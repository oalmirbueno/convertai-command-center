-- API gateway owner, tenant scope and atomic quota contracts.
-- All credentials and UUIDs are synthetic; the transaction is rolled back.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT * FROM no_plan();

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text,
    true
  );
  EXECUTE 'SET LOCAL ROLE authenticated';
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.act_as_owner() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
END
$$;

SELECT has_column(
  'public',
  'api_keys',
  'client_scope_mode',
  'API keys carry a fail-closed client scope mode'
);

SELECT has_table(
  'api_gateway_private',
  'api_gateway_key_client_scopes',
  'explicit API gateway client scopes live in a private table'
);

SELECT has_table(
  'api_gateway_private',
  'api_gateway_rate_limits',
  'API gateway rate counters live in a private table'
);

SELECT is(
  has_schema_privilege('anon', 'api_gateway_private', 'USAGE'),
  false,
  'anonymous callers cannot use the private schema'
);

SELECT is(
  has_table_privilege(
    'authenticated',
    'api_gateway_private.api_gateway_key_client_scopes',
    'SELECT'
  ),
  false,
  'authenticated users cannot enumerate key tenant scopes'
);

SELECT is(
  has_table_privilege(
    'authenticated',
    'api_gateway_private.api_gateway_rate_limits',
    'SELECT'
  ),
  false,
  'authenticated users cannot enumerate gateway rate counters'
);

SELECT is(
  has_table_privilege(
    'service_role',
    'api_gateway_private.api_gateway_key_client_scopes',
    'SELECT'
  ),
  false,
  'service role reaches key tenant scopes only through locked RPCs'
);

SELECT ok(
  (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_class
    WHERE oid = 'api_gateway_private.api_gateway_key_client_scopes'::regclass
  ),
  'explicit key mappings have enabled and forced RLS'
);

SELECT ok(
  (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_class
    WHERE oid = 'api_gateway_private.api_gateway_rate_limits'::regclass
  ),
  'gateway rate counters have enabled and forced RLS'
);

SELECT ok(
  to_regprocedure('public.validate_api_key(text)') IS NOT NULL,
  'the legacy key validator remains during the EXPAND compatibility window'
);

SELECT is(
  has_function_privilege(
    'service_role',
    'public.validate_api_key(text)',
    'EXECUTE'
  ),
  true,
  'only the server runtime keeps access to the compatibility validator'
);

SELECT is(
  has_function_privilege(
    'authenticated',
    'public.validate_api_key(text)',
    'EXECUTE'
  ),
  false,
  'authenticated clients cannot call the compatibility validator'
);

SELECT is(
  has_function_privilege(
    'anon',
    'public.validate_api_key(text)',
    'EXECUTE'
  ),
  false,
  'anonymous clients cannot call the compatibility validator'
);

SELECT ok(
  (
    SELECT procedure_row.prosecdef
      AND procedure_row.proconfig @> ARRAY['search_path=""']::text[]
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid =
      'public.validate_api_key(text)'::regprocedure
  ),
  'the compatibility validator is SECURITY DEFINER with an empty search path'
);

SELECT has_index(
  'public',
  'api_keys',
  'api_keys_active_key_hash_unique_idx',
  'active API key fingerprints are unique'
);

SELECT ok(
  (
    SELECT index_row.indisunique
    FROM pg_index AS index_row
    WHERE index_row.indexrelid =
      'public.api_keys_active_key_hash_unique_idx'::regclass
  ),
  'the active API key fingerprint index is unique'
);

SELECT has_index(
  'api_gateway_private',
  'api_gateway_rate_limits',
  'api_gateway_rate_limits_retention_idx',
  'gateway quota retention cleanup is indexed by window time'
);

SELECT is(
  has_function_privilege(
    'anon',
    'public.configure_api_gateway_key_scope(uuid,text,uuid[])',
    'EXECUTE'
  ),
  false,
  'anonymous callers cannot configure API gateway tenant scope'
);

SELECT is(
  has_function_privilege(
    'authenticated',
    'public.configure_api_gateway_key_scope(uuid,text,uuid[])',
    'EXECUTE'
  ),
  true,
  'authenticated administrators can reach the guarded scope RPC'
);

SELECT is(
  has_function_privilege(
    'service_role',
    'public.configure_api_gateway_key_scope(uuid,text,uuid[])',
    'EXECUTE'
  ),
  false,
  'service role has no direct grant to the administrator scope RPC'
);

