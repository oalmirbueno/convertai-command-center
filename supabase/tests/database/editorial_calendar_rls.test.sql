-- ============================================================================
-- Aceleriq OS - editorial calendar, publication workflow and RLS contract
-- Runs entirely inside BEGIN/ROLLBACK and never persists fixture data.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT * FROM no_plan();

-- Keep fixture writes local: legacy automation triggers must not make outbound
-- calls while this transaction creates users, projects and tasks.
ALTER TABLE public.profiles DISABLE TRIGGER USER;
ALTER TABLE public.projects DISABLE TRIGGER USER;
ALTER TABLE public.tasks DISABLE TRIGGER USER;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
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

CREATE OR REPLACE FUNCTION pg_temp.act_as_anon() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.act_as_owner() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.act_as_service_role() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config(
    'request.jwt.claims',
    '{"role":"service_role"}',
    true
  );
  EXECUTE 'SET LOCAL ROLE service_role';
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.statement_fails(_sql text)
RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  _message text;
  _state text;
BEGIN
  BEGIN
    EXECUTE _sql;
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = '__editorial_test_statement_succeeded__';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      _message = MESSAGE_TEXT,
      _state = RETURNED_SQLSTATE;
    RETURN NOT (
      _state = 'P0001'
      AND _message = '__editorial_test_statement_succeeded__'
    );
  END;
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
-- 1. Structural contract: schema, RLS, grants, policies and guarded RPCs.
-- ---------------------------------------------------------------------------
SELECT ok(
  to_regclass('public.editorial_posts') IS NOT NULL
    AND to_regclass('public.editorial_post_internal') IS NOT NULL
    AND to_regclass('public.editorial_publications') IS NOT NULL
    AND to_regclass('public.editorial_publication_internal') IS NOT NULL
    AND to_regclass('public.editorial_events') IS NOT NULL,
  'all five editorial tables exist'
);

SELECT ok(
  (
    SELECT bool_and(relation.relrowsecurity)
    FROM pg_class AS relation
    WHERE relation.oid IN (
      'public.editorial_posts'::regclass,
      'public.editorial_post_internal'::regclass,
      'public.editorial_publications'::regclass,
      'public.editorial_publication_internal'::regclass,
      'public.editorial_events'::regclass
    )
  ),
  'RLS is enabled on every editorial table'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'editorial_posts',
        'editorial_post_internal',
        'editorial_publications',
        'editorial_publication_internal',
        'editorial_events'
      )
      AND cmd <> 'SELECT'
  ),
  0,
  'authenticated editorial tables expose no direct write policy'
);

SELECT ok(
  (
    SELECT bool_and(
      has_table_privilege(
        'authenticated',
        format('%I.%I', relation.schemaname, relation.tablename),
        'SELECT'
      )
      AND NOT has_table_privilege(
        'authenticated',
        format('%I.%I', relation.schemaname, relation.tablename),
        'INSERT'
      )
      AND NOT has_table_privilege(
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
      AND NOT has_table_privilege(
        'authenticated',
        format('%I.%I', relation.schemaname, relation.tablename),
        'REFERENCES'
      )
      AND NOT has_table_privilege(
        'authenticated',
        format('%I.%I', relation.schemaname, relation.tablename),
        'TRIGGER'
      )
    )
    FROM (
      VALUES
        ('public', 'editorial_posts'),
        ('public', 'editorial_post_internal'),
        ('public', 'editorial_publications'),
        ('public', 'editorial_publication_internal'),
        ('public', 'editorial_events')
    ) AS relation(schemaname, tablename)
  ),
  'authenticated receives SELECT only on all editorial tables'
);

SELECT ok(
  (
    SELECT bool_and(
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
      AND NOT has_table_privilege(
        'anon',
        format('%I.%I', relation.schemaname, relation.tablename),
        'REFERENCES'
      )
      AND NOT has_table_privilege(
        'anon',
        format('%I.%I', relation.schemaname, relation.tablename),
        'TRIGGER'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_class AS target_relation
        CROSS JOIN LATERAL aclexplode(
          COALESCE(
            target_relation.relacl,
            acldefault('r', target_relation.relowner)
          )
        ) AS acl
        WHERE target_relation.oid =
          format(
            '%I.%I',
            relation.schemaname,
            relation.tablename
          )::regclass
          AND acl.grantee = 0
      )
    )
    FROM (
      VALUES
        ('public', 'editorial_posts'),
        ('public', 'editorial_post_internal'),
        ('public', 'editorial_publications'),
        ('public', 'editorial_publication_internal'),
        ('public', 'editorial_events')
    ) AS relation(schemaname, tablename)
  ),
  'anon and PUBLIC receive no table privileges on editorial tables'
);

SELECT ok(
  (
    SELECT bool_and(
      has_table_privilege(
        'service_role',
        format('%I.%I', relation.schemaname, relation.tablename),
        'SELECT'
      )
      AND NOT has_table_privilege(
        'service_role',
        format('%I.%I', relation.schemaname, relation.tablename),
        'INSERT'
      )
      AND NOT has_table_privilege(
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
      AND NOT has_table_privilege(
        'service_role',
        format('%I.%I', relation.schemaname, relation.tablename),
        'REFERENCES'
      )
      AND NOT has_table_privilege(
        'service_role',
        format('%I.%I', relation.schemaname, relation.tablename),
        'TRIGGER'
      )
    )
    FROM (
      VALUES
        ('public', 'editorial_posts'),
        ('public', 'editorial_post_internal'),
        ('public', 'editorial_publications'),
        ('public', 'editorial_publication_internal'),
        ('public', 'editorial_events')
    ) AS relation(schemaname, tablename)
  ),
  'service_role is read-only until a dedicated social worker exists'
);

SELECT ok(
  EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'editorial_post_internal'
        AND column_name = 'approval_fingerprint'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'files'
        AND column_name = 'approval_fingerprint'
    ),
  'approval fingerprints live only in the staff-only editorial record'
);

SELECT ok(
  EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'public.editorial_post_internal'::regclass
        AND conname =
          'editorial_post_internal_approval_fingerprint_check'
        AND contype = 'c'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'editorial_posts'
        AND indexname = 'editorial_posts_primary_file_unique_idx'
        AND indexdef LIKE '%UNIQUE%'
        AND indexdef LIKE '%primary_file_id%'
    )
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'editorial_publication_internal'
        AND column_name = 'included_in_approval_snapshot'
        AND is_nullable = 'NO'
    ),
  'approval fingerprints, snapshot membership and primary files have guards'
);

SELECT ok(
  (
    SELECT bool_and(procedure_row.prosecdef)
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid IN (
      'public.save_editorial_post(jsonb,integer)'::regprocedure,
      'public.transition_editorial_publication(uuid,text,integer,timestamptz,text,text,text,text,text,timestamptz)'::regprocedure,
      'public.archive_editorial_post(uuid,integer)'::regprocedure,
      'public.create_and_link_editorial_account(uuid,uuid,text,text,text)'::regprocedure
    )
  ),
  'editorial and account mutation RPCs are SECURITY DEFINER'
);

SELECT ok(
  (
    SELECT
      procedure_row.prosecdef
      AND procedure_row.proconfig @> ARRAY['search_path=""']::text[]
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid =
      'public.create_and_link_editorial_account(uuid,uuid,text,text,text)'::regprocedure
  ),
  'atomic account setup is SECURITY DEFINER with an empty search_path'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.save_editorial_post(jsonb,integer)',
    'EXECUTE'
  )
    AND has_function_privilege(
      'authenticated',
      'public.transition_editorial_publication(uuid,text,integer,timestamptz,text,text,text,text,text,timestamptz)',
      'EXECUTE'
    )
    AND has_function_privilege(
      'authenticated',
      'public.archive_editorial_post(uuid,integer)',
      'EXECUTE'
    )
    AND has_function_privilege(
      'authenticated',
      'public.get_editorial_approval_preview(uuid)',
      'EXECUTE'
    )
    AND has_function_privilege(
      'authenticated',
      'public.create_and_link_editorial_account(uuid,uuid,text,text,text)',
      'EXECUTE'
    ),
  'authenticated can invoke guarded mutations, account setup and the public-safe preview'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.save_editorial_post(jsonb,integer)',
    'EXECUTE'
  )
    AND NOT has_function_privilege(
      'anon',
      'public.transition_editorial_publication(uuid,text,integer,timestamptz,text,text,text,text,text,timestamptz)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.archive_editorial_post(uuid,integer)',
      'EXECUTE'
    )
    AND NOT pg_temp.public_has_execute(
      'public.save_editorial_post(jsonb,integer)'::regprocedure
    )
    AND NOT pg_temp.public_has_execute(
      'public.transition_editorial_publication(uuid,text,integer,timestamptz,text,text,text,text,text,timestamptz)'::regprocedure
    )
    AND NOT pg_temp.public_has_execute(
      'public.archive_editorial_post(uuid,integer)'::regprocedure
    )
    AND NOT has_function_privilege(
      'service_role',
      'public.save_editorial_post(jsonb,integer)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'service_role',
      'public.transition_editorial_publication(uuid,text,integer,timestamptz,text,text,text,text,text,timestamptz)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'service_role',
      'public.archive_editorial_post(uuid,integer)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.get_editorial_approval_preview(uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'service_role',
      'public.get_editorial_approval_preview(uuid)',
      'EXECUTE'
    )
    AND NOT pg_temp.public_has_execute(
      'public.get_editorial_approval_preview(uuid)'::regprocedure
    )
    AND NOT has_function_privilege(
      'anon',
      'public.create_and_link_editorial_account(uuid,uuid,text,text,text)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'service_role',
      'public.create_and_link_editorial_account(uuid,uuid,text,text,text)',
      'EXECUTE'
    )
    AND NOT pg_temp.public_has_execute(
      'public.create_and_link_editorial_account(uuid,uuid,text,text,text)'::regprocedure
    ),
  'anon, PUBLIC and service_role cannot mutate, set up accounts or inspect approval previews'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.editorial_file_is_publishable(uuid,uuid,uuid)',
    'EXECUTE'
  )
    AND NOT has_function_privilege(
      'service_role',
      'public.editorial_file_is_publishable(uuid,uuid,uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.editorial_file_is_publishable(uuid,uuid,uuid)',
      'EXECUTE'
    )
    AND NOT pg_temp.public_has_execute(
      'public.editorial_file_is_publishable(uuid,uuid,uuid)'::regprocedure
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.editorial_file_is_publishable_media(uuid,uuid,uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'service_role',
      'public.editorial_file_is_publishable_media(uuid,uuid,uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.editorial_file_is_publishable_media(uuid,uuid,uuid)',
      'EXECUTE'
    )
    AND NOT pg_temp.public_has_execute(
      'public.editorial_file_is_publishable_media(uuid,uuid,uuid)'::regprocedure
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.editorial_compute_approval_fingerprint(uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'service_role',
      'public.editorial_compute_approval_fingerprint(uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.editorial_compute_approval_fingerprint(uuid)',
      'EXECUTE'
    )
    AND NOT pg_temp.public_has_execute(
      'public.editorial_compute_approval_fingerprint(uuid)'::regprocedure
    ),
  'publishability, media and approval fingerprint helpers stay private'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.editorial_posts'::regclass
      AND conname = 'editorial_posts_project_fk'
      AND contype = 'f'
  )
    AND EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'public.editorial_post_internal'::regclass
        AND conname = 'editorial_post_internal_post_fk'
        AND contype = 'f'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'public.editorial_publications'::regclass
        AND conname = 'editorial_publications_post_fk'
        AND contype = 'f'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'public.editorial_publications'::regclass
        AND conname = 'editorial_publications_account_fk'
        AND contype = 'f'
    ),
  'composite foreign keys preserve client and project scope'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.editorial_events'::regclass
      AND tgname = 'editorial_events_no_update_delete'
      AND NOT tgisinternal
  )
    AND EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgrelid = 'public.editorial_events'::regclass
        AND tgname = 'editorial_events_no_truncate'
        AND NOT tgisinternal
    ),
  'editorial history has row and statement immutability triggers'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.file_approval_events'::regclass
      AND tgname = 'file_approval_events_editorial_snapshot_trg'
      AND NOT tgisinternal
  ),
  'file decisions are bound to the current editorial approval fingerprint'
);

