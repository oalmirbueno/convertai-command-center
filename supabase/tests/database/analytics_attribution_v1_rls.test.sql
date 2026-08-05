-- ============================================================================
-- Aceleriq OS - Growth Analytics V1, attribution and RLS contract
-- Runs entirely inside BEGIN/ROLLBACK and never persists fixture data.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT * FROM no_plan();

-- Keep fixture writes local. Legacy automation triggers must not make outbound
-- calls while this transaction creates users and projects.
ALTER TABLE public.profiles DISABLE TRIGGER USER;
ALTER TABLE public.projects DISABLE TRIGGER USER;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', _uid::text,
      'role', 'authenticated'
    )::text,
    true
  );
  EXECUTE 'SET LOCAL ROLE authenticated';
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.act_as_anon()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.act_as_owner()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE 'RESET ROLE';
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.public_has_execute(_fn regprocedure)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure_row
    CROSS JOIN LATERAL aclexplode(
      COALESCE(
        procedure_row.proacl,
        acldefault('f', procedure_row.proowner)
      )
    ) AS acl
    WHERE procedure_row.oid = _fn::oid
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  )
$$;

-- ---------------------------------------------------------------------------
-- 1. Structural contract: schema, RLS, grants, policies and constraints.
-- ---------------------------------------------------------------------------
SELECT ok(
  to_regclass('public.analytics_campaigns') IS NOT NULL
    AND to_regclass('public.analytics_utm_links') IS NOT NULL
    AND to_regclass('public.analytics_conversion_definitions') IS NOT NULL
    AND to_regclass('public.analytics_conversion_events') IS NOT NULL
    AND to_regclass('public.analytics_metric_entries') IS NOT NULL,
  'all five Growth Analytics V1 tables exist'
);

SELECT ok(
  (
    SELECT count(*) = 5
      AND bool_and(relation.relrowsecurity)
    FROM pg_class AS relation
    WHERE relation.oid IN (
      'public.analytics_campaigns'::regclass,
      'public.analytics_utm_links'::regclass,
      'public.analytics_conversion_definitions'::regclass,
      'public.analytics_conversion_events'::regclass,
      'public.analytics_metric_entries'::regclass
    )
  ),
  'RLS is enabled on every Growth Analytics V1 table'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'analytics_campaigns',
        'analytics_utm_links',
        'analytics_conversion_definitions',
        'analytics_conversion_events',
        'analytics_metric_entries'
      )
      AND cmd = 'DELETE'
  ),
  0,
  'no Growth Analytics V1 table exposes a DELETE policy'
);

SELECT ok(
  (
    SELECT count(*) = 15
      AND count(*) FILTER (WHERE cmd = 'SELECT') = 5
      AND count(*) FILTER (WHERE cmd = 'INSERT') = 5
      AND count(*) FILTER (WHERE cmd = 'UPDATE') = 5
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'analytics_campaigns',
        'analytics_utm_links',
        'analytics_conversion_definitions',
        'analytics_conversion_events',
        'analytics_metric_entries'
      )
  ),
  'every analytics table has explicit SELECT, INSERT and UPDATE policies'
);

SELECT ok(
  (
    SELECT count(*) = 5
      AND bool_and(
        has_table_privilege(
          'authenticated',
          format('%I.%I', relation.schemaname, relation.tablename),
          'SELECT'
        )
        AND has_table_privilege(
          'authenticated',
          format('%I.%I', relation.schemaname, relation.tablename),
          'INSERT'
        )
        AND has_table_privilege(
          'authenticated',
          format('%I.%I', relation.schemaname, relation.tablename),
          'UPDATE'
        )
        AND NOT has_table_privilege(
          'authenticated',
          format('%I.%I', relation.schemaname, relation.tablename),
          'DELETE'
        )
        AND NOT has_table_privilege(
          'authenticated',
          format('%I.%I', relation.schemaname, relation.tablename),
          'TRUNCATE'
        )
      )
    FROM (
      VALUES
        ('public', 'analytics_campaigns'),
        ('public', 'analytics_utm_links'),
        ('public', 'analytics_conversion_definitions'),
        ('public', 'analytics_conversion_events'),
        ('public', 'analytics_metric_entries')
    ) AS relation(schemaname, tablename)
  ),
  'authenticated receives SELECT, INSERT and UPDATE but no hard-delete privilege'
);

SELECT ok(
  (
    SELECT count(*) = 5
      AND bool_and(
        NOT has_table_privilege(
          'anon',
          format('%I.%I', relation.schemaname, relation.tablename),
          'SELECT'
        )
        AND NOT has_table_privilege(
          'anon',
          format('%I.%I', relation.schemaname, relation.tablename),
          'INSERT'
        )
        AND NOT has_table_privilege(
          'anon',
          format('%I.%I', relation.schemaname, relation.tablename),
          'UPDATE'
        )
        AND NOT has_table_privilege(
          'anon',
          format('%I.%I', relation.schemaname, relation.tablename),
          'DELETE'
        )
        AND NOT has_table_privilege(
          'anon',
          format('%I.%I', relation.schemaname, relation.tablename),
          'TRUNCATE'
        )
      )
    FROM (
      VALUES
        ('public', 'analytics_campaigns'),
        ('public', 'analytics_utm_links'),
        ('public', 'analytics_conversion_definitions'),
        ('public', 'analytics_conversion_events'),
        ('public', 'analytics_metric_entries')
    ) AS relation(schemaname, tablename)
  ),
  'anon has no privilege on Growth Analytics V1 tables'
);

