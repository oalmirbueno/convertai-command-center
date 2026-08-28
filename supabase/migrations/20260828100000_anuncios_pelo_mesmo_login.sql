-- Conectar anuncios vira o mesmo clique que conecta o Instagram.
--
-- O RELATO, e ele corrige o rumo que eu tinha tomado: "o social, metricas
-- e agendamentos esta correto, a dificuldade era mesmo o de anuncios, com
-- esse token que nem sei onde pega, e tem que ficar adicionando usuario do
-- sistema, da uma trabalheira danada".
--
-- Ele esta certo. Sao dois desenhos diferentes para o mesmo Business
-- Manager, e o dos anuncios e o pior:
--
--   Instagram  ->  um login, uma tela de consentimento, o painel puxa as
--                  contas sozinho. Funciona, e e o que ele quer copiar.
--   Anuncios   ->  criar usuario do sistema no Business Manager, atribuir
--                  ativo por ativo, gerar token, copiar antes que suma,
--                  colar no painel. Por conta.
--
-- O QUE TORNA A TROCA POSSIVEL SEM NADA NOVO: o login que ja existe termina
-- guardando um token de USUARIO de longa duracao. Se esse token tiver a
-- permissao `ads_read`, ele ja consegue ler todas as contas de anuncio a
-- que a pessoa tem acesso. Nao falta infraestrutura: falta so aproveitar o
-- token que ja passa pela nossa mao.
--
-- Esta migration abre a porta do lado do banco. A funcao aqui e chamada
-- pelo servico durante o login, quando (e somente quando) a permissao de
-- anuncios tiver sido concedida.
--
-- POR QUE UMA FUNCAO SEPARADA da save_meta_ads_token: aquela exige
-- `has_role(auth.uid(), 'admin')`, e durante o login quem escreve e o
-- servico, sem usuario na sessao. Reaproveita-la exigiria afrouxar a regra
-- de quem pode gravar token — e essa regra e boa. Melhor uma porta
-- estreita, exclusiva do servico, do que alargar a porta larga.
--
-- Rodar de novo nao faz mal.

/**
 * Guarda o token de anuncios colhido no login, valendo para TODAS as contas.
 *
 * `external_account_id` nulo em ads_tokens ja significa "vale para toda a
 * carteira" — o desenho que os anuncios sempre tiveram e que ninguem
 * conseguia alimentar sem o ritual do usuario do sistema.
 *
 * Idempotente por token: se o mesmo texto ja estiver guardado e ativo, nao
 * cria outro nem revoga o que funciona. Sem isso, cada reconexao de
 * Instagram giraria o token de anuncios a toa.
 */
create or replace function public.save_meta_ads_token_from_login(
  _token text,
  _label text default 'Token do login da Meta'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  _secret_id uuid;
  _id uuid;
  _igual boolean;
begin
  if btrim(coalesce(_token, '')) = '' then
    raise exception 'token vazio';
  end if;

  -- Ja e exatamente este token, e esta ativo? Entao nao ha o que fazer.
  select exists (
    select 1
      from social_private.ads_tokens as t
      join vault.decrypted_secrets as s on s.id = t.access_token_secret_id
     where t.revoked_at is null
       and t.external_account_id is null
       and s.decrypted_secret = btrim(_token)
  ) into _igual;

  if _igual then
    return jsonb_build_object('ok', true, 'mudou', false);
  end if;

  update social_private.ads_tokens
     set revoked_at = now()
   where revoked_at is null
     and external_account_id is null;

  select vault.create_secret(
    btrim(_token),
    'meta-ads-login-' || gen_random_uuid()::text,
    'Token de leitura do Meta Ads, vindo do login da Meta',
    null
  ) into _secret_id;

  insert into social_private.ads_tokens
    (external_account_id, access_token_secret_id, label, saved_by)
  values (null, _secret_id, btrim(_label), null)
  returning id into _id;

  return jsonb_build_object('ok', true, 'mudou', true, 'id', _id);
end;
$fn$;

-- Porta estreita: so o servico, durante o login. Ninguem mais.
revoke execute on function public.save_meta_ads_token_from_login(text, text) from anon, authenticated;
grant execute on function public.save_meta_ads_token_from_login(text, text) to service_role;

/**
 * As contas de anuncio que o painel ja consegue ler, e a quem pertencem.
 *
 * Serve a tela de /anuncios: mostrar de uma vez o que existe do lado da
 * Meta e o que ja esta ligado a um cliente, para ligar o resto num clique
 * em vez de digitar numero de conta.
 *
 * Ela NAO liga nada sozinha. Casar conta de anuncio com cliente por nome
 * parecido colocaria o investimento de um no relatorio de outro, e
 * dinheiro trocado de dono e o tipo de erro que ninguem percebe olhando a
 * tela — so no fim do mes.
 */
create or replace function public.ads_contas_conhecidas()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    'tem_token_da_carteira', exists (
      select 1 from social_private.ads_tokens
       where revoked_at is null and external_account_id is null
    ),
    'contas', coalesce(jsonb_agg(jsonb_build_object(
      'external_account_id', c.id,
      'numero', c.external_id,
      'nome', c.display_name,
      'cliente', c.cliente,
      'tem_token_proprio', c.proprio,
      'campanhas_colhidas', c.campanhas
    ) order by c.cliente nulls last, c.nome), '[]'::jsonb)
  )
  from (
    select account.id, account.external_id, account.display_name,
           coalesce(nullif(btrim(pr.company_name), ''), pr.full_name) as cliente,
           exists (
             select 1 from social_private.ads_tokens t
              where t.revoked_at is null and t.external_account_id = account.id
           ) as proprio,
           (select count(*) from public.ads_campaigns k
             where k.external_account_id = account.id) as campanhas,
           account.display_name as nome
      from public.external_accounts as account
      left join public.profiles as pr on pr.id = account.client_id
     where account.platform = 'meta_ads'
  ) as c
$fn$;

revoke execute on function public.ads_contas_conhecidas() from anon;
grant execute on function public.ads_contas_conhecidas() to authenticated;