SELECT pg_temp.act_as_anon();
SELECT ok(
  pg_temp.statement_fails(
    'SELECT count(*) FROM public.editorial_posts'
  ),
  'anon cannot query editorial posts'
);
SELECT ok(
  pg_temp.statement_fails(
    'SELECT count(*) FROM public.editorial_events'
  ),
  'anon cannot query editorial history'
);
SELECT pg_temp.act_as_owner();

-- ---------------------------------------------------------------------------
-- 2. Isolated fixtures.
-- ---------------------------------------------------------------------------
-- Actors:
--   admin              91000000-0000-0000-0000-000000000001
--   manager assigned   91000000-0000-0000-0000-000000000002
--   design assigned    91000000-0000-0000-0000-000000000003
--   traffic assigned   91000000-0000-0000-0000-000000000004
--   client A           91000000-0000-0000-0000-00000000000a
--   client B           91000000-0000-0000-0000-00000000000b
--   manager unassigned 91000000-0000-0000-0000-00000000000e

INSERT INTO auth.users (id, email)
VALUES
  (
    '91000000-0000-0000-0000-000000000001',
    'editorial-admin@test.local'
  ),
  (
    '91000000-0000-0000-0000-000000000002',
    'editorial-manager-a@test.local'
  ),
  (
    '91000000-0000-0000-0000-000000000003',
    'editorial-design-a@test.local'
  ),
  (
    '91000000-0000-0000-0000-000000000004',
    'editorial-traffic-a@test.local'
  ),
  (
    '91000000-0000-0000-0000-00000000000a',
    'editorial-client-a@test.local'
  ),
  (
    '91000000-0000-0000-0000-00000000000b',
    'editorial-client-b@test.local'
  ),
  (
    '91000000-0000-0000-0000-00000000000e',
    'editorial-manager-unassigned@test.local'
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
      '91000000-0000-0000-0000-000000000001'::uuid,
      'Editorial Admin'
    ),
    (
      '91000000-0000-0000-0000-000000000002'::uuid,
      'Editorial Manager A'
    ),
    (
      '91000000-0000-0000-0000-000000000003'::uuid,
      'Editorial Design A'
    ),
    (
      '91000000-0000-0000-0000-000000000004'::uuid,
      'Editorial Traffic A'
    ),
    (
      '91000000-0000-0000-0000-00000000000a'::uuid,
      'Editorial Client A'
    ),
    (
      '91000000-0000-0000-0000-00000000000b'::uuid,
      'Editorial Client B'
    ),
    (
      '91000000-0000-0000-0000-00000000000e'::uuid,
      'Editorial Manager Unassigned'
    )
) AS fixture(id, full_name)
WHERE profile.id = fixture.id;

-- handle_new_user creates a client role; replace it only for staff.
DELETE FROM public.user_roles
WHERE user_id IN (
  '91000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000002',
  '91000000-0000-0000-0000-000000000003',
  '91000000-0000-0000-0000-000000000004',
  '91000000-0000-0000-0000-00000000000e'
);

INSERT INTO public.user_roles (user_id, role)
VALUES
  ('91000000-0000-0000-0000-000000000001', 'admin'),
  ('91000000-0000-0000-0000-000000000002', 'manager'),
  ('91000000-0000-0000-0000-000000000003', 'design'),
  ('91000000-0000-0000-0000-000000000004', 'traffic'),
  ('91000000-0000-0000-0000-00000000000e', 'manager');

INSERT INTO public.team_client_assignments (user_id, client_id)
VALUES
  (
    '91000000-0000-0000-0000-000000000002',
    '91000000-0000-0000-0000-00000000000a'
  ),
  (
    '91000000-0000-0000-0000-000000000003',
    '91000000-0000-0000-0000-00000000000a'
  ),
  (
    '91000000-0000-0000-0000-000000000004',
    '91000000-0000-0000-0000-00000000000a'
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
    '92000000-0000-0000-0000-00000000000a',
    '91000000-0000-0000-0000-00000000000a',
    'Editorial Project A',
    'recurring',
    'active',
    0,
    current_date,
    current_date + 30,
    'included'
  ),
  (
    '92000000-0000-0000-0000-00000000000b',
    '91000000-0000-0000-0000-00000000000b',
    'Editorial Project B',
    'recurring',
    'active',
    0,
    current_date,
    current_date + 30,
    'included'
  );

INSERT INTO public.tasks (
  id,
  project_id,
  title,
  status,
  priority,
  assigned_to,
  source
)
VALUES (
  '95000000-0000-0000-0000-00000000000a',
  '92000000-0000-0000-0000-00000000000a',
  'Produce editorial fixture',
  'backlog',
  'medium',
  '91000000-0000-0000-0000-000000000003',
  'portal'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '91000000-0000-0000-0000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '91000000-0000-0000-0000-000000000001',
    'role', 'authenticated'
  )::text,
  true
);

INSERT INTO public.external_accounts (
  id,
  client_id,
  platform,
  display_name,
  handle,
  created_by
)
VALUES
  (
    '93000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-00000000000a',
    'instagram',
    'Client A Instagram',
    '@editorial-a-instagram',
    '91000000-0000-0000-0000-000000000001'
  ),
  (
    '93000000-0000-0000-0000-000000000002',
    '91000000-0000-0000-0000-00000000000a',
    'linkedin',
    'Client A LinkedIn',
    '@editorial-a-linkedin',
    '91000000-0000-0000-0000-000000000001'
  ),
  (
    '93000000-0000-0000-0000-00000000000b',
    '91000000-0000-0000-0000-00000000000b',
    'instagram',
    'Client B Instagram',
    '@editorial-b-instagram',
    '91000000-0000-0000-0000-000000000001'
  );

INSERT INTO public.project_external_accounts (
  client_id,
  project_id,
  external_account_id,
  created_by
)
VALUES
  (
    '91000000-0000-0000-0000-00000000000a',
    '92000000-0000-0000-0000-00000000000a',
    '93000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000001'
  ),
  (
    '91000000-0000-0000-0000-00000000000a',
    '92000000-0000-0000-0000-00000000000a',
    '93000000-0000-0000-0000-000000000002',
    '91000000-0000-0000-0000-000000000001'
  ),
  (
    '91000000-0000-0000-0000-00000000000b',
    '92000000-0000-0000-0000-00000000000b',
    '93000000-0000-0000-0000-00000000000b',
    '91000000-0000-0000-0000-000000000001'
  );

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000002'
);
SELECT lives_ok(
  $sql$
    SELECT public.create_and_link_editorial_account(
      '91000000-0000-0000-0000-00000000000a',
      '92000000-0000-0000-0000-00000000000a',
      ' FACEBOOK ',
      ' Client A Facebook ',
      ' @editorial-a-facebook '
    )
  $sql$,
  'assigned manager creates and links a supported editorial account atomically'
);

