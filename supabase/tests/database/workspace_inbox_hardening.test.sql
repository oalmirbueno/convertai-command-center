-- Workspace public inbox: schema, privilege and policy contract.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT * FROM no_plan();

SELECT has_column(
  'public',
  'workspace_nodes',
  'inbox_token_expires_at',
  'workspace inbox tokens have an expiration'
);

SELECT has_column(
  'public',
  'workspace_nodes',
  'inbox_scan_status',
  'public inbox uploads carry a quarantine status'
);

SELECT has_column(
  'public',
  'workspace_nodes',
  'inbox_token_generation',
  'workspace inbox rotation has a generation identifier'
);

SELECT has_table(
  'public',
  'workspace_inbox_upload_reservations',
  'workspace inbox has an upload reservation ledger'
);

SELECT ok(
  (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_class
    WHERE oid = 'public.workspace_inbox_upload_reservations'::regclass
  ),
  'workspace inbox reservation ledger forces RLS'
);

SELECT is(
  has_table_privilege(
    'authenticated',
    'public.workspace_inbox_upload_reservations',
    'SELECT'
  ),
  false,
  'authenticated users cannot enumerate public upload reservations'
);

SELECT is(
  has_function_privilege(
    'authenticated',
    'public.reserve_workspace_inbox_upload(uuid,bigint,uuid,text)',
    'EXECUTE'
  ),
  false,
  'authenticated users cannot reserve public inbox uploads directly'
);

SELECT is(
  has_function_privilege(
    'service_role',
    'public.reserve_workspace_inbox_upload(uuid,bigint,uuid,text)',
    'EXECUTE'
  ),
  true,
  'the Edge Function service role can reserve uploads'
);

SELECT is(
  has_function_privilege(
    'authenticated',
    'public.manage_workspace_inbox_token(uuid,text)',
    'EXECUTE'
  ),
  true,
  'authenticated staff can call the RLS-bound token manager'
);

SELECT is(
  has_function_privilege(
    'anon',
    'public.manage_workspace_inbox_token(uuid,text)',
    'EXECUTE'
  ),
  false,
  'anonymous users cannot rotate or revoke inbox tokens'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'workspace'
      AND public = false
  ),
  'portable schema includes a private workspace bucket'
);

SELECT * FROM finish();
ROLLBACK;