-- Logical rollback is a product invariant. API service credentials must not be
-- able to bypass it with DELETE or TRUNCATE.
SELECT ok(
  (
    SELECT count(*) = 5
      AND bool_and(
        has_table_privilege(
          'service_role',
          format('%I.%I', relation.schemaname, relation.tablename),
          'SELECT'
        )
        AND has_table_privilege(
          'service_role',
          format('%I.%I', relation.schemaname, relation.tablename),
          'INSERT'
        )
        AND has_table_privilege(
          'service_role',
          format('%I.%I', relation.schemaname, relation.tablename),
          'UPDATE'
        )
        AND NOT has_table_privilege(
          'service_role',
          format('%I.%I', relation.schemaname, relation.tablename),
          'DELETE'
        )
        AND NOT has_table_privilege(
          'service_role',
          format('%I.%I', relation.schemaname, relation.tablename),
          'TRUNCATE'
        )
      )
    FROM (
      VALUES
        ('public', 'analytics_campaigns'),
        ('public', 'analytics_utm_links'),
        ('public', 'analytics_conversion_definitions'),
        ('public', 'analytics_conversion_events'),
        ('public', 'analytics_metric_entries')
    ) AS relation(schemaname, tablename)
  ),
  'service_role can sync analytics but cannot hard-delete or truncate history'
);

SELECT is(
  has_function_privilege(
    'authenticated',
    'public.analytics_can_write_client(uuid)',
    'EXECUTE'
  ),
  true,
  'authenticated can evaluate analytics write authorization'
);

SELECT is(
  has_function_privilege(
    'anon',
    'public.analytics_can_write_client(uuid)',
    'EXECUTE'
  ),
  false,
  'anon cannot execute analytics write authorization'
);

SELECT is(
  pg_temp.public_has_execute(
    'public.analytics_can_write_client(uuid)'::regprocedure
  ),
  false,
  'PUBLIC cannot execute analytics write authorization'
);

SELECT ok(
  NOT pg_temp.public_has_execute(
    'public.analytics_record_guard()'::regprocedure
  )
    AND NOT pg_temp.public_has_execute(
      'public.analytics_utm_link_immutable_guard()'::regprocedure
    )
    AND NOT pg_temp.public_has_execute(
      'public.analytics_conversion_event_guard()'::regprocedure
    )
    AND NOT pg_temp.public_has_execute(
      'public.analytics_metric_entry_immutable_guard()'::regprocedure
    ),
  'analytics trigger functions are not public API endpoints'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.analytics_utm_links'::regclass
      AND conname = 'analytics_utm_links_campaign_scope_fk'
      AND contype = 'f'
      AND array_length(conkey, 1) = 3
  )
    AND EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'public.analytics_conversion_events'::regclass
        AND conname = 'analytics_conversion_events_link_scope_fk'
        AND contype = 'f'
        AND array_length(conkey, 1) = 4
    )
    AND EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'public.analytics_metric_entries'::regclass
        AND conname = 'analytics_metric_entries_link_scope_fk'
        AND contype = 'f'
        AND array_length(conkey, 1) = 4
    ),
  'composite FKs bind campaign and UTM relations to client and project scope'
);

SELECT ok(
  to_regclass('public.analytics_utm_links_tracking_key') IS NOT NULL
    AND to_regclass(
      'public.analytics_conversion_events_source_external_key'
    ) IS NOT NULL
    AND to_regclass(
      'public.analytics_metric_entries_semantic_key'
    ) IS NOT NULL,
  'tracking and idempotency indexes exist'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename IN (
        'analytics_campaigns',
        'analytics_utm_links',
        'analytics_conversion_definitions',
        'analytics_conversion_events',
        'analytics_metric_entries'
      )
  ),
  5,
  'all analytics tables publish changes through Supabase Realtime'
);

-- ---------------------------------------------------------------------------
-- 2. Fixtures.
-- ---------------------------------------------------------------------------
-- Users:
--   admin              93000000-0000-0000-0000-000000000001
--   manager assigned   93000000-0000-0000-0000-000000000002
--   traffic assigned   93000000-0000-0000-0000-000000000003
--   design assigned    93000000-0000-0000-0000-000000000004
--   client A           93000000-0000-0000-0000-00000000000a
--   client B           93000000-0000-0000-0000-00000000000b
--   manager unassigned 93000000-0000-0000-0000-00000000000e

INSERT INTO auth.users (id, email)
VALUES
  (
    '93000000-0000-0000-0000-000000000001',
    'analytics-admin@test.local'
  ),
  (
    '93000000-0000-0000-0000-000000000002',
    'analytics-manager-a@test.local'
  ),
  (
    '93000000-0000-0000-0000-000000000003',
    'analytics-traffic-a@test.local'
  ),
  (
    '93000000-0000-0000-0000-000000000004',
    'analytics-design-a@test.local'
  ),
  (
    '93000000-0000-0000-0000-00000000000a',
    'analytics-client-a@test.local'
  ),
  (
    '93000000-0000-0000-0000-00000000000b',
    'analytics-client-b@test.local'
  ),
  (
    '93000000-0000-0000-0000-00000000000e',
    'analytics-manager-u@test.local'
  );