SELECT pg_temp.act_as_owner();
SELECT ok(
  (
    SELECT
      account.platform = 'facebook'
      AND account.display_name = 'Client A Facebook'
      AND account.handle = '@editorial-a-facebook'
      AND account.status = 'active'
      AND account.created_by =
        '91000000-0000-0000-0000-000000000002'::uuid
      AND link.client_id = account.client_id
      AND link.project_id =
        '92000000-0000-0000-0000-00000000000a'::uuid
      AND link.created_by =
        '91000000-0000-0000-0000-000000000002'::uuid
    FROM public.external_accounts AS account
    JOIN public.project_external_accounts AS link
      ON link.external_account_id = account.id
    WHERE account.client_id =
        '91000000-0000-0000-0000-00000000000a'::uuid
      AND account.handle = '@editorial-a-facebook'
  ),
  'atomic account setup normalizes fields and preserves actor and project scope'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000003'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.create_and_link_editorial_account(
        '91000000-0000-0000-0000-00000000000a',
        '92000000-0000-0000-0000-00000000000a',
        'youtube',
        'Design must not create accounts',
        '@must-not-persist-design'
      )
    $sql$
  ),
  'assigned design cannot create or link an editorial account'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000002'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.create_and_link_editorial_account(
        '91000000-0000-0000-0000-00000000000a',
        '92000000-0000-0000-0000-00000000000b',
        'instagram',
        'Wrong project scope',
        '@must-not-persist-scope'
      )
    $sql$
  ),
  'account setup rejects a project from another client'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.create_and_link_editorial_account(
        '91000000-0000-0000-0000-00000000000a',
        '92000000-0000-0000-0000-00000000000a',
        'whatsapp',
        'Unsupported platform',
        '@must-not-persist-platform'
      )
    $sql$
  ),
  'account setup rejects platforms outside the six publication channels'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-00000000000e'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.create_and_link_editorial_account(
        '91000000-0000-0000-0000-00000000000a',
        '92000000-0000-0000-0000-00000000000a',
        'tiktok',
        'Unassigned manager',
        '@must-not-persist-unassigned'
      )
    $sql$
  ),
  'unassigned manager cannot create or link an editorial account'
);

SELECT pg_temp.act_as_owner();
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.external_accounts
    WHERE handle LIKE '@must-not-persist-%'
  ),
  0,
  'failed account setup leaves no orphan external account'
);

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
  storage_bucket,
  storage_path
)
VALUES
  (
    '94000000-0000-0000-0000-00000000000a',
    '92000000-0000-0000-0000-00000000000a',
    '91000000-0000-0000-0000-00000000000a',
    '91000000-0000-0000-0000-000000000003',
    'editorial-client-a.png',
    'files://91000000-0000-0000-0000-00000000000a/94000000-0000-0000-0000-00000000000a/1/editorial-client-a.png',
    'image/png',
    'entregas',
    'ready',
    'files',
    '91000000-0000-0000-0000-00000000000a/94000000-0000-0000-0000-00000000000a/1/editorial-client-a.png'
  ),
  (
    '94000000-0000-0000-0000-00000000000b',
    '92000000-0000-0000-0000-00000000000b',
    '91000000-0000-0000-0000-00000000000b',
    '91000000-0000-0000-0000-000000000001',
    'editorial-client-b.png',
    'files://91000000-0000-0000-0000-00000000000b/94000000-0000-0000-0000-00000000000b/1/editorial-client-b.png',
    'image/png',
    'entregas',
    'ready',
    'files',
    '91000000-0000-0000-0000-00000000000b/94000000-0000-0000-0000-00000000000b/1/editorial-client-b.png'
  ),
  (
    '94000000-0000-0000-0000-00000000000c',
    '92000000-0000-0000-0000-00000000000a',
    '91000000-0000-0000-0000-00000000000a',
    '91000000-0000-0000-0000-000000000003',
    'editorial-client-a-spare.png',
    'files://91000000-0000-0000-0000-00000000000a/94000000-0000-0000-0000-00000000000c/1/editorial-client-a-spare.png',
    'image/png',
    'entregas',
    'ready',
    'files',
    '91000000-0000-0000-0000-00000000000a/94000000-0000-0000-0000-00000000000c/1/editorial-client-a-spare.png'
  ),
  (
    '94000000-0000-0000-0000-00000000000d',
    '92000000-0000-0000-0000-00000000000a',
    '91000000-0000-0000-0000-00000000000a',
    '91000000-0000-0000-0000-000000000003',
    'editorial-client-a-override.png',
    'files://91000000-0000-0000-0000-00000000000a/94000000-0000-0000-0000-00000000000d/1/editorial-client-a-override.png',
    'image/png',
    'entregas',
    'ready',
    'files',
    '91000000-0000-0000-0000-00000000000a/94000000-0000-0000-0000-00000000000d/1/editorial-client-a-override.png'
  ),
  (
    '94000000-0000-0000-0000-00000000000e',
    '92000000-0000-0000-0000-00000000000a',
    '91000000-0000-0000-0000-00000000000a',
    '91000000-0000-0000-0000-000000000003',
    'editorial-client-a-no-plan.png',
    'files://91000000-0000-0000-0000-00000000000a/94000000-0000-0000-0000-00000000000e/1/editorial-client-a-no-plan.png',
    'image/png',
    'entregas',
    'ready',
    'files',
    '91000000-0000-0000-0000-00000000000a/94000000-0000-0000-0000-00000000000e/1/editorial-client-a-no-plan.png'
  ),
  (
    '94000000-0000-0000-0000-00000000000f',
    '92000000-0000-0000-0000-00000000000a',
    '91000000-0000-0000-0000-00000000000a',
    '91000000-0000-0000-0000-000000000003',
    'editorial-client-a-new-revision.png',
    'files://91000000-0000-0000-0000-00000000000a/94000000-0000-0000-0000-00000000000f/1/editorial-client-a-new-revision.png',
    'image/png',
    'entregas',
    'ready',
    'files',
    '91000000-0000-0000-0000-00000000000a/94000000-0000-0000-0000-00000000000f/1/editorial-client-a-new-revision.png'
  );

INSERT INTO storage.objects (bucket_id, name)
VALUES
  (
    'files',
    '91000000-0000-0000-0000-00000000000a/94000000-0000-0000-0000-00000000000a/1/editorial-client-a.png'
  ),
  (
    'files',
    '91000000-0000-0000-0000-00000000000b/94000000-0000-0000-0000-00000000000b/1/editorial-client-b.png'
  ),
  (
    'files',
    '91000000-0000-0000-0000-00000000000a/94000000-0000-0000-0000-00000000000c/1/editorial-client-a-spare.png'
  ),
  (
    'files',
    '91000000-0000-0000-0000-00000000000a/94000000-0000-0000-0000-00000000000d/1/editorial-client-a-override.png'
  ),
  (
    'files',
    '91000000-0000-0000-0000-00000000000a/94000000-0000-0000-0000-00000000000e/1/editorial-client-a-no-plan.png'
  ),
  (
    'files',
    '91000000-0000-0000-0000-00000000000a/94000000-0000-0000-0000-00000000000f/1/editorial-client-a-new-revision.png'
  );

CREATE TEMP TABLE editorial_test_state (
  label text PRIMARY KEY,
  payload jsonb NOT NULL,
  result jsonb,
  post_id uuid,
  manager_publication_id uuid,
  admin_publication_id uuid,
  client_b_publication_id uuid,
  initial_approval_fingerprint text,
  updated_approval_fingerprint text,
  stale_post_version integer,
  transition_result jsonb,
  event_count integer
);

GRANT SELECT, INSERT, UPDATE ON pg_temp.editorial_test_state
  TO authenticated;

