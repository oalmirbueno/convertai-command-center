-- ============================================================================
-- ACQ-OPS-001C — RLS test suite for external_accounts / project_external_accounts
-- pgTAP suite. Runs inside BEGIN/ROLLBACK. Never touches production data.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(48);

-- ---------------------------------------------------------------------------
-- 0. Silence outbound HTTP triggers that fire on writes to real tables.
-- ---------------------------------------------------------------------------
ALTER TABLE public.projects  DISABLE TRIGGER USER;
ALTER TABLE public.milestones DISABLE TRIGGER USER;
ALTER TABLE public.tasks     DISABLE TRIGGER USER;

-- ---------------------------------------------------------------------------
-- 1. Structural assertions (RLS, grants, function EXECUTE, constraints, FKs).
-- ---------------------------------------------------------------------------
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.external_accounts'::regclass),
  'RLS enabled on external_accounts'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.project_external_accounts'::regclass),
  'RLS enabled on project_external_accounts'
);

SELECT is(
  (SELECT count(*)::int FROM information_schema.role_table_grants
     WHERE table_schema='public' AND table_name='external_accounts' AND grantee='anon'),
  0, 'anon has no grants on external_accounts'
);
SELECT is(
  (SELECT count(*)::int FROM information_schema.role_table_grants
     WHERE table_schema='public' AND table_name='project_external_accounts' AND grantee='anon'),
  0, 'anon has no grants on project_external_accounts'
);

SELECT is(
  (SELECT has_function_privilege('anon', 'public.can_manage_client(uuid)', 'EXECUTE')),
  false, 'anon cannot EXECUTE can_manage_client'
);
SELECT is(
  (SELECT has_function_privilege('anon', 'public.can_access_client(uuid)', 'EXECUTE')),
  false, 'anon cannot EXECUTE can_access_client'
);
SELECT is(
  (SELECT has_function_privilege('public', 'public.external_accounts_guard()', 'EXECUTE')),
  false, 'PUBLIC cannot EXECUTE external_accounts_guard'
);
SELECT is(
  (SELECT has_function_privilege('public', 'public.project_external_accounts_guard()', 'EXECUTE')),
  false, 'PUBLIC cannot EXECUTE project_external_accounts_guard'
);

SELECT ok(
  EXISTS (SELECT 1 FROM pg_constraint
           WHERE conname='external_accounts_platform_nonempty' AND conrelid='public.external_accounts'::regclass),
  'CHECK constraint platform_nonempty exists'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_constraint
           WHERE conname='external_accounts_display_name_nonempty' AND conrelid='public.external_accounts'::regclass),
  'CHECK constraint display_name_nonempty exists'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.project_external_accounts'::regclass
      AND contype='f' AND conname='project_external_accounts_project_fk'
      AND array_length(conkey,1) = 2
  ),
  'Composite FK to projects (project_id, client_id) exists'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.project_external_accounts'::regclass
      AND contype='f' AND conname='project_external_accounts_account_fk'
      AND array_length(conkey,1) = 2
  ),
  'Composite FK to external_accounts (external_account_id, client_id) exists'
);

SELECT ok(
  EXISTS (SELECT 1 FROM pg_indexes
           WHERE schemaname='public' AND indexname='external_accounts_unique_handle'),
  'Unique index on handle exists'
);

-- ---------------------------------------------------------------------------
-- 2. Fixtures (superuser).
-- ---------------------------------------------------------------------------
-- fixed UUIDs
--   admin              a0000000-0000-0000-0000-000000000001
--   manager assigned   a0000000-0000-0000-0000-000000000002
--   design  assigned   a0000000-0000-0000-0000-000000000003
--   traffic assigned   a0000000-0000-0000-0000-000000000004
--   client A           a0000000-0000-0000-0000-00000000000A
--   client B           a0000000-0000-0000-0000-00000000000B
--   manager unassigned a0000000-0000-0000-0000-00000000000E
--   project A          b0000000-0000-0000-0000-00000000000A
--   project B          b0000000-0000-0000-0000-00000000000B
--   account A1         c0000000-0000-0000-0000-00000000000A
--   account B1         c0000000-0000-0000-0000-00000000000B

INSERT INTO public.profiles (id, full_name, email, plan_status, onboarding_done, sync_status, client_type)
VALUES
  ('a0000000-0000-0000-0000-000000000001','Admin Fixture','admin@test.local','active',true,'ok','recurring'),
  ('a0000000-0000-0000-0000-000000000002','Manager A','manager-a@test.local','active',true,'ok','recurring'),
  ('a0000000-0000-0000-0000-000000000003','Design A','design-a@test.local','active',true,'ok','recurring'),
  ('a0000000-0000-0000-0000-000000000004','Traffic A','traffic-a@test.local','active',true,'ok','recurring'),
  ('a0000000-0000-0000-0000-00000000000a','Client A','client-a@test.local','active',true,'ok','recurring'),
  ('a0000000-0000-0000-0000-00000000000b','Client B','client-b@test.local','active',true,'ok','recurring'),
  ('a0000000-0000-0000-0000-00000000000e','Manager Unassigned','manager-u@test.local','active',true,'ok','recurring');

