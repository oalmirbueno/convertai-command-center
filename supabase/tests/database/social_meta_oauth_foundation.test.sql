-- Meta OAuth foundation: structural security contract.
-- Runs inside a transaction and never calls Meta or writes production data.

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

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspname = 'social_private'
  ),
  'private social schema exists'
);

SELECT ok(
  to_regclass('public.external_account_connections') IS NOT NULL,
  'sanitized public connection table exists'
);

SELECT ok(
  to_regclass('public.social_account_events') IS NOT NULL,
  'immutable social account event table exists'
);

SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.social_account_events'::regclass
  ),
  'RLS is enabled on social account events'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'social_account_events'
      AND grantee = 'authenticated'
      AND privilege_type <> 'SELECT'
  ),
  0,
  'authenticated has no write grant on social account events'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'social_account_events'
      AND column_name ~* '(access|refresh).*token|secret|password|credential'
  ),
  0,
  'social account events contain no credential column'
);

SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.external_account_connections'::regclass
  ),
  'RLS is enabled on public connection metadata'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'external_account_connections'
      AND grantee = 'authenticated'
      AND privilege_type <> 'SELECT'
  ),
  0,
  'authenticated has no write grant on connection metadata'
);

SELECT ok(
  has_table_privilege(
    'authenticated',
    'public.external_account_connections',
    'SELECT'
  ),
  'authenticated can read sanitized connection metadata through RLS'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'external_account_connections'
      AND grantee = 'anon'
  ),
  0,
  'anon has no connection metadata grant'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'external_account_connections'
      AND column_name ~* '(access|refresh).*token|secret|oauth_state'
  ),
  0,
  'public connection metadata contains no token, secret or OAuth state column'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM information_schema.tables AS table_row
    WHERE table_row.table_schema = 'social_private'
      AND table_row.table_name IN (
        'oauth_sessions',
        'oauth_grants',
        'oauth_resource_candidates',
        'external_account_grants',
        'editorial_publication_assets',
        'editorial_publication_delivery_requests'
      )
  ),
  6,
  'all private OAuth and asset tables exist'
);

SELECT ok(
  (
    SELECT bool_and(relation.relrowsecurity)
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace_row
      ON namespace_row.oid = relation.relnamespace
    WHERE namespace_row.nspname = 'social_private'
      AND relation.relname IN (
        'oauth_sessions',
        'oauth_grants',
        'oauth_resource_candidates',
        'external_account_grants',
        'editorial_publication_assets',
        'editorial_publication_delivery_requests'
      )
  ),
  'RLS is enabled on every private table'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM information_schema.role_table_grants
    WHERE table_schema = 'social_private'
      AND grantee IN ('anon', 'authenticated', 'service_role')
  ),
  0,
  'API roles have no direct private-table grants'
);

SELECT is(
  has_schema_privilege('authenticated', 'social_private', 'USAGE'),
  false,
  'authenticated cannot use the private schema'
);

SELECT is(
  has_schema_privilege('service_role', 'social_private', 'USAGE'),
  false,
  'service_role cannot bypass RPCs to use the private schema directly'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.social_meta_oauth_create_session(uuid,uuid,text)',
    'EXECUTE'
  ),
  'authenticated can start a guarded Meta OAuth session'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.social_meta_oauth_consume_session(text)',
    'EXECUTE'
  ),
  'authenticated can consume its guarded Meta OAuth state'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.social_meta_connect_resource(uuid,uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated can select a resource through the guarded RPC'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.social_meta_oauth_finish_session(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated can finalize and clean its guarded OAuth session'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.social_meta_disconnect_account(uuid)',
    'EXECUTE'
  ),
  'authenticated can disconnect through the guarded RPC'
);

SELECT is(
  has_function_privilege(
    'authenticated',
    'public.social_meta_oauth_store_resources(uuid,uuid,text,text,timestamptz,timestamptz,text[],text[],jsonb,text)',
    'EXECUTE'
  ),
  false,
  'authenticated cannot store OAuth tokens or resources'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.social_meta_oauth_store_resources(uuid,uuid,text,text,timestamptz,timestamptz,text[],text[],jsonb,text)',
    'EXECUTE'
  ),
  'only the Edge service path can store OAuth tokens and resources'
);