INSERT INTO pg_temp.editorial_test_state (label, payload)
VALUES
  (
    'client_a',
    jsonb_build_object(
      'client_id', '91000000-0000-0000-0000-00000000000a',
      'project_id', '92000000-0000-0000-0000-00000000000a',
      'primary_file_id', '94000000-0000-0000-0000-00000000000a',
      'task_id', '95000000-0000-0000-0000-00000000000a',
      'responsible_id', '91000000-0000-0000-0000-000000000003',
      'idempotency_key', '96000000-0000-0000-0000-000000000001',
      'mutation_id', '96200000-0000-0000-0000-000000000001',
      'title', 'Launch week',
      'content_type', 'static',
      'objective', 'Validate the editorial workflow',
      'default_caption', 'Default editorial caption',
      'production_status', 'ready',
      'internal_notes', 'Internal fixture note',
      'publications', jsonb_build_array(
        jsonb_build_object(
          'external_account_id',
          '93000000-0000-0000-0000-000000000001',
          'file_id',
          '94000000-0000-0000-0000-00000000000a',
          'caption',
          'Instagram publication',
          'scheduled_at',
          now() + interval '1 day',
          'scheduled_timezone',
          'America/Sao_Paulo',
          'idempotency_key',
          '96100000-0000-0000-0000-000000000001'
        ),
        jsonb_build_object(
          'external_account_id',
          '93000000-0000-0000-0000-000000000002',
          'file_id',
          '94000000-0000-0000-0000-00000000000d',
          'caption',
          'LinkedIn publication',
          'scheduled_at',
          now() + interval '2 days',
          'scheduled_timezone',
          'America/Sao_Paulo',
          'idempotency_key',
          '96100000-0000-0000-0000-000000000002'
        )
      )
    )
  ),
  (
    'client_b',
    jsonb_build_object(
      'client_id', '91000000-0000-0000-0000-00000000000b',
      'project_id', '92000000-0000-0000-0000-00000000000b',
      'primary_file_id', '94000000-0000-0000-0000-00000000000b',
      'responsible_id', '91000000-0000-0000-0000-000000000001',
      'idempotency_key', '96000000-0000-0000-0000-00000000000b',
      'mutation_id', '96200000-0000-0000-0000-00000000000b',
      'title', 'Private client B post',
      'content_type', 'static',
      'production_status', 'ready',
      'publications', jsonb_build_array(
        jsonb_build_object(
          'external_account_id',
          '93000000-0000-0000-0000-00000000000b',
          'file_id',
          '94000000-0000-0000-0000-00000000000b',
          'caption',
          'Client B publication',
          'scheduled_at',
          now() + interval '3 days',
          'scheduled_timezone',
          'America/Sao_Paulo',
          'idempotency_key',
          '96100000-0000-0000-0000-00000000000b'
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Assigned staff save through the RPC; direct writes stay blocked.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000003'
);

SELECT lives_ok(
  $sql$
    UPDATE pg_temp.editorial_test_state
    SET result = public.save_editorial_post(payload, NULL)
    WHERE label = 'client_a'
  $sql$,
  'assigned design saves a post and two platform plans transactionally'
);

SELECT is(
  (
    SELECT (result->>'recovered')::boolean
    FROM pg_temp.editorial_test_state
    WHERE label = 'client_a'
  ),
  false,
  'first save is not an idempotent recovery'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_posts
    WHERE client_id = '91000000-0000-0000-0000-00000000000a'
  ),
  1,
  'assigned design sees the saved Client A post'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_publications
    WHERE client_id = '91000000-0000-0000-0000-00000000000a'
  ),
  2,
  'one independent publication plan exists per linked platform account'
);

SELECT ok(
  (
    SELECT
      internal.task_id =
        '95000000-0000-0000-0000-00000000000a'::uuid
      AND internal.responsible_id =
        '91000000-0000-0000-0000-000000000003'::uuid
      AND internal.internal_notes = 'Internal fixture note'
    FROM public.editorial_post_internal AS internal
    JOIN pg_temp.editorial_test_state AS state
      ON state.result->>'post_id' = internal.post_id::text
    WHERE state.label = 'client_a'
  ),
  'task, responsible and notes stay in the staff-only record'
);

SELECT pg_temp.act_as_owner();
UPDATE pg_temp.editorial_test_state AS state
SET
  post_id = (state.result->>'post_id')::uuid,
  initial_approval_fingerprint = internal.approval_fingerprint
FROM public.editorial_post_internal AS internal
WHERE state.label = 'client_a'
  AND internal.post_id = (state.result->>'post_id')::uuid;

SELECT ok(
  (
    SELECT
      state.initial_approval_fingerprint ~ '^[0-9a-f]{64}$'
      AND state.initial_approval_fingerprint =
        internal.approval_fingerprint
      AND internal.request_fingerprint ~ '^[0-9a-f]{64}$'
      AND publication_internal.sha256_count = 2
    FROM pg_temp.editorial_test_state AS state
    JOIN public.editorial_post_internal AS internal
      ON internal.post_id = state.post_id
    CROSS JOIN LATERAL (
      SELECT count(*)::integer AS sha256_count
      FROM public.editorial_publication_internal AS row_internal
      JOIN public.editorial_publications AS publication
        ON publication.id = row_internal.publication_id
      WHERE publication.post_id = state.post_id
        AND row_internal.request_fingerprint ~ '^[0-9a-f]{64}$'
    ) AS publication_internal
    WHERE state.label = 'client_a'
  ),
  'save creates SHA-256 approval and publication request bindings'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000003'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      UPDATE public.editorial_post_internal
      SET approval_fingerprint = repeat('a', 64)
      WHERE post_id = (
        SELECT post_id
        FROM pg_temp.editorial_test_state
        WHERE label = 'client_a'
      )
    $sql$
  ),
  'authenticated staff cannot overwrite the server approval fingerprint'
);

SELECT ok(
  pg_temp.statement_fails(
    $sql$
      INSERT INTO public.editorial_posts (
        client_id,
        project_id,
        title,
        content_type
      )
      VALUES (
        '91000000-0000-0000-0000-00000000000a',
        '92000000-0000-0000-0000-00000000000a',
        'Direct write must fail',
        'static'
      )
    $sql$
  ),
  'assigned staff cannot INSERT directly into editorial_posts'
);

SELECT ok(
  pg_temp.statement_fails(
    $sql$
      UPDATE public.editorial_posts
      SET title = 'Direct update must fail'
      WHERE client_id = '91000000-0000-0000-0000-00000000000a'
    $sql$
  ),
  'assigned staff cannot UPDATE editorial posts directly'
);

SELECT ok(
  pg_temp.statement_fails(
    $sql$
      DELETE FROM public.editorial_publications
      WHERE client_id = '91000000-0000-0000-0000-00000000000a'
    $sql$
  ),
  'assigned staff cannot DELETE publication plans directly'
);

SELECT ok(
  pg_temp.statement_fails(
    $sql$
      INSERT INTO public.editorial_events (
        client_id,
        post_id,
        actor_id,
        event_type
      )
      SELECT
        '91000000-0000-0000-0000-00000000000a',
        (result->>'post_id')::uuid,
        '91000000-0000-0000-0000-000000000003',
        'forged_event'
      FROM pg_temp.editorial_test_state
      WHERE label = 'client_a'
    $sql$
  ),
  'assigned staff cannot forge history directly'
);

SELECT pg_temp.act_as_service_role();
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      UPDATE public.editorial_publications
      SET
        status = 'published',
        scheduled_at = now(),
        published_at = now(),
        permalink = 'https://example.test/service-role-bypass',
        file_id = '94000000-0000-0000-0000-00000000000a'
      WHERE client_id = '91000000-0000-0000-0000-00000000000a'
    $sql$
  ),
  'service_role cannot bypass approval, CAS and history by direct write'
);

SELECT ok(
  pg_temp.statement_fails(
    $sql$
      UPDATE public.editorial_post_internal
      SET approval_fingerprint = repeat('b', 64)
      WHERE post_id = (
        SELECT post_id
        FROM pg_temp.editorial_test_state
        WHERE label = 'client_a'
      )
    $sql$
  ),
  'service_role cannot alter the server approval fingerprint'
);

SELECT pg_temp.act_as_owner();
SELECT is(
  (
    SELECT internal.approval_fingerprint
    FROM public.editorial_post_internal AS internal
    JOIN pg_temp.editorial_test_state AS state
      ON state.post_id = internal.post_id
    WHERE state.label = 'client_a'
  ),
  (
    SELECT state.initial_approval_fingerprint
    FROM pg_temp.editorial_test_state AS state
    WHERE state.label = 'client_a'
  ),
  'failed direct writes leave the server approval fingerprint unchanged'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000003'
);

-- ---------------------------------------------------------------------------
-- 4. Idempotency, key mismatch and mandatory save CAS.
-- ---------------------------------------------------------------------------
SELECT is(
  (
    SELECT (
      public.save_editorial_post(state.payload, NULL)
      ->>'recovered'
    )::boolean
    FROM pg_temp.editorial_test_state AS state
    WHERE state.label = 'client_a'
  ),
  true,
  'an exact post save retry is recovered idempotently'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_posts
    WHERE client_id = '91000000-0000-0000-0000-00000000000a'
  ),
  1,
  'exact retry does not duplicate the post'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_publications
    WHERE client_id = '91000000-0000-0000-0000-00000000000a'
  ),
  2,
  'exact retry does not duplicate publication plans'
);

SELECT throws_like(
  $sql$
    SELECT public.save_editorial_post(
      jsonb_set(
        state.payload,
        '{title}',
        to_jsonb('Different payload'::text)
      ),
      NULL
    )
    FROM pg_temp.editorial_test_state AS state
    WHERE state.label = 'client_a'
  $sql$,
  '%idempotency key was reused with different data%',
  'a post idempotency key cannot be reused with a different payload'
);

SELECT throws_like(
  $sql$
    SELECT public.save_editorial_post(
      jsonb_set(
        jsonb_set(
          state.payload,
          '{id}',
          to_jsonb(state.result->>'post_id')
        ),
        '{mutation_id}',
        to_jsonb(
          '96200000-0000-0000-0000-000000000002'::text
        )
      ),
      NULL
    )
    FROM pg_temp.editorial_test_state AS state
    WHERE state.label = 'client_a'
  $sql$,
  '%refresh before saving%',
  'updating a post requires an expected version'
);

INSERT INTO pg_temp.editorial_test_state (label, payload)
SELECT
  'publication_key_mismatch',
  jsonb_build_object(
    'client_id', '91000000-0000-0000-0000-00000000000a',
    'project_id', '92000000-0000-0000-0000-00000000000a',
    'primary_file_id', '94000000-0000-0000-0000-00000000000c',
    'idempotency_key', '96000000-0000-0000-0000-000000000009',
    'mutation_id', '96200000-0000-0000-0000-000000000009',
    'title', 'Must roll back',
    'content_type', 'static',
    'production_status', 'ready',
    'publications', jsonb_build_array(
      jsonb_build_object(
        'external_account_id',
        '93000000-0000-0000-0000-000000000001',
        'file_id',
        '94000000-0000-0000-0000-00000000000a',
        'caption',
        'Different publication payload',
        'scheduled_at',
        now() + interval '4 days',
        'scheduled_timezone',
        'America/Sao_Paulo',
        'idempotency_key',
        '96100000-0000-0000-0000-000000000001'
      )
    )
  );

SELECT throws_like(
  $sql$
    SELECT public.save_editorial_post(state.payload, NULL)
    FROM pg_temp.editorial_test_state AS state
    WHERE state.label = 'publication_key_mismatch'
  $sql$,
  '%publication idempotency key was reused with different data%',
  'a publication idempotency key cannot be reused for another payload'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_posts
    WHERE title = 'Must roll back'
  ),
  0,
  'publication key mismatch rolls back the whole post save'
);

-- ---------------------------------------------------------------------------
-- 5. Cross-client isolation and assigned-versus-unassigned staff.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000001'
);