SELECT ok(
  (
    SELECT procedure_row.prosecdef
      AND procedure_row.proconfig @> ARRAY['search_path=""']::text[]
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid =
      'public.configure_api_gateway_key_scope(uuid,text,uuid[])'::regprocedure
  ),
  'scope configuration is SECURITY DEFINER with an empty search path'
);

SELECT is(
  has_function_privilege(
    'authenticated',
    'public.consume_api_gateway_rate_limit(text)',
    'EXECUTE'
  ),
  false,
  'authenticated users cannot consume or probe the gateway quota RPC'
);

SELECT is(
  has_function_privilege(
    'service_role',
    'public.consume_api_gateway_rate_limit(text)',
    'EXECUTE'
  ),
  true,
  'the Edge Function service role can consume the gateway quota RPC'
);

INSERT INTO auth.users (id, email)
VALUES
  ('a9000000-0000-4000-8000-000000000001', 'gateway-admin@test.local'),
  ('a9000000-0000-4000-8000-00000000000a', 'gateway-client-a@test.local'),
  ('a9000000-0000-4000-8000-00000000000b', 'gateway-client-b@test.local');

DELETE FROM public.user_roles
WHERE user_id = 'a9000000-0000-4000-8000-000000000001';

INSERT INTO public.user_roles (user_id, role)
VALUES (
  'a9000000-0000-4000-8000-000000000001',
  'admin'::public.app_role
);

INSERT INTO public.api_keys (
  id,
  name,
  key_hash,
  key_preview,
  scopes,
  origin,
  audience,
  created_by
)
VALUES
  (
    'b9000000-0000-4000-8000-000000000010',
    'pgTAP legacy gateway key',
    'pgtap-legacy-gateway-hash',
    'pgtap-legacy...',
    ARRAY['gateway:discover']::text[],
    NULL,
    NULL,
    'a9000000-0000-4000-8000-000000000001'
  ),
  (
    'b9000000-0000-4000-8000-000000000011',
    'pgTAP MCP key',
    'pgtap-mcp-audience-hash',
    'pgtap-mcp...',
    ARRAY['aceleriq:read']::text[],
    'mcp',
    'mcp',
    'a9000000-0000-4000-8000-000000000001'
  ),
  (
    'b9000000-0000-4000-8000-000000000012',
    'pgTAP legacy-shaped MCP key',
    'pgtap-mcp-origin-hash',
    'pgtap-mcp-origin...',
    ARRAY['aceleriq:read']::text[],
    'mcp',
    NULL,
    'a9000000-0000-4000-8000-000000000001'
  );

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.validate_api_key('pgtap-legacy-gateway-hash')
  ),
  1,
  'the EXPAND validator keeps only a legacy audience-null non-MCP key working'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.validate_api_key('pgtap-mcp-audience-hash')
  ),
  0,
  'the EXPAND validator never crosses an MCP key into the API gateway'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.validate_api_key('pgtap-mcp-origin-hash')
  ),
  0,
  'the EXPAND validator rejects an audience-null key marked with MCP origin'
);

INSERT INTO public.api_keys (
  id,
  name,
  key_hash,
  key_preview,
  scopes,
  origin,
  audience,
  created_by
)
VALUES (
  'b9000000-0000-4000-8000-000000000001',
  'pgTAP existing none key',
  'pgtap-gateway-none-hash',
  'pgtap-none...',
  ARRAY['gateway:discover', 'projects:read']::text[],
  'api-docs',
  'api-gateway',
  'a9000000-0000-4000-8000-000000000001'
);

SELECT is(
  (
    SELECT client_scope_mode
    FROM public.api_keys
    WHERE id = 'b9000000-0000-4000-8000-000000000001'
  ),
  'none',
  'new and backfilled keys default to discovery-only none scope'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.validate_api_key('pgtap-gateway-none-hash')
  ),
  1,
  'the old Edge accepts a reviewed audience-bound gateway key during rotation'
);

