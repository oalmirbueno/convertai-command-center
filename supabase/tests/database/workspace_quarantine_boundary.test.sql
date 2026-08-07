-- Workspace inbox quarantine, token TTL and audited release boundary.
-- Synthetic fixtures run inside BEGIN/ROLLBACK and never touch production.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT * FROM no_plan();

ALTER TABLE public.profiles DISABLE TRIGGER USER;

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
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.workspace_nodes'::regclass
      AND conname = 'workspace_nodes_inbox_token_max_ttl_ck'
  ),
  'Workspace inbox links have a seven-day maximum TTL constraint'
);

SELECT is(
  has_function_privilege(
    'anon',
    'public.mark_workspace_inbox_scan_clean(uuid,text)',
    'EXECUTE'
  ),
  false,
  'anon cannot release quarantined files'
);

SELECT is(
  has_function_privilege(
    'authenticated',
    'public.mark_workspace_inbox_scan_clean(uuid,text)',
    'EXECUTE'
  ),
  true,
  'authenticated reaches the RPC, which performs its own admin authorization'
);

SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
   FROM pg_class
   WHERE oid = 'public.workspace_inbox_scan_events'::regclass),
  'scan audit events have enabled and forced RLS'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'workspace_inbox_scan_events'
      AND grantee = 'authenticated'
  ),
  0,
  'authenticated cannot read or write the private scan audit ledger'
);

INSERT INTO auth.users (id, email)
VALUES
  ('d0000000-0000-0000-0000-000000000001', 'quarantine-admin@test.local'),
  ('d0000000-0000-0000-0000-000000000002', 'quarantine-manager@test.local');

DELETE FROM public.user_roles
WHERE user_id IN (
  'd0000000-0000-0000-0000-000000000001',
  'd0000000-0000-0000-0000-000000000002'
);

INSERT INTO public.user_roles (user_id, role)
VALUES
  ('d0000000-0000-0000-0000-000000000001', 'admin'),
  ('d0000000-0000-0000-0000-000000000002', 'manager');

INSERT INTO public.workspace_nodes (
  id,
  scope,
  kind,
  name,
  storage_path,
  created_by,
  inbox_scan_status
)
VALUES
  (
    'd1000000-0000-0000-0000-000000000001',
    'global',
    'file',
    'pending.pdf',
    'global/global/inbox/d1000000-0000-0000-0000-000000000001.pdf',
    'd0000000-0000-0000-0000-000000000001',
    'pending'
  ),
  (
    'd1000000-0000-0000-0000-000000000002',
    'global',
    'file',
    'blocked.pdf',
    'global/global/inbox/d1000000-0000-0000-0000-000000000002.pdf',
    'd0000000-0000-0000-0000-000000000001',
    'blocked'
  );

SELECT is(
  public.workspace_storage_object_is_releasable(
    'global/global/inbox/d1000000-0000-0000-0000-000000000001.pdf'
  ),
  false,
  'pending inbox object is rejected by the predicate prepared for cutover'
);

SELECT pg_temp.act_as('d0000000-0000-0000-0000-000000000002');

SELECT lives_ok(
  $$
    UPDATE public.workspace_nodes
    SET inbox_scan_status = 'clean'
    WHERE id = 'd1000000-0000-0000-0000-000000000001'
  $$,
  'EXPAND preserves the legacy direct transition until UI and Edge cut over'
);

UPDATE public.workspace_nodes
SET inbox_scan_status = 'pending'
WHERE id = 'd1000000-0000-0000-0000-000000000001';

SELECT throws_ok(
  $$
    SELECT public.mark_workspace_inbox_scan_clean(
      'd1000000-0000-0000-0000-000000000001',
      'manager attempt'
    )
  $$,
  '42501',
  'WORKSPACE_INBOX_VERIFICATION_FORBIDDEN',
  'non-admin staff cannot release a pending file through the RPC'
);

SELECT pg_temp.act_as('d0000000-0000-0000-0000-000000000001');

SELECT lives_ok(
  $$
    SELECT public.mark_workspace_inbox_scan_clean(
      'd1000000-0000-0000-0000-000000000001',
      'verified by pgTAP'
    )
  $$,
  'admin can release a pending file through the audited RPC'
);

SELECT is(
  (
    SELECT inbox_scan_status
    FROM public.workspace_nodes
    WHERE id = 'd1000000-0000-0000-0000-000000000001'
  ),
  'clean',
  'audited RPC changes pending to clean'
);

SELECT pg_temp.act_as_owner();

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.workspace_inbox_scan_events
    WHERE node_id = 'd1000000-0000-0000-0000-000000000001'
      AND previous_status = 'pending'
      AND next_status = 'clean'
      AND method = 'manual_admin'
  ),
  1,
  'successful manual release appends one audit event'
);

SELECT is(
  public.workspace_storage_object_is_releasable(
    'global/global/inbox/d1000000-0000-0000-0000-000000000001.pdf'
  ),
  true,
  'clean inbox object becomes eligible for surrounding Storage policies'
);

SELECT pg_temp.act_as('d0000000-0000-0000-0000-000000000001');

SELECT throws_ok(
  $$
    SELECT public.mark_workspace_inbox_scan_clean(
      'd1000000-0000-0000-0000-000000000002',
      'blocked attempt'
    )
  $$,
  '22023',
  'WORKSPACE_INBOX_NOT_PENDING',
  'blocked files cannot transition directly to clean'
);

SELECT * FROM finish();
ROLLBACK;
