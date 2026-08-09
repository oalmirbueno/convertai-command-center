-- ============================================================================
-- Aceleriq OS - secure file approval and Storage RLS contract
-- Runs entirely inside BEGIN/ROLLBACK and never persists fixture data.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT * FROM no_plan();

-- The legacy profile webhook trigger must not make outbound requests while
-- auth.users fixtures create their profiles. The transaction restores it.
ALTER TABLE public.profiles DISABLE TRIGGER USER;
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

CREATE OR REPLACE FUNCTION pg_temp.act_as_service_role() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  EXECUTE 'SET LOCAL ROLE service_role';
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.statement_fails(_sql text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE _sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.statement_row_count(_sql text)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  _rows integer;
BEGIN
  EXECUTE _sql;
  GET DIAGNOSTICS _rows = ROW_COUNT;
  RETURN _rows;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.statement_blocked(_sql text)
RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  _rows integer;
BEGIN
  EXECUTE _sql;
  GET DIAGNOSTICS _rows = ROW_COUNT;
  RETURN _rows = 0;
EXCEPTION WHEN OTHERS THEN
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.public_has_execute(_fn regprocedure)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pg_proc AS p
    CROSS JOIN LATERAL aclexplode(
      COALESCE(p.proacl, acldefault('f', p.proowner))
    ) AS acl
    WHERE p.oid = _fn::oid
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  )
$$;

-- ---------------------------------------------------------------------------
-- Structural security contract
-- ---------------------------------------------------------------------------
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.files'::regclass),
  'files has RLS enabled'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'storage.objects'::regclass),
  'storage.objects has RLS enabled'
);

SELECT is(
  (SELECT public FROM storage.buckets WHERE id = 'files'),
  false,
  'files bucket is private'
);
SELECT is(
  (SELECT public FROM storage.buckets WHERE id = 'mcp-files'),
  false,
  'mcp-files bucket exists and is private'
);

SELECT ok(
  to_regprocedure('public.request_file_agency_review(uuid)') IS NOT NULL,
  'request_file_agency_review(uuid) exists'
);
SELECT ok(
  to_regprocedure('public.review_file_agency(uuid,text,text)') IS NOT NULL,
  'review_file_agency(uuid,text,text) exists'
);
SELECT ok(
  to_regprocedure('public.release_file_to_client(uuid,text)') IS NOT NULL,
  'release_file_to_client(uuid,text) exists'
);
SELECT ok(
  to_regprocedure('public.decide_file_approval(uuid,integer,text,text)') IS NOT NULL,
  'decide_file_approval(uuid,integer,text,text) exists'
);
SELECT ok(
  to_regprocedure(
    'public.complete_contract_signature(text,text,text)'
  ) IS NOT NULL,
  'complete_contract_signature(text,text,text) exists'
);

SELECT ok(
  (SELECT prosecdef FROM pg_proc
    WHERE oid = 'public.request_file_agency_review(uuid)'::regprocedure),
  'request_file_agency_review is SECURITY DEFINER'
);
SELECT ok(
  (SELECT prosecdef FROM pg_proc
    WHERE oid = 'public.review_file_agency(uuid,text,text)'::regprocedure),
  'review_file_agency is SECURITY DEFINER'
);
SELECT ok(
  (SELECT prosecdef FROM pg_proc
    WHERE oid = 'public.release_file_to_client(uuid,text)'::regprocedure),
  'release_file_to_client is SECURITY DEFINER'
);
SELECT ok(
  (SELECT prosecdef FROM pg_proc
    WHERE oid = 'public.decide_file_approval(uuid,integer,text,text)'::regprocedure),
  'decide_file_approval is SECURITY DEFINER'
);

SELECT is(
  pg_temp.public_has_execute(
    'public.request_file_agency_review(uuid)'::regprocedure
  ),
  false,
  'PUBLIC cannot request agency review'
);
SELECT is(
  pg_temp.public_has_execute(
    'public.review_file_agency(uuid,text,text)'::regprocedure
  ),
  false,
  'PUBLIC cannot decide agency review'
);
SELECT is(
  pg_temp.public_has_execute(
    'public.release_file_to_client(uuid,text)'::regprocedure
  ),
  false,
  'PUBLIC cannot release a file'
);
SELECT is(
  pg_temp.public_has_execute(
    'public.decide_file_approval(uuid,integer,text,text)'::regprocedure
  ),
  false,
  'PUBLIC cannot decide client approval'
);

SELECT is(
  has_function_privilege(
    'anon',
    'public.request_file_agency_review(uuid)',
    'EXECUTE'
  ),
  false,
  'anon cannot request agency review'
);
SELECT is(
  has_function_privilege(
    'anon',
    'public.review_file_agency(uuid,text,text)',
    'EXECUTE'
  ),
  false,
  'anon cannot decide agency review'
);
SELECT is(
  has_function_privilege(
    'anon',
    'public.release_file_to_client(uuid,text)',
    'EXECUTE'
  ),
  false,
  'anon cannot release a file'
);
SELECT is(
  has_function_privilege(
    'anon',
    'public.decide_file_approval(uuid,integer,text,text)',
    'EXECUTE'
  ),
  false,
  'anon cannot decide client approval'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.request_file_agency_review(uuid)',
    'EXECUTE'
  ),
  'authenticated can invoke request_file_agency_review'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.review_file_agency(uuid,text,text)',
    'EXECUTE'
  ),
  'authenticated can invoke review_file_agency'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.release_file_to_client(uuid,text)',
    'EXECUTE'
  ),
  'authenticated can invoke release_file_to_client'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.decide_file_approval(uuid,integer,text,text)',
    'EXECUTE'
  ),
  'authenticated can invoke decide_file_approval'
);
SELECT is(
  has_function_privilege(
    'authenticated',
    'public.complete_contract_signature(text,text,text)',
    'EXECUTE'
  ),
  false,
  'authenticated cannot invoke trusted contract completion'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.complete_contract_signature(text,text,text)',
    'EXECUTE'
  ),
  'service_role can invoke trusted contract completion'
);

SELECT is(
  has_column_privilege(
    'authenticated',
    'public.files',
    'agency_approval_status',
    'SELECT'
  ),
  false,
  'authenticated cannot read the internal agency gate column directly'
);
SELECT is(
  has_column_privilege(
    'authenticated',
    'public.files',
    'extraction_error',
    'SELECT'
  ),
  false,
  'authenticated cannot read extraction failures directly'
);
SELECT is(
  has_column_privilege(
    'authenticated',
    'public.files',
    'source',
    'SELECT'
  ),
  false,
  'authenticated cannot read the internal file source directly'
);
SELECT is(
  has_column_privilege(
    'authenticated',
    'public.reports',
    'internal_notes',
    'SELECT'
  ),
  false,
  'authenticated cannot read internal report notes'
);
SELECT is(
  has_column_privilege(
    'authenticated',
    'public.client_requests',
    'ai_draft',
    'SELECT'
  ),
  false,
  'authenticated cannot read internal request drafts'
);
SELECT is(
  has_table_privilege(
    'service_role',
    'public.file_approval_events',
    'TRUNCATE'
  ),
  false,
  'service_role cannot truncate the approval audit log'
);
SELECT ok(
  to_regclass('public.staff_files_secure') IS NOT NULL,
  'assigned staff file view exists'
);