INSERT INTO public.api_keys (
  id,
  name,
  key_hash,
  key_preview,
  scopes,
  origin,
  audience,
  created_by,
  client_scope_mode
)
VALUES
  (
    'b9000000-0000-4000-8000-000000000002',
    'pgTAP explicit key',
    'pgtap-gateway-explicit-hash',
    'pgtap-explicit...',
    ARRAY['gateway:discover', 'projects:read']::text[],
    'api-docs',
    'api-gateway',
    'a9000000-0000-4000-8000-000000000001',
    'explicit'
  ),
  (
    'b9000000-0000-4000-8000-000000000003',
    'pgTAP all key',
    'pgtap-gateway-all-hash',
    'pgtap-all...',
    ARRAY['gateway:discover', 'projects:read', 'team:read']::text[],
    'api-docs',
    'api-gateway',
    'a9000000-0000-4000-8000-000000000001',
    'all'
  );

INSERT INTO api_gateway_private.api_gateway_key_client_scopes (key_id, client_id)
VALUES (
  'b9000000-0000-4000-8000-000000000002',
  'a9000000-0000-4000-8000-00000000000a'
);

SELECT is(
  (
    SELECT owner_is_admin
    FROM public.validate_api_key_for_audience(
      'pgtap-gateway-explicit-hash',
      'api-gateway'
    )
  ),
  true,
  'validator confirms the key owner is currently an admin'
);

SELECT is(
  (
    SELECT client_ids
    FROM public.validate_api_key_for_audience(
      'pgtap-gateway-explicit-hash',
      'api-gateway'
    )
  ),
  ARRAY['a9000000-0000-4000-8000-00000000000a'::uuid],
  'explicit validator output contains only the mapped client'
);

SELECT is(
  (
    SELECT client_ids
    FROM public.validate_api_key_for_audience(
      'pgtap-gateway-all-hash',
      'api-gateway'
    )
  ),
  ARRAY[]::uuid[],
  'all scope does not depend on an enumerated client list'
);

SELECT pg_temp.act_as('a9000000-0000-4000-8000-00000000000b');
SELECT throws_like(
  $$
    SELECT public.configure_api_gateway_key_scope(
      'b9000000-0000-4000-8000-000000000001',
      'all',
      ARRAY[]::uuid[]
    )
  $$,
  '%administrator role required%',
  'a client cannot configure an API gateway key scope'
);
SELECT pg_temp.act_as_owner();

SELECT pg_temp.act_as('a9000000-0000-4000-8000-000000000001');
SELECT lives_ok(
  $$
    SELECT public.configure_api_gateway_key_scope(
      'b9000000-0000-4000-8000-000000000001',
      'explicit',
      ARRAY[
        'a9000000-0000-4000-8000-00000000000a'::uuid,
        'a9000000-0000-4000-8000-00000000000b'::uuid
      ]
    )
  $$,
  'an administrator can install an explicit client allowlist atomically'
);
SELECT pg_temp.act_as_owner();

SELECT is(
  (
    SELECT client_scope_mode
    FROM public.api_keys
    WHERE id = 'b9000000-0000-4000-8000-000000000001'
  ),
  'explicit',
  'the scope RPC updates the key mode'
);

SELECT is(
  (
    SELECT array_agg(client_id ORDER BY client_id)
    FROM api_gateway_private.api_gateway_key_client_scopes
    WHERE key_id = 'b9000000-0000-4000-8000-000000000001'
  ),
  ARRAY[
    'a9000000-0000-4000-8000-00000000000a'::uuid,
    'a9000000-0000-4000-8000-00000000000b'::uuid
  ],
  'the explicit RPC installs exactly the requested current clients'
);

SELECT pg_temp.act_as('a9000000-0000-4000-8000-000000000001');
SELECT lives_ok(
  $$
    SELECT public.configure_api_gateway_key_scope(
      'b9000000-0000-4000-8000-000000000001',
      'explicit',
      ARRAY['a9000000-0000-4000-8000-00000000000b'::uuid]
    )
  $$,
  'a later explicit configuration replaces the previous mappings'
);
SELECT pg_temp.act_as_owner();

SELECT is(
  (
    SELECT array_agg(client_id ORDER BY client_id)
    FROM api_gateway_private.api_gateway_key_client_scopes
    WHERE key_id = 'b9000000-0000-4000-8000-000000000001'
  ),
  ARRAY['a9000000-0000-4000-8000-00000000000b'::uuid],
  'scope replacement does not retain stale client mappings'
);

