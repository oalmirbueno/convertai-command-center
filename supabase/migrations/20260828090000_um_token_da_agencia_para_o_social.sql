-- Um token da agencia cobre todas as contas, como ja acontece nos anuncios.
--
-- O RELATO: "vai dar uma trabalheira conectar todos os usuarios de sistema
-- na meta, deixe melhor e que eu consiga ver todos so com o login de admin".
--
-- O DESENHO ATUAL, e por que ele da trabalho: cada conta de Instagram
-- precisa do PROPRIO grant em social_private.external_account_grants, com
-- o proprio token no cofre. Doze contas, doze conexoes, doze tokens que um
-- dia expiram em doze momentos diferentes. E cada cliente novo repete o
-- ritual inteiro antes de aparecer qualquer numero.
--
-- O CAMINHO JA EXISTE NESTA CASA, do lado dos anuncios: em
-- social_private.ads_tokens, external_account_id NULO significa "vale para
-- todas as contas" — o token do Business Manager, um so, cobrindo a
-- carteira inteira. E o desenho certo, e o social nao tinha.
--
-- O QUE TORNA ISSO POSSIVEL SEM ADIVINHAR NADA: conferi as nove contas
-- conectadas hoje e, em TODAS, external_accounts.external_id e identico ao
-- provider_resource_id do grant. Ou seja, o painel JA sabe o id de cada
-- Instagram. Falta so um token que fale por todos eles.
--
-- A ORDEM DE PRECEDENCIA, e ela importa: o grant da propria conta ganha do
-- token da agencia. Assim o cliente que roda fora do Business Manager da
-- Aceleriq continua funcionando exatamente como antes, e ligar o token da
-- agencia NAO quebra nem substitui nenhuma conexao existente.
--
-- Rodar de novo nao faz mal.

-- ─────────────────── 1) O token unico, no cofre ──────────────────────────

create table if not exists social_private.social_agency_tokens (
  id uuid primary key default gen_random_uuid(),
  access_token_secret_id uuid not null,
  label text not null,
  saved_by uuid references public.profiles(id),
  saved_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table social_private.social_agency_tokens enable row level security;

-- Um ativo por vez. Sem isto daria para gravar dois e nunca se saber qual
-- valeu, o mesmo cuidado que ads_tokens ja toma.
create unique index if not exists social_agency_token_unico_ativo
  on social_private.social_agency_tokens ((true)) where revoked_at is null;

/**
 * Guarda o token de leitura do Business Manager. So administrador.
 *
 * O token vai para o cofre e nunca mais e devolvido por nenhuma leitura:
 * a tabela guarda o ID do segredo, nao o segredo.
 */
create or replace function public.save_meta_social_token(
  _token text,
  _label text default 'Token da agência'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  _secret_id uuid;
  _id uuid;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'somente administrador pode guardar o token social';
  end if;
  if btrim(coalesce(_token, '')) = '' then
    raise exception 'token vazio';
  end if;

  update social_private.social_agency_tokens
     set revoked_at = now()
   where revoked_at is null;

  select vault.create_secret(
    btrim(_token),
    'meta-social-' || gen_random_uuid()::text,
    'Token de leitura do Instagram (Business Manager)',
    null
  ) into _secret_id;

  insert into social_private.social_agency_tokens
    (access_token_secret_id, label, saved_by)
  values (_secret_id, btrim(_label), auth.uid())
  returning id into _id;

  return jsonb_build_object('id', _id, 'saved_at', now());
end;
$fn$;

revoke execute on function public.save_meta_social_token(text, text) from anon;
grant execute on function public.save_meta_social_token(text, text) to authenticated;

-- ──────────── 2) A resolucao: conta primeiro, agencia depois ─────────────

/**
 * Resolve o token que vale para uma conta.
 *
 * 1. O grant da propria conta, se existir. Cliente que roda fora do
 *    Business Manager da agencia continua funcionando como antes.
 * 2. Senao, o token da agencia, casado com o external_id que a conta ja
 *    guarda. Uma conexao, todas as contas.
 *
 * Os dois ramos sao MUTUAMENTE EXCLUSIVOS: o segundo exige que nao exista
 * grant proprio. Por isso o LIMIT 1 no fim e deterministico mesmo sem
 * ORDER BY. Quem for mexer aqui precisa preservar essa exclusao, senao o
 * token que vence passa a depender da ordem que o banco resolveu usar
 * naquele dia.
 *
 * Conta sem external_id nao resolve pelo caminho 2, e isso e proposital:
 * sem o id do Instagram nao ha o que consultar, e inventar um id daria
 * numero de outra conta no relatorio de um cliente.
 */
create or replace function social_private.autopublish_account_token(_external_account_id uuid)
returns table(resource_id text, access_token text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select grant_row.provider_resource_id, secret_row.decrypted_secret
    from social_private.external_account_grants as grant_row
    join vault.decrypted_secrets as secret_row
      on secret_row.id = grant_row.resource_access_token_secret_id
   where grant_row.external_account_id = _external_account_id
     and grant_row.revoked_at is null
     and grant_row.platform = 'instagram'

  union all

  select account.external_id, secret_row.decrypted_secret
    from public.external_accounts as account
   cross join social_private.social_agency_tokens as agency
    join vault.decrypted_secrets as secret_row
      on secret_row.id = agency.access_token_secret_id
   where account.id = _external_account_id
     and account.platform = 'instagram'
     and account.external_id is not null
     and agency.revoked_at is null
     -- So cai aqui quem nao tem grant proprio: a conta manda no seu token.
     and not exists (
       select 1 from social_private.external_account_grants as g
        where g.external_account_id = _external_account_id
          and g.revoked_at is null
          and g.platform = 'instagram'
     )

  limit 1;
$fn$;

-- ─────────────── 3) O que o Business Manager enxerga ─────────────────────

/**
 * Lista as contas de Instagram que o token da agencia alcanca.
 *
 * SO LEITURA, e de proposito: ela mostra o que existe no Business Manager
 * para voce casar com os clientes do painel, mas nao escreve external_id
 * em conta nenhuma. Casar por nome parecido gravaria o Instagram de um
 * cliente na ficha de outro, e dai o relatorio inteiro mente sem nenhum
 * erro aparecer. Esse casamento e um gesto de gente.
 */
create or replace function public.social_contas_do_business_manager()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  _token text;
  _rid bigint;
begin
  if not public.is_staff(auth.uid()) then
    raise exception 'somente a equipe pode consultar o Business Manager';
  end if;

  select secret_row.decrypted_secret into _token
    from social_private.social_agency_tokens as agency
    join vault.decrypted_secrets as secret_row
      on secret_row.id = agency.access_token_secret_id
   where agency.revoked_at is null
   limit 1;

  if _token is null then
    return jsonb_build_object(
      'ok', false,
      'motivo', 'Nenhum token da agencia guardado. Cole o token primeiro.'
    );
  end if;

  select net.http_get(
    url := 'https://graph.facebook.com/v21.0/me/accounts'
        || '?fields=name,instagram_business_account{id,username,name}'
        || '&limit=100&access_token=' || _token
  ) into _rid;

  return jsonb_build_object(
    'ok', true,
    'request_id', _rid,
    'como_ler', 'A resposta chega em alguns segundos. Consulte o corpo pelo request_id.'
  );
end;
$fn$;

revoke execute on function public.social_contas_do_business_manager() from anon;
grant execute on function public.social_contas_do_business_manager() to authenticated;

-- ──────────────── 4) Atualizar agora, sem esperar o robo ─────────────────