SELECT lives_ok(
  $sql$
    UPDATE pg_temp.editorial_test_state
    SET result = public.save_editorial_post(payload, NULL)
    WHERE label = 'client_b'
  $sql$,
  'admin can create a Client B editorial fixture'
);

SELECT pg_temp.act_as_owner();
UPDATE pg_temp.editorial_test_state AS state
SET
  post_id = (state.result->>'post_id')::uuid,
  manager_publication_id = CASE
    WHEN state.label = 'client_a' THEN (
      SELECT publication.id
      FROM public.editorial_publications AS publication
      WHERE publication.post_id = (state.result->>'post_id')::uuid
        AND publication.external_account_id =
          '93000000-0000-0000-0000-000000000001'
    )
    ELSE NULL
  END,
  admin_publication_id = CASE
    WHEN state.label = 'client_a' THEN (
      SELECT publication.id
      FROM public.editorial_publications AS publication
      WHERE publication.post_id = (state.result->>'post_id')::uuid
        AND publication.external_account_id =
          '93000000-0000-0000-0000-000000000002'
    )
    ELSE NULL
  END,
  client_b_publication_id = CASE
    WHEN state.label = 'client_b' THEN (
      SELECT publication.id
      FROM public.editorial_publications AS publication
      WHERE publication.post_id = (state.result->>'post_id')::uuid
        AND publication.external_account_id =
          '93000000-0000-0000-0000-00000000000b'
    )
    ELSE NULL
  END
WHERE state.label IN ('client_a', 'client_b');

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000003'
);
SELECT lives_ok(
  $sql$
    UPDATE pg_temp.editorial_test_state AS state
    SET result = public.save_editorial_post(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            state.payload,
            '{id}',
            to_jsonb(state.post_id::text)
          ),
          '{default_caption}',
          to_jsonb('Updated editorial caption before approval'::text)
        ),
        '{mutation_id}',
        to_jsonb(
          '96200000-0000-0000-0000-000000000003'::text
        )
      ),
      1
    )
    WHERE state.label = 'client_a'
  $sql$,
  'assigned design can change copy while the primary file is editable'
);

SELECT pg_temp.act_as_owner();
UPDATE pg_temp.editorial_test_state AS state
SET updated_approval_fingerprint = internal.approval_fingerprint
FROM public.editorial_post_internal AS internal
WHERE state.label = 'client_a'
  AND internal.post_id = state.post_id;

SELECT ok(
  (
    SELECT
      state.updated_approval_fingerprint ~ '^[0-9a-f]{64}$'
      AND state.updated_approval_fingerprint <>
        state.initial_approval_fingerprint
      AND state.updated_approval_fingerprint =
        internal.approval_fingerprint
      AND post.default_caption =
        'Updated editorial caption before approval'
      AND post.version = 2
    FROM pg_temp.editorial_test_state AS state
    JOIN public.editorial_posts AS post
      ON post.id = state.post_id
    JOIN public.editorial_post_internal AS internal
      ON internal.post_id = post.id
    WHERE state.label = 'client_a'
  ),
  'copy changes before approval rotate the matching SHA-256 binding'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000001'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.save_editorial_post(
        jsonb_set(
          jsonb_set(
            state.payload,
            '{idempotency_key}',
            to_jsonb(
              '96000000-0000-0000-0000-000000000007'::text
            )
          ),
          '{primary_file_id}',
          to_jsonb(
            '94000000-0000-0000-0000-00000000000b'::text
          )
        ),
        NULL
      )
      FROM pg_temp.editorial_test_state AS state
      WHERE state.label = 'client_a'
    $sql$
  ),
  'even admin cannot attach a cross-client file to a Client A post'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000004'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_posts
    WHERE client_id = '91000000-0000-0000-0000-00000000000a'
  ),
  1,
  'assigned traffic can read Client A editorial posts'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_post_internal
    WHERE client_id = '91000000-0000-0000-0000-00000000000a'
  ),
  1,
  'assigned traffic can read Client A internal editorial context'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-00000000000e'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_posts
    WHERE client_id = '91000000-0000-0000-0000-00000000000a'
  ),
  0,
  'unassigned manager cannot read Client A editorial posts'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_events
    WHERE client_id = '91000000-0000-0000-0000-00000000000a'
  ),
  0,
  'unassigned manager cannot read Client A editorial history'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.save_editorial_post(
        jsonb_set(
          state.payload,
          '{idempotency_key}',
          to_jsonb(
            '96000000-0000-0000-0000-00000000000e'::text
          )
        ),
        NULL
      )
      FROM pg_temp.editorial_test_state AS state
      WHERE state.label = 'client_a'
    $sql$
  ),
  'unassigned manager cannot save for Client A'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000003'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_posts
    WHERE client_id = '91000000-0000-0000-0000-00000000000b'
  ),
  0,
  'Client A design cannot cross-read Client B posts'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.save_editorial_post(
        jsonb_set(
          state.payload,
          '{idempotency_key}',
          to_jsonb(
            '96000000-0000-0000-0000-000000000008'::text
          )
        ),
        NULL
      )
      FROM pg_temp.editorial_test_state AS state
      WHERE state.label = 'client_b'
    $sql$
  ),
  'Client A design cannot create a Client B post'
);

SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.transition_editorial_publication(
        state.client_b_publication_id,
        'cancel',
        1
      )
      FROM pg_temp.editorial_test_state AS state
      WHERE state.label = 'client_b'
    $sql$
  ),
  'Client A design cannot transition a Client B publication'
);

SELECT pg_temp.act_as_owner();
SELECT throws_like(
  $sql$
    INSERT INTO public.editorial_events (
      client_id,
      post_id,
      actor_id,
      event_type
    )
    SELECT
      '91000000-0000-0000-0000-00000000000b',
      state.post_id,
      '91000000-0000-0000-0000-000000000001',
      'cross_client_event'
    FROM pg_temp.editorial_test_state AS state
    WHERE state.label = 'client_a'
  $sql$,
  '%event must match the post client%',
  'trusted writes cannot forge a cross-client history event'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000002'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.transition_editorial_publication(
        state.manager_publication_id,
        'schedule',
        publication.version,
        publication.scheduled_at,
        publication.scheduled_timezone
      )
      FROM pg_temp.editorial_test_state AS state
      JOIN public.editorial_publications AS publication
        ON publication.id = state.manager_publication_id
      WHERE state.label = 'client_a'
    $sql$
  ),
  'assigned manager cannot schedule before the file passes both gates'
);

-- ---------------------------------------------------------------------------
-- 6. Client visibility opens only after the agency and client gates.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-00000000000a'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_posts
  ),
  0,
  'client sees no editorial post before the double gate'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_publications
  ),
  0,
  'client sees no publication plan before the double gate'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_post_internal
  ),
  0,
  'client never sees post internal records'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_events
  ),
  0,
  'client never sees editorial events'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000003'
);
SELECT lives_ok(
  $sql$
    SELECT public.request_file_agency_review(requested.file_id)
    FROM unnest(
      ARRAY[
        '94000000-0000-0000-0000-00000000000a'::uuid,
        '94000000-0000-0000-0000-00000000000d'::uuid
      ]
    ) AS requested(file_id)
  $sql$,
  'assigned design requests review for primary and platform files'
);

SELECT throws_like(
  $sql$
    SELECT public.save_editorial_post(
      jsonb_set(
        jsonb_set(
          state.payload,
          '{idempotency_key}',
          to_jsonb(
            '96000000-0000-0000-0000-00000000000c'::text
          )
        ),
        '{title}',
        to_jsonb('Cannot reuse a file under review'::text)
      ),
      NULL
    )
    FROM pg_temp.editorial_test_state AS state
    WHERE state.label = 'client_a'
  $sql$,
  '%primary file is already under review%',
  'a new post cannot reuse a primary file already under review'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000002'
);
SELECT lives_ok(
  $sql$
    SELECT public.review_file_agency(
      requested.file_id,
      'approved',
      NULL
    )
    FROM unnest(
      ARRAY[
        '94000000-0000-0000-0000-00000000000a'::uuid,
        '94000000-0000-0000-0000-00000000000d'::uuid
      ]
    ) AS requested(file_id)
  $sql$,
  'assigned manager approves primary and platform files at the agency gate'
);
SELECT lives_ok(
  $sql$
    SELECT public.release_file_to_client(
      requested.file_id,
      'approval'
    )
    FROM unnest(
      ARRAY[
        '94000000-0000-0000-0000-00000000000a'::uuid,
        '94000000-0000-0000-0000-00000000000d'::uuid
      ]
    ) AS requested(file_id)
  $sql$,
  'assigned manager releases primary and platform files to the client'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-00000000000a'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_posts
  ),
  0,
  'agency approval alone does not expose the editorial post'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_publications
  ),
  0,
  'pending client approval does not expose publication plans'
);
SELECT lives_ok(
  $sql$
    SELECT public.decide_file_approval(
      requested.file_id,
      1,
      'approved',
      NULL
    )
    FROM unnest(
      ARRAY[
        '94000000-0000-0000-0000-00000000000a'::uuid,
        '94000000-0000-0000-0000-00000000000d'::uuid
      ]
    ) AS requested(file_id)
  $sql$,
  'client approves the exact primary and platform file versions'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_posts
  ),
  1,
  'client sees its post only after both approval gates'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_publications
  ),
  0,
  'client still cannot see internal planned publications'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_post_internal
  ),
  0,
  'double-gate approval does not expose post internals'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_publication_internal
  ),
  0,
  'double-gate approval does not expose publication internals'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_events
  ),
  0,
  'double-gate approval does not expose editorial history'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_posts
    WHERE client_id = '91000000-0000-0000-0000-00000000000b'
  ),
  0,
  'client A cannot cross-read Client B content'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000003'
);
SELECT throws_like(
  $sql$
    SELECT public.save_editorial_post(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            state.payload,
            '{idempotency_key}',
            to_jsonb(
              '96000000-0000-0000-0000-00000000000d'::text
            )
          ),
          '{title}',
          to_jsonb(
            'Cannot reuse an approved file'::text
          )
        ),
        '{publications,1,file_id}',
        to_jsonb(
          '94000000-0000-0000-0000-00000000000a'::text
        )
      ),
      NULL
    )
    FROM pg_temp.editorial_test_state AS state
    WHERE state.label = 'client_a'
  $sql$,
  '%approved editorial media is already linked to another content%',
  'a new post cannot reuse a primary file after final approval'
);