-- ---------------------------------------------------------------------------
-- Privileged boundary behind the staff-only file view
-- ---------------------------------------------------------------------------
SELECT ok(
  EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'app_private'),
  'the private boundary schema exists'
);
SELECT is(
  has_schema_privilege('anon', 'app_private', 'USAGE'),
  false,
  'anon has no USAGE on the private boundary schema'
);
SELECT is(
  has_schema_privilege('authenticated', 'app_private', 'USAGE'),
  false,
  'authenticated has no USAGE on the private boundary schema'
);
SELECT is(
  has_schema_privilege('service_role', 'app_private', 'USAGE'),
  false,
  'service_role has no USAGE on the private boundary schema'
);
SELECT ok(
  (
    SELECT nspacl::text
    FROM pg_namespace
    WHERE nspname = 'app_private'
  ) NOT LIKE '%=%/%,%',
  'the private boundary schema grants nothing beyond its owner'
);
SELECT ok(
  to_regprocedure('app_private.staff_files_secure_rows()') IS NOT NULL,
  'the privileged staff file row source exists'
);
SELECT is(
  (
    SELECT proretset
    FROM pg_proc
    WHERE oid = to_regprocedure('app_private.staff_files_secure_rows()')
  ),
  true,
  'the privileged row source returns a set'
);
SELECT is(
  (
    SELECT prorettype
    FROM pg_proc
    WHERE oid = to_regprocedure('app_private.staff_files_secure_rows()')
  ),
  'public.files'::regtype::oid,
  'the privileged row source returns public.files rows'
);
SELECT is(
  (
    SELECT prosecdef
    FROM pg_proc
    WHERE oid = to_regprocedure('app_private.staff_files_secure_rows()')
  ),
  true,
  'the privileged row source is SECURITY DEFINER'
);
SELECT is(
  (
    SELECT provolatile::text
    FROM pg_proc
    WHERE oid = to_regprocedure('app_private.staff_files_secure_rows()')
  ),
  's',
  'the privileged row source is STABLE'
);
SELECT is(
  (
    SELECT pg_get_userbyid(proowner)
    FROM pg_proc
    WHERE oid = to_regprocedure('app_private.staff_files_secure_rows()')
  ),
  'postgres',
  'the privileged row source is owned by postgres'
);
SELECT is(
  (
    SELECT proconfig
    FROM pg_proc
    WHERE oid = to_regprocedure('app_private.staff_files_secure_rows()')
  ),
  ARRAY['search_path=""'],
  'the privileged row source pins an empty search_path'
);
SELECT is(
  (
    SELECT pronargs
    FROM pg_proc
    WHERE oid = to_regprocedure('app_private.staff_files_secure_rows()')
  ),
  0::smallint,
  'the privileged row source accepts no caller-supplied identity'
);
SELECT is(
  has_function_privilege('anon', 'app_private.staff_files_secure_rows()', 'EXECUTE'),
  false,
  'anon cannot execute the privileged row source'
);
SELECT is(
  has_function_privilege('authenticated', 'app_private.staff_files_secure_rows()', 'EXECUTE'),
  true,
  'authenticated can execute the privileged row source'
);
SELECT is(
  has_function_privilege('service_role', 'app_private.staff_files_secure_rows()', 'EXECUTE'),
  true,
  'service_role can execute the privileged row source'
);
SELECT ok(
  (
    SELECT proacl::text
    FROM pg_proc
    WHERE oid = to_regprocedure('app_private.staff_files_secure_rows()')
  ) NOT LIKE '%=X%*%',
  'the privileged row source grants no grant option'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS proc,
      LATERAL aclexplode(proc.proacl) AS acl
    WHERE proc.oid = to_regprocedure('app_private.staff_files_secure_rows()')
      AND acl.grantee = 0
  ),
  'the privileged row source grants nothing to PUBLIC'
);
SELECT ok(
  (
    SELECT reloptions
    FROM pg_class
    WHERE oid = 'public.staff_files_secure'::regclass
  ) @> ARRAY['security_barrier=true', 'security_invoker=true'],
  'the staff-only file view stays a security barrier and invoker view'
);
SELECT ok(
  pg_get_viewdef('public.staff_files_secure'::regclass, true)
    LIKE '%app_private.staff_files_secure_rows()%',
  'the staff-only file view reads through the privileged row source'
);
SELECT ok(
  pg_get_viewdef('public.staff_files_secure'::regclass, true) LIKE '%is_staff(auth.uid())%',
  'the staff-only file view keeps its staff filter as defence in depth'
);
SELECT ok(
  pg_get_viewdef('public.staff_files_secure'::regclass, true)
    LIKE '%can_access_client(file_row.client_id)%',
  'the staff-only file view keeps its client-scope filter as defence in depth'
);
SELECT is(
  has_table_privilege('authenticated', 'public.staff_files_secure', 'SELECT'),
  true,
  'authenticated can select the staff-only file view'
);
SELECT is(
  has_table_privilege('anon', 'public.staff_files_secure', 'SELECT'),
  false,
  'anon cannot select the staff-only file view'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_class AS view_class,
      LATERAL aclexplode(view_class.relacl) AS acl
    WHERE view_class.oid = 'public.staff_files_secure'::regclass
      AND acl.grantee = 0
  ),
  'the staff-only file view grants nothing to PUBLIC'
);
SELECT is(
  has_table_privilege('authenticated', 'public.files', 'SELECT'),
  false,
  'authenticated keeps no table-level SELECT on public.files'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM unnest(ARRAY[
      'sha256',
      'tags',
      'sensitivity',
      'extraction_status',
      'extraction_error',
      'extracted_metadata',
      'source',
      'idempotency_key',
      'agency_approval_status',
      'agency_feedback',
      'agency_reviewed_by',
      'agency_reviewed_at'
    ]) AS technical_column
    WHERE has_column_privilege(
      'authenticated',
      'public.files',
      technical_column,
      'SELECT'
    )
  ),
  0,
  'authenticated keeps no SELECT on the 12 technical file columns'
);
-- The staff view joins client identity from public.profiles. Only the three
-- columns it reads are granted, and only to authenticated/service_role.
SELECT is(
  (
    SELECT count(*)::integer
    FROM unnest(ARRAY['id', 'full_name', 'company_name']) AS profile_column
    WHERE has_column_privilege(
      'authenticated',
      'public.profiles',
      profile_column,
      'SELECT'
    )
  ),
  3,
  'authenticated can read the three profile columns used by the staff view'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM unnest(ARRAY['id', 'full_name', 'company_name']) AS profile_column
    WHERE has_column_privilege(
      'service_role',
      'public.profiles',
      profile_column,
      'SELECT'
    )
  ),
  3,
  'service_role can read the three profile columns used by the staff view'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM unnest(ARRAY['id', 'full_name', 'company_name']) AS profile_column
    WHERE has_column_privilege(
      'anon',
      'public.profiles',
      profile_column,
      'SELECT'
    )
  ),
  0,
  'anon gains no profile column privileges from the staff view grant'
);
SELECT is(
  has_table_privilege('anon', 'public.profiles', 'SELECT'),
  false,
  'anon keeps no table-level read on profiles'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_class AS cls
    CROSS JOIN LATERAL aclexplode(COALESCE(cls.relacl, ARRAY[]::aclitem[])) AS acl
    WHERE cls.oid = 'public.profiles'::regclass
      AND acl.privilege_type = 'SELECT'
      AND pg_get_userbyid(acl.grantee) IN ('authenticated', 'anon')
  ),
  0,
  'the profiles grant stays column-scoped without table-level SELECT'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'files'
      AND indexname = 'files_unique_storage_object_idx'
  ),
  'one physical Storage object can back only one file version'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'files'
      AND column_name = 'agency_approval_status'
  ),
  'files records the agency gate'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'files'
      AND column_name = 'agency_feedback'
  ),
  'files keeps agency feedback separate from client feedback'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'files'
      AND column_name = 'revision_of_file_id'
  ),
  'files has a dedicated revision link'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    JOIN pg_attribute AS a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.files'::regclass
      AND c.confrelid = 'public.files'::regclass
      AND c.contype = 'f'
      AND a.attname = 'revision_of_file_id'
  ),
  'revision_of_file_id references files'
);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- Actors:
--   admin              a0000000-0000-0000-0000-000000000001
--   manager assigned   a0000000-0000-0000-0000-000000000002
--   design assigned    a0000000-0000-0000-0000-000000000003
--   traffic assigned   a0000000-0000-0000-0000-000000000004
--   client A           a0000000-0000-0000-0000-00000000000a
--   client B           a0000000-0000-0000-0000-00000000000b
--   manager unassigned a0000000-0000-0000-0000-00000000000e

INSERT INTO auth.users (id, email)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'file-admin@test.local'),
  ('a0000000-0000-0000-0000-000000000002', 'file-manager-a@test.local'),
  ('a0000000-0000-0000-0000-000000000003', 'file-design-a@test.local'),
  ('a0000000-0000-0000-0000-000000000004', 'file-traffic-a@test.local'),
  ('a0000000-0000-0000-0000-00000000000a', 'file-client-a@test.local'),
  ('a0000000-0000-0000-0000-00000000000b', 'file-client-b@test.local'),
  ('a0000000-0000-0000-0000-00000000000e', 'file-manager-u@test.local');

DELETE FROM public.user_roles
WHERE user_id IN (
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000003',
  'a0000000-0000-0000-0000-000000000004',
  'a0000000-0000-0000-0000-00000000000e'
);

INSERT INTO public.user_roles (user_id, role)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'manager'),
  ('a0000000-0000-0000-0000-000000000003', 'design'),
  ('a0000000-0000-0000-0000-000000000004', 'traffic'),
  ('a0000000-0000-0000-0000-00000000000e', 'manager');

INSERT INTO public.team_client_assignments (user_id, client_id)
VALUES
  (
    'a0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-00000000000a'
  ),
  (
    'a0000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-00000000000a'
  ),
  (
    'a0000000-0000-0000-0000-000000000004',
    'a0000000-0000-0000-0000-00000000000a'
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
    'b0000000-0000-0000-0000-00000000000a',
    'a0000000-0000-0000-0000-00000000000a',
    'Secure approval A',
    'recurring',
    'active',
    0,
    current_date,
    current_date + 30,
    'included'
  ),
  (
    'b0000000-0000-0000-0000-00000000000b',
    'a0000000-0000-0000-0000-00000000000b',
    'Secure approval B',
    'recurring',
    'active',
    0,
    current_date,
    current_date + 30,
    'included'
  );