INSERT INTO public.user_roles (user_id, role) VALUES
  ('a0000000-0000-0000-0000-000000000001','admin'),
  ('a0000000-0000-0000-0000-000000000002','manager'),
  ('a0000000-0000-0000-0000-000000000003','design'),
  ('a0000000-0000-0000-0000-000000000004','traffic'),
  ('a0000000-0000-0000-0000-00000000000a','client'),
  ('a0000000-0000-0000-0000-00000000000b','client'),
  ('a0000000-0000-0000-0000-00000000000e','manager');

-- Assign staff only to Client A.
INSERT INTO public.team_client_assignments (user_id, client_id) VALUES
  ('a0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a'),
  ('a0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-00000000000a'),
  ('a0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-00000000000a');

INSERT INTO public.projects (id, client_id, name, project_type, status, progress, start_date, deadline, billing_mode)
VALUES
  ('b0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000a','Project A','recurring','active',0, current_date, current_date + 30, 'included'),
  ('b0000000-0000-0000-0000-00000000000b','a0000000-0000-0000-0000-00000000000b','Project B','recurring','active',0, current_date, current_date + 30, 'included');

-- Baseline accounts inserted by admin via trigger (bypass RLS as superuser is fine;
-- we set jwt sub so guard trigger writes created_by = admin).
SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);

INSERT INTO public.external_accounts (id, client_id, platform, display_name, handle)
VALUES
  ('c0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000a','meta_ads','Account A1','@a1'),
  ('c0000000-0000-0000-0000-00000000000b','a0000000-0000-0000-0000-00000000000b','meta_ads','Account B1','@b1');

-- ---------------------------------------------------------------------------
-- Helper: switch to authenticated role with given user id
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;

CREATE OR REPLACE FUNCTION pg_temp.act_as_admin() RETURNS void
LANGUAGE plpgsql AS $$ BEGIN EXECUTE 'RESET ROLE'; END $$;

-- ===========================================================================
-- TEST 1. Admin can manage any client.
-- ===========================================================================
SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000001');

SELECT lives_ok(
  $$INSERT INTO public.external_accounts (client_id, platform, display_name, handle)
    VALUES ('a0000000-0000-0000-0000-00000000000b','google_ads','Admin can manage B','@admin-b1')$$,
  'TEST 1 — admin inserts account for Client B'
);
SELECT lives_ok(
  $$UPDATE public.external_accounts SET display_name='Admin Renamed'
      WHERE id='c0000000-0000-0000-0000-00000000000a'$$,
  'TEST 1 — admin updates Client A account'
);
SELECT is(
  (SELECT count(*)::int FROM public.external_accounts
    WHERE client_id='a0000000-0000-0000-0000-00000000000b'),
  2, 'TEST 1 — admin sees all Client B accounts'
);

-- ===========================================================================
-- TEST 2. Assigned manager manages Client A.
-- ===========================================================================
SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000002');

SELECT lives_ok(
  $$INSERT INTO public.external_accounts (client_id, platform, display_name, handle)
    VALUES ('a0000000-0000-0000-0000-00000000000a','tiktok','Manager insert A','@mgr-a')$$,
  'TEST 2 — assigned manager inserts for Client A'
);
SELECT lives_ok(
  $$UPDATE public.external_accounts SET display_name='Manager Renamed'
      WHERE id='c0000000-0000-0000-0000-00000000000a'$$,
  'TEST 2 — assigned manager updates Client A account'
);

-- ===========================================================================
-- TEST 3. Unassigned manager cannot see or write Client B.
-- ===========================================================================
SELECT pg_temp.act_as('a0000000-0000-0000-0000-00000000000e');

SELECT is(
  (SELECT count(*)::int FROM public.external_accounts
    WHERE client_id='a0000000-0000-0000-0000-00000000000b'),
  0, 'TEST 3 — unassigned manager cannot SELECT Client B accounts'
);

DO $$
DECLARE _n int;
BEGIN
  INSERT INTO public.external_accounts (client_id, platform, display_name, handle)
  VALUES ('a0000000-0000-0000-0000-00000000000b','instagram','Should fail','@nope');
EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
END $$;

