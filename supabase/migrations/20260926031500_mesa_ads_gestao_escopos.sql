-- Frente X, rodada 2 (26/09): gestão de campanhas preparada na Mesa Ads.
-- Só amplia e é idempotente. Sem este SQL a função mesa-ads funciona igual:
-- usa ads_token_para_biblioteca e confere /me/permissions na Meta a cada
-- pedido (com cache curto na memória da função).
--
-- 1) O resultado da última conferência de permissões fica junto do token
--    (onde o token de anúncios já mora), para a tela não perguntar à Meta a
--    cada abertura.
alter table social_private.ads_tokens
  add column if not exists escopos text[],
  add column if not exists escopos_conferidos_em timestamptz;

-- 2) O token que vale para as ações do cliente, com o id e a última
--    conferência. Mesma escolha da coleta (social_private.ads_account_token):
--    o token próprio da conta; senão o do perfil que ENXERGA a conta do
--    cliente; senão o mais recente da carteira. _client_id nulo (tela
--    /anuncios): o token mais recente da carteira.
create or replace function public.ads_token_de_gestao(_client_id uuid)
returns table (token_id uuid, token text, escopos text[], conferido_em timestamptz)
language sql
stable
security definer
set search_path = ''
as $fn$
  select t.id, s.decrypted_secret, t.escopos, t.escopos_conferidos_em
  from social_private.ads_tokens as t
  join vault.decrypted_secrets as s on s.id = t.access_token_secret_id
  left join public.external_accounts as proprio on proprio.id = t.external_account_id
  where t.revoked_at is null
    and (
      t.external_account_id is null
      or (_client_id is not null and proprio.client_id = _client_id and proprio.platform = 'meta_ads')
    )
  order by
    (t.external_account_id is null),
    (not exists (
      select 1 from public.external_accounts as a
       where _client_id is not null
         and a.client_id = _client_id
         and a.platform = 'meta_ads'
         and a.external_id = any (coalesce(t.contas, '{}'::text[]))
    )),
    t.saved_at desc
  limit 1;
$fn$;

revoke all on function public.ads_token_de_gestao(uuid) from public, anon, authenticated;
grant execute on function public.ads_token_de_gestao(uuid) to service_role;

-- 3) Grava a conferência (só a função, com a chave de serviço).
create or replace function public.ads_token_registrar_escopos(_token_id uuid, _escopos text[])
returns void
language sql
volatile
security definer
set search_path = ''
as $fn$
  update social_private.ads_tokens
     set escopos = coalesce(_escopos, '{}'::text[]),
         escopos_conferidos_em = now()
   where id = _token_id;
$fn$;

revoke all on function public.ads_token_registrar_escopos(uuid, text[]) from public, anon, authenticated;
grant execute on function public.ads_token_registrar_escopos(uuid, text[]) to service_role;