SELECT pg_temp.act_as_owner();
UPDATE public.editorial_post_internal AS internal
SET approval_fingerprint =
  CASE
    WHEN left(state.updated_approval_fingerprint, 1) = '0'
      THEN '1' || substr(state.updated_approval_fingerprint, 2)
    ELSE '0' || substr(state.updated_approval_fingerprint, 2)
  END
FROM pg_temp.editorial_test_state AS state
WHERE state.label = 'client_a'
  AND internal.post_id = state.post_id;

SELECT ok(
  (
    SELECT
      public.editorial_compute_approval_fingerprint(state.post_id) <>
        internal.approval_fingerprint
    FROM pg_temp.editorial_test_state AS state
    JOIN public.editorial_post_internal AS internal
      ON internal.post_id = state.post_id
    WHERE state.label = 'client_a'
  ),
  'the mismatch fixture diverges stored and current approval fingerprints'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-00000000000a'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_posts
  ),
  0,
  'client visibility closes when the approved file hash diverges'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000002'
);
SELECT throws_like(
  $sql$
    SELECT public.transition_editorial_publication(
      state.manager_publication_id,
      'schedule',
      publication.version,
      publication.scheduled_at,
      publication.scheduled_timezone
    )
    FROM pg_temp.editorial_test_state AS state
    JOIN public.editorial_publications AS publication
      ON publication.id = state.manager_publication_id
    WHERE state.label = 'client_a'
  $sql$,
  '%approved immutable files%',
  'scheduling fails while the file and editorial hashes diverge'
);

SELECT throws_like(
  $sql$
    SELECT public.transition_editorial_publication(
      state.admin_publication_id,
      'publish',
      publication.version,
      NULL,
      NULL,
      'https://example.test/editorial/hash-mismatch'
    )
    FROM pg_temp.editorial_test_state AS state
    JOIN public.editorial_publications AS publication
      ON publication.id = state.admin_publication_id
    WHERE state.label = 'client_a'
  $sql$,
  '%approved immutable files%',
  'publishing fails while the file and editorial hashes diverge'
);

SELECT pg_temp.act_as_owner();
UPDATE public.editorial_post_internal AS internal
SET approval_fingerprint = state.updated_approval_fingerprint
FROM pg_temp.editorial_test_state AS state
WHERE state.label = 'client_a'
  AND internal.post_id = state.post_id;

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-00000000000a'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_posts
  ),
  1,
  'restoring the exact approved hash restores client visibility'
);

-- ---------------------------------------------------------------------------
-- 7. Only assigned manager/admin can schedule or publish; CAS is mandatory.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000003'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.transition_editorial_publication(
        state.manager_publication_id,
        'schedule',
        publication.version,
        publication.scheduled_at,
        publication.scheduled_timezone
      )
      FROM pg_temp.editorial_test_state AS state
      JOIN public.editorial_publications AS publication
        ON publication.id = state.manager_publication_id
      WHERE state.label = 'client_a'
    $sql$
  ),
  'assigned design cannot schedule a publication'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000004'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.transition_editorial_publication(
        state.manager_publication_id,
        'publish',
        publication.version,
        NULL,
        NULL,
        'https://example.test/traffic-must-not-publish'
      )
      FROM pg_temp.editorial_test_state AS state
      JOIN public.editorial_publications AS publication
        ON publication.id = state.manager_publication_id
      WHERE state.label = 'client_a'
    $sql$
  ),
  'assigned traffic cannot publish a publication'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000002'
);
SELECT throws_like(
  $sql$
    SELECT public.transition_editorial_publication(
      state.admin_publication_id,
      'schedule',
      NULL,
      publication.scheduled_at,
      publication.scheduled_timezone
    )
    FROM pg_temp.editorial_test_state AS state
    JOIN public.editorial_publications AS publication
      ON publication.id = state.admin_publication_id
    WHERE state.label = 'client_a'
  $sql$,
  '%expected version is required%',
  'publication transitions require an expected version'
);

SELECT lives_ok(
  $sql$
    SELECT public.transition_editorial_publication(
      state.manager_publication_id,
      'schedule',
      publication.version,
      publication.scheduled_at,
      publication.scheduled_timezone
    )
    FROM pg_temp.editorial_test_state AS state
    JOIN public.editorial_publications AS publication
      ON publication.id = state.manager_publication_id
    WHERE state.label = 'client_a'
  $sql$,
  'assigned manager schedules an approved publication'
);

SELECT throws_ok(
  $sql$
    SELECT public.transition_editorial_publication(
      state.manager_publication_id,
      'schedule',
      1,
      now() + interval '5 days',
      'America/Sao_Paulo'
    )
    FROM pg_temp.editorial_test_state AS state
    WHERE state.label = 'client_a'
  $sql$,
  '40001',
  NULL,
  'stale CAS cannot reschedule a changed publication'
);

SELECT ok(
  (
    SELECT
      publication.status = 'scheduled'
      AND internal.scheduled_by =
        '91000000-0000-0000-0000-000000000002'::uuid
    FROM pg_temp.editorial_test_state AS state
    JOIN public.editorial_publications AS publication
      ON publication.id = state.manager_publication_id
    JOIN public.editorial_publication_internal AS internal
      ON internal.publication_id = publication.id
    WHERE state.label = 'client_a'
  ),
  'manager scheduling records the status and actor'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-00000000000a'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_publications
    WHERE status = 'scheduled'
  ),
  1,
  'client sees only the approved scheduled publication'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_publication_internal
  ),
  0,
  'client cannot inspect scheduling actors or technical state'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.transition_editorial_publication(
        state.manager_publication_id,
        'cancel',
        publication.version
      )
      FROM pg_temp.editorial_test_state AS state
      JOIN public.editorial_publications AS publication
        ON publication.id = state.manager_publication_id
      WHERE state.label = 'client_a'
    $sql$
  ),
  'client cannot transition its own publication'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000002'
);
SELECT lives_ok(
  $sql$
    SELECT public.transition_editorial_publication(
      state.manager_publication_id,
      'publish',
      publication.version,
      NULL,
      NULL,
      'https://example.test/editorial/manager-publication',
      'manager-external-id'
    )
    FROM pg_temp.editorial_test_state AS state
    JOIN public.editorial_publications AS publication
      ON publication.id = state.manager_publication_id
    WHERE state.label = 'client_a'
  $sql$,
  'assigned manager confirms a publication as published'
);

SELECT ok(
  (
    SELECT
      publication.status = 'published'
      AND publication.permalink =
        'https://example.test/editorial/manager-publication'
      AND internal.published_by =
        '91000000-0000-0000-0000-000000000002'::uuid
    FROM pg_temp.editorial_test_state AS state
    JOIN public.editorial_publications AS publication
      ON publication.id = state.manager_publication_id
    JOIN public.editorial_publication_internal AS internal
      ON internal.publication_id = publication.id
    WHERE state.label = 'client_a'
  ),
  'manager publishing records the public result and actor'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000001'
);
SELECT lives_ok(
  $sql$
    SELECT public.transition_editorial_publication(
      state.admin_publication_id,
      'schedule',
      publication.version,
      publication.scheduled_at,
      publication.scheduled_timezone
    )
    FROM pg_temp.editorial_test_state AS state
    JOIN public.editorial_publications AS publication
      ON publication.id = state.admin_publication_id
    WHERE state.label = 'client_a'
  $sql$,
  'admin schedules a second approved publication'
);
SELECT lives_ok(
  $sql$
    SELECT public.transition_editorial_publication(
      state.admin_publication_id,
      'publish',
      publication.version,
      NULL,
      NULL,
      'https://example.test/editorial/admin-publication',
      'admin-external-id'
    )
    FROM pg_temp.editorial_test_state AS state
    JOIN public.editorial_publications AS publication
      ON publication.id = state.admin_publication_id
    WHERE state.label = 'client_a'
  $sql$,
  'admin confirms the second publication as published'
);

SELECT ok(
  (
    SELECT
      publication.status = 'published'
      AND internal.scheduled_by =
        '91000000-0000-0000-0000-000000000001'::uuid
      AND internal.published_by =
        '91000000-0000-0000-0000-000000000001'::uuid
    FROM pg_temp.editorial_test_state AS state
    JOIN public.editorial_publications AS publication
      ON publication.id = state.admin_publication_id
    JOIN public.editorial_publication_internal AS internal
      ON internal.publication_id = publication.id
    WHERE state.label = 'client_a'
  ),
  'admin scheduling and publishing record both actors'
);

-- ---------------------------------------------------------------------------
-- 8. Pre-approved media is adopted canonically and scheduled atomically.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as_owner();

UPDATE public.files
SET
  file_name = 'Approved launch asset',
  caption = 'Approved launch caption',
  description = 'Approved launch context',
  file_type = 'binary',
  mime_type = NULL,
  extension = NULL
