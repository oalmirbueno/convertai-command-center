-- Synthetic fixture for scripts/test-ci-corte-edge.mjs (real mcp-server Edge on loopback).
-- Not part of test-isolated-db.mjs. It COMMITs because PostgREST and Storage use their own
-- connections. Every ID and the API key hash are random per run and arrive as psql variables;
-- the emails are @test.local. The script revokes the key, grant, author link and attestation
-- before the Corte race step inserts its own fixture. Mirrors mcp_project_video_upload.test.sql.
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
CREATE TEMP TABLE corte_edge_trigger_modes ON COMMIT DROP AS
SELECT tgrelid, tgname, tgenabled
FROM pg_trigger
WHERE tgrelid IN ('public.profiles'::regclass, 'public.tasks'::regclass)
  AND NOT tgisinternal AND tgenabled <> 'D';
ALTER TABLE public.profiles DISABLE TRIGGER USER;
ALTER TABLE public.tasks DISABLE TRIGGER USER;

INSERT INTO auth.users (id, email) VALUES
  (:'admin_id',  'corte-edge.admin+'  || :'suffix' || '@test.local'),
  (:'author_id', 'corte-edge.agente+' || :'suffix' || '@test.local'),
  (:'staff_id',  'corte-edge.humano+' || :'suffix' || '@test.local'),
  (:'client_id', 'corte-edge.cliente+' || :'suffix' || '@test.local');
DELETE FROM public.user_roles WHERE user_id IN (:'admin_id', :'author_id', :'staff_id', :'client_id');
INSERT INTO public.user_roles (user_id, role) VALUES
  (:'admin_id', 'admin'), (:'author_id', 'design'), (:'staff_id', 'design'), (:'client_id', 'client');
INSERT INTO public.team_client_assignments (user_id, client_id) VALUES
  (:'author_id', :'client_id'), (:'staff_id', :'client_id');

INSERT INTO public.projects (id, client_id, name, project_type, status, progress, start_date, deadline, billing_mode) VALUES
  (:'project_id',       :'client_id', 'Corte Edge CI', 'recurring', 'active', 0, current_date, current_date + 30, 'included'),
  (:'other_project_id', :'client_id', 'Corte Edge CI fora', 'recurring', 'active', 0, current_date, current_date + 30, 'included');
INSERT INTO public.tasks (id, project_id, title, status, priority, source) VALUES
  (:'task_id',       :'project_id',       'Reel sintético Edge', 'todo', 'medium', 'portal'),
  (:'other_task_id', :'other_project_id', 'Reel sintético fora', 'todo', 'medium', 'portal');

INSERT INTO public.internal_operators (slug, display_name, role, scope, hermes_profile_ref)
VALUES ('corte', 'Corte (sintético)', 'Edição de vídeo', 'Cortes', 'hermes:ci-corte-edge')
ON CONFLICT (slug) DO NOTHING;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.internal_operators WHERE slug = 'corte' AND status = 'active') THEN
    RAISE EXCEPTION 'Synthetic Corte operator is not active';
  END IF;
END $$;

-- Human attachment on the same task: it must never enter the agent review request.
INSERT INTO public.files (id, client_id, project_id, uploaded_by, file_name, file_url, storage_bucket, storage_path, status, file_type, folder)
VALUES (:'human_file_id', :'client_id', :'project_id', :'staff_id', 'humano.mp4',
        'mcp-files://' || :'client_id' || '/humano/humano.mp4', 'mcp-files', :'client_id' || '/humano/humano.mp4',
        'ready', 'video', 'materiais');
INSERT INTO public.task_attachments (task_id, file_name, file_url, file_type, uploaded_by)
VALUES (:'task_id', 'humano.mp4', 'mcp-files://' || :'client_id' || '/humano/humano.mp4', 'video/mp4', :'staff_id');

INSERT INTO public.api_keys (id, name, key_hash, key_preview, scopes, origin, audience, created_by)
VALUES (:'key_id', 'CI Corte Edge sintética', :'key_hash', 'ci-edge', ARRAY['mcp:project'], NULL, 'mcp', :'admin_id');
INSERT INTO public.mcp_project_grants (api_key_id, project_id, client_id, operator_slug, allow_video_upload, created_by)
VALUES (:'key_id', :'project_id', :'client_id', 'corte', true, :'admin_id');

UPDATE auth.users
   SET raw_app_meta_data = jsonb_build_object('aceleriq_mcp_author_operator', 'corte'),
       banned_until = now() + interval '1 day'
 WHERE id = :'author_id';
INSERT INTO public.mcp_agent_author_attestations (operator_slug, profile_id, declaracao, attested_by)
VALUES ('corte', :'author_id', 'perfil-exclusivo-do-agente:sem-uso-humano:sem-outra-funcao', :'admin_id');
INSERT INTO public.mcp_operator_author_profiles (operator_slug, profile_id, configured_by)
VALUES ('corte', :'author_id', :'admin_id');

SELECT format('ALTER TABLE %s ENABLE %s TRIGGER %I', tgrelid::regclass,
              CASE tgenabled WHEN 'R' THEN 'REPLICA' WHEN 'A' THEN 'ALWAYS' ELSE '' END, tgname)
FROM corte_edge_trigger_modes
\gexec
COMMIT;
\echo corte edge fixture committed