SELECT set_config(
  'request.jwt.claim.sub',
  'a0000000-0000-0000-0000-000000000001',
  true
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
  approval_status,
  agency_approval_status,
  version,
  visibility,
  requires_approval,
  status,
  storage_bucket,
  storage_path
)
VALUES
  (
    'f0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-00000000000a',
    'a0000000-0000-0000-0000-00000000000a',
    'a0000000-0000-0000-0000-000000000001',
    'approval-a.pdf',
    'storage://approval-a.pdf',
    'application/pdf',
    'entregas',
    'none',
    'not_requested',
    1,
    'internal',
    false,
    'ready',
    'files',
    'a0000000-0000-0000-0000-00000000000a/f0000000-0000-0000-0000-000000000001/1/approval-a.pdf'
  ),
  (
    'f0000000-0000-0000-0000-000000000002',
    'b0000000-0000-0000-0000-00000000000a',
    'a0000000-0000-0000-0000-00000000000a',
    'a0000000-0000-0000-0000-000000000001',
    'internal-a.pdf',
    'storage://internal-a.pdf',
    'application/pdf',
    'entregas',
    'none',
    'not_requested',
    1,
    'internal',
    false,
    'ready',
    'mcp-files',
    'a0000000-0000-0000-0000-00000000000a/f0000000-0000-0000-0000-000000000002/1/internal-a.pdf'
  ),
  (
    'f0000000-0000-0000-0000-00000000000b',
    'b0000000-0000-0000-0000-00000000000b',
    'a0000000-0000-0000-0000-00000000000b',
    'a0000000-0000-0000-0000-000000000001',
    'shared-b.pdf',
    'storage://shared-b.pdf',
    'application/pdf',
    'entregas',
    'none',
    'not_requested',
    1,
    'internal',
    false,
    'ready',
    'files',
    'a0000000-0000-0000-0000-00000000000b/f0000000-0000-0000-0000-00000000000b/1/shared-b.pdf'
  );

INSERT INTO storage.objects (bucket_id, name)
VALUES
  (
    'files',
    'a0000000-0000-0000-0000-00000000000a/f0000000-0000-0000-0000-000000000001/1/approval-a.pdf'
  ),
  (
    'mcp-files',
    'a0000000-0000-0000-0000-00000000000a/f0000000-0000-0000-0000-000000000002/1/internal-a.pdf'
  ),
  (
    'files',
    'a0000000-0000-0000-0000-00000000000b/f0000000-0000-0000-0000-00000000000b/1/shared-b.pdf'
  );

INSERT INTO storage.buckets (id, name, public)
VALUES ('workspace', 'workspace', false)
ON CONFLICT (id) DO UPDATE SET public = false;

INSERT INTO public.workspace_nodes (
  id,
  scope,
  client_id,
  kind,
  name,
  storage_path,
  created_by
)
VALUES
  (
    'e6000000-0000-0000-0000-00000000000a',
    'client',
    'a0000000-0000-0000-0000-00000000000a',
    'file',
    'workspace-a.txt',
    'client/a0000000-0000-0000-0000-00000000000a/workspace-a.txt',
    'a0000000-0000-0000-0000-000000000001'
  ),
  (
    'e6000000-0000-0000-0000-00000000000b',
    'client',
    'a0000000-0000-0000-0000-00000000000b',
    'file',
    'workspace-b.txt',
    'client/a0000000-0000-0000-0000-00000000000b/workspace-b.txt',
    'a0000000-0000-0000-0000-000000000001'
  );

INSERT INTO storage.objects (bucket_id, name)
VALUES
  (
    'workspace',
    'client/a0000000-0000-0000-0000-00000000000a/workspace-a.txt'
  ),
  (
    'workspace',
    'client/a0000000-0000-0000-0000-00000000000b/workspace-b.txt'
  );

INSERT INTO public.tasks (
  id,
  project_id,
  title,
  status,
  priority,
  source
)
VALUES
  (
    'e0000000-0000-0000-0000-00000000000a',
    'b0000000-0000-0000-0000-00000000000a',
    'Internal task A',
    'backlog',
    'medium',
    'portal'
  ),
  (
    'e0000000-0000-0000-0000-00000000000b',
    'b0000000-0000-0000-0000-00000000000b',
    'Internal task B',
    'backlog',
    'medium',
    'portal'
  );

INSERT INTO public.task_comments (id, task_id, author_id, content)
VALUES
  (
    'e1000000-0000-0000-0000-00000000000a',
    'e0000000-0000-0000-0000-00000000000a',
    'a0000000-0000-0000-0000-000000000001',
    'Internal comment A'
  ),
  (
    'e1000000-0000-0000-0000-00000000000b',
    'e0000000-0000-0000-0000-00000000000b',
    'a0000000-0000-0000-0000-000000000001',
    'Internal comment B'
  );

INSERT INTO public.task_checklist_items (
  id,
  task_id,
  title,
  created_by
)
VALUES
  (
    'e2000000-0000-0000-0000-00000000000a',
    'e0000000-0000-0000-0000-00000000000a',
    'Internal checklist A',
    'a0000000-0000-0000-0000-000000000001'
  ),
  (
    'e2000000-0000-0000-0000-00000000000b',
    'e0000000-0000-0000-0000-00000000000b',
    'Internal checklist B',
    'a0000000-0000-0000-0000-000000000001'
  );

INSERT INTO public.file_content_chunks (
  id,
  file_id,
  client_id,
  project_id,
  chunk_index,
  text
)
VALUES
  (
    'e3000000-0000-0000-0000-00000000000a',
    'f0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-00000000000a',
    'b0000000-0000-0000-0000-00000000000a',
    0,
    'Internal extracted content A'
  ),
  (
    'e3000000-0000-0000-0000-00000000000b',
    'f0000000-0000-0000-0000-00000000000b',
    'a0000000-0000-0000-0000-00000000000b',
    'b0000000-0000-0000-0000-00000000000b',
    0,
    'Internal extracted content B'
  );

INSERT INTO public.file_processing_jobs (id, file_id, job_type, status)
VALUES
  (
    'e4000000-0000-0000-0000-00000000000a',
    'f0000000-0000-0000-0000-000000000001',
    'extract',
    'pending'
  ),
  (
    'e4000000-0000-0000-0000-00000000000b',
    'f0000000-0000-0000-0000-00000000000b',
    'extract',
    'pending'
  );

INSERT INTO public.updates (
  id,
  project_id,
  author_id,
  message,
  update_type,
  client_visible
)
VALUES
  (
    'e5000000-0000-0000-0000-00000000000a',
    'b0000000-0000-0000-0000-00000000000a',
    'a0000000-0000-0000-0000-000000000001',
    'Internal update A',
    'internal',
    false
  ),
  (
    'e5000000-0000-0000-0000-00000000000b',
    'b0000000-0000-0000-0000-00000000000b',
    'a0000000-0000-0000-0000-000000000001',
    'Internal update B',
    'internal',
    false
  );

INSERT INTO storage.objects (bucket_id, name)
VALUES
  (
    'files',
    'reports/a0000000-0000-0000-0000-00000000000a/draft-a.pdf'
  ),
  (
    'files',
    'reports/a0000000-0000-0000-0000-00000000000a/published-a.pdf'
  ),
  (
    'files',
    'reports/a0000000-0000-0000-0000-00000000000b/published-b.pdf'
  ),
  (
    'files',
    'a0000000-0000-0000-0000-00000000000b/unreferenced-b.pdf'
  );

INSERT INTO public.reports (
  id,
  project_id,
  client_id,
  title,
  file_url,
  status,
  created_by,
  internal_notes
)
VALUES
  (
    'd1000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-00000000000a',
    'a0000000-0000-0000-0000-00000000000a',
    'Draft report A',
    'files://reports/a0000000-0000-0000-0000-00000000000a/draft-a.pdf',
    'draft',
    'a0000000-0000-0000-0000-000000000001',
    'Internal notes A'
  ),
  (
    'd1000000-0000-0000-0000-000000000002',
    'b0000000-0000-0000-0000-00000000000a',
    'a0000000-0000-0000-0000-00000000000a',
    'Published report A',
    'files://reports/a0000000-0000-0000-0000-00000000000a/published-a.pdf',
    'published',
    'a0000000-0000-0000-0000-000000000001',
    'Internal published notes A'
  ),
  (
    'd1000000-0000-0000-0000-000000000003',
    'b0000000-0000-0000-0000-00000000000b',
    'a0000000-0000-0000-0000-00000000000b',
    'Published report B',
    'files://reports/a0000000-0000-0000-0000-00000000000b/published-b.pdf',
    'published',
    'a0000000-0000-0000-0000-000000000001',
    'Internal notes B'
  );

INSERT INTO public.client_requests (
  id,
  client_id,
  project_id,
  title,
  description,
  status,
  ai_draft
)
VALUES (
  'd2000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-00000000000a',
  'b0000000-0000-0000-0000-00000000000a',
  'Request A',
  'Visible client request',
  'new',
  'Internal processing prompt'
);

