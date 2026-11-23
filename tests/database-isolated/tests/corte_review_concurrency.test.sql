-- Executed by the CI runner around the shared pgTAP setup.
SET statement_timeout = '60s';
DO $$
BEGIN
  IF current_database() <> 'postgres' OR inet_server_addr() IS NULL
     OR session_user <> 'postgres' OR current_setting('is_superuser') <> 'on' THEN
    RAISE EXCEPTION 'Disposable Supabase with local superuser required';
  END IF;
END $$;

-- Preserve trigger modes because the shared fixture disables these triggers.
CREATE TEMP TABLE corte_trigger_modes AS
SELECT tgrelid, tgname, tgenabled
FROM pg_trigger
WHERE tgrelid IN ('public.profiles'::regclass, 'public.tasks'::regclass)
  AND NOT tgisinternal AND tgenabled <> 'D';
\echo preflight passed

-- CI_CORTE_RUN_RACE
SELECT * FROM finish(true);
SELECT format('ALTER TABLE %s ENABLE %s TRIGGER %I', tgrelid::regclass,
              CASE tgenabled WHEN 'R' THEN 'REPLICA' WHEN 'A' THEN 'ALWAYS' ELSE '' END, tgname)
FROM corte_trigger_modes
\gexec

CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
-- The workers need to see the finalized upload and staff fixture.
COMMIT;
SET search_path = public, extensions;
\echo fixture committed

SELECT dblink_connect(name, format(
  'hostaddr=127.0.0.1 port=%s dbname=postgres user=postgres password=postgres connect_timeout=5 application_name=%s',
  current_setting('port'), name))
FROM unnest(ARRAY['corte_a', 'corte_b']) AS workers(name);
SELECT dblink_exec(name, 'SET statement_timeout = ''15s''')
FROM unnest(ARRAY['corte_a', 'corte_b']) AS workers(name);

CREATE TEMP TABLE corte_race AS
SELECT a.pid AS a_pid, b.pid AS b_pid, s1.upload_id, f1.file_id,
       format('WITH f1 AS (SELECT %L::uuid AS file_id) %s', f1.file_id, p.prosrc) AS child_insert
FROM dblink('corte_a', 'SELECT pg_backend_pid()') AS a(pid integer)
CROSS JOIN dblink('corte_b', 'SELECT pg_backend_pid()') AS b(pid integer)
CROSS JOIN s1 CROSS JOIN f1
CROSS JOIN pg_proc AS p
WHERE p.oid = 'pg_temp.fixture_filho_entre_projetos()'::regprocedure;

SELECT dblink_exec('corte_a', 'SET ROLE service_role');
SELECT dblink_exec('corte_b', 'SET ROLE authenticated');
SELECT dblink_exec('corte_b', $$SET request.jwt.claim.sub = 'a7000000-0000-4000-8000-000000000003'$$);
SELECT dblink_exec('corte_b', $$SET request.jwt.claim.role = 'authenticated'$$);

-- Control: the same staff insert succeeds before review. Roll it back in B.
SELECT dblink_exec('corte_b', 'BEGIN');
SELECT dblink_exec('corte_b', child_insert) FROM corte_race;
SELECT dblink_exec('corte_b', 'ROLLBACK');
\echo staff insert verified

SELECT dblink_exec('corte_a', 'BEGIN');
SELECT result.status FROM corte_race AS r
CROSS JOIN LATERAL dblink('corte_a', format(
  'SELECT status FROM public.mcp_project_video_request_review(%L, %L, %L)',
  'd7000000-0000-4000-8000-000000000001', r.upload_id, 'pgtap-idem-s1'
)) AS result(status text);

-- Poll the actual blocker, with a deadline and no fixed scheduling assumption.
DO $$
DECLARE
  race corte_race%ROWTYPE;
  deadline timestamptz := clock_timestamp() + interval '5 seconds';
BEGIN
  SELECT * INTO STRICT race FROM corte_race;
  IF dblink_send_query('corte_b', race.child_insert) <> 1 THEN
    RAISE EXCEPTION 'Could not send concurrent child insertion';
  END IF;
  LOOP
    EXIT WHEN race.a_pid = ANY(pg_blocking_pids(race.b_pid));
    IF dblink_is_busy('corte_b') = 0 OR clock_timestamp() >= deadline THEN
      RAISE EXCEPTION 'Child insertion did not wait for the review transaction';
    END IF;
    PERFORM pg_sleep(0.02);
  END LOOP;
END $$;
\echo blocking verified

SELECT dblink_exec('corte_a', 'COMMIT');
SELECT * FROM dblink_get_result('corte_b', false) AS result(status text);
DO $$
DECLARE
  target uuid := (SELECT file_id FROM corte_race);
BEGIN
  IF split_part(dblink_error_message('corte_b'), E'\n', 1)
     !~ '^ERROR:[[:blank:]]+carousel children can only be added before review$' THEN
    RAISE EXCEPTION 'Child insertion was not rejected by the review guard';
  END IF;
  IF NOT EXISTS (
    SELECT FROM public.files WHERE id = target AND agency_approval_status = 'pending'
      AND visibility = 'internal' AND approval_status = 'none' AND locked_at IS NULL
  ) OR EXISTS (
    SELECT FROM public.files WHERE parent_file_id = target OR revision_of_file_id = target
  ) OR NOT EXISTS (
    SELECT FROM public.mcp_project_video_uploads WHERE file_id = target AND status = 'review_requested'
  ) OR (SELECT count(*) FROM public.file_approval_events WHERE file_id = target) <> 1
    OR NOT EXISTS (
      SELECT FROM public.file_approval_events WHERE file_id = target AND event_type = 'agency_review_requested'
        AND actor_id = 'a7000000-0000-4000-8000-000000000002' AND to_status = 'pending'
    ) THEN
    RAISE EXCEPTION 'Unexpected Corte state after the concurrent operations';
  END IF;
END $$;
SELECT dblink_disconnect('corte_a');
SELECT dblink_disconnect('corte_b');
\echo postconditions passed