UPDATE public.profiles AS profile
SET
  full_name = fixture.full_name,
  plan_status = 'active',
  onboarding_done = true,
  sync_status = 'synced',
  client_type = 'recurring'
FROM (
  VALUES
    (
      '93000000-0000-0000-0000-000000000001'::uuid,
      'Analytics Admin'
    ),
    (
      '93000000-0000-0000-0000-000000000002'::uuid,
      'Analytics Manager A'
    ),
    (
      '93000000-0000-0000-0000-000000000003'::uuid,
      'Analytics Traffic A'
    ),
    (
      '93000000-0000-0000-0000-000000000004'::uuid,
      'Analytics Design A'
    ),
    (
      '93000000-0000-0000-0000-00000000000a'::uuid,
      'Analytics Client A'
    ),
    (
      '93000000-0000-0000-0000-00000000000b'::uuid,
      'Analytics Client B'
    ),
    (
      '93000000-0000-0000-0000-00000000000e'::uuid,
      'Analytics Manager Unassigned'
    )
) AS fixture(id, full_name)
WHERE profile.id = fixture.id;

-- handle_new_user creates a client role. Replace it only for staff.
DELETE FROM public.user_roles
WHERE user_id IN (
  '93000000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000002',
  '93000000-0000-0000-0000-000000000003',
  '93000000-0000-0000-0000-000000000004',
  '93000000-0000-0000-0000-00000000000e'
);

INSERT INTO public.user_roles (user_id, role)
VALUES
  ('93000000-0000-0000-0000-000000000001', 'admin'),
  ('93000000-0000-0000-0000-000000000002', 'manager'),
  ('93000000-0000-0000-0000-000000000003', 'traffic'),
  ('93000000-0000-0000-0000-000000000004', 'design'),
  ('93000000-0000-0000-0000-00000000000e', 'manager');

INSERT INTO public.team_client_assignments (user_id, client_id)
VALUES
  (
    '93000000-0000-0000-0000-000000000002',
    '93000000-0000-0000-0000-00000000000a'
  ),
  (
    '93000000-0000-0000-0000-000000000003',
    '93000000-0000-0000-0000-00000000000a'
  ),
  (
    '93000000-0000-0000-0000-000000000004',
    '93000000-0000-0000-0000-00000000000a'
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
  billing_mode
)
VALUES
  (
    '93100000-0000-0000-0000-00000000000a',
    '93000000-0000-0000-0000-00000000000a',
    'Analytics Project A',
    'analytics',
    'active',
    0,
    current_date,
    current_date + 30,
    'included'
  ),
  (
    '93100000-0000-0000-0000-00000000000c',
    '93000000-0000-0000-0000-00000000000a',
    'Analytics Project A2',
    'analytics',
    'active',
    0,
    current_date,
    current_date + 30,
    'included'
  ),
  (
    '93100000-0000-0000-0000-00000000000b',
    '93000000-0000-0000-0000-00000000000b',
    'Analytics Project B',
    'analytics',
    'active',
    0,
    current_date,
    current_date + 30,
    'included'
  );