/**
 * O botao "atualizar" de verdade: colhe na hora, como ja existe nos
 * anuncios (collect_ads_metrics_now). Numero que so muda de dez em dez
 * minutos parece travado para quem esta olhando a tela.
 *
 * Roda o ciclo DUAS vezes: a primeira despacha os pedidos, a segunda le o
 * que ja voltou. Sem isso, apertar o botao devolveria zero lidos e
 * pareceria que nada aconteceu.
 *
 * O FORMATO DE VOLTA E O MESMO DE ANTES — {week_start, dispatched,
 * parsed} — de proposito. Esta funcao ja existia e a tela ja le esses tres
 * campos para montar a mensagem. Trocar a forma faria o `dispatched` virar
 * indefinido e a tela dizer "tudo em dia" justamente quando acabou de
 * disparar trinta chamadas. Funcao publica que muda de formato quebra
 * quem depende dela em silencio.
 */
create or replace function public.collect_social_metrics_now()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  _ida jsonb;
  _volta jsonb;
begin
  if not public.is_staff(auth.uid()) then
    raise exception 'somente a equipe pode atualizar as metricas';
  end if;

  _ida := public.social_metrics_ciclo();
  perform pg_sleep(2);
  _volta := public.social_metrics_ciclo();

  return jsonb_build_object(
    'week_start', _ida->'tick'->>'week_start',
    'dispatched',
      coalesce((_ida->'retrato_de_hoje'->>'despachados')::int, 0)
      + coalesce((_ida->'tick'->>'dispatched')::int, 0)
      + coalesce((_volta->'retrato_de_hoje'->>'despachados')::int, 0)
      + coalesce((_volta->'tick'->>'dispatched')::int, 0),
    'parsed',
      coalesce((_ida->'tick'->>'parsed')::int, 0)
      + coalesce((_volta->'tick'->>'parsed')::int, 0)
  );
end;
$fn$;

revoke execute on function public.collect_social_metrics_now() from anon;
grant execute on function public.collect_social_metrics_now() to authenticated;