SELECT is(
  (SELECT count(*)::int FROM (SELECT 1 FROM public.external_accounts
      WHERE handle='@nope') s),
  0, 'TEST 3 — unassigned manager cannot INSERT for Client B'
);

-- ===========================================================================
-- TEST 4. Design/traffic assigned: read yes, write no.
-- ===========================================================================
SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000003');  -- design A

SELECT cmp_ok(
  (SELECT count(*)::int FROM public.external_accounts
     WHERE client_id='a0000000-0000-0000-0000-00000000000a'),
  '>', 0,
  'TEST 4 — design (assigned) can SELECT Client A accounts'
);

DO $$
BEGIN
  INSERT INTO public.external_accounts (client_id, platform, display_name, handle)
  VALUES ('a0000000-0000-0000-0000-00000000000a','youtube','Design should fail','@design-fail');
EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
END $$;
SELECT is(
  (SELECT count(*)::int FROM public.external_accounts WHERE handle='@design-fail'),
  0, 'TEST 4 — design cannot INSERT'
);

DO $$
BEGIN
  UPDATE public.external_accounts SET display_name='design tried'
    WHERE id='c0000000-0000-0000-0000-00000000000a';
EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
END $$;
SELECT is(
  (SELECT count(*)::int FROM public.external_accounts
    WHERE id='c0000000-0000-0000-0000-00000000000a' AND display_name='design tried'),
  0, 'TEST 4 — design cannot UPDATE'
);

SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000004');  -- traffic A

SELECT cmp_ok(
  (SELECT count(*)::int FROM public.external_accounts
     WHERE client_id='a0000000-0000-0000-0000-00000000000a'),
  '>', 0,
  'TEST 4 — traffic (assigned) can SELECT Client A accounts'
);

DO $$
BEGIN
  INSERT INTO public.external_accounts (client_id, platform, display_name, handle)
  VALUES ('a0000000-0000-0000-0000-00000000000a','linkedin','Traffic should fail','@traffic-fail');
EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
END $$;
SELECT is(
  (SELECT count(*)::int FROM public.external_accounts WHERE handle='@traffic-fail'),
  0, 'TEST 4 — traffic cannot INSERT'
);

-- ===========================================================================
-- TEST 5. Client A sees only own accounts.
-- ===========================================================================
SELECT pg_temp.act_as('a0000000-0000-0000-0000-00000000000a');

SELECT is(
  (SELECT count(*)::int FROM public.external_accounts
    WHERE client_id='a0000000-0000-0000-0000-00000000000b'),
  0, 'TEST 5 — client A sees zero Client B accounts'
);
SELECT cmp_ok(
  (SELECT count(*)::int FROM public.external_accounts
    WHERE client_id='a0000000-0000-0000-0000-00000000000a'),
  '>', 0,
  'TEST 5 — client A sees own accounts'
);

-- Client cannot manage even own accounts (no manager role).
DO $$
BEGIN
  INSERT INTO public.external_accounts (client_id, platform, display_name, handle)
  VALUES ('a0000000-0000-0000-0000-00000000000a','tiktok','Client tries','@self');
EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
END $$;
SELECT is(
  (SELECT count(*)::int FROM public.external_accounts WHERE handle='@self'),
  0, 'TEST 5 — client cannot INSERT own account (needs manager)'
);

-- ===========================================================================
-- TEST 6. Accidental staff-style assignment of client_A to Client B does not
--         unlock Client B. (Clients are gated by explicit client role match.)
-- ===========================================================================
SELECT pg_temp.act_as_admin();
INSERT INTO public.team_client_assignments (user_id, client_id)
VALUES ('a0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000b')
ON CONFLICT DO NOTHING;

SELECT pg_temp.act_as('a0000000-0000-0000-0000-00000000000a');

SELECT is(
  (SELECT count(*)::int FROM public.external_accounts
    WHERE client_id='a0000000-0000-0000-0000-00000000000b'),
  0, 'TEST 6 — misplaced assignment does NOT expose Client B to Client A'
);

-- ===========================================================================
-- TEST 7. Cross SELECT returns zero rows (assigned manager A -> Client B).
-- ===========================================================================
SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000002');
SELECT is(
  (SELECT count(*)::int FROM public.external_accounts
    WHERE client_id='a0000000-0000-0000-0000-00000000000b'),
  0, 'TEST 7 — cross-client SELECT returns 0 rows'
);

-- ===========================================================================
-- TEST 8. Cross INSERT/UPDATE/DELETE do not alter data.
-- ===========================================================================
SELECT pg_temp.act_as_admin();
SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
CREATE TEMP TABLE _snap AS
SELECT id, display_name FROM public.external_accounts
 WHERE client_id='a0000000-0000-0000-0000-00000000000b';

SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000002'); -- manager A