SELECT set_config(
  'request.jwt.claim.sub',
  '93000000-0000-0000-0000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

INSERT INTO public.analytics_campaigns (
  id,
  client_id,
  project_id,
  name,
  channel,
  status,
  budget,
  utm_campaign,
  created_by
)
VALUES
  (
    '93200000-0000-0000-0000-00000000000a',
    '93000000-0000-0000-0000-00000000000a',
    '93100000-0000-0000-0000-00000000000a',
    'Campaign A',
    'meta_ads',
    'active',
    1000,
    'campaign_a',
    '93000000-0000-0000-0000-000000000001'
  ),
  (
    '93200000-0000-0000-0000-00000000000c',
    '93000000-0000-0000-0000-00000000000a',
    '93100000-0000-0000-0000-00000000000c',
    'Campaign A2',
    'google_ads',
    'active',
    800,
    'campaign_a2',
    '93000000-0000-0000-0000-000000000001'
  ),
  (
    '93200000-0000-0000-0000-00000000000b',
    '93000000-0000-0000-0000-00000000000b',
    '93100000-0000-0000-0000-00000000000b',
    'Campaign B',
    'meta_ads',
    'active',
    1200,
    'campaign_b',
    '93000000-0000-0000-0000-000000000001'
  );

INSERT INTO public.analytics_utm_links (
  id,
  client_id,
  project_id,
  campaign_id,
  name,
  destination_url,
  utm_source,
  utm_medium,
  utm_campaign,
  utm_content,
  created_by
)
VALUES
  (
    '93300000-0000-0000-0000-00000000000a',
    '93000000-0000-0000-0000-00000000000a',
    '93100000-0000-0000-0000-00000000000a',
    '93200000-0000-0000-0000-00000000000a',
    'UTM A',
    'https://example.test/a',
    'meta',
    'paid_social',
    'campaign_a',
    'creative_a',
    '93000000-0000-0000-0000-000000000001'
  ),
  (
    '93300000-0000-0000-0000-00000000000b',
    '93000000-0000-0000-0000-00000000000b',
    '93100000-0000-0000-0000-00000000000b',
    '93200000-0000-0000-0000-00000000000b',
    'UTM B',
    'https://example.test/b',
    'meta',
    'paid_social',
    'campaign_b',
    'creative_b',
    '93000000-0000-0000-0000-000000000001'
  );

INSERT INTO public.analytics_conversion_definitions (
  id,
  client_id,
  project_id,
  name,
  event_key,
  conversion_type,
  is_primary,
  counts_as_revenue,
  default_value,
  funnel_order,
  created_by
)
VALUES
  (
    '93400000-0000-0000-0000-00000000000a',
    '93000000-0000-0000-0000-00000000000a',
    '93100000-0000-0000-0000-00000000000a',
    'Qualified Lead A',
    'qualified_lead',
    'lead',
    true,
    false,
    25,
    1,
    '93000000-0000-0000-0000-000000000001'
  ),
  (
    '93400000-0000-0000-0000-00000000000b',
    '93000000-0000-0000-0000-00000000000b',
    '93100000-0000-0000-0000-00000000000b',
    'Purchase B',
    'purchase',
    'purchase',
    true,
    true,
    100,
    1,
    '93000000-0000-0000-0000-000000000001'
  );

INSERT INTO public.analytics_conversion_events (
  id,
  client_id,
  project_id,
  definition_id,
  campaign_id,
  utm_link_id,
  source,
  external_id,
  value,
  occurred_at,
  created_by
)
VALUES
  (
    '93500000-0000-0000-0000-00000000000a',
    '93000000-0000-0000-0000-00000000000a',
    '93100000-0000-0000-0000-00000000000a',
    '93400000-0000-0000-0000-00000000000a',
    '93200000-0000-0000-0000-00000000000a',
    '93300000-0000-0000-0000-00000000000a',
    'manual',
    'conversion-a',
    25,
    '2026-07-15 12:00:00+00',
    '93000000-0000-0000-0000-000000000001'
  ),
  (
    '93500000-0000-0000-0000-00000000000b',
    '93000000-0000-0000-0000-00000000000b',
    '93100000-0000-0000-0000-00000000000b',
    '93400000-0000-0000-0000-00000000000b',
    '93200000-0000-0000-0000-00000000000b',
    '93300000-0000-0000-0000-00000000000b',
    'manual',
    'conversion-b',
    100,
    '2026-07-16 12:00:00+00',
    '93000000-0000-0000-0000-000000000001'
  );

INSERT INTO public.analytics_metric_entries (
  id,
  client_id,
  project_id,
  campaign_id,
  utm_link_id,
  metric_key,
  metric_value,
  source,
  external_id,
  period_start,
  period_end,
  created_by
)
VALUES
  (
    '93600000-0000-0000-0000-00000000000a',
    '93000000-0000-0000-0000-00000000000a',
    '93100000-0000-0000-0000-00000000000a',
    '93200000-0000-0000-0000-00000000000a',
    '93300000-0000-0000-0000-00000000000a',
    'impressions',
    1000,
    'manual',
    'metric-a',
    '2026-07-01',
    '2026-07-31',
    '93000000-0000-0000-0000-000000000001'
  ),
  (
    '93600000-0000-0000-0000-00000000000b',
    '93000000-0000-0000-0000-00000000000b',
    '93100000-0000-0000-0000-00000000000b',
    '93200000-0000-0000-0000-00000000000b',
    '93300000-0000-0000-0000-00000000000b',
    'impressions',
    1200,
    'manual',
    'metric-b',
    '2026-07-01',
    '2026-07-31',
    '93000000-0000-0000-0000-000000000001'
  );

-- ---------------------------------------------------------------------------
-- 3. Write authorization: admin, assigned manager and assigned traffic.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(
  '93000000-0000-0000-0000-000000000001'
);

SELECT is(
  public.analytics_can_write_client(
    '93000000-0000-0000-0000-00000000000b'
  ),
  true,
  'admin can write analytics for any client'
);

SELECT lives_ok(
  $sql$
    INSERT INTO public.analytics_campaigns (
      client_id,
      project_id,
      name,
      channel,
      utm_campaign,
      created_by
    )
    VALUES (
      '93000000-0000-0000-0000-00000000000b',
      '93100000-0000-0000-0000-00000000000b',
      'Admin Campaign B',
      'google_ads',
      'admin_campaign_b',
      '93000000-0000-0000-0000-000000000001'
    )
  $sql$,
  'admin creates analytics for Client B'
);

SELECT pg_temp.act_as(
  '93000000-0000-0000-0000-000000000002'
);

SELECT is(
  public.analytics_can_write_client(
    '93000000-0000-0000-0000-00000000000a'
  ),
  true,
  'assigned manager can write Client A analytics'
);

SELECT lives_ok(
  $sql$
    INSERT INTO public.analytics_campaigns (
      client_id,
      project_id,
      name,
      objective,
      channel,
      utm_campaign,
      created_by
    )
    VALUES (
      '93000000-0000-0000-0000-00000000000a',
      '93100000-0000-0000-0000-00000000000a',
      'Manager Campaign A',
      'Gerar conversas qualificadas para o lançamento de julho',
      'instagram',
      'manager_campaign_a',
      '93000000-0000-0000-0000-000000000001'
    )
  $sql$,
  'assigned manager creates Client A campaign'
);

SELECT is(
  (
    SELECT created_by
    FROM public.analytics_campaigns
    WHERE utm_campaign = 'manager_campaign_a'
  ),
  '93000000-0000-0000-0000-000000000002'::uuid,
  'record guard replaces forged created_by with the authenticated manager'
);

SELECT is(
  (
    SELECT objective
    FROM public.analytics_campaigns
    WHERE utm_campaign = 'manager_campaign_a'
  ),
  'Gerar conversas qualificadas para o lançamento de julho',
  'campaign objective accepts non-empty human context instead of requiring a slug'
);

SELECT throws_ok(
  $sql$
    INSERT INTO public.analytics_campaigns (
      client_id,
      project_id,
      name,
      objective,
      channel,
      utm_campaign,
      created_by
    )
    VALUES (
      '93000000-0000-0000-0000-00000000000a',
      '93100000-0000-0000-0000-00000000000a',
      'Campaign Without Objective',
      '   ',
      'instagram',
      'campaign_without_objective',
      '93000000-0000-0000-0000-000000000002'
    )
  $sql$,
  '23514',
  NULL,
  'campaign objective rejects blank context'
);

SELECT throws_ok(
  $sql$
    INSERT INTO public.analytics_campaigns (
      client_id,
      project_id,
      name,
      objective,
      channel,
      status,
      utm_campaign,
      created_by
    )
    VALUES (
      '93000000-0000-0000-0000-00000000000a',
      '93100000-0000-0000-0000-00000000000a',
      'Invalid Archived Campaign',
      'Provar que arquivamento lógico não nasce ativo',
      'instagram',
      'archived',
      'invalid_archived_campaign',
      '93000000-0000-0000-0000-000000000002'
    )
  $sql$,
  '23514',
  NULL,
  'campaign cannot be created as archived without an archive timestamp'
);

SELECT lives_ok(
  $sql$
    INSERT INTO public.analytics_utm_links (
      client_id,
      project_id,
      campaign_id,
      name,
      destination_url,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      created_by
    )
    VALUES (
      '93000000-0000-0000-0000-00000000000a',
      '93100000-0000-0000-0000-00000000000a',
      '93200000-0000-0000-0000-00000000000a',
      'Derived Campaign UTM',
      'https://example.test/derived',
      'instagram',
      'organic_social',
      'forged_campaign_value',
      'story',
      '93000000-0000-0000-0000-000000000002'
    )
  $sql$,
  'assigned manager creates a UTM link in the campaign scope'
);

SELECT is(
  (
    SELECT utm_campaign
    FROM public.analytics_utm_links
    WHERE destination_url = 'https://example.test/derived'
  ),
  'campaign_a',
  'UTM link derives utm_campaign from its scoped campaign'
);

SELECT lives_ok(
  $sql$
    INSERT INTO public.analytics_conversion_events (
      id,
      client_id,
      project_id,
      definition_id,
      campaign_id,
      utm_link_id,
      source,
      external_id,
      occurred_at,
      created_by
    )
    VALUES (
      '93500000-0000-0000-0000-00000000000c',
      '93000000-0000-0000-0000-00000000000a',
      '93100000-0000-0000-0000-00000000000a',
      '93400000-0000-0000-0000-00000000000a',
      '93200000-0000-0000-0000-00000000000a',
      '93300000-0000-0000-0000-00000000000a',
      'manual',
      'conversion-default-a',
      '2026-07-17 12:00:00+00',
      '93000000-0000-0000-0000-000000000001'
    )
  $sql$,
  'conversion event can omit value and currency when its definition supplies them'
);

SELECT ok(
  (
    SELECT value = 25
      AND currency = 'BRL'
      AND definition_name = 'Qualified Lead A'
      AND event_key = 'qualified_lead'
    FROM public.analytics_conversion_events
    WHERE id = '93500000-0000-0000-0000-00000000000c'
  ),
  'conversion event inherits value, currency and immutable definition snapshot'
);

SELECT pg_temp.act_as(
  '93000000-0000-0000-0000-000000000003'
);

SELECT is(
  public.analytics_can_write_client(
    '93000000-0000-0000-0000-00000000000a'
  ),
  true,
  'assigned traffic can write Client A analytics'
);

SELECT lives_ok(
  $sql$
    INSERT INTO public.analytics_metric_entries (
      client_id,
      project_id,
      campaign_id,
      metric_key,
      metric_value,
      source,
      external_id,
      period_start,
      period_end,
      created_by
    )
    VALUES (
      '93000000-0000-0000-0000-00000000000a',
      '93100000-0000-0000-0000-00000000000a',
      '93200000-0000-0000-0000-00000000000a',
      'clicks',
      120,
      'manual',
      'traffic-clicks-a',
      '2026-08-01',
      '2026-08-31',
      '93000000-0000-0000-0000-000000000001'
    )
  $sql$,
  'assigned traffic records a manual metric'
);

-- ---------------------------------------------------------------------------
-- 4. Read-only roles and cross-client isolation.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(
  '93000000-0000-0000-0000-000000000004'
);

SELECT is(
  public.analytics_can_write_client(
    '93000000-0000-0000-0000-00000000000a'
  ),
  false,
  'assigned design is read-only for analytics'
);

SELECT cmp_ok(
  (
    SELECT count(*)::integer
    FROM public.analytics_campaigns
    WHERE client_id = '93000000-0000-0000-0000-00000000000a'
  ),
  '>',
  0,
  'assigned design reads Client A analytics'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.analytics_campaigns
    WHERE client_id = '93000000-0000-0000-0000-00000000000b'
  ),
  0,
  'assigned design cannot read Client B analytics'
);

