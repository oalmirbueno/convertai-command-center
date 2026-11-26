-- MCP 2.39.0 (25/11/2026): token EXATO de uma conta orgânica da Meta, para o teste ao vivo
-- (debug_token) de aceleriq_meta_conexoes_estado. Só leitura; uma função; nada de tabela, ACL de
-- tabela ou Vault muda.
--
-- Por que nova: perfis_instagram_token(_client_id) devolve até 2 linhas e cai para a conta da agência;
-- mesa_facebook_token(_client_id) devolve até 10 páginas por cliente. Nenhuma das duas responde "a
-- credencial desta conta e só dela", e o inventário não pode testar com credencial de outra conta.
--
-- Entrada: o que a leitura de metadados (meta_usuario_do_sistema_contas) mostrou. Se algo mudou entre
-- as duas leituras, a função não devolve nada e a ferramenta mostra nao_verificado
-- (credencial_nao_localizada_ou_trocada); nunca procura outra credencial.
--   _external_account_id  conta do painel
--   _grant_id             concessão vista (oauth_grants.id)
--   _client_id            ficha do cliente (profiles.id), dona da conta
--   _platform             'instagram' ou 'facebook' esperada
--   _provider_resource_id id da Meta esperado (só dígitos)
--
-- Vínculo estrito (todas as condições):
--   - conta ativa, da plataforma e do id da Meta esperados, da ficha informada;
--   - ficha é cliente ativo: user_roles role=client, profiles.plan_status=active, sem deleted_at;
--   - mapeamento não revogado da PRÓPRIA conta: mesmo dono, mesma plataforma, mesmo recurso,
--     provider='meta' e apontando para a concessão vista;
--   - concessão provider='meta', do mesmo dono, status active e sem prazo vencido (token e dados).
-- No máximo 1 linha. Sem chamada externa. Só a service_role executa.
--
-- Preflight (só leitura, antes de aplicar):
--   select count(*) from pg_proc where proname = 'meta_conexao_token_da_conta';            -- esperado 0
--   select to_regclass('social_private.external_account_grants'), to_regclass('social_private.oauth_grants'),
--          to_regclass('public.external_accounts'), to_regclass('public.user_roles');        -- nenhum null
--   select count(*) from information_schema.columns
--    where (table_schema, table_name, column_name) in (
--      ('social_private', 'oauth_grants', 'client_id'), ('social_private', 'oauth_grants', 'provider'),
--      ('social_private', 'oauth_grants', 'status'), ('social_private', 'external_account_grants', 'provider'),
--      ('social_private', 'external_account_grants', 'grant_id'));                          -- esperado 5
--
-- Rollback lógico (não apaga dado nenhum; a ferramenta volta a mostrar nao_verificado):
--   DROP FUNCTION IF EXISTS public.meta_conexao_token_da_conta(uuid, uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION public.meta_conexao_token_da_conta(
  _external_account_id uuid,
  _grant_id uuid,
  _client_id uuid,
  _platform text,
  _provider_resource_id text
)
RETURNS TABLE (access_token text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT secret_row.decrypted_secret
  FROM public.external_accounts AS account
  JOIN public.profiles AS owner_profile
    ON owner_profile.id = account.client_id
   AND owner_profile.plan_status = 'active'
   AND owner_profile.deleted_at IS NULL
  JOIN social_private.external_account_grants AS mapping
    ON mapping.external_account_id = account.id
   AND mapping.client_id = account.client_id
   AND mapping.platform = account.platform
   AND mapping.provider_resource_id = account.external_id
   AND mapping.provider = 'meta'
   AND mapping.grant_id = _grant_id
   AND mapping.revoked_at IS NULL
  JOIN social_private.oauth_grants AS grant_row
    ON grant_row.id = mapping.grant_id
   AND grant_row.client_id = account.client_id
   AND grant_row.provider = 'meta'
   AND grant_row.status = 'active'
   AND (grant_row.access_token_expires_at IS NULL OR grant_row.access_token_expires_at > now())
   AND (grant_row.data_access_expires_at IS NULL OR grant_row.data_access_expires_at > now())
  JOIN vault.decrypted_secrets AS secret_row
    ON secret_row.id = mapping.resource_access_token_secret_id
  WHERE _external_account_id IS NOT NULL
    AND _grant_id IS NOT NULL
    AND _client_id IS NOT NULL
    AND _platform IN ('instagram', 'facebook')
    AND _provider_resource_id ~ '^[0-9]{1,64}$'
    AND account.id = _external_account_id
    AND account.client_id = _client_id
    AND account.platform = _platform
    AND account.external_id = _provider_resource_id
    AND account.status = 'active'
    AND EXISTS (
      SELECT 1 FROM public.user_roles AS role_row
      WHERE role_row.user_id = _client_id
        AND role_row.role = 'client'::public.app_role
    )
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.meta_conexao_token_da_conta(uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_conexao_token_da_conta(uuid, uuid, uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.meta_conexao_token_da_conta(uuid, uuid, uuid, text, text) IS
  'MCP aceleriq_meta_conexoes_estado: token exato de UMA conta orgânica (IG/FB) de cliente ativo, presa à concessão vista, à ficha, à plataforma e ao recurso esperados. Só service_role; o token nunca sai da função de borda.';

-- Conferência (só leitura, depois de aplicar):
--   select p.prosecdef, p.provolatile, p.proconfig from pg_proc p where p.proname = 'meta_conexao_token_da_conta';
--     -- esperado: true, 's', {search_path=""}
--   select grantee, privilege_type from information_schema.routine_privileges
--    where routine_name = 'meta_conexao_token_da_conta' order by 1;                       -- só service_role (e o dono)
