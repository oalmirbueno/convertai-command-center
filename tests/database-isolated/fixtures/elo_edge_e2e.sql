-- Synthetic fixture for scripts/test-ci-elo-edge.mjs (real mcp-server Edge on loopback).
-- Not part of test-isolated-db.mjs. It COMMITs because PostgREST uses its own connections.
-- Every ID and the API key hash are random per run and arrive as psql variables; the emails
-- are @test.local. The key is RESTRICTED: owned by a non-admin staff member assigned only to
-- client X, scopes escritorio:identity + tasks:read, and bound to exactly one agent (elo).
-- The script removes the binding and deactivates the key at the end.
SET statement_timeout = '30s';
DO $$
BEGIN
  IF current_database() <> 'postgres' OR inet_server_addr() IS NULL OR session_user <> 'postgres'
     OR to_regclass('aceleriq_ci_replay.background_job_attestation') IS NULL THEN
    RAISE EXCEPTION 'Disposable Supabase required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM aceleriq_ci_replay.background_job_attestation)
     OR EXISTS (SELECT 1 FROM cron.job WHERE active) THEN
    RAISE EXCEPTION 'Disposable Supabase jobs must be paused';
  END IF;
END $$;

BEGIN;
-- The pgTAP fixture disables these USER triggers. Restore the exact modes before COMMIT.
CREATE TEMP TABLE elo_edge_trigger_modes ON COMMIT DROP AS
SELECT tgrelid, tgname, tgenabled
FROM pg_trigger
WHERE tgrelid IN ('public.profiles'::regclass, 'public.tasks'::regclass)
  AND NOT tgisinternal AND tgenabled <> 'D';
ALTER TABLE public.profiles DISABLE TRIGGER USER;
ALTER TABLE public.tasks DISABLE TRIGGER USER;

INSERT INTO auth.users (id, email) VALUES
  (:'staff_id',    'elo-edge.equipe+'   || :'suffix' || '@test.local'),
  (:'client_x_id', 'elo-edge.cliente-x+' || :'suffix' || '@test.local'),
  (:'client_y_id', 'elo-edge.cliente-y+' || :'suffix' || '@test.local');
DELETE FROM public.user_roles WHERE user_id IN (:'staff_id', :'client_x_id', :'client_y_id');
-- Key owner is internal staff but NOT admin: the key gets a restricted client scope.
INSERT INTO public.user_roles (user_id, role) VALUES
  (:'staff_id', 'design'), (:'client_x_id', 'client'), (:'client_y_id', 'client');
-- Only client X is assigned. Client Y must stay outside the key's data scope.
INSERT INTO public.team_client_assignments (user_id, client_id) VALUES (:'staff_id', :'client_x_id');

INSERT INTO public.projects (id, client_id, name, project_type, status, progress, start_date, deadline, billing_mode) VALUES
  (:'project_x_id', :'client_x_id', 'Elo Edge CI X', 'recurring', 'active', 0, current_date, current_date + 30, 'included'),
  (:'project_y_id', :'client_y_id', 'Elo Edge CI Y', 'recurring', 'active', 0, current_date, current_date + 30, 'included');
INSERT INTO public.tasks (id, project_id, title, status, priority, source) VALUES
  (:'task_x_id', :'project_x_id', 'Tarefa sintética X', 'todo', 'medium', 'portal'),
  (:'task_y_id', :'project_y_id', 'Tarefa sintética Y', 'todo', 'medium', 'portal');

INSERT INTO public.internal_operators (slug, display_name, role, scope, hermes_profile_ref)
VALUES ('elo', 'Elo (sintético)', 'Elo com clientes', 'Identidade', 'hermes:ci-elo-edge')
ON CONFLICT (slug) DO NOTHING;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.internal_operators WHERE slug = 'elo' AND status = 'active') THEN
    RAISE EXCEPTION 'Synthetic Elo operator is not active';
  END IF;
END $$;

INSERT INTO public.api_keys (id, name, key_hash, key_preview, scopes, origin, audience, created_by)
VALUES (:'key_id', 'CI Elo Edge sintética', :'key_hash', 'ci-elo', ARRAY['escritorio:identity', 'tasks:read'], NULL, 'mcp', :'staff_id');
-- Exactly one binding, the default: the restricted identity requires a single active link.
INSERT INTO public.operator_key_bindings (principal, operator_slug, padrao, rotulo)
VALUES ('key:' || :'key_id', 'elo', true, 'CI Elo Edge sintética');
-- psql does not substitute variables inside DO blocks; the owner's roles were recreated above
-- as 'design' only, and the script re-checks owner_is_admin through the real Edge scope.

SELECT format('ALTER TABLE %s ENABLE %s TRIGGER %I', tgrelid::regclass,
              CASE tgenabled WHEN 'R' THEN 'REPLICA' WHEN 'A' THEN 'ALWAYS' ELSE '' END, tgname)
FROM elo_edge_trigger_modes
\gexec
COMMIT;
\echo elo edge fixture committed