WHERE id = '94000000-0000-0000-0000-00000000000e';

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
  storage_bucket,
  storage_path,
  parent_file_id,
  mime_type,
  extension
) VALUES
  (
    '94000000-0000-0000-0000-00000000010e',
    '92000000-0000-0000-0000-00000000000a',
    '91000000-0000-0000-0000-00000000000a',
    '91000000-0000-0000-0000-000000000003',
    'Approved launch asset.png (2/6)',
    'files://91000000-0000-0000-0000-00000000000a/94000000-0000-0000-0000-00000000010e/1/approved-launch-card-2',
    'binary',
    'entregas',
    'ready',
    'files',
    '91000000-0000-0000-0000-00000000000a/94000000-0000-0000-0000-00000000010e/1/approved-launch-card-2',
    '94000000-0000-0000-0000-00000000000e',
    NULL,
    NULL
  ),
  (
    '94000000-0000-0000-0000-00000000020e',
    '92000000-0000-0000-0000-00000000000a',
    '91000000-0000-0000-0000-00000000000a',
    '91000000-0000-0000-0000-000000000003',
    'Approved launch asset card 3',
    'files://91000000-0000-0000-0000-00000000000a/94000000-0000-0000-0000-00000000020e/1/approved-launch-card-3.png',
    'binary',
    'entregas',
    'ready',
    'files',
    '91000000-0000-0000-0000-00000000000a/94000000-0000-0000-0000-00000000020e/1/approved-launch-card-3.png',
    '94000000-0000-0000-0000-00000000000e',
    NULL,
    NULL
  );

INSERT INTO storage.objects (bucket_id, name)
VALUES
  (
    'files',
    '91000000-0000-0000-0000-00000000000a/94000000-0000-0000-0000-00000000010e/1/approved-launch-card-2'
  ),
  (
    'files',
    '91000000-0000-0000-0000-00000000000a/94000000-0000-0000-0000-00000000020e/1/approved-launch-card-3.png'
  );

UPDATE public.files
SET
  file_name = 'Approved internal document.pdf',
  file_type = 'application/pdf',
  mime_type = 'application/pdf',
  extension = 'pdf'
WHERE id = '94000000-0000-0000-0000-00000000000f';

INSERT INTO public.tasks (
  id,
  project_id,
  title,
  description,
  status,
  priority,
  assigned_to,
  source
) VALUES (
  '95000000-0000-0000-0000-00000000000e',
  '92000000-0000-0000-0000-00000000000a',
  'Approved media publication',
  'Task context must not replace approved public copy',
  'backlog',
  'medium',
  '91000000-0000-0000-0000-000000000003',
  'portal'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000003'
);
SELECT lives_ok(
  $sql$
    SELECT public.request_file_agency_review(requested.file_id)
    FROM unnest(
      ARRAY[
        '94000000-0000-0000-0000-00000000000e'::uuid,
        '94000000-0000-0000-0000-00000000000f'::uuid
      ]
    ) AS requested(file_id)
  $sql$,
  'assigned design requests review for the approved-media fixtures'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000002'
);
SELECT lives_ok(
  $sql$
    SELECT public.review_file_agency(
      requested.file_id,
      'approved',
      NULL
    )
    FROM unnest(
      ARRAY[
        '94000000-0000-0000-0000-00000000000e'::uuid,
        '94000000-0000-0000-0000-00000000000f'::uuid
      ]
    ) AS requested(file_id)
  $sql$,
  'assigned manager approves the approved-media fixtures internally'
);
SELECT lives_ok(
  $sql$
    SELECT public.release_file_to_client(
      requested.file_id,
      'approval'
    )
    FROM unnest(
      ARRAY[
        '94000000-0000-0000-0000-00000000000e'::uuid,
        '94000000-0000-0000-0000-00000000000f'::uuid
      ]
    ) AS requested(file_id)
  $sql$,
  'assigned manager releases the approved-media fixtures to the client'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-00000000000a'
);
SELECT lives_ok(
  $sql$
    SELECT public.decide_file_approval(
      requested.file_id,
      1,
      'approved',
      NULL
    )
    FROM unnest(
      ARRAY[
        '94000000-0000-0000-0000-00000000000e'::uuid,
        '94000000-0000-0000-0000-00000000000f'::uuid
      ]
    ) AS requested(file_id)
  $sql$,
  'client approves the exact media and document versions'
);

SELECT pg_temp.act_as_owner();
SELECT is(
  (
    SELECT bool_and(
      child.requires_approval
      AND child.approval_status = 'none'
      AND child.agency_approval_status = 'approved'
      AND child.visibility = 'approval'
      AND child.locked_at IS NOT NULL
    )
    FROM public.files AS child
    WHERE child.parent_file_id =
      '94000000-0000-0000-0000-00000000000e'::uuid
  ),
  true,
  'approved carousel children retain the root-owned approval flag and terminal gates'
);
SELECT is(
  public.editorial_file_is_publishable_media(
    '94000000-0000-0000-0000-00000000000e',
    '91000000-0000-0000-0000-00000000000a',
    '92000000-0000-0000-0000-00000000000a'
  ),
  true,
  'approved carousel is publishable with inherited child approval and historical media paths'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000002'
);

INSERT INTO pg_temp.editorial_test_state (label, payload)
VALUES (
  'approved_media',
  jsonb_build_object(
    'client_id', '91000000-0000-0000-0000-00000000000a',
    'project_id', '92000000-0000-0000-0000-00000000000a',
    'primary_file_id', '94000000-0000-0000-0000-00000000000e',
    'task_id', '95000000-0000-0000-0000-00000000000e',
    'responsible_id', '91000000-0000-0000-0000-000000000003',
    'idempotency_key', '96000000-0000-0000-0000-00000000000e',
    'mutation_id', '96200000-0000-0000-0000-00000000000e',
    'title', 'Unapproved replacement title',
    'content_type', 'static',
    'objective', 'Unapproved replacement context',
    'default_caption', ' Unapproved replacement caption ',
    'production_status', 'draft',
    'internal_notes', 'Internal scheduling note',
    'publications', jsonb_build_array()
  )
);

SELECT lives_ok(
  $sql$
    UPDATE pg_temp.editorial_test_state
    SET result = public.save_editorial_post(payload, NULL)
    WHERE label = 'approved_media'
  $sql$,
  'assigned manager adopts an unused double-gate approved media root'
);

SELECT pg_temp.act_as_owner();
UPDATE pg_temp.editorial_test_state AS state
SET post_id = (state.result->>'post_id')::uuid
WHERE state.label = 'approved_media';

SELECT ok(
  (
    SELECT
      post.primary_file_id =
        '94000000-0000-0000-0000-00000000000e'::uuid
      AND post.title = 'Approved launch asset'
      AND post.objective = 'Approved launch context'
      AND post.default_caption = 'Approved launch caption'
      AND post.content_type = 'carousel'
      AND post.production_status = 'ready'
      AND internal.internal_notes = 'Internal scheduling note'
      AND internal.approval_fingerprint =
        public.editorial_compute_approval_fingerprint(post.id)
    FROM pg_temp.editorial_test_state AS state
    JOIN public.editorial_posts AS post ON post.id = state.post_id
    JOIN public.editorial_post_internal AS internal
      ON internal.post_id = post.id
    WHERE state.label = 'approved_media'
  ),
  'approved media canonicalizes theme, context and caption but keeps internal notes'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_publications AS publication
    JOIN pg_temp.editorial_test_state AS state
      ON state.post_id = publication.post_id
    WHERE state.label = 'approved_media'
  ),
  0,
  'approved media may stay accountless without inventing a publication'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000002'
);
SELECT is(
  (
    SELECT (
      public.save_editorial_post(state.payload, NULL)
      ->>'recovered'
    )::boolean
    FROM pg_temp.editorial_test_state AS state
    WHERE state.label = 'approved_media'
  ),
  true,
  'exact approved-media creation retry is recovered idempotently'
);

SELECT throws_like(
  $sql$
    SELECT public.save_editorial_post(
      jsonb_build_object(
        'client_id', '91000000-0000-0000-0000-00000000000a',
        'project_id', '92000000-0000-0000-0000-00000000000a',
        'primary_file_id', '94000000-0000-0000-0000-00000000000e',
        'idempotency_key', '96000000-0000-0000-0000-0000000000e2',
        'mutation_id', '96200000-0000-0000-0000-0000000000e2',
        'title', 'Second use must fail',
        'content_type', 'static',
        'production_status', 'ready',
        'publications', jsonb_build_array()
      ),
      NULL
    )
  $sql$,
  '%already linked to another content%',
  'an approved media root cannot be linked to a second content'
);

SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.save_editorial_post(
        jsonb_build_object(
          'client_id', '91000000-0000-0000-0000-00000000000a',
          'project_id', '92000000-0000-0000-0000-00000000000a',
          'primary_file_id', '94000000-0000-0000-0000-00000000000f',
          'idempotency_key', '96000000-0000-0000-0000-00000000000f',
          'mutation_id', '96200000-0000-0000-0000-00000000000f',
          'title', 'PDF must not become social media',
          'content_type', 'static',
          'production_status', 'ready',
          'publications', jsonb_build_array()
        ),
        NULL
      )
    $sql$
  ),
  'an approved PDF is not accepted as publishable editorial media'
);