SELECT throws_ok(
  $sql$
    INSERT INTO public.analytics_campaigns (
      client_id,
      project_id,
      name,
      channel,
      utm_campaign,
      created_by
    )
    VALUES (
      '93000000-0000-0000-0000-00000000000a',
      '93100000-0000-0000-0000-00000000000a',
      'Design Cannot Write',
      'instagram',
      'design_cannot_write',
      '93000000-0000-0000-0000-000000000004'
    )
  $sql$,
  '42501',
  NULL,
  'assigned design cannot create analytics'
);

SELECT pg_temp.act_as(
  '93000000-0000-0000-0000-00000000000a'
);

SELECT is(
  public.analytics_can_write_client(
    '93000000-0000-0000-0000-00000000000a'
  ),
  false,
  'client owner is read-only for analytics'
);

SELECT cmp_ok(
  (
    SELECT count(*)::integer
    FROM public.analytics_conversion_events
    WHERE client_id = '93000000-0000-0000-0000-00000000000a'
  ),
  '>',
  0,
  'client owner reads own conversion events'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.analytics_conversion_events
    WHERE client_id = '93000000-0000-0000-0000-00000000000b'
  ),
  0,
  'client owner cannot read another client conversion events'
);

SELECT throws_ok(
  $sql$
    INSERT INTO public.analytics_metric_entries (
      client_id,
      project_id,
      metric_key,
      metric_value,
      source,
      external_id,
      period_start,
      period_end,
      created_by
    )
    VALUES (
      '93000000-0000-0000-0000-00000000000a',
      '93100000-0000-0000-0000-00000000000a',
      'client_metric',
      1,
      'manual',
      'client-cannot-write',
      '2026-08-01',
      '2026-08-31',
      '93000000-0000-0000-0000-00000000000a'
    )
  $sql$,
  '42501',
  NULL,
  'client owner cannot write own analytics'
);