-- ---------------------------------------------------------------------------
-- Reports, requests and cross-client references stay separated
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('a0000000-0000-0000-0000-00000000000a');
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.reports
    WHERE client_id = 'a0000000-0000-0000-0000-00000000000a'
  ),
  1,
  'client sees only its published report, never the draft'
);
SELECT ok(
  pg_temp.statement_fails(
    'SELECT internal_notes FROM public.reports LIMIT 1'
  ),
  'client cannot query internal report notes'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM storage.objects
    WHERE bucket_id = 'files'
      AND name LIKE
        'reports/a0000000-0000-0000-0000-00000000000a/%'
  ),
  1,
  'client can read the published report object but not the draft object'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.client_requests
    WHERE id = 'd2000000-0000-0000-0000-000000000001'
  ),
  1,
  'client can read the safe fields of its own request'
);
SELECT ok(
  pg_temp.statement_fails(
    'SELECT ai_draft FROM public.client_requests LIMIT 1'
  ),
  'client cannot query the internal request draft'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      INSERT INTO public.client_requests (
        client_id,
        project_id,
        title,
        description,
        status,
        ai_draft
      ) VALUES (
        'a0000000-0000-0000-0000-00000000000a',
        'b0000000-0000-0000-0000-00000000000a',
        'Forged internal draft',
        'Client must not write backend instructions',
        'new',
        'hidden prompt'
      )
    $sql$
  ),
  'client cannot inject a backend-only request draft'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000002');
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.reports
    WHERE client_id = 'a0000000-0000-0000-0000-00000000000a'
  ),
  2,
  'assigned manager sees the draft and published reports for Client A'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      INSERT INTO public.reports (
        id,
        project_id,
        client_id,
        title,
        file_url,
        status,
        created_by
      ) VALUES (
        'd1000000-0000-0000-0000-000000000004',
        'b0000000-0000-0000-0000-00000000000a',
        'a0000000-0000-0000-0000-00000000000a',
        'Cross-client report alias',
        'files://reports/a0000000-0000-0000-0000-00000000000b/published-b.pdf',
        'draft',
        'a0000000-0000-0000-0000-000000000002'
      )
    $sql$
  ),
  'assigned manager cannot alias a Client B report object into Client A'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      INSERT INTO public.files (
        id,
        project_id,
        client_id,
        uploaded_by,
        file_name,
        file_url,
        file_type,
        source,
        status,
        storage_bucket,
        storage_path
      ) VALUES (
        'f1000000-0000-0000-0000-000000000001',
        'b0000000-0000-0000-0000-00000000000a',
        'a0000000-0000-0000-0000-00000000000a',
        'a0000000-0000-0000-0000-000000000002',
        'cross-client-storage.pdf',
        'files://a0000000-0000-0000-0000-00000000000b/unreferenced-b.pdf',
        'application/pdf',
        'panel',
        'ready',
        'files',
        'a0000000-0000-0000-0000-00000000000b/unreferenced-b.pdf'
      )
    $sql$
  ),
  'an unreferenced Client B object cannot be aliased into Client A'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      INSERT INTO public.files (
        id,
        project_id,
        client_id,
        uploaded_by,
        file_name,
        file_url,
        file_type,
        source,
        status
      ) VALUES (
        'f1000000-0000-0000-0000-000000000002',
        'b0000000-0000-0000-0000-00000000000b',
        'a0000000-0000-0000-0000-00000000000a',
        'a0000000-0000-0000-0000-000000000002',
        'cross-project-file.pdf',
        'storage://cross-project-file.pdf',
        'application/pdf',
        'panel',
        'ready'
      )
    $sql$
  ),
  'a Client A file cannot point to a Client B project'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      INSERT INTO public.contracts (
        client_id,
        project_id,
        title,
        original_file_url,
        original_file_name,
        status,
        created_by
      ) VALUES (
        'a0000000-0000-0000-0000-00000000000a',
        'b0000000-0000-0000-0000-00000000000b',
        'Cross-project contract',
        'files://a0000000-0000-0000-0000-00000000000a/contracts/cross-project.pdf',
        'cross-project.pdf',
        'draft',
        'a0000000-0000-0000-0000-000000000002'
      )
    $sql$
  ),
  'a Client A contract cannot point to a Client B project'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-00000000000e');
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.reports
    WHERE client_id IN (
      'a0000000-0000-0000-0000-00000000000a',
      'a0000000-0000-0000-0000-00000000000b'
    )
  ),
  0,
  'unassigned manager cannot read reports from either client'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.staff_files_secure
  ),
  0,
  'unassigned manager reads nothing through the staff-only file view'
);

-- ---------------------------------------------------------------------------
-- Client isolation and assignment-aware staff access
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('a0000000-0000-0000-0000-00000000000a');
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.files
    WHERE client_id = 'a0000000-0000-0000-0000-00000000000a'
  ),
  0,
  'client A cannot see internal file records'
);
SELECT ok(
  pg_temp.statement_fails(
    'SELECT source FROM public.files LIMIT 1'
  ),
  'client cannot query a technical file source column'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.staff_files_secure
  ),
  0,
  'client cannot read the staff-only file view'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM storage.objects
    WHERE bucket_id IN ('files', 'mcp-files')
      AND name LIKE 'a0000000-0000-0000-0000-00000000000a/%'
  ),
  0,
  'client A cannot read internal Storage objects'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      INSERT INTO storage.objects (bucket_id, name)
      VALUES (
        'files',
        'a0000000-0000-0000-0000-00000000000a/unlinked/client-upload.pdf'
      )
    $sql$
  ),
  'client cannot upload an object outside the controlled file flow'
);
SELECT ok(
  pg_temp.statement_blocked(
    $sql$
      DELETE FROM storage.objects
      WHERE bucket_id = 'mcp-files'
        AND name =
          'a0000000-0000-0000-0000-00000000000a/f0000000-0000-0000-0000-000000000002/1/internal-a.pdf'
    $sql$
  ),
  'client cannot delete an internal Storage object'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.tasks
    WHERE id = 'e0000000-0000-0000-0000-00000000000a'
  ),
  0,
  'client cannot read its own internal task'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.task_comments
    WHERE id = 'e1000000-0000-0000-0000-00000000000a'
  ),
  0,
  'client cannot read its own internal task comment'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.task_checklist_items
    WHERE id = 'e2000000-0000-0000-0000-00000000000a'
  ),
  0,
  'client cannot read its own internal checklist'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.file_content_chunks
    WHERE id = 'e3000000-0000-0000-0000-00000000000a'
  ),
  0,
  'client cannot read internal extracted chunks'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.file_processing_jobs
    WHERE id = 'e4000000-0000-0000-0000-00000000000a'
  ),
  0,
  'client cannot read internal processing jobs'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.updates
    WHERE id = 'e5000000-0000-0000-0000-00000000000a'
  ),
  0,
  'client cannot read an internal project update'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000003');
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.files
    WHERE client_id = 'a0000000-0000-0000-0000-00000000000a'
  ),
  2,
  'assigned design sees Client A internal file records'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.staff_files_secure
    WHERE client_id = 'a0000000-0000-0000-0000-00000000000a'
  ),
  2,
  'assigned design reads technical file data through the staff-only view'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.staff_files_secure
    WHERE client_id = 'a0000000-0000-0000-0000-00000000000b'
  ),
  0,
  'assigned design cannot cross-read Client B through the staff-only view'
);
SELECT ok(
  (
    SELECT count(*)::integer
    FROM public.staff_files_secure AS staff_file
    WHERE staff_file.client_id = 'a0000000-0000-0000-0000-00000000000a'
      AND staff_file.source IS NOT DISTINCT FROM staff_file.source
      AND staff_file.extraction_status IS NOT DISTINCT FROM staff_file.extraction_status
      AND staff_file.extraction_error IS NOT DISTINCT FROM staff_file.extraction_error
      AND staff_file.agency_approval_status
        IS NOT DISTINCT FROM staff_file.agency_approval_status
  ) = 2,
  'assigned design reads the technical columns through the staff-only view'
);
SELECT ok(
  pg_temp.statement_fails(
    'SELECT source FROM public.files LIMIT 1'
  ),
  'assigned design still cannot read a technical column directly on public.files'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      UPDATE public.staff_files_secure
      SET file_name = 'renamed-through-the-view.pdf'
      WHERE client_id = 'a0000000-0000-0000-0000-00000000000a'
    $sql$
  ),
  'assigned design cannot write through the staff-only view'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      DELETE FROM public.staff_files_secure
      WHERE client_id = 'a0000000-0000-0000-0000-00000000000a'
    $sql$
  ),
  'nobody can delete through the staff-only view'
);