DO $$ BEGIN
  INSERT INTO public.external_accounts (client_id, platform, display_name, handle)
  VALUES ('a0000000-0000-0000-0000-00000000000b','tiktok','Cross insert','@x');
EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL; END $$;

DO $$ BEGIN
  UPDATE public.external_accounts SET display_name='hacked'
    WHERE client_id='a0000000-0000-0000-0000-00000000000b';
EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL; END $$;

DO $$ BEGIN
  DELETE FROM public.external_accounts
    WHERE client_id='a0000000-0000-0000-0000-00000000000b';
EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL; END $$;

SELECT pg_temp.act_as_admin();
SELECT is(
  (SELECT count(*)::int FROM public.external_accounts a
     JOIN _snap s USING (id) WHERE a.display_name = s.display_name),
  (SELECT count(*)::int FROM _snap),
  'TEST 8 — Client B accounts unchanged after cross writes'
);
SELECT is(
  (SELECT count(*)::int FROM public.external_accounts
     WHERE handle='@x'),
  0, 'TEST 8 — cross INSERT did not persist'
);

-- ===========================================================================
-- TEST 9. Forged created_by is overwritten to auth.uid().
-- ===========================================================================
SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000002');  -- manager A

INSERT INTO public.external_accounts (client_id, platform, display_name, handle, created_by)
VALUES ('a0000000-0000-0000-0000-00000000000a','facebook','Forge test','@forge',
        'a0000000-0000-0000-0000-000000000001'); -- forged as admin

SELECT is(
  (SELECT created_by FROM public.external_accounts WHERE handle='@forge'),
  'a0000000-0000-0000-0000-000000000002'::uuid,
  'TEST 9 — created_by forged value replaced by auth.uid()'
);

-- ===========================================================================
-- TEST 10. Immutability: id, client_id, created_at, created_by.
-- ===========================================================================
SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000001'); -- admin

SELECT throws_like(
  $$UPDATE public.external_accounts SET client_id='a0000000-0000-0000-0000-00000000000b'
      WHERE id='c0000000-0000-0000-0000-00000000000a'$$,
  '%client_id is immutable%',
  'TEST 10 — client_id immutable'
);
SELECT throws_like(
  $$UPDATE public.external_accounts SET id='c0000000-0000-0000-0000-0000000000cc'
      WHERE id='c0000000-0000-0000-0000-00000000000a'$$,
  '%id is immutable%',
  'TEST 10 — id immutable'
);
SELECT throws_like(
  $$UPDATE public.external_accounts SET created_at=now() - interval '1 year'
      WHERE id='c0000000-0000-0000-0000-00000000000a'$$,
  '%created_at is immutable%',
  'TEST 10 — created_at immutable'
);
SELECT throws_like(
  $$UPDATE public.external_accounts SET created_by='a0000000-0000-0000-0000-00000000000b'
      WHERE id='c0000000-0000-0000-0000-00000000000a'$$,
  '%created_by is immutable%',
  'TEST 10 — created_by immutable'
);

-- ===========================================================================
-- TEST 11. Duplicate handle blocked even with different external_id.
-- ===========================================================================
SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000002');  -- manager A

INSERT INTO public.external_accounts (client_id, platform, display_name, handle, external_id)
VALUES ('a0000000-0000-0000-0000-00000000000a','meta_ads','Handle dup base','@dup-handle','111');

SELECT throws_ok(
  $$INSERT INTO public.external_accounts (client_id, platform, display_name, handle, external_id)
    VALUES ('a0000000-0000-0000-0000-00000000000a','meta_ads','Handle dup other','@dup-handle','222')$$,
  '23505',
  NULL,
  'TEST 11 — duplicate handle blocked despite different external_id'
);

-- Case-insensitive
SELECT throws_ok(
  $$INSERT INTO public.external_accounts (client_id, platform, display_name, handle, external_id)
    VALUES ('a0000000-0000-0000-0000-00000000000a','meta_ads','Handle case','@DUP-HANDLE','333')$$,
  '23505',
  NULL,
  'TEST 11 — duplicate handle case-insensitive blocked'
);

-- ===========================================================================
-- Bonus structural: composite FK enforces same client_id in link table.
-- ===========================================================================
SELECT pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
SELECT throws_ok(
  $$INSERT INTO public.project_external_accounts (client_id, project_id, external_account_id)
    VALUES ('a0000000-0000-0000-0000-00000000000a',
            'b0000000-0000-0000-0000-00000000000a',
            'c0000000-0000-0000-0000-00000000000b')$$,
  '23503',
  NULL,
  'BONUS — composite FK blocks linking account of Client B to Client A project'
);

SELECT * FROM finish();
ROLLBACK;
