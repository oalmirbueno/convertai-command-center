-- MCP OAuth client binding: redirect-origin and privilege contract.
-- All fixtures are rolled back and no token or user data is used.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT * FROM no_plan();

SELECT ok(
  to_regclass('public.mcp_oauth_allowed_redirect_origins') IS NOT NULL,
  'MCP OAuth redirect-origin allowlist exists'
);

SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.mcp_oauth_allowed_redirect_origins'::regclass
  ),
  'MCP OAuth redirect-origin allowlist has RLS enabled'
);

SELECT is(
  has_table_privilege(
    'authenticated',
    'public.mcp_oauth_allowed_redirect_origins',
    'SELECT'
  ),
  false,
  'authenticated cannot enumerate trusted OAuth redirect origins'
);

SELECT is(
  has_function_privilege(
    'authenticated',
    'public.is_allowed_mcp_oauth_client(uuid)',
    'EXECUTE'
  ),
  false,
  'authenticated cannot invoke the OAuth client validator'
);

INSERT INTO auth.oauth_clients (
  id,
  registration_type,
  redirect_uris,
  grant_types,
  client_name,
  client_type,
  token_endpoint_auth_method
)
VALUES
  (
    '00000000-0000-4000-8000-000000000101',
    'dynamic',
    'https://chatgpt.com/connector/oauth/test',
    'authorization_code,refresh_token',
    'pgTAP allowed MCP client',
    'public',
    'none'
  ),
  (
    '00000000-0000-4000-8000-000000000102',
    'dynamic',
    'https://chatgpt.com.evil.example/connector/oauth/test',
    'authorization_code,refresh_token',
    'pgTAP denied MCP client',
    'public',
    'none'
  ),
  (
    '00000000-0000-4000-8000-000000000103',
    'dynamic',
    'https://chatgpt.com/connector/oauth/test, https://attacker.example/oauth/callback',
    'authorization_code,refresh_token',
    'pgTAP mixed-origin MCP client',
    'public',
    'none'
  );

SELECT is(
  public.is_allowed_mcp_oauth_client(
    '00000000-0000-4000-8000-000000000101'
  ),
  true,
  'exact ChatGPT redirect origin is accepted'
);

SELECT is(
  public.is_allowed_mcp_oauth_client(
    '00000000-0000-4000-8000-000000000102'
  ),
  false,
  'lookalike redirect origin is rejected'
);

SELECT is(
  public.is_allowed_mcp_oauth_client(
    '00000000-0000-4000-8000-000000000103'
  ),
  false,
  'a trusted first redirect cannot hide a later untrusted origin'
);

SELECT * FROM finish();
ROLLBACK;