-- The administrator keeps the full expected set through the privileged source.
SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.staff_files_secure
    WHERE client_id = 'a0000000-0000-0000-0000-00000000000a'
  ),
  2,
  'administrator reads the Client A set through the staff-only view'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.staff_files_secure AS staff_file
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.files AS file_row
      WHERE file_row.id = staff_file.id
    )
  ),
  0,
  'the staff-only view never exposes a row the administrator cannot reach on files'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.files AS file_row
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.staff_files_secure AS staff_file
      WHERE staff_file.id = file_row.id
    )
  ),
  0,
  'the staff-only view exposes the administrator the exact expected file set'
);
SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000003');
SELECT is(
  (
    SELECT count(*)::integer
    FROM storage.objects
    WHERE bucket_id IN ('files', 'mcp-files')
      AND name LIKE 'a0000000-0000-0000-0000-00000000000a/%'
  ),
  2,
  'assigned design reads Client A objects in both private buckets'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.files
    WHERE client_id = 'a0000000-0000-0000-0000-00000000000b'
  ),
  0,
  'assigned design cannot cross-read Client B files'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.workspace_nodes
    WHERE id = 'e6000000-0000-0000-0000-00000000000a'
  ),
  1,
  'assigned design sees Client A workspace node'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.workspace_nodes
    WHERE id = 'e6000000-0000-0000-0000-00000000000b'
  ),
  0,
  'assigned design cannot see Client B workspace node'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM storage.objects
    WHERE bucket_id = 'workspace'
      AND name =
        'client/a0000000-0000-0000-0000-00000000000a/workspace-a.txt'
  ),
  1,
  'assigned design sees Client A workspace object'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM storage.objects
    WHERE bucket_id = 'workspace'
      AND name =
        'client/a0000000-0000-0000-0000-00000000000b/workspace-b.txt'
  ),
  0,
  'assigned design cannot see Client B workspace object'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.tasks
    WHERE id = 'e0000000-0000-0000-0000-00000000000a'
  ),
  1,
  'assigned design sees Client A internal task'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.tasks
    WHERE id = 'e0000000-0000-0000-0000-00000000000b'
  ),
  0,
  'assigned design cannot see Client B internal task'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.task_comments
    WHERE id = 'e1000000-0000-0000-0000-00000000000a'
  ),
  1,
  'assigned design sees Client A internal comment'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.task_comments
    WHERE id = 'e1000000-0000-0000-0000-00000000000b'
  ),
  0,
  'assigned design cannot see Client B internal comment'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.task_checklist_items
    WHERE id = 'e2000000-0000-0000-0000-00000000000a'
  ),
  1,
  'assigned design sees Client A internal checklist'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.task_checklist_items
    WHERE id = 'e2000000-0000-0000-0000-00000000000b'
  ),
  0,
  'assigned design cannot see Client B internal checklist'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.file_content_chunks
    WHERE id = 'e3000000-0000-0000-0000-00000000000a'
  ),
  1,
  'assigned design sees Client A extracted chunk'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.file_content_chunks
    WHERE id = 'e3000000-0000-0000-0000-00000000000b'
  ),
  0,
  'assigned design cannot see Client B extracted chunk'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.file_processing_jobs
    WHERE id = 'e4000000-0000-0000-0000-00000000000a'
  ),
  1,
  'assigned design sees Client A processing job'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.file_processing_jobs
    WHERE id = 'e4000000-0000-0000-0000-00000000000b'
  ),
  0,
  'assigned design cannot see Client B processing job'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.updates
    WHERE id = 'e5000000-0000-0000-0000-00000000000a'
  ),
  1,
  'assigned design sees Client A internal update'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.updates
    WHERE id = 'e5000000-0000-0000-0000-00000000000b'
  ),
  0,
  'assigned design cannot see Client B internal update'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-00000000000e');
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.files
    WHERE client_id = 'a0000000-0000-0000-0000-00000000000a'
  ),
  0,
  'unassigned manager cannot read Client A files'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM storage.objects
    WHERE bucket_id IN ('files', 'mcp-files')
      AND name LIKE 'a0000000-0000-0000-0000-00000000000a/%'
  ),
  0,
  'unassigned manager cannot read Client A Storage objects'
);

-- ---------------------------------------------------------------------------
-- Client-visible updates require a manager/admin decision
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000003');
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      INSERT INTO public.updates (
        id,
        project_id,
        author_id,
        message,
        update_type,
        client_visible
      ) VALUES (
        'e5000000-0000-0000-0000-00000000000c',
        'b0000000-0000-0000-0000-00000000000a',
        'a0000000-0000-0000-0000-000000000003',
        'Design cannot publish this update',
        'delivery',
        true
      )
    $sql$
  ),
  'assigned design cannot publish a client-visible update'
);
SELECT ok(
  pg_temp.statement_blocked(
    $sql$
      DELETE FROM public.updates
      WHERE id = 'e5000000-0000-0000-0000-00000000000a'
    $sql$
  ),
  'assigned design cannot perform administrative update deletion'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000002');
SELECT lives_ok(
  $sql$
    INSERT INTO public.updates (
      id,
      project_id,
      author_id,
      message,
      update_type,
      client_visible
    ) VALUES (
      'e5000000-0000-0000-0000-00000000000c',
      'b0000000-0000-0000-0000-00000000000a',
      'a0000000-0000-0000-0000-000000000002',
      'Manager-approved client update',
      'delivery',
      true
    )
  $sql$,
  'assigned manager can publish a client-visible update'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-00000000000a');
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.updates
    WHERE id = 'e5000000-0000-0000-0000-00000000000c'
      AND client_visible
  ),
  1,
  'client sees the manager-approved update'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.updates
    WHERE id = 'e5000000-0000-0000-0000-00000000000a'
  ),
  0,
  'client still cannot see the internal update'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
SELECT is(
  pg_temp.statement_row_count(
    $sql$
      DELETE FROM public.updates
      WHERE id = 'e5000000-0000-0000-0000-00000000000a'
    $sql$
  ),
  1,
  'admin DELETE remains available for an internal update'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.updates
    WHERE id = 'e5000000-0000-0000-0000-00000000000a'
  ),
  0,
  'administratively deleted update is actually removed'
);

-- ---------------------------------------------------------------------------
-- Service-role and actor boundaries
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000003');
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      INSERT INTO public.files (
        id,
        project_id,
        client_id,
        uploaded_by,
        file_name,
        file_url,
        file_type,
        folder,
        source,
        status
      ) VALUES (
        'fa000000-0000-0000-0000-000000000001',
        'b0000000-0000-0000-0000-00000000000a',
        'a0000000-0000-0000-0000-00000000000a',
        'a0000000-0000-0000-0000-000000000003',
        'forged-authenticated.pdf',
        'https://invalid.test/forged-authenticated.pdf',
        'application/pdf',
        'contratos',
        'contract-public',
        'ready'
      )
    $sql$
  ),
  'authenticated staff cannot forge a contract-public file'
);

SELECT pg_temp.act_as_service_role();
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      INSERT INTO public.files (
        id,
        project_id,
        client_id,
        uploaded_by,
        file_name,
        file_url,
        file_type,
        folder,
        source,
        status
      ) VALUES (
        'fa000000-0000-0000-0000-000000000002',
        'b0000000-0000-0000-0000-00000000000a',
        'a0000000-0000-0000-0000-00000000000a',
        'a0000000-0000-0000-0000-000000000001',
        'forged-service.pdf',
        'https://invalid.test/forged-service.pdf',
        'application/pdf',
        'contratos',
        'contract-public',
        'ready'
      )
    $sql$
  ),
  'service_role cannot forge contract-public without a signed contract'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      INSERT INTO public.file_approval_events (
        id,
        file_id,
        client_id,
        actor_id,
        event_type,
        from_status,
        to_status
      ) VALUES (
        'e7000000-0000-0000-0000-000000000001',
        'f0000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-00000000000a',
        'a0000000-0000-0000-0000-000000000001',
        'agency_approved',
        'pending',
        'approved'
      )
    $sql$
  ),
  'service_role cannot forge an approval event'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      UPDATE public.files
      SET agency_approval_status = 'approved',
          visibility = 'client_shared'
      WHERE id = 'f0000000-0000-0000-0000-000000000002'
    $sql$
  ),
  'service-role file agent cannot bypass the approval guard'
);

SELECT pg_temp.act_as_owner();
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.files
    WHERE id IN (
      'fa000000-0000-0000-0000-000000000001',
      'fa000000-0000-0000-0000-000000000002'
    )
  ),
  0,
  'forged contract-public rows were not inserted'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.file_approval_events
    WHERE id = 'e7000000-0000-0000-0000-000000000001'
  ),
  0,
  'forged approval event was not inserted'
);
SELECT is(
  (
    SELECT agency_approval_status
    FROM public.files
    WHERE id = 'f0000000-0000-0000-0000-000000000002'
  ),
  'not_requested',
  'blocked service-role write did not change the agency gate'
);
SELECT is(
  (
    SELECT visibility
    FROM public.files
    WHERE id = 'f0000000-0000-0000-0000-000000000002'
  ),
  'internal',
  'blocked service-role write did not expose the file'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000002');
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.release_file_to_client(
        'f0000000-0000-0000-0000-000000000002',
        'approval'
      )
    $sql$
  ),
  'manager cannot release a file before agency approval'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000003');
SELECT lives_ok(
  $sql$
    SELECT public.request_file_agency_review(
      'f0000000-0000-0000-0000-000000000002'
    )
  $sql$,
  'assigned design requests review for the second internal file'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000002');
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.review_file_agency(
        'f0000000-0000-0000-0000-000000000002',
        'rejected',
        NULL
      )
    $sql$
  ),
  'agency rejection requires feedback'
);
SELECT lives_ok(
  $sql$
    SELECT public.review_file_agency(
      'f0000000-0000-0000-0000-000000000002',
      'rejected',
      'Corrigir a peça antes de liberar ao cliente'
    )
  $sql$,
  'assigned manager rejects internally with agency feedback'
);

SELECT pg_temp.act_as_owner();
SELECT is(
  (
    SELECT agency_approval_status
    FROM public.files
    WHERE id = 'f0000000-0000-0000-0000-000000000002'
  ),
  'rejected',
  'agency rejection remains in the internal gate'
);
SELECT is(
  (
    SELECT agency_feedback
    FROM public.files
    WHERE id = 'f0000000-0000-0000-0000-000000000002'
  ),
  'Corrigir a peça antes de liberar ao cliente',
  'agency feedback is preserved separately'
);
SELECT is(
  (
    SELECT visibility
    FROM public.files
    WHERE id = 'f0000000-0000-0000-0000-000000000002'
  ),
  'internal',
  'agency rejection does not expose the file'
);
SELECT ok(
  (
    SELECT locked_at IS NOT NULL
    FROM public.files
    WHERE id = 'f0000000-0000-0000-0000-000000000002'
  ),
  'agency rejection locks the rejected version'
);