SELECT pg_temp.act_as('a9000000-0000-4000-8000-000000000001');
SELECT throws_like(
  $$
    SELECT public.configure_api_gateway_key_scope(
      'b9000000-0000-4000-8000-000000000001',
      'explicit',
      ARRAY['a9000000-0000-4000-8000-000000000099'::uuid]
    )
  $$,
  '%every explicit scope identifier must have the client role%',
  'an explicit scope rejects users without the current client role'
);
SELECT pg_temp.act_as_owner();

SELECT is(
  (
    SELECT array_agg(client_id ORDER BY client_id)
    FROM api_gateway_private.api_gateway_key_client_scopes
    WHERE key_id = 'b9000000-0000-4000-8000-000000000001'
  ),
  ARRAY['a9000000-0000-4000-8000-00000000000b'::uuid],
  'failed replacement rolls back and preserves the prior mapping'
);

SELECT pg_temp.act_as('a9000000-0000-4000-8000-000000000001');
SELECT lives_ok(
  $$
    SELECT public.configure_api_gateway_key_scope(
      'b9000000-0000-4000-8000-000000000001',
      'all',
      ARRAY[]::uuid[]
    )
  $$,
  'an administrator can promote a key to global all scope'
);
SELECT pg_temp.act_as_owner();

SELECT is(
  (
    SELECT client_scope_mode
    FROM public.api_keys
    WHERE id = 'b9000000-0000-4000-8000-000000000001'
  ),
  'all',
  'all mode is persisted only by the guarded RPC'
);