SELECT pg_temp.act_as_owner();
UPDATE pg_temp.editorial_test_state AS state
SET
  payload = jsonb_build_object(
    'id', state.post_id,
    'client_id', '91000000-0000-0000-0000-00000000000a',
    'project_id', '92000000-0000-0000-0000-00000000000a',
    'primary_file_id', '94000000-0000-0000-0000-00000000000e',
    'task_id', '95000000-0000-0000-0000-00000000000e',
    'responsible_id', '91000000-0000-0000-0000-000000000003',
    'idempotency_key', '96000000-0000-0000-0000-00000000000e',
    'mutation_id', '96200000-0000-0000-0000-0000000000e3',
    'title', 'Tampered title on reopen',
    'content_type', 'static',
    'objective', 'Tampered context on reopen',
    'default_caption', '  Tampered caption on reopen  ',
    'production_status', 'draft',
    'internal_notes', 'Updated internal scheduling note',
    'publications', jsonb_build_array(
      jsonb_build_object(
        'external_account_id',
          '93000000-0000-0000-0000-000000000001',
        'file_id', '94000000-0000-0000-0000-00000000000e',
        'caption', '  Tampered platform caption  ',
        'first_comment', 'Unapproved first comment',
        'alt_text', 'Unapproved alt text',
        'scheduled_at', now() + interval '6 days',
        'scheduled_timezone', 'America/Sao_Paulo',
        'idempotency_key',
          '96100000-0000-0000-0000-00000000000e'
      )
    )
  )
WHERE state.label = 'approved_media';

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000002'
);
SELECT lives_ok(
  $sql$
    UPDATE pg_temp.editorial_test_state AS state
    SET result = public.save_editorial_post(
      state.payload,
      (
        SELECT post.version
        FROM public.editorial_posts AS post
        WHERE post.id = state.post_id
      )
    )
    WHERE state.label = 'approved_media'
  $sql$,
  'account, date and timezone are saved and scheduled in one transaction'
);

SELECT ok(
  (
    SELECT
      post.title = 'Approved launch asset.png'
      AND post.objective = 'Approved launch context'
      AND post.default_caption = 'Approved launch caption'
      AND publication.file_id =
        '94000000-0000-0000-0000-00000000000e'::uuid
      AND publication.caption = 'Approved launch caption'
      AND publication.first_comment IS NULL
      AND publication.alt_text IS NULL
      AND publication.status = 'scheduled'
      AND publication.scheduled_at IS NOT NULL
      AND publication.scheduled_timezone = 'America/Sao_Paulo'
      AND internal.included_in_approval_snapshot
    FROM pg_temp.editorial_test_state AS state
    JOIN public.editorial_posts AS post ON post.id = state.post_id
    JOIN public.editorial_publications AS publication
      ON publication.post_id = post.id
    JOIN public.editorial_publication_internal AS internal
      ON internal.publication_id = publication.id
    WHERE state.label = 'approved_media'
  ),
  'atomic scheduling preserves only the canonical approved public payload'
);

SELECT pg_temp.act_as_owner();
UPDATE pg_temp.editorial_test_state AS state
SET payload = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        state.payload,
        '{mutation_id}',
        to_jsonb(
          '96200000-0000-0000-0000-0000000000e4'::text
        )
      ),
      '{publications,0,id}',
      to_jsonb(publication.id::text)
    ),
    '{publications,0,scheduled_at}',
    to_jsonb((now() + interval '8 days')::text)
  ),
  '{publications,0,scheduled_timezone}',
  to_jsonb('UTC'::text)
)
FROM public.editorial_publications AS publication
WHERE state.label = 'approved_media'
  AND publication.post_id = state.post_id;

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000002'
);
SELECT lives_ok(
  $sql$
    UPDATE pg_temp.editorial_test_state AS state
    SET result = public.save_editorial_post(
      state.payload,
      (
        SELECT post.version
        FROM public.editorial_posts AS post
        WHERE post.id = state.post_id
      )
    )
    WHERE state.label = 'approved_media'
  $sql$,
  'approved scheduled media can change account envelope date and timezone atomically'
);

SELECT ok(
  (
    SELECT
      publication.status = 'scheduled'
      AND publication.scheduled_at > now() + interval '7 days'
      AND publication.scheduled_timezone = 'UTC'
      AND publication.caption = 'Approved launch caption'
      AND publication.first_comment IS NULL
      AND publication.alt_text IS NULL
    FROM pg_temp.editorial_test_state AS state
    JOIN public.editorial_publications AS publication
      ON publication.post_id = state.post_id
    WHERE state.label = 'approved_media'
  ),
  'replanning keeps approved copy canonical while applying the editable schedule envelope'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.task_comments
    WHERE task_id = '95000000-0000-0000-0000-00000000000e'
  ),
  0,
  'scheduling alone does not create a false publication receipt'
);
SELECT pg_temp.act_as_owner();
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.notifications
    WHERE notification_type = 'publication'
      AND link =
        '/kanban?task=95000000-0000-0000-0000-00000000000e'
  ),
  0,
  'scheduling alone sends no published notification'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000002'
);
SELECT throws_like(
  $sql$
    SELECT public.transition_editorial_publication(
      publication.id,
      'publish',
      publication.version
    )
    FROM pg_temp.editorial_test_state AS state
    JOIN public.editorial_publications AS publication
      ON publication.post_id = state.post_id
    WHERE state.label = 'approved_media'
  $sql$,
  '%valid public URL%',
  'published state still requires a confirmed public permalink'
);

SELECT is(
  (
    SELECT publication.status
    FROM pg_temp.editorial_test_state AS state
    JOIN public.editorial_publications AS publication
      ON publication.post_id = state.post_id
    WHERE state.label = 'approved_media'
  ),
  'scheduled',
  'failed confirmation leaves the approved publication scheduled'
);

SELECT lives_ok(
  $sql$
    UPDATE pg_temp.editorial_test_state AS state
    SET transition_result = public.transition_editorial_publication(
      publication.id,
      'publish',
      publication.version,
      NULL,
      NULL,
      'https://example.test/editorial/approved-media',
      'approved-media-external-id'
    )
    FROM public.editorial_publications AS publication
    WHERE state.label = 'approved_media'
      AND publication.post_id = state.post_id
  $sql$,
  'manager confirms the real public result with its permalink'
);

SELECT ok(
  (
    SELECT
      comment.author_id =
        '91000000-0000-0000-0000-000000000002'::uuid
      AND comment.content =
        'Publicado em instagram: https://example.test/editorial/approved-media'
    FROM public.task_comments AS comment
    WHERE comment.task_id =
      '95000000-0000-0000-0000-00000000000e'
  ),
  'published transition writes one permalink receipt to task notes'
);

SELECT pg_temp.act_as_owner();
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.notifications
    WHERE notification_type = 'publication'
      AND link =
        '/kanban?task=95000000-0000-0000-0000-00000000000e'
  ),
  4,
  'published transition notifies only the assigned Client A staff and admins'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.notifications
    WHERE notification_type = 'publication'
      AND link =
        '/kanban?task=95000000-0000-0000-0000-00000000000e'
      AND user_id IN (
        '91000000-0000-0000-0000-00000000000a'::uuid,
        '91000000-0000-0000-0000-00000000000b'::uuid,
        '91000000-0000-0000-0000-00000000000e'::uuid
      )
  ),
  0,
  'published notification never crosses into clients or unassigned staff'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000002'
);
SELECT is(
  (
    SELECT (
      public.transition_editorial_publication(
        publication.id,
        'publish',
        1,
        NULL,
        NULL,
        publication.permalink,
        publication.external_post_id
      )->>'recovered'
    )::boolean
    FROM pg_temp.editorial_test_state AS state
    JOIN public.editorial_publications AS publication
      ON publication.post_id = state.post_id
    WHERE state.label = 'approved_media'
  ),
  true,
  'exact published retry is recovered idempotently'
);

SELECT pg_temp.act_as_owner();
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.task_comments
    WHERE task_id = '95000000-0000-0000-0000-00000000000e'
  ),
  1,
  'published retry does not duplicate the permalink comment'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.notifications
    WHERE notification_type = 'publication'
      AND link =
        '/kanban?task=95000000-0000-0000-0000-00000000000e'
  ),
  4,
  'published retry does not duplicate notifications'
);

-- ---------------------------------------------------------------------------
-- 9. History is staff-only, correctly scoped and immutable for every role.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-00000000000a'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_publications
    WHERE status = 'published'
  ),
  3,
  'client sees all three published records after the double gate'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_events
  ),
  0,
  'published client content still exposes no internal history'
);

SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000004'
);
SELECT cmp_ok(
  (
    SELECT count(*)::integer
    FROM public.editorial_events
    WHERE client_id = '91000000-0000-0000-0000-00000000000a'
  ),
  '>',
  0,
  'assigned traffic can audit Client A editorial history'
);

SELECT pg_temp.act_as_owner();
UPDATE pg_temp.editorial_test_state
SET event_count = (
  SELECT count(*)::integer
  FROM public.editorial_events
)
WHERE label = 'client_a';

SELECT throws_like(
  $sql$
    UPDATE public.editorial_events
    SET event_type = 'rewritten_event'
  $sql$,
  '%editorial history is append-only%',
  'even the owner cannot UPDATE editorial history'
);

SELECT throws_like(
  $sql$
    DELETE FROM public.editorial_events
  $sql$,
  '%editorial history is append-only%',
  'even the owner cannot DELETE editorial history'
);

SELECT throws_like(
  $sql$
    TRUNCATE TABLE public.editorial_events
  $sql$,
  '%editorial history is append-only%',
  'even the owner cannot TRUNCATE editorial history'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.editorial_events
  ),
  (
    SELECT event_count
    FROM pg_temp.editorial_test_state
    WHERE label = 'client_a'
  ),
  'all history rows remain intact after mutation attempts'
);

-- Archive is also a critical mutation and must not accept a missing CAS token.
SELECT pg_temp.act_as(
  '91000000-0000-0000-0000-000000000001'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.archive_editorial_post(
        state.post_id,
        NULL
      )
      FROM pg_temp.editorial_test_state AS state
      WHERE state.label = 'client_b'
    $sql$
  ),
  'archiving a post requires an expected version'
);

SELECT * FROM finish();

ROLLBACK;