SELECT is(
  has_function_privilege(
    'anon',
    'public.social_meta_oauth_create_session(uuid,uuid,text)',
    'EXECUTE'
  ),
  false,
  'anon cannot start Meta OAuth'
);

SELECT is(
  has_function_privilege(
    'anon',
    'public.social_meta_connect_resource(uuid,uuid,uuid,uuid)',
    'EXECUTE'
  ),
  false,
  'anon cannot connect a resource'
);

SELECT is(
  has_function_privilege(
    'anon',
    'public.social_meta_oauth_finish_session(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  false,
  'anon cannot finalize a Meta OAuth session'
);

SELECT ok(
  (
    SELECT bool_and(procedure_row.prosecdef)
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid IN (
      'public.social_meta_oauth_create_session(uuid,uuid,text)'::regprocedure,
      'public.social_meta_oauth_consume_session(text)'::regprocedure,
      'public.social_meta_oauth_store_resources(uuid,uuid,text,text,timestamptz,timestamptz,text[],text[],jsonb,text)'::regprocedure,
      'public.social_meta_oauth_finish_session(uuid,uuid,uuid)'::regprocedure,
      'public.social_meta_connect_resource(uuid,uuid,uuid,uuid)'::regprocedure,
      'public.social_meta_disconnect_account(uuid)'::regprocedure
    )
  ),
  'every Meta RPC is SECURITY DEFINER'
);

SELECT ok(
  (
    SELECT bool_and(
      procedure_row.proconfig @> ARRAY['search_path=""']::text[]
    )
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid IN (
      'public.social_meta_oauth_create_session(uuid,uuid,text)'::regprocedure,
      'public.social_meta_oauth_consume_session(text)'::regprocedure,
      'public.social_meta_oauth_store_resources(uuid,uuid,text,text,timestamptz,timestamptz,text[],text[],jsonb,text)'::regprocedure,
      'public.social_meta_oauth_finish_session(uuid,uuid,uuid)'::regprocedure,
      'public.social_meta_connect_resource(uuid,uuid,uuid,uuid)'::regprocedure,
      'public.social_meta_disconnect_account(uuid)'::regprocedure
    )
  ),
  'every Meta RPC has an empty search_path'
);

SELECT is(
  (
    SELECT column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'editorial_publications'
      AND column_name = 'delivery_mode'
  ),
  '''manual''::text',
  'editorial delivery remains manual by default'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.external_account_connections'::regclass
      AND conname = 'external_account_connections_automation_check'
  ),
  'connection automation cannot be enabled unless connected'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid =
      'social_private.editorial_publication_assets'::regclass
      AND conname = 'social_editorial_publication_assets_file_key'
  ),
  'an ordered snapshot cannot repeat a file'
);

-- ---------------------------------------------------------------------------
-- Behavioral contract. All credentials below are inert UUID references; this
-- transaction does not call Meta, Edge Functions or Vault helpers.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as_owner();
ALTER TABLE public.profiles DISABLE TRIGGER USER;
ALTER TABLE public.projects DISABLE TRIGGER USER;
ALTER TABLE public.files DISABLE TRIGGER USER;

INSERT INTO auth.users (id, email)
VALUES
  (
    'a1000000-0000-4000-8000-000000000001',
    'social-foundation-admin@test.local'
  ),
  (
    'a1000000-0000-4000-8000-000000000002',
    'social-foundation-manager-b@test.local'
  ),
  (
    'a1000000-0000-4000-8000-00000000000a',
    'social-foundation-client-a@test.local'
  ),
  (
    'a1000000-0000-4000-8000-00000000000b',
    'social-foundation-client-b@test.local'
  );

UPDATE public.profiles AS profile
SET full_name = fixture.full_name, plan_status = 'active'
FROM (
  VALUES
    (
      'a1000000-0000-4000-8000-000000000001'::uuid,
      'Social Foundation Admin'
    ),
    (
      'a1000000-0000-4000-8000-000000000002'::uuid,
      'Social Foundation Manager B'
    ),
    (
      'a1000000-0000-4000-8000-00000000000a'::uuid,
      'Social Foundation Client A'
    ),
    (
      'a1000000-0000-4000-8000-00000000000b'::uuid,
      'Social Foundation Client B'
    )
) AS fixture(id, full_name)
WHERE profile.id = fixture.id;

DELETE FROM public.user_roles
WHERE user_id IN (
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002'
);
INSERT INTO public.user_roles (user_id, role)
VALUES
  ('a1000000-0000-4000-8000-000000000001', 'admin'),
  ('a1000000-0000-4000-8000-000000000002', 'manager');

INSERT INTO public.team_client_assignments (
  user_id,
  client_id,
  created_by
) VALUES (
  'a1000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-00000000000b',
  'a1000000-0000-4000-8000-000000000001'
);

INSERT INTO public.projects (
  id,
  client_id,
  name,
  project_type,
  status,
  progress,
  start_date,
  deadline,
  billing_mode,
  created_by
)
VALUES
  (
    'a2000000-0000-4000-8000-00000000000a',
    'a1000000-0000-4000-8000-00000000000a',
    'Social Foundation A',
    'recurring',
    'active',
    0,
    current_date,
    current_date + 30,
    'included',
    'a1000000-0000-4000-8000-000000000001'
  ),
  (
    'a2000000-0000-4000-8000-00000000000b',
    'a1000000-0000-4000-8000-00000000000b',
    'Social Foundation B',
    'recurring',
    'active',
    0,
    current_date,
    current_date + 30,
    'included',
    'a1000000-0000-4000-8000-000000000001'
  );

CREATE TEMP TABLE social_foundation_state (
  label text PRIMARY KEY,
  payload jsonb,
  result jsonb,
  post_id uuid,
  publication_id uuid,
  external_account_id uuid
);

GRANT SELECT, INSERT, UPDATE ON pg_temp.social_foundation_state
  TO authenticated;

SELECT pg_temp.act_as('a1000000-0000-4000-8000-000000000001');
INSERT INTO pg_temp.social_foundation_state (label, result)
VALUES (
  'oauth_state',
  public.social_meta_oauth_create_session(
    'a1000000-0000-4000-8000-00000000000a',
    'a2000000-0000-4000-8000-00000000000a',
    'http://localhost:5173/oauth/meta/callback'
  )
);

SELECT pg_temp.act_as_owner();
SELECT ok(
  (
    SELECT
      length(state.result->>'state') = 64
      AND session.state_hash = encode(
        sha256(convert_to(state.result->>'state', 'UTF8')),
        'hex'
      )
      AND session.state_hash <> state.result->>'state'
    FROM pg_temp.social_foundation_state AS state
    JOIN social_private.oauth_sessions AS session
      ON session.id = (state.result->>'oauth_session_id')::uuid
    WHERE state.label = 'oauth_state'
  ),
  'OAuth state is random-looking and only its digest is persisted'
);

SELECT pg_temp.act_as('a1000000-0000-4000-8000-000000000001');
SELECT lives_ok(
  $sql$
    SELECT public.social_meta_oauth_consume_session(state.result->>'state')
    FROM pg_temp.social_foundation_state AS state
    WHERE state.label = 'oauth_state'
  $sql$,
  'the owning actor consumes a pending OAuth state once'
);
SELECT throws_like(
  $sql$
    SELECT public.social_meta_oauth_consume_session(state.result->>'state')
    FROM pg_temp.social_foundation_state AS state
    WHERE state.label = 'oauth_state'
  $sql$,
  '%meta oauth session is invalid or expired%',
  'OAuth state replay is rejected'
);
SELECT throws_like(
  $sql$
    SELECT public.social_meta_oauth_create_session(
      'a1000000-0000-4000-8000-00000000000a',
      'a2000000-0000-4000-8000-00000000000b',
      'http://localhost:5173/oauth/meta/callback'
    )
  $sql$,
  '%meta oauth project is unavailable%',
  'OAuth session scope cannot cross client/project boundaries'
);

SELECT pg_temp.act_as_owner();
INSERT INTO social_private.oauth_sessions (
  id,
  actor_id,
  client_id,
  project_id,
  state_hash,
  redirect_uri,
  status,
  expires_at,
  consumed_at,
  resources_stored_at
)
VALUES (
  'a3000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-00000000000a',
  'a2000000-0000-4000-8000-00000000000a',
  repeat('f', 64),
  'http://localhost:5173/oauth/meta/callback',
  'resources_ready',
  now() + interval '10 minutes',
  now(),
  now()
);
INSERT INTO social_private.oauth_grants (
  id,
  client_id,
  provider_subject,
  user_access_token_secret_id,
  granted_scopes,
  access_token_expires_at,
  data_access_expires_at,
  graph_version
)
VALUES (
  'a4000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-00000000000a',
  'meta-test-user',
  'a6000000-0000-4000-8000-000000000001',
  ARRAY[
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
    'instagram_basic',
    'instagram_content_publish'
  ],
  now() + interval '60 days',
  now() + interval '60 days',
  'v23.0'
);
INSERT INTO social_private.oauth_resource_candidates (
  id,
  oauth_session_id,
  grant_id,
  client_id,
  project_id,
  platform,
  resource_type,
  provider_resource_id,
  display_name,
  handle,
  page_id,
  instagram_user_id,
  resource_access_token_secret_id
)
VALUES (
  'a5000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-00000000000a',
  'a2000000-0000-4000-8000-00000000000a',
  'instagram',
  'instagram_business_account',
  'ig-test-resource',
  'Instagram Test Resource',
  '@ig_test_resource',
  'page-test-resource',
  'ig-test-resource',
  'a6000000-0000-4000-8000-000000000002'
), (
  'a5000000-0000-4000-8000-000000000002',
  'a3000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-00000000000a',
  'a2000000-0000-4000-8000-00000000000a',
  'facebook',
  'page',
  'page-unused-resource',
  'Unused Facebook Test Resource',
  '@unused_test_resource',
  'page-unused-resource',
  NULL,
  vault.create_secret(
    'fixture-unused-resource-token-123456',
    'pgtap-unused-meta-resource',
    'Temporary pgTAP Meta resource token',
    NULL
  )
);

SELECT pg_temp.act_as('a1000000-0000-4000-8000-000000000001');
SELECT throws_like(
  $sql$
    SELECT public.social_meta_connect_resource(
      'a3000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-00000000000b',
      'a2000000-0000-4000-8000-00000000000b'
    )
  $sql$,
  '%meta oauth session is invalid or expired%',
  'a candidate cannot be connected through another client scope'
);
SELECT lives_ok(
  $sql$
    SELECT public.social_meta_connect_resource(
      'a3000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-00000000000a',
      'a2000000-0000-4000-8000-00000000000a'
    )
  $sql$,
  'an in-scope candidate connects without any external call'
);
SELECT lives_ok(
  $sql$
    SELECT public.social_meta_connect_resource(
      'a3000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-00000000000a',
      'a2000000-0000-4000-8000-00000000000a'
    )
  $sql$,
  'the same resource selection is idempotent'
);

SELECT pg_temp.act_as_owner();
UPDATE pg_temp.social_foundation_state AS state
SET external_account_id = candidate.selected_external_account_id
FROM social_private.oauth_resource_candidates AS candidate
WHERE state.label = 'oauth_state'
  AND candidate.id = 'a5000000-0000-4000-8000-000000000001';
SELECT ok(
  (
    SELECT
      connection.connection_status = 'connected'
      AND NOT connection.automation_enabled
    FROM public.external_account_connections AS connection
    JOIN pg_temp.social_foundation_state AS state
      ON state.external_account_id = connection.external_account_id
    WHERE state.label = 'oauth_state'
  ),
  'a connected account remains manual with automation disabled by default'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.social_account_events AS event_row
    JOIN pg_temp.social_foundation_state AS state
      ON state.external_account_id = event_row.external_account_id
    WHERE state.label = 'oauth_state'
      AND event_row.event_type = 'connected'
  ),
  1,
  'the first official connection is recorded once'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.social_account_events AS event_row
    JOIN pg_temp.social_foundation_state AS state
      ON state.external_account_id = event_row.external_account_id
    WHERE state.label = 'oauth_state'
      AND event_row.event_type = 'reconnected'
  ),
  0,
  'an idempotent OAuth retry does not invent a reconnection event'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.social_account_events AS event_row
    JOIN pg_temp.social_foundation_state AS state
      ON state.external_account_id = event_row.external_account_id
    WHERE state.label = 'oauth_state'
      AND event_row.event_type = 'project_linked'
      AND event_row.project_id =
        'a2000000-0000-4000-8000-00000000000a'::uuid
  ),
  1,
  'the account destination project is recorded once'
);

SELECT throws_like(
  $sql$
    UPDATE public.external_accounts AS account
    SET external_id = 'tampered-provider-identity'
    FROM pg_temp.social_foundation_state AS state
    WHERE state.label = 'oauth_state'
      AND account.id = state.external_account_id
  $sql$,
  '%platform and external_id are immutable for connected accounts%',
  'provider identity cannot be edited after an official connection'
);

INSERT INTO public.external_accounts (
  id,
  client_id,
  platform,
  external_id,
  display_name,
  handle,
  status
) VALUES (
  'a9000000-0000-4000-8000-00000000000b',
  'a1000000-0000-4000-8000-00000000000b',
  'instagram',
  'other-client-account',
  'Other Client Instagram',
  '@other_client_instagram',
  'active'
);

INSERT INTO public.project_external_accounts (
  client_id,
  project_id,
  external_account_id
) VALUES (
  'a1000000-0000-4000-8000-00000000000b',
  'a2000000-0000-4000-8000-00000000000b',
  'a9000000-0000-4000-8000-00000000000b'
);

SELECT throws_like(
  $sql$
    INSERT INTO social_private.external_account_grants (
      external_account_id,
      client_id,
      grant_id,
      candidate_id,
      provider,
      platform,
      provider_resource_id,
      resource_access_token_secret_id,
      connected_by
    ) VALUES (
      'a9000000-0000-4000-8000-00000000000b',
      'a1000000-0000-4000-8000-00000000000b',
      'a4000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      'meta',
      'instagram',
      'ig-test-resource',
      'a6000000-0000-4000-8000-000000000003',
      'a1000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '%this Meta account is already connected; disconnect it before reassignment%',
  'the same Meta resource cannot silently route into another client'
);

SELECT pg_temp.act_as('a1000000-0000-4000-8000-00000000000b');
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.external_account_connections AS connection
    JOIN pg_temp.social_foundation_state AS state
      ON state.external_account_id = connection.external_account_id
    WHERE state.label = 'oauth_state'
  ),
  0,
  'connection metadata is isolated from another client through RLS'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.social_account_events AS event_row
    JOIN pg_temp.social_foundation_state AS state
      ON state.external_account_id = event_row.external_account_id
    WHERE state.label = 'oauth_state'
  ),
  0,
  'social account history is isolated from another client through RLS'
);

SELECT pg_temp.act_as('a1000000-0000-4000-8000-000000000002');
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.social_account_events
    WHERE client_id = 'a1000000-0000-4000-8000-00000000000a'
  ),
  0,
  'a manager assigned to client B cannot read client A social history'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.social_account_events
    WHERE client_id = 'a1000000-0000-4000-8000-00000000000b'
      AND external_account_id =
        'a9000000-0000-4000-8000-00000000000b'::uuid
      AND event_type = 'project_linked'
  ),
  1,
  'a manager assigned to client B can read client B social history'
);

SELECT pg_temp.act_as('a1000000-0000-4000-8000-000000000001');
SELECT lives_ok(
  $sql$
    SELECT public.social_meta_oauth_finish_session(
      'a3000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-00000000000a',
      'a2000000-0000-4000-8000-00000000000a'
    )
  $sql$,
  'finishing a multi-resource session cleans unused candidates'
);
SELECT throws_like(
  $sql$
    SELECT public.social_meta_connect_resource(
      'a3000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000002',
      'a1000000-0000-4000-8000-00000000000a',
      'a2000000-0000-4000-8000-00000000000a'
    )
  $sql$,
  '%meta resource does not belong to this session%',
  'an unused candidate cannot be connected after session finalization'
);

SELECT pg_temp.act_as_owner();
SELECT ok(
  (
    SELECT
      session.status = 'completed'
      AND session.cleaned_at IS NOT NULL
      AND unused_candidate.discarded_at IS NOT NULL
      AND selected_candidate.discarded_at IS NULL
    FROM social_private.oauth_sessions AS session
    JOIN social_private.oauth_resource_candidates AS unused_candidate
      ON unused_candidate.oauth_session_id = session.id
     AND unused_candidate.id =
       'a5000000-0000-4000-8000-000000000002'::uuid
    JOIN social_private.oauth_resource_candidates AS selected_candidate
      ON selected_candidate.oauth_session_id = session.id
     AND selected_candidate.id =
       'a5000000-0000-4000-8000-000000000001'::uuid
    WHERE session.id = 'a3000000-0000-4000-8000-000000000001'::uuid
  ),
  'session cleanup preserves selected resources and discards unused ones'
);
SELECT ok(
  (
    SELECT decrypted.decrypted_secret LIKE 'revoked:%'
    FROM social_private.oauth_resource_candidates AS candidate
    JOIN vault.decrypted_secrets AS decrypted
      ON decrypted.id = candidate.resource_access_token_secret_id
    WHERE candidate.id = 'a5000000-0000-4000-8000-000000000002'::uuid
  ),
  'unused resource credential is replaced in Vault during cleanup'
);

SELECT pg_temp.act_as_owner();
INSERT INTO public.files (
  id,
  project_id,
  client_id,
  uploaded_by,
  file_name,
  file_url,
  file_type,
  folder,
  status,
  mime_type,
  extension,
  size_bytes,
  sha256,
  visibility,
  requires_approval,
  approval_status,
  agency_approval_status,
  agency_reviewed_by,
  agency_reviewed_at,
  client_decided_by,
  client_decided_at,
  approval_requested_at,
  locked_at
)
VALUES
  (
    'a7000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-00000000000a',
    'a1000000-0000-4000-8000-00000000000a',
    'a1000000-0000-4000-8000-000000000001',
    'Approved social asset one.png',
    'https://example.test/approved-social-asset-one.png',
    'image',
    'entregas',
    'ready',
    'image/png',
    'png',
    1024,
    repeat('b', 64),
    'approval',
    true,
    'approved',
    'approved',
    'a1000000-0000-4000-8000-000000000001',
    now() - interval '2 hours',
    'a1000000-0000-4000-8000-00000000000a',
    now() - interval '1 hour',
    now() - interval '3 hours',
    now() - interval '1 hour'
  ),
  (
    'a7000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-00000000000a',
    'a1000000-0000-4000-8000-00000000000a',
    'a1000000-0000-4000-8000-000000000001',
    'Approved legacy manual asset.png',
    'https://example.test/approved-legacy-manual-asset.png',
    'image',
    'entregas',
    'ready',
    'image/png',
    'png',
    2048,
    repeat('c', 64),
    'approval',
    true,
    'approved',
    'approved',
    'a1000000-0000-4000-8000-000000000001',
    now() - interval '2 hours',
    'a1000000-0000-4000-8000-00000000000a',
    now() - interval '1 hour',
    now() - interval '3 hours',
    now() - interval '1 hour'
  );

INSERT INTO pg_temp.social_foundation_state (label, payload)
SELECT
  'manual_snapshot',
  jsonb_build_object(
    'client_id', 'a1000000-0000-4000-8000-00000000000a',
    'project_id', 'a2000000-0000-4000-8000-00000000000a',
    'primary_file_id', 'a7000000-0000-4000-8000-000000000001',
    'idempotency_key', 'a8000000-0000-4000-8000-000000000001',
    'mutation_id', 'a8100000-0000-4000-8000-000000000001',
    'title', 'ignored in favor of approved media',
    'content_type', 'static',
    'production_status', 'ready',
    'publications', jsonb_build_array(
      jsonb_build_object(
        'external_account_id', state.external_account_id,
        'file_id', 'a7000000-0000-4000-8000-000000000001',
        'scheduled_at', now() + interval '1 day',
        'scheduled_timezone', 'America/Sao_Paulo',
        'idempotency_key', 'a8200000-0000-4000-8000-000000000001',
        'delivery_mode', 'manual',
        'asset_file_ids', jsonb_build_array(
          'a7000000-0000-4000-8000-000000000001'
        )
      )
    )
  )
FROM pg_temp.social_foundation_state AS state
WHERE state.label = 'oauth_state';

SELECT pg_temp.act_as('a1000000-0000-4000-8000-000000000001');
SELECT lives_ok(
  $sql$
    UPDATE pg_temp.social_foundation_state
    SET result = public.save_editorial_post(payload, NULL)
    WHERE label = 'manual_snapshot'
  $sql$,
  'extension-aware manual save captures before scheduling'
);

SELECT pg_temp.act_as_owner();
UPDATE pg_temp.social_foundation_state AS state
SET
  post_id = (state.result->>'post_id')::uuid,
  publication_id = publication.id
FROM public.editorial_publications AS publication
WHERE state.label = 'manual_snapshot'
  AND publication.post_id = (state.result->>'post_id')::uuid;
SELECT ok(
  (
    SELECT
      publication.status = 'scheduled'
      AND publication.delivery_mode = 'manual'
      AND request_row.asset_count = 1
      AND internal.approval_fingerprint =
        public.editorial_compute_approval_fingerprint(post.id)
      AND (
        SELECT array_agg(asset.file_id ORDER BY asset.position)
        FROM social_private.editorial_publication_assets AS asset
        WHERE asset.publication_id = publication.id
      ) = ARRAY[
        'a7000000-0000-4000-8000-000000000001'::uuid
      ]
    FROM pg_temp.social_foundation_state AS state
    JOIN public.editorial_posts AS post ON post.id = state.post_id
    JOIN public.editorial_post_internal AS internal
      ON internal.post_id = post.id
    JOIN public.editorial_publications AS publication
      ON publication.id = state.publication_id
    JOIN social_private.editorial_publication_delivery_requests AS request_row
      ON request_row.publication_id = publication.id
    WHERE state.label = 'manual_snapshot'
  ),
  'manual delivery stores ordered assets in the immutable double-gate digest'
);

SELECT pg_temp.act_as('a1000000-0000-4000-8000-000000000001');
SELECT is(
  (
    SELECT (public.save_editorial_post(state.payload, NULL)->>'recovered')::boolean
    FROM pg_temp.social_foundation_state AS state
    WHERE state.label = 'manual_snapshot'
  ),
  true,
  'the exact delivery request is recovered idempotently'
);
SELECT throws_like(
  $sql$
    SELECT public.save_editorial_post(
      jsonb_set(
        state.payload,
        '{publications,0,delivery_mode}',
        to_jsonb('automatic'::text)
      ),
      NULL
    )
    FROM pg_temp.social_foundation_state AS state
    WHERE state.label = 'manual_snapshot'
  $sql$,
  '%approved editorial delivery snapshot is immutable; create a revision%',
  'delivery mode cannot change after its approved snapshot is hydrated'
);

SELECT throws_like(
  $sql$
    SELECT public.save_editorial_post(
      jsonb_build_object(
        'client_id', 'a1000000-0000-4000-8000-00000000000a',
        'project_id', 'a2000000-0000-4000-8000-00000000000a',
        'primary_file_id', 'a7000000-0000-4000-8000-000000000002',
        'idempotency_key', 'a8000000-0000-4000-8000-000000000003',
        'mutation_id', 'a8100000-0000-4000-8000-000000000002',
        'title', 'automatic remains disabled',
        'content_type', 'static',
        'production_status', 'ready',
        'publications', jsonb_build_array(
          jsonb_build_object(
            'external_account_id', state.external_account_id,
            'file_id', 'a7000000-0000-4000-8000-000000000002',
            'scheduled_at', now() + interval '2 days',
            'scheduled_timezone', 'America/Sao_Paulo',
            'idempotency_key',
              'a8200000-0000-4000-8000-000000000003',
            'delivery_mode', 'automatic',
            'asset_file_ids', jsonb_build_array(
              'a7000000-0000-4000-8000-000000000002'
            )
          )
        )
      ),
      NULL
    )
    FROM pg_temp.social_foundation_state AS state
    WHERE state.label = 'oauth_state'
  $sql$,
  '%automatic delivery requires an enabled official connection%',
  'automatic save is blocked while the official connection is disabled'
);

SELECT pg_temp.act_as_owner();
SELECT ok(
  (
    SELECT
      publication.status = 'scheduled'
      AND publication.delivery_mode = 'manual'
      AND request_row.asset_count = 1
      AND NOT EXISTS (
        SELECT 1
        FROM public.editorial_posts AS blocked_post
        WHERE blocked_post.primary_file_id =
          'a7000000-0000-4000-8000-000000000002'::uuid
      )
    FROM pg_temp.social_foundation_state AS state
    JOIN public.editorial_publications AS publication
      ON publication.id = state.publication_id
    JOIN social_private.editorial_publication_delivery_requests AS request_row
      ON request_row.publication_id = publication.id
    WHERE state.label = 'manual_snapshot'
  ),
  'failed automatic validation rolls back before changing scheduled manual state'
);

INSERT INTO pg_temp.social_foundation_state (label, payload)
SELECT
  'legacy_manual',
  jsonb_build_object(
    'client_id', 'a1000000-0000-4000-8000-00000000000a',
    'project_id', 'a2000000-0000-4000-8000-00000000000a',
    'primary_file_id', 'a7000000-0000-4000-8000-000000000002',
    'idempotency_key', 'a8000000-0000-4000-8000-000000000002',
    'mutation_id', 'a8100000-0000-4000-8000-000000000003',
    'title', 'legacy payload',
    'content_type', 'static',
    'production_status', 'ready',
    'publications', jsonb_build_array(
      jsonb_build_object(
        'external_account_id', state.external_account_id,
        'file_id', 'a7000000-0000-4000-8000-000000000002',
        'scheduled_at', now() + interval '2 days',
        'scheduled_timezone', 'America/Sao_Paulo',
        'idempotency_key', 'a8200000-0000-4000-8000-000000000002'
      )
    )
  )
FROM pg_temp.social_foundation_state AS state
WHERE state.label = 'oauth_state';

SELECT pg_temp.act_as('a1000000-0000-4000-8000-000000000001');
SELECT lives_ok(
  $sql$
    UPDATE pg_temp.social_foundation_state
    SET result = public.save_editorial_post(payload, NULL)
    WHERE label = 'legacy_manual'
  $sql$,
  'legacy manual payload remains saveable without delivery extension fields'
);
SELECT pg_temp.act_as_owner();
SELECT ok(
  (
    SELECT
      publication.status = 'scheduled'
      AND publication.delivery_mode = 'manual'
      AND NOT EXISTS (
        SELECT 1
        FROM social_private.editorial_publication_assets AS asset
        WHERE asset.publication_id = publication.id
      )
    FROM pg_temp.social_foundation_state AS state
    JOIN public.editorial_publications AS publication
      ON publication.post_id = (state.result->>'post_id')::uuid
    WHERE state.label = 'legacy_manual'
  ),
  'legacy manual save keeps its scheduled behavior and does not invent assets'
);

SELECT pg_temp.act_as_owner();
SELECT throws_like(
  $sql$
    UPDATE public.social_account_events
    SET reason = 'tampered'
    WHERE client_id = 'a1000000-0000-4000-8000-00000000000a'
  $sql$,
  '%social account events are immutable%',
  'recorded social account events cannot be changed'
);

SELECT throws_like(
  $sql$
    DELETE FROM public.social_account_events
    WHERE client_id = 'a1000000-0000-4000-8000-00000000000a'
  $sql$,
  '%social account events are immutable%',
  'recorded social account events cannot be deleted'
);

SELECT throws_like(
  $sql$
    SELECT social_private.record_social_account_event(
      gen_random_uuid(),
      'a1000000-0000-4000-8000-00000000000a',
      'a2000000-0000-4000-8000-00000000000a',
      NULL,
      'a1000000-0000-4000-8000-000000000001',
      'connection_status_changed',
      'system',
      NULL,
      jsonb_build_object('access_token', 'forbidden')
    )
  $sql$,
  '%sensitive fields are forbidden in social account events%',
  'credential-shaped metadata is rejected from the audit trail'
);

SELECT throws_like(
  $sql$
    SELECT social_private.record_social_account_event(
      gen_random_uuid(),
      'a1000000-0000-4000-8000-00000000000a',
      'a2000000-0000-4000-8000-00000000000a',
      NULL,
      'a1000000-0000-4000-8000-000000000001',
      'connection_status_changed',
      'system',
      'access_token=forbidden',
      '{}'::jsonb
    )
  $sql$,
  '%invalid social account event reason%',
  'free-form or credential-shaped event reasons are rejected'
);

SELECT * FROM finish();
ROLLBACK;