SELECT is(
  (
    SELECT count(*)
    FROM api_gateway_private.api_gateway_key_client_scopes
    WHERE key_id = 'b9000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'all mode clears every explicit mapping'
);

SELECT pg_temp.act_as('a9000000-0000-4000-8000-000000000001');
SELECT lives_ok(
  $$
    SELECT public.configure_api_gateway_key_scope(
      'b9000000-0000-4000-8000-000000000001',
      'none',
      ARRAY[]::uuid[]
    )
  $$,
  'an administrator can fail-close a key back to none'
);
SELECT pg_temp.act_as_owner();

SELECT is(
  (
    SELECT client_scope_mode
    FROM public.api_keys
    WHERE id = 'b9000000-0000-4000-8000-000000000001'
  ),
  'none',
  'none mode is persisted by the guarded RPC'
);

DELETE FROM public.user_roles
WHERE user_id = 'a9000000-0000-4000-8000-000000000001';

SELECT is(
  (
    SELECT owner_is_admin
    FROM public.validate_api_key_for_audience(
      'pgtap-gateway-explicit-hash',
      'api-gateway'
    )
  ),
  false,
  'removing the owner admin role immediately fails the admin check'
);

INSERT INTO public.user_roles (user_id, role)
VALUES (
  'a9000000-0000-4000-8000-000000000001',
  'admin'::public.app_role
);

DELETE FROM public.user_roles
WHERE user_id = 'a9000000-0000-4000-8000-00000000000a';

SELECT is(
  (
    SELECT client_ids
    FROM public.validate_api_key_for_audience(
      'pgtap-gateway-explicit-hash',
      'api-gateway'
    )
  ),
  ARRAY[]::uuid[],
  'removing a client role cascades its explicit key mapping'
);

SELECT throws_like(
  $$
    INSERT INTO public.api_keys (
      name,
      key_hash,
      key_preview,
      scopes,
      origin,
      audience,
      client_scope_mode
    ) VALUES (
      'ownerless all key',
      'pgtap-ownerless-all-hash',
      'pgtap-ownerless...',
      ARRAY['projects:read']::text[],
      'api-docs',
      'api-gateway',
      'all'
    )
  $$,
  '%api_keys_gateway_data_scope_owner_required%',
  'an active all-scope gateway key cannot be ownerless'
);

SELECT throws_like(
  $$
    UPDATE public.api_keys
    SET client_scope_mode = 'invalid'
    WHERE id = 'b9000000-0000-4000-8000-000000000001'
  $$,
  '%api_keys_client_scope_mode_valid%',
  'unknown client scope modes are rejected'
);

SELECT throws_like(
  $$
    INSERT INTO public.api_keys (
      name, key_hash, key_preview, scopes, origin, audience
    ) VALUES (
      'unknown audience key',
      'pgtap-unknown-audience-hash',
      'pgtap-unknown...',
      ARRAY['gateway:discover']::text[],
      'api-docs',
      'unknown-consumer'
    )
  $$,
  '%api_keys_audience_supported%',
  'unknown credential audiences are rejected'
);

SELECT throws_like(
  $$
    INSERT INTO public.api_keys (
      name, key_hash, key_preview, scopes, origin, audience
    ) VALUES (
      'wrong gateway origin key',
      'pgtap-wrong-gateway-origin-hash',
      'pgtap-origin...',
      ARRAY['gateway:discover']::text[],
      'mcp',
      'api-gateway'
    )
  $$,
  '%api_keys_gateway_origin_supported%',
  'API gateway keys accept only reviewed origins'
);

SELECT throws_like(
  $$
    INSERT INTO public.api_keys (
      name, key_hash, key_preview, scopes, origin, audience
    ) VALUES (
      'missing gateway origin key',
      'pgtap-missing-gateway-origin-hash',
      'pgtap-no-origin...',
      ARRAY['gateway:discover']::text[],
      NULL,
      'api-gateway'
    )
  $$,
  '%api_keys_gateway_origin_supported%',
  'API gateway keys cannot omit their reviewed origin'
);

SELECT lives_ok(
  $$
    INSERT INTO public.api_keys (
      name,
      key_hash,
      key_preview,
      origin,
      audience,
      is_active,
      revoked_at
    ) VALUES (
      'revoked legacy audience key',
      'pgtap-revoked-legacy-audience-hash',
      'pgtap-old-aud...',
      'legacy-system',
      'retired-consumer',
      false,
      statement_timestamp()
    )
  $$,
  'invalid legacy audience metadata remains available on revoked history'
);

SELECT lives_ok(
  $$
    INSERT INTO public.api_keys (
      name,
      key_hash,
      key_preview,
      origin,
      audience,
      is_active,
      revoked_at
    ) VALUES (
      'revoked legacy gateway origin key',
      'pgtap-revoked-legacy-origin-hash',
      'pgtap-old-origin...',
      'legacy-gateway',
      'api-gateway',
      false,
      statement_timestamp()
    )
  $$,
  'invalid gateway origins remain available only on revoked history'
);

SELECT lives_ok(
  $$
    INSERT INTO public.api_keys (
      name,
      key_hash,
      key_preview,
      is_active,
      revoked_at
    ) VALUES (
      'inactive duplicate API key fingerprint',
      'pgtap-gateway-none-hash',
      'pgtap-old-dup...',
      false,
      statement_timestamp()
    )
  $$,
  'an inactive revoked historical row may share an active fingerprint'
);

SELECT throws_like(
  $$
    INSERT INTO public.api_keys (
      name, key_hash, key_preview
    ) VALUES (
      'duplicate active API key fingerprint',
      'pgtap-gateway-none-hash',
      'pgtap-duplicate...'
    )
  $$,
  '%api_keys_active_key_hash_unique_idx%',
  'a second active row cannot reuse an API key fingerprint'
);

INSERT INTO api_gateway_private.api_gateway_rate_limits (
  key_fingerprint,
  window_started_at,
  request_count
)
VALUES (
  repeat('b', 64),
  date_trunc('minute', clock_timestamp()) - interval '2 days',
  7
);

SELECT is(
  (
    SELECT is_allowed
    FROM public.consume_api_gateway_rate_limit(
      repeat('a', 64)
    )
  ),
  true,
  'the first request in a credential minute is allowed'
);

SELECT is(
  (
    SELECT count(*)
    FROM api_gateway_private.api_gateway_rate_limits
    WHERE key_fingerprint = repeat('b', 64)
  ),
  0::bigint,
  'a quota call removes stale windows globally, not only for its credential'
);

DO $$
BEGIN
  FOR request_number IN 2..120 LOOP
    PERFORM *
    FROM public.consume_api_gateway_rate_limit(repeat('a', 64));
  END LOOP;
END
$$;

SELECT is(
  (
    SELECT is_allowed
    FROM public.consume_api_gateway_rate_limit(
      repeat('a', 64)
    )
  ),
  false,
  'request 121 for the same credential and minute is denied atomically'
);

SELECT is(
  (
    SELECT request_count
    FROM api_gateway_private.api_gateway_rate_limits
    WHERE key_fingerprint = repeat('a', 64)
      AND window_started_at = date_trunc('minute', clock_timestamp())
  ),
  121,
  'the fixed-window counter records every attempt without a check-then-write race'
);

SELECT * FROM finish();
ROLLBACK;