SELECT pg_temp.act_as_service_role();
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      UPDATE public.files
      SET tags = ARRAY['forged-after-rejection'],
          extracted_metadata = '{"forged": true}'::jsonb
      WHERE id = 'f0000000-0000-0000-0000-000000000002'
    $sql$
  ),
  'service_role cannot change tags or metadata on an agency-rejected version'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      INSERT INTO public.files (
        id,
        project_id,
        client_id,
        uploaded_by,
        file_name,
        file_url,
        file_type,
        folder,
        parent_file_id,
        source,
        status
      ) VALUES (
        'f0000000-0000-0000-0000-000000000006',
        'b0000000-0000-0000-0000-00000000000a',
        'a0000000-0000-0000-0000-00000000000a',
        'a0000000-0000-0000-0000-000000000001',
        'late-carousel-child.png',
        'storage://late-carousel-child.png',
        'image/png',
        'entregas',
        'f0000000-0000-0000-0000-000000000002',
        'panel',
        'ready'
      )
    $sql$
  ),
  'a locked rejected version cannot receive a new carousel child'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000002');
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      INSERT INTO public.files (
        id,
        project_id,
        client_id,
        uploaded_by,
        file_name,
        file_url,
        file_type,
        folder,
        parent_file_id,
        revision_of_file_id,
        source,
        status
      ) VALUES (
        'f0000000-0000-0000-0000-000000000004',
        'b0000000-0000-0000-0000-00000000000a',
        'a0000000-0000-0000-0000-00000000000a',
        'a0000000-0000-0000-0000-000000000002',
        'ambiguous-child-revision.pdf',
        'storage://ambiguous-child-revision.pdf',
        'application/pdf',
        'entregas',
        'f0000000-0000-0000-0000-000000000001',
        'f0000000-0000-0000-0000-000000000002',
        'panel',
        'ready'
      )
    $sql$
  ),
  'a file cannot be both a carousel child and a revision'
);
SELECT lives_ok(
  $sql$
    INSERT INTO public.files (
      id,
      project_id,
      client_id,
      uploaded_by,
      file_name,
      file_url,
      file_type,
      folder,
      revision_of_file_id,
      source,
      status
    ) VALUES (
      'f0000000-0000-0000-0000-000000000003',
      'b0000000-0000-0000-0000-00000000000a',
      'a0000000-0000-0000-0000-00000000000a',
      'a0000000-0000-0000-0000-000000000002',
      'internal-a-revision-2.pdf',
      'storage://internal-a-revision-2.pdf',
      'application/pdf',
      'entregas',
      'f0000000-0000-0000-0000-000000000002',
      'panel',
      'ready'
    )
  $sql$,
  'assigned manager creates a new revision from the locked rejection'
);

SELECT pg_temp.act_as_owner();
SELECT is(
  (
    SELECT revision_of_file_id
    FROM public.files
    WHERE id = 'f0000000-0000-0000-0000-000000000003'
  ),
  'f0000000-0000-0000-0000-000000000002'::uuid,
  'new correction keeps an explicit link to the rejected version'
);
SELECT is(
  (
    SELECT version
    FROM public.files
    WHERE id = 'f0000000-0000-0000-0000-000000000003'
  ),
  2,
  'new correction advances the version number'
);
SELECT ok(
  (
    SELECT locked_at IS NULL
      AND agency_approval_status = 'not_requested'
      AND approval_status = 'none'
      AND visibility = 'internal'
    FROM public.files
    WHERE id = 'f0000000-0000-0000-0000-000000000003'
  ),
  'new correction starts unlocked in the internal gate'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.files
    WHERE id IN (
      'f0000000-0000-0000-0000-000000000004',
      'f0000000-0000-0000-0000-000000000006'
    )
  ),
  0,
  'invalid child/revision attempts left no rows behind'
);
SELECT is(
  (
    SELECT tags = '{}'::text[]
      AND extracted_metadata = '{}'::jsonb
    FROM public.files
    WHERE id = 'f0000000-0000-0000-0000-000000000002'
  ),
  true,
  'blocked metadata overwrite left the rejected version unchanged'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000003');
SELECT lives_ok(
  $sql$
    SELECT public.request_file_agency_review(
      'f0000000-0000-0000-0000-000000000003'
    )
  $sql$,
  'the new revision can continue through the internal review flow'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-00000000000a');
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.request_file_agency_review(
        'f0000000-0000-0000-0000-000000000001'
      )
    $sql$
  ),
  'client cannot request internal agency review'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000003');
SELECT lives_ok(
  $sql$
    SELECT public.request_file_agency_review(
      'f0000000-0000-0000-0000-000000000001'
    )
  $sql$,
  'assigned design can request agency review'
);
SELECT is(
  pg_temp.statement_row_count(
    $sql$
      UPDATE public.files
      SET file_name = 'mutated-during-agency-review.pdf'
      WHERE id = 'f0000000-0000-0000-0000-000000000001'
    $sql$
  ),
  0,
  'file row is immutable as soon as agency review starts'
);
SELECT is(
  pg_temp.statement_row_count(
    $sql$
      DELETE FROM public.files
      WHERE id = 'f0000000-0000-0000-0000-000000000001'
    $sql$
  ),
  0,
  'file row cannot be deleted during agency review'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      DELETE FROM storage.objects
      WHERE bucket_id = 'files'
        AND name =
          'a0000000-0000-0000-0000-00000000000a/f0000000-0000-0000-0000-000000000001/1/approval-a.pdf'
    $sql$
  ),
  'physical object cannot be deleted during agency review'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      INSERT INTO public.files (
        id,
        project_id,
        client_id,
        uploaded_by,
        file_name,
        file_url,
        file_type,
        folder,
        parent_file_id,
        source,
        status
      ) VALUES (
        'f0000000-0000-0000-0000-000000000007',
        'b0000000-0000-0000-0000-00000000000a',
        'a0000000-0000-0000-0000-00000000000a',
        'a0000000-0000-0000-0000-000000000003',
        'late-child-agency-pending.png',
        'storage://late-child-agency-pending.png',
        'image/png',
        'entregas',
        'f0000000-0000-0000-0000-000000000001',
        'panel',
        'ready'
      )
    $sql$
  ),
  'agency-pending root cannot receive an unreviewed late child'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.review_file_agency(
        'f0000000-0000-0000-0000-000000000001',
        'approved',
        NULL
      )
    $sql$
  ),
  'design agent cannot approve internally'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-00000000000a');
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.review_file_agency(
        'f0000000-0000-0000-0000-000000000001',
        'approved',
        NULL
      )
    $sql$
  ),
  'client cannot approve internally'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-00000000000e');
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.review_file_agency(
        'f0000000-0000-0000-0000-000000000001',
        'approved',
        NULL
      )
    $sql$
  ),
  'unassigned manager cannot approve Client A internally'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000002');
SELECT lives_ok(
  $sql$
    SELECT public.review_file_agency(
      'f0000000-0000-0000-0000-000000000001',
      'approved',
      NULL
    )
  $sql$,
  'assigned manager approves the agency gate'
);

SELECT pg_temp.act_as_owner();
SELECT is(
  (
    SELECT agency_approval_status
    FROM public.files
    WHERE id = 'f0000000-0000-0000-0000-000000000001'
  ),
  'approved',
  'agency gate records the internal approval'
);
SELECT is(
  (
    SELECT visibility
    FROM public.files
    WHERE id = 'f0000000-0000-0000-0000-000000000001'
  ),
  'internal',
  'agency approval alone does not expose the file to the client'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-00000000000a');
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.files
    WHERE id = 'f0000000-0000-0000-0000-000000000001'
  ),
  0,
  'client still cannot see an agency-approved file before release'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.release_file_to_client(
        'f0000000-0000-0000-0000-000000000001',
        'approval'
      )
    $sql$
  ),
  'client cannot release an agency-approved file'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000003');
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.release_file_to_client(
        'f0000000-0000-0000-0000-000000000001',
        'approval'
      )
    $sql$
  ),
  'design agent cannot release an agency-approved file'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000002');
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.release_file_to_client(
        'f0000000-0000-0000-0000-000000000001',
        NULL
      )
    $sql$
  ),
  'release rejects a missing mode instead of exposing a file by default'
);
SELECT lives_ok(
  $sql$
    SELECT public.release_file_to_client(
      'f0000000-0000-0000-0000-000000000001',
      'approval'
    )
  $sql$,
  'assigned manager releases the file for client approval'
);
SELECT is(
  pg_temp.statement_row_count(
    $sql$
      UPDATE public.files
      SET file_name = 'mutated-after-release.pdf'
      WHERE id = 'f0000000-0000-0000-0000-000000000001'
    $sql$
  ),
  0,
  'released file row is immutable while the client decision is pending'
);
SELECT is(
  pg_temp.statement_row_count(
    $sql$
      DELETE FROM public.files
      WHERE id = 'f0000000-0000-0000-0000-000000000001'
    $sql$
  ),
  0,
  'released file row cannot be deleted while approval is pending'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      DELETE FROM storage.objects
      WHERE bucket_id = 'files'
        AND name =
          'a0000000-0000-0000-0000-00000000000a/f0000000-0000-0000-0000-000000000001/1/approval-a.pdf'
    $sql$
  ),
  'released physical object cannot be deleted while approval is pending'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      INSERT INTO public.files (
        id,
        project_id,
        client_id,
        uploaded_by,
        file_name,
        file_url,
        file_type,
        folder,
        parent_file_id,
        source,
        status
      ) VALUES (
        'f0000000-0000-0000-0000-000000000008',
        'b0000000-0000-0000-0000-00000000000a',
        'a0000000-0000-0000-0000-00000000000a',
        'a0000000-0000-0000-0000-000000000002',
        'late-child-client-pending.png',
        'storage://late-child-client-pending.png',
        'image/png',
        'entregas',
        'f0000000-0000-0000-0000-000000000001',
        'panel',
        'ready'
      )
    $sql$
  ),
  'client-pending root cannot receive an unreviewed late child'
);