SELECT pg_temp.act_as(
  '93000000-0000-0000-0000-00000000000e'
);

SELECT is(
  public.analytics_can_write_client(
    '93000000-0000-0000-0000-00000000000a'
  ),
  false,
  'unassigned manager cannot write Client A analytics'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.analytics_campaigns
  ),
  0,
  'unassigned manager cannot read any analytics fixture'
);

SELECT pg_temp.act_as(
  '93000000-0000-0000-0000-000000000002'
);

SELECT throws_ok(
  $sql$
    INSERT INTO public.analytics_campaigns (
      client_id,
      project_id,
      name,
      channel,
      utm_campaign,
      created_by
    )
    VALUES (
      '93000000-0000-0000-0000-00000000000b',
      '93100000-0000-0000-0000-00000000000b',
      'Cross Client Write',
      'meta_ads',
      'cross_client_write',
      '93000000-0000-0000-0000-000000000002'
    )
  $sql$,
  '42501',
  NULL,
  'assigned manager cannot write another client analytics'
);

-- ---------------------------------------------------------------------------
-- 5. Composite FKs enforce client and project scope independently of RLS.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(
  '93000000-0000-0000-0000-000000000001'
);

SELECT throws_ok(
  $sql$
    INSERT INTO public.analytics_campaigns (
      client_id,
      project_id,
      name,
      channel,
      utm_campaign,
      created_by
    )
    VALUES (
      '93000000-0000-0000-0000-00000000000a',
      '93100000-0000-0000-0000-00000000000b',
      'Mismatched Client Project',
      'meta_ads',
      'mismatched_client_project',
      '93000000-0000-0000-0000-000000000001'
    )
  $sql$,
  '23503',
  NULL,
  'campaign cannot bind a Client A row to Client B project'
);

SELECT throws_ok(
  $sql$
    INSERT INTO public.analytics_utm_links (
      client_id,
      project_id,
      campaign_id,
      name,
      destination_url,
      utm_source,
      utm_medium,
      utm_campaign,
      created_by
    )
    VALUES (
      '93000000-0000-0000-0000-00000000000a',
      '93100000-0000-0000-0000-00000000000a',
      '93200000-0000-0000-0000-00000000000c',
      'Mismatched Same Client Project',
      'https://example.test/mismatch',
      'google',
      'paid_search',
      'campaign_a2',
      '93000000-0000-0000-0000-000000000001'
    )
  $sql$,
  '23503',
  NULL,
  'UTM link cannot bind a campaign from another project of the same client'
);

