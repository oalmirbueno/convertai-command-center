-- Frente IG, rodada 2 (28/09/2026): a aba Redes lê as páginas do Facebook do cliente.
-- Função: supabase/functions/mesa-instagram (ação "pagina").
--
-- Só cria uma função de leitura, idempotente. Devolve o token de cada página
-- do Facebook CONECTADA AO PRÓPRIO CLIENTE (nunca de outro cliente, nunca da
-- agência). Só a service_role executa: o token nunca sai da função de borda.
-- Não mexe em can_access_client (quem chama a função já foi conferido lá).
-- Sem esta função, a aba tenta o token das contas do Instagram do cliente
-- (que também é token de página) e avisa quando não dá.

CREATE OR REPLACE FUNCTION public.mesa_facebook_token(_client_id uuid)
RETURNS TABLE (external_account_id uuid, page_id text, access_token text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    account.id,
    grant_row.provider_resource_id,
    secret_row.decrypted_secret
  FROM public.external_accounts AS account
  JOIN social_private.external_account_grants AS grant_row
    ON grant_row.external_account_id = account.id
   AND grant_row.client_id = account.client_id
   AND grant_row.revoked_at IS NULL
   AND grant_row.platform = 'facebook'
  JOIN vault.decrypted_secrets AS secret_row
    ON secret_row.id = grant_row.resource_access_token_secret_id
  WHERE account.client_id = _client_id
    AND account.platform = 'facebook'
    AND account.status = 'active'
    AND grant_row.provider_resource_id IS NOT NULL
  ORDER BY account.updated_at DESC
  LIMIT 10;
$function$;

REVOKE ALL ON FUNCTION public.mesa_facebook_token(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_facebook_token(uuid) TO service_role;

COMMENT ON FUNCTION public.mesa_facebook_token(uuid) IS
  'Aba Redes da Mesa (frente IG): token de cada página do Facebook do próprio cliente, só para a service_role (função mesa-instagram).';

-- Conferência (só leitura, depois de aplicar):
-- select p.proname, p.prosecdef, pg_get_function_identity_arguments(p.oid) from pg_proc p where p.proname = 'mesa_facebook_token';
-- select grantee, privilege_type from information_schema.routine_privileges where routine_name = 'mesa_facebook_token' order by 1;
-- select count(*) from public.mesa_facebook_token('4dd691a7-d481-451f-800b-5e6b6fdc8721');  -- como service_role: 2 páginas da AcelerIQ