SELECT pg_temp.act_as_service_role();
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      INSERT INTO public.files (
        id,
        project_id,
        client_id,
        uploaded_by,
        file_name,
        file_url,
        file_type,
        folder,
        source,
        status,
        storage_bucket,
        storage_path
      ) VALUES (
        'f0000000-0000-0000-0000-000000000009',
        'b0000000-0000-0000-0000-00000000000a',
        'a0000000-0000-0000-0000-00000000000a',
        'a0000000-0000-0000-0000-000000000001',
        'duplicate-storage-alias.pdf',
        'files://a0000000-0000-0000-0000-00000000000a/f0000000-0000-0000-0000-000000000001/1/approval-a.pdf',
        'application/pdf',
        'entregas',
        'panel',
        'ready',
        'files',
        'a0000000-0000-0000-0000-00000000000a/f0000000-0000-0000-0000-000000000001/1/approval-a.pdf'
      )
    $sql$
  ),
  'one physical object cannot be aliased by a second file version'
);

-- ---------------------------------------------------------------------------
-- Client gate, optimistic version and terminal immutability
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('a0000000-0000-0000-0000-00000000000a');
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.files
    WHERE id = 'f0000000-0000-0000-0000-000000000001'
      AND visibility = 'approval'
      AND approval_status = 'pending'
  ),
  1,
  'owner client sees only the explicitly released pending approval'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM storage.objects
    WHERE bucket_id = 'files'
      AND name =
        'a0000000-0000-0000-0000-00000000000a/f0000000-0000-0000-0000-000000000001/1/approval-a.pdf'
  ),
  1,
  'owner client can read the released Storage object'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM storage.objects
    WHERE bucket_id = 'mcp-files'
      AND name LIKE 'a0000000-0000-0000-0000-00000000000a/%'
  ),
  0,
  'owner client still cannot read another internal object'
);
SELECT ok(
  pg_temp.statement_blocked(
    $sql$
      DELETE FROM storage.objects
      WHERE bucket_id = 'files'
        AND name =
          'a0000000-0000-0000-0000-00000000000a/f0000000-0000-0000-0000-000000000001/1/approval-a.pdf'
    $sql$
  ),
  'client cannot delete a released Storage object'
);

SELECT ok(
  pg_temp.statement_fails(
    $sql$
      UPDATE public.files
      SET approval_status = 'approved'
      WHERE id = 'f0000000-0000-0000-0000-000000000001'
    $sql$
  ),
  'client cannot bypass decide_file_approval with a direct update'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.decide_file_approval(
        'f0000000-0000-0000-0000-000000000001',
        NULL,
        'approved',
        NULL
      )
    $sql$
  ),
  'client decision rejects a missing expected version'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.decide_file_approval(
        'f0000000-0000-0000-0000-000000000001',
        1,
        NULL,
        NULL
      )
    $sql$
  ),
  'client decision rejects a missing decision'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.decide_file_approval(
        'f0000000-0000-0000-0000-000000000001',
        999,
        'approved',
        NULL
      )
    $sql$
  ),
  'client decision rejects a stale expected version'
);
SELECT lives_ok(
  $sql$
    SELECT public.decide_file_approval(
      'f0000000-0000-0000-0000-000000000001',
      1,
      'approved',
      NULL
    )
  $sql$,
  'owner client approves the expected version once'
);
SELECT is(
  (
    SELECT approval_status
    FROM public.files
    WHERE id = 'f0000000-0000-0000-0000-000000000001'
  ),
  'approved',
  'client approval becomes terminal'
);
SELECT is(
  (
    SELECT client_decided_by
    FROM public.files
    WHERE id = 'f0000000-0000-0000-0000-000000000001'
  ),
  'a0000000-0000-0000-0000-00000000000a'::uuid,
  'client decision records the owner'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.decide_file_approval(
        'f0000000-0000-0000-0000-000000000001',
        1,
        'rejected',
        'Replay must not replace the first decision'
      )
    $sql$
  ),
  'owner client cannot decide the same version twice'
);

SELECT pg_temp.act_as_service_role();
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      UPDATE public.files
      SET approval_status = 'rejected',
          feedback = 'Agent overwrite'
      WHERE id = 'f0000000-0000-0000-0000-000000000001'
    $sql$
  ),
  'service-role agent cannot overwrite a terminal client decision'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      UPDATE public.files
      SET tags = ARRAY['forged-after-approval'],
          extracted_metadata = '{"forged": true}'::jsonb
      WHERE id = 'f0000000-0000-0000-0000-000000000001'
    $sql$
  ),
  'service_role cannot change tags or metadata on a client-approved version'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      INSERT INTO public.files (
        id,
        project_id,
        client_id,
        uploaded_by,
        file_name,
        file_url,
        file_type,
        folder,
        parent_file_id,
        source,
        status
      ) VALUES (
        'f0000000-0000-0000-0000-000000000005',
        'b0000000-0000-0000-0000-00000000000a',
        'a0000000-0000-0000-0000-00000000000a',
        'a0000000-0000-0000-0000-000000000001',
        'late-approved-child.png',
        'storage://late-approved-child.png',
        'image/png',
        'entregas',
        'f0000000-0000-0000-0000-000000000001',
        'panel',
        'ready'
      )
    $sql$
  ),
  'a locked approved version cannot receive a new carousel child'
);

SELECT pg_temp.act_as_owner();
SELECT is(
  (
    SELECT approval_status
    FROM public.files
    WHERE id = 'f0000000-0000-0000-0000-000000000001'
  ),
  'approved',
  'terminal client approval remains unchanged after bypass attempts'
);
SELECT is(
  (
    SELECT tags = '{}'::text[]
      AND extracted_metadata = '{}'::jsonb
    FROM public.files
    WHERE id = 'f0000000-0000-0000-0000-000000000001'
  ),
  true,
  'terminal approved version keeps its original tags and metadata'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.files
    WHERE id = 'f0000000-0000-0000-0000-000000000005'
  ),
  0,
  'blocked child insert left the approved version tree unchanged'
);

-- ---------------------------------------------------------------------------
-- Released cross-client isolation and client-shared mode
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
SELECT lives_ok(
  $sql$
    SELECT public.request_file_agency_review(
      'f0000000-0000-0000-0000-00000000000b'
    )
  $sql$,
  'admin requests Client B agency review'
);
SELECT lives_ok(
  $sql$
    SELECT public.review_file_agency(
      'f0000000-0000-0000-0000-00000000000b',
      'approved',
      NULL
    )
  $sql$,
  'admin approves Client B agency gate'
);
SELECT lives_ok(
  $sql$
    SELECT public.release_file_to_client(
      'f0000000-0000-0000-0000-00000000000b',
      'client_shared'
    )
  $sql$,
  'admin shares Client B file without requesting a decision'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-00000000000a');
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.files
    WHERE id = 'f0000000-0000-0000-0000-00000000000b'
  ),
  0,
  'client A cannot cross-read Client B released file'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM storage.objects
    WHERE bucket_id = 'files'
      AND name LIKE 'a0000000-0000-0000-0000-00000000000b/%'
  ),
  0,
  'client A cannot cross-read Client B released object'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-00000000000b');
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.files
    WHERE id = 'f0000000-0000-0000-0000-00000000000b'
      AND visibility = 'client_shared'
      AND approval_status = 'none'
  ),
  1,
  'client B sees its shared file without a false pending approval'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM storage.objects
    WHERE bucket_id = 'files'
      AND name LIKE 'a0000000-0000-0000-0000-00000000000b/%'
  ),
  1,
  'client B reads its own released Storage object'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.decide_file_approval(
        'f0000000-0000-0000-0000-00000000000b',
        1,
        'approved',
        NULL
      )
    $sql$
  ),
  'client-shared mode does not create an approval decision'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
SELECT is(
  pg_temp.statement_row_count(
    $sql$
      UPDATE public.files
      SET file_name = 'mutated-client-shared.pdf'
      WHERE id = 'f0000000-0000-0000-0000-00000000000b'
    $sql$
  ),
  0,
  'client-shared file is immutable for staff'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      DELETE FROM storage.objects
      WHERE bucket_id = 'files'
        AND name LIKE 'a0000000-0000-0000-0000-00000000000b/%'
    $sql$
  ),
  'client-shared physical object is immutable for staff'
);

-- ---------------------------------------------------------------------------
-- Client rejection preserves feedback and opens exactly one correction
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as_owner();
INSERT INTO storage.objects (bucket_id, name)
VALUES (
  'files',
  'a0000000-0000-0000-0000-00000000000a/f3000000-0000-0000-0000-000000000001/1/reject-me.pdf'
);

