-- API key audience isolation. Fixtures are synthetic hashes and are rolled back.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT * FROM no_plan();

SELECT has_column(
  'public',
  'api_keys',
  'audience',
  'api_keys carries an explicit credential audience'
);

SELECT is(
  has_function_privilege(
    'authenticated',
    'public.validate_api_key_for_audience(text,text)',
    'EXECUTE'
  ),
  false,
  'authenticated cannot invoke the audience validator'
);

SELECT is(
  has_function_privilege(
    'service_role',
    'public.validate_api_key_for_audience(text,text)',
    'EXECUTE'
  ),
  true,
  'service_role can invoke the audience validator'
);

INSERT INTO public.api_keys (
  name,
  key_hash,
  key_preview,
  scopes,
  origin,
  audience
)
VALUES
  (
    'pgTAP API gateway key',
    'pgtap-api-gateway-hash',
    'pgtap-api...',
    ARRAY['projects:read']::text[],
    'api-docs',
    'api-gateway'
  ),
  (
    'pgTAP MCP key',
    'pgtap-mcp-hash',
    'pgtap-mcp...',
    ARRAY['projects:read']::text[],
    'mcp',
    'mcp'
  ),
  (
    'pgTAP legacy key',
    'pgtap-legacy-hash',
    'pgtap-old...',
    ARRAY['projects:read']::text[],
    NULL,
    NULL
  );

SELECT is(
  (SELECT count(*) FROM public.validate_api_key_for_audience(
    'pgtap-api-gateway-hash',
    'api-gateway'
  )),
  1::bigint,
  'gateway key validates for its exact audience'
);

SELECT is(
  (SELECT count(*) FROM public.validate_api_key_for_audience(
    'pgtap-mcp-hash',
    'api-gateway'
  )),
  0::bigint,
  'MCP key cannot validate for the API gateway'
);

SELECT is(
  (SELECT count(*) FROM public.validate_api_key_for_audience(
    'pgtap-api-gateway-hash',
    'mcp'
  )),
  0::bigint,
  'API gateway key cannot validate for MCP'
);

SELECT is(
  (SELECT count(*) FROM public.validate_api_key_for_audience(
    'pgtap-legacy-hash',
    'api-gateway'
  )),
  0::bigint,
  'legacy key without audience fails closed'
);

SELECT * FROM finish();
ROLLBACK;