SELECT throws_ok(
  $sql$
    INSERT INTO public.analytics_conversion_events (
      client_id,
      project_id,
      definition_id,
      campaign_id,
      utm_link_id,
      source,
      external_id,
      value,
      occurred_at,
      created_by
    )
    VALUES (
      '93000000-0000-0000-0000-00000000000a',
      '93100000-0000-0000-0000-00000000000a',
      '93400000-0000-0000-0000-00000000000a',
      '93200000-0000-0000-0000-00000000000b',
      '93300000-0000-0000-0000-00000000000b',
      'manual',
      'cross-scope-event',
      10,
      '2026-07-20 12:00:00+00',
      '93000000-0000-0000-0000-000000000001'
    )
  $sql$,
  '23503',
  NULL,
  'conversion event cannot mix definition and attribution from different scopes'
);

SELECT throws_ok(
  $sql$
    INSERT INTO public.analytics_conversion_events (
      client_id,
      project_id,
      definition_id,
      campaign_id,
      utm_link_id,
      source,
      external_id,
      value,
      occurred_at,
      created_by
    )
    VALUES (
      '93000000-0000-0000-0000-00000000000a',
      '93100000-0000-0000-0000-00000000000a',
      '93400000-0000-0000-0000-00000000000b',
      '93200000-0000-0000-0000-00000000000a',
      '93300000-0000-0000-0000-00000000000a',
      'manual',
      'cross-scope-definition',
      10,
      '2026-07-20 13:00:00+00',
      '93000000-0000-0000-0000-000000000001'
    )
  $sql$,
  '23503',
  NULL,
  'conversion event cannot use a definition from another client scope'
);

-- ---------------------------------------------------------------------------
-- 6. Idempotency and semantic uniqueness.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(
  '93000000-0000-0000-0000-000000000002'
);

SELECT throws_ok(
  $sql$
    INSERT INTO public.analytics_conversion_events (
      client_id,
      project_id,
      definition_id,
      campaign_id,
      utm_link_id,
      source,
      external_id,
      value,
      occurred_at,
      created_by
    )
    VALUES (
      '93000000-0000-0000-0000-00000000000a',
      '93100000-0000-0000-0000-00000000000a',
      '93400000-0000-0000-0000-00000000000a',
      '93200000-0000-0000-0000-00000000000a',
      '93300000-0000-0000-0000-00000000000a',
      'manual',
      'conversion-a',
      25,
      '2026-07-15 12:00:00+00',
      '93000000-0000-0000-0000-000000000002'
    )
  $sql$,
  '23505',
  NULL,
  'same client, source and external conversion id is idempotent'
);

SELECT throws_ok(
  $sql$
    INSERT INTO public.analytics_metric_entries (
      client_id,
      project_id,
      campaign_id,
      utm_link_id,
      metric_key,
      metric_value,
      source,
      external_id,
      period_start,
      period_end,
      created_by
    )
    VALUES (
      '93000000-0000-0000-0000-00000000000a',
      '93100000-0000-0000-0000-00000000000a',
      '93200000-0000-0000-0000-00000000000a',
      '93300000-0000-0000-0000-00000000000a',
      'impressions',
      1000,
      'manual',
      'metric-a',
      '2026-09-01',
      '2026-09-30',
      '93000000-0000-0000-0000-000000000002'
    )
  $sql$,
  '23505',
  NULL,
  'same source metric identity is idempotent'
);

SELECT throws_ok(
  $sql$
    INSERT INTO public.analytics_metric_entries (
      client_id,
      project_id,
      campaign_id,
      utm_link_id,
      metric_key,
      metric_value,
      source,
      external_id,
      period_start,
      period_end,
      created_by
    )
    VALUES (
      '93000000-0000-0000-0000-00000000000a',
      '93100000-0000-0000-0000-00000000000a',
      '93200000-0000-0000-0000-00000000000a',
      '93300000-0000-0000-0000-00000000000a',
      'impressions',
      999,
      'manual',
      'different-external-overlap',
      '2026-07-15',
      '2026-08-15',
      '93000000-0000-0000-0000-000000000002'
    )
  $sql$,
  '23505',
  NULL,
  'overlapping metric periods cannot double-count the same scoped observation'
);

SELECT throws_ok(
  $sql$
    INSERT INTO public.analytics_utm_links (
      client_id,
      project_id,
      campaign_id,
      name,
      destination_url,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      created_by
    )
    VALUES (
      '93000000-0000-0000-0000-00000000000a',
      '93100000-0000-0000-0000-00000000000a',
      '93200000-0000-0000-0000-00000000000a',
      'Duplicate UTM A',
      'https://example.test/a',
      'meta',
      'paid_social',
      'campaign_a',
      'creative_a',
      '93000000-0000-0000-0000-000000000002'
    )
  $sql$,
  '23505',
  NULL,
  'same active UTM tracking identity cannot be duplicated'
);

-- ---------------------------------------------------------------------------
-- 7. Conversion snapshots and tracking identity are immutable.
-- ---------------------------------------------------------------------------
SELECT is(
  (
    SELECT definition_name
    FROM public.analytics_conversion_events
    WHERE id = '93500000-0000-0000-0000-00000000000a'
  ),
  'Qualified Lead A',
  'conversion event stores the original definition snapshot'
);

SELECT lives_ok(
  $sql$
    UPDATE public.analytics_conversion_definitions
    SET name = 'Renamed Qualified Lead A'
    WHERE id = '93400000-0000-0000-0000-00000000000a'
  $sql$,
  'assigned manager can rename the live conversion definition'
);