SELECT pg_temp.act_as_service_role();
INSERT INTO public.files (
  id,
  project_id,
  client_id,
  uploaded_by,
  file_name,
  file_url,
  file_type,
  folder,
  source,
  status,
  storage_bucket,
  storage_path
)
VALUES (
  'f3000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-00000000000a',
  'a0000000-0000-0000-0000-00000000000a',
  'a0000000-0000-0000-0000-00000000000a',
  'reject-me.pdf',
  'files://a0000000-0000-0000-0000-00000000000a/f3000000-0000-0000-0000-000000000001/1/reject-me.pdf',
  'application/pdf',
  'entregas',
  'mcp',
  'ready',
  'files',
  'a0000000-0000-0000-0000-00000000000a/f3000000-0000-0000-0000-000000000001/1/reject-me.pdf'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000003');
SELECT lives_ok(
  $sql$
    SELECT public.request_file_agency_review(
      'f3000000-0000-0000-0000-000000000001'
    )
  $sql$,
  'assigned design sends the rejection fixture to agency review'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000002');
SELECT lives_ok(
  $sql$
    SELECT public.review_file_agency(
      'f3000000-0000-0000-0000-000000000001',
      'approved',
      NULL
    )
  $sql$,
  'assigned manager approves the rejection fixture internally'
);
SELECT lives_ok(
  $sql$
    SELECT public.release_file_to_client(
      'f3000000-0000-0000-0000-000000000001',
      'approval'
    )
  $sql$,
  'assigned manager releases the rejection fixture to the client'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-00000000000a');
SELECT lives_ok(
  $sql$
    SELECT public.decide_file_approval(
      'f3000000-0000-0000-0000-000000000001',
      1,
      'rejected',
      'Ajustar a chamada principal e reenviar para aprovação'
    )
  $sql$,
  'client rejects the released version with actionable feedback'
);

SELECT pg_temp.act_as_owner();
SELECT ok(
  (
    SELECT approval_status = 'rejected'
      AND feedback =
        'Ajustar a chamada principal e reenviar para aprovação'
      AND locked_at IS NOT NULL
    FROM public.files
    WHERE id = 'f3000000-0000-0000-0000-000000000001'
  ),
  'client rejection locks the version and preserves the exact feedback'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.file_approval_events
    WHERE file_id = 'f3000000-0000-0000-0000-000000000001'
      AND event_type = 'client_rejected'
  ),
  1,
  'client rejection writes one immutable audit event'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.tasks
    WHERE project_id = 'b0000000-0000-0000-0000-00000000000a'
      AND source = 'client_feedback'
      AND title = 'Ajustar: reject-me.pdf'
      AND assigned_to IS NULL
  ),
  1,
  'client rejection opens one correction task without assigning a client'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000002');
SELECT lives_ok(
  $sql$
    INSERT INTO public.files (
      id,
      project_id,
      client_id,
      uploaded_by,
      file_name,
      file_url,
      file_type,
      folder,
      revision_of_file_id,
      source,
      status
    ) VALUES (
      'f3000000-0000-0000-0000-000000000002',
      'b0000000-0000-0000-0000-00000000000a',
      'a0000000-0000-0000-0000-00000000000a',
      'a0000000-0000-0000-0000-000000000002',
      'reject-me-v2.pdf',
      'storage://reject-me-v2.pdf',
      'application/pdf',
      'entregas',
      'f3000000-0000-0000-0000-000000000001',
      'panel',
      'ready'
    )
  $sql$,
  'assigned manager creates a fresh correction linked to the rejected version'
);

SELECT pg_temp.act_as_owner();
SELECT ok(
  (
    SELECT revision_of_file_id =
        'f3000000-0000-0000-0000-000000000001'::uuid
      AND version = 2
      AND visibility = 'internal'
      AND agency_approval_status = 'not_requested'
      AND approval_status = 'none'
      AND locked_at IS NULL
    FROM public.files
    WHERE id = 'f3000000-0000-0000-0000-000000000002'
  ),
  'correction starts as an internal editable version two'
);
SELECT is(
  (
    SELECT feedback
    FROM public.files
    WHERE id = 'f3000000-0000-0000-0000-000000000001'
  ),
  'Ajustar a chamada principal e reenviar para aprovação',
  'creating the correction never erases the rejected feedback'
);

-- ---------------------------------------------------------------------------
-- Contract signing stays atomic and immutable
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as_owner();
INSERT INTO storage.objects (bucket_id, name)
VALUES (
  'files',
  'a0000000-0000-0000-0000-00000000000a/contracts/signed-contract-a.pdf'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
SELECT lives_ok(
  $sql$
    INSERT INTO public.contracts (
      client_id,
      project_id,
      title,
      original_file_url,
      original_file_name,
      status,
      created_by
    ) VALUES (
      'a0000000-0000-0000-0000-00000000000a',
      'b0000000-0000-0000-0000-00000000000a',
      'Atomic signature contract A',
      'files://a0000000-0000-0000-0000-00000000000a/contracts/signed-contract-a.pdf',
      'signed-contract-a.pdf',
      'draft',
      'a0000000-0000-0000-0000-000000000001'
    )
  $sql$,
  'assigned administrator creates an unsigned contract draft'
);
SELECT lives_ok(
  $sql$
    UPDATE public.contracts
    SET admin_signature_name = 'Aceleriq',
        admin_signed_at = now(),
        admin_signature_ip = '127.0.0.1'
    WHERE title = 'Atomic signature contract A'
  $sql$,
  'administrator signs the draft before it is sent'
);

SELECT pg_temp.act_as_service_role();
UPDATE public.contracts
SET status = 'sent',
    sent_at = now()
WHERE title = 'Atomic signature contract A';

SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
SELECT ok(
  pg_temp.statement_blocked(
    $sql$
      DELETE FROM public.contracts
      WHERE title = 'Atomic signature contract A'
    $sql$
  ),
  'administrator cannot delete a sent contract'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      UPDATE public.contracts
      SET title = 'Mutated after send'
      WHERE title = 'Atomic signature contract A'
    $sql$
  ),
  'sent contract is immutable for authenticated staff'
);

SELECT pg_temp.act_as_service_role();
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      DELETE FROM public.contracts
      WHERE title = 'Atomic signature contract A'
    $sql$
  ),
  'service role cannot delete a sent contract'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-00000000000a');
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      UPDATE public.contracts
      SET client_signature_name = 'Forged direct signature'
      WHERE title = 'Atomic signature contract A'
    $sql$
  ),
  'client cannot write signature fields directly'
);
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      SELECT public.complete_contract_signature(
        (
          SELECT sign_token
          FROM public.contracts
          WHERE title = 'Atomic signature contract A'
        ),
        'Client A',
        '127.0.0.1'
      )
    $sql$
  ),
  'authenticated client cannot invoke the trusted signing RPC'
);

SELECT pg_temp.act_as_service_role();
SELECT lives_ok(
  $sql$
    SELECT public.complete_contract_signature(
      (
        SELECT sign_token
        FROM public.contracts
        WHERE title = 'Atomic signature contract A'
      ),
      'Client A',
      '127.0.0.1'
    )
  $sql$,
  'trusted backend completes the signature, file and audit event atomically'
);
SELECT is(
  (
    SELECT public.complete_contract_signature(
      sign_token,
      'Client A',
      '127.0.0.1'
    )
    FROM public.contracts
    WHERE title = 'Atomic signature contract A'
  ),
  (
    SELECT file_id
    FROM public.contracts
    WHERE title = 'Atomic signature contract A'
  ),
  'trusted contract completion is idempotent'
);

SELECT pg_temp.act_as_owner();
SELECT is(
  (
    SELECT status
    FROM public.contracts
    WHERE title = 'Atomic signature contract A'
  ),
  'completed',
  'contract reaches completed only through the trusted transaction'
);
SELECT ok(
  (
    SELECT file_id IS NOT NULL
      AND client_signed_at IS NOT NULL
      AND client_signature_name = 'Client A'
    FROM public.contracts
    WHERE title = 'Atomic signature contract A'
  ),
  'completed contract stores its signature and linked immutable file'
);
SELECT ok(
  (
    SELECT file_row.source = 'contract-public'
      AND file_row.visibility = 'client_shared'
      AND file_row.approval_status = 'approved'
      AND file_row.locked_at IS NOT NULL
      AND file_row.storage_bucket = 'files'
    FROM public.contracts AS contract
    JOIN public.files AS file_row ON file_row.id = contract.file_id
    WHERE contract.title = 'Atomic signature contract A'
  ),
  'signed contract file is client-visible, approved and locked'
);
SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
SELECT ok(
  pg_temp.statement_blocked(
    $sql$
      DELETE FROM public.contracts
      WHERE title = 'Atomic signature contract A'
    $sql$
  ),
  'administrator cannot delete a completed contract'
);
SELECT pg_temp.act_as_service_role();
SELECT ok(
  pg_temp.statement_fails(
    $sql$
      DELETE FROM public.contracts
      WHERE title = 'Atomic signature contract A'
    $sql$
  ),
  'service role cannot delete a completed contract'
);
SELECT pg_temp.act_as_owner();
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.file_approval_events AS event
    JOIN public.contracts AS contract ON contract.file_id = event.file_id
    WHERE contract.title = 'Atomic signature contract A'
      AND event.event_type = 'contract_signed'
  ),
  1,
  'contract completion writes exactly one immutable audit event'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-00000000000a');
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.files AS file_row
    JOIN public.contracts AS contract ON contract.file_id = file_row.id
    WHERE contract.title = 'Atomic signature contract A'
  ),
  1,
  'client can read the completed contract file metadata'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM storage.objects
    WHERE bucket_id = 'files'
      AND name =
        'a0000000-0000-0000-0000-00000000000a/contracts/signed-contract-a.pdf'
  ),
  1,
  'client can read the completed contract object'
);

SELECT * FROM finish();
ROLLBACK;