SELECT is(
  (
    SELECT definition_name
    FROM public.analytics_conversion_events
    WHERE id = '93500000-0000-0000-0000-00000000000a'
  ),
  'Qualified Lead A',
  'existing conversion snapshot does not change with its definition'
);

SELECT throws_like(
  $sql$
    UPDATE public.analytics_conversion_events
    SET value = 999
    WHERE id = '93500000-0000-0000-0000-00000000000a'
  $sql$,
  '%conversion events are append-only%',
  'conversion event business data cannot be rewritten'
);

SELECT throws_like(
  $sql$
    UPDATE public.analytics_utm_links
    SET utm_source = 'google'
    WHERE id = '93300000-0000-0000-0000-00000000000a'
  $sql$,
  '%used tracking fields are immutable%',
  'UTM tracking identity cannot be rewritten'
);

SELECT throws_like(
  $sql$
    UPDATE public.analytics_campaigns
    SET utm_campaign = 'campaign_a_rewritten'
    WHERE id = '93200000-0000-0000-0000-00000000000a'
  $sql$,
  '%campaign UTM identity is immutable%',
  'campaign UTM identity cannot be rewritten after creation'
);

SELECT lives_ok(
  $sql$
    UPDATE public.analytics_utm_links
    SET name = 'Renamed UTM A'
    WHERE id = '93300000-0000-0000-0000-00000000000a'
  $sql$,
  'UTM display metadata can change without changing attribution'
);

SELECT lives_ok(
  $sql$
    UPDATE public.analytics_metric_entries
    SET metric_value = 1100
    WHERE id = '93600000-0000-0000-0000-00000000000a'
  $sql$,
  'metric observation value can be corrected in place'
);

SELECT is(
  (
    SELECT metric_value
    FROM public.analytics_metric_entries
    WHERE id = '93600000-0000-0000-0000-00000000000a'
  ),
  1100::numeric,
  'metric value correction persists without changing its identity'
);

SELECT throws_like(
  $sql$
    UPDATE public.analytics_metric_entries
    SET period_start = '2026-06-30'
    WHERE id = '93600000-0000-0000-0000-00000000000a'
  $sql$,
  '%metric identity fields are immutable%',
  'metric scope and period identity cannot be rewritten'
);

-- ---------------------------------------------------------------------------
-- 8. Logical archive keeps records and captures the actor.
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $sql$
    UPDATE public.analytics_conversion_events
    SET archived_at = now()
    WHERE id = '93500000-0000-0000-0000-00000000000a'
  $sql$,
  'assigned manager can logically archive a conversion event'
);

SELECT ok(
  (
    SELECT archived_at IS NOT NULL
      AND archived_by =
        '93000000-0000-0000-0000-000000000002'::uuid
    FROM public.analytics_conversion_events
    WHERE id = '93500000-0000-0000-0000-00000000000a'
  ),
  'archived conversion remains present and records the actor'
);

SELECT lives_ok(
  $sql$
    UPDATE public.analytics_utm_links
    SET
      active = false,
      archived_at = now()
    WHERE id = '93300000-0000-0000-0000-00000000000a'
  $sql$,
  'assigned manager logically archives a UTM link'
);

SELECT lives_ok(
  $sql$
    UPDATE public.analytics_conversion_definitions
    SET
      active = false,
      archived_at = now()
    WHERE id = '93400000-0000-0000-0000-00000000000a'
  $sql$,
  'assigned manager logically archives a conversion definition'
);

SELECT lives_ok(
  $sql$
    UPDATE public.analytics_campaigns
    SET
      status = 'archived',
      archived_at = now()
    WHERE id = '93200000-0000-0000-0000-00000000000a'
  $sql$,
  'assigned manager logically archives a campaign'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.analytics_campaigns
    WHERE id = '93200000-0000-0000-0000-00000000000a'
      AND status = 'archived'
      AND archived_at IS NOT NULL
  )
    AND EXISTS (
      SELECT 1
      FROM public.analytics_utm_links
      WHERE id = '93300000-0000-0000-0000-00000000000a'
        AND active = false
        AND archived_at IS NOT NULL
    )
    AND EXISTS (
      SELECT 1
      FROM public.analytics_conversion_definitions
      WHERE id = '93400000-0000-0000-0000-00000000000a'
        AND active = false
        AND archived_at IS NOT NULL
    )
    AND EXISTS (
      SELECT 1
      FROM public.analytics_conversion_events
      WHERE id = '93500000-0000-0000-0000-00000000000a'
        AND archived_at IS NOT NULL
    ),
  'logical archive preserves campaign, UTM, definition and conversion history'
);

SELECT throws_ok(
  $sql$
    DELETE FROM public.analytics_conversion_events
    WHERE id = '93500000-0000-0000-0000-00000000000a'
  $sql$,
  '42501',
  NULL,
  'authenticated manager cannot hard-delete a conversion event'
);

SELECT throws_ok(
  $sql$
    DELETE FROM public.analytics_campaigns
    WHERE id = '93200000-0000-0000-0000-00000000000a'
  $sql$,
  '42501',
  NULL,
  'authenticated manager cannot hard-delete an archived campaign'
);

SELECT * FROM finish();

ROLLBACK;
