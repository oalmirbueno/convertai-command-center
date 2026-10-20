-- Disposable CI only. Preserve every scheduled job, but keep background
-- workers paused while synthetic browser fixtures exercise the application.
DO $ci$
DECLARE before_hash text; after_hash text; job_count integer;
BEGIN
  IF session_user <> 'postgres' OR current_database() <> 'postgres'
     OR current_setting('aceleriq.ci_pause_background',true) IS DISTINCT FROM 'on'
     OR to_regclass('aceleriq_ci_replay.operator_parent_attestation') IS NULL
     OR to_regclass('aceleriq_ci_replay.background_job_attestation') IS NOT NULL THEN
    RAISE EXCEPTION 'CI_BACKGROUND_REQUIRES_FRESH_ISOLATED_REPLAY';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM aceleriq_ci_replay.operator_parent_attestation WHERE frozen)
     OR EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM public.profiles)
     OR EXISTS(SELECT 1 FROM public.projects) OR EXISTS(SELECT 1 FROM public.tasks)
     OR EXISTS(SELECT 1 FROM public.user_roles) THEN
    RAISE EXCEPTION 'CI_BACKGROUND_REQUIRES_EMPTY_SYNTHETIC_STACK';
  END IF;
  SELECT md5(COALESCE(jsonb_agg(to_jsonb(j)-'active' ORDER BY j.jobid),'[]'::jsonb)::text),count(*)
    INTO before_hash,job_count FROM cron.job AS j;
  CREATE TABLE aceleriq_ci_replay.background_job_attestation(
    id boolean PRIMARY KEY DEFAULT true CHECK(id), metadata_hash text NOT NULL,
    job_count integer NOT NULL, paused_at timestamptz NOT NULL DEFAULT now()
  );
  REVOKE ALL ON aceleriq_ci_replay.background_job_attestation FROM PUBLIC,anon,authenticated,service_role;
  INSERT INTO aceleriq_ci_replay.background_job_attestation(metadata_hash,job_count)
    VALUES(before_hash,job_count);
  -- postgres cannot UPDATE the extension's table directly in Supabase. Use
  -- its owner-scoped API without elevating the CI connection's permissions.
  PERFORM cron.alter_job(jobid,active:=false) FROM cron.job WHERE active;
  SELECT md5(COALESCE(jsonb_agg(to_jsonb(j)-'active' ORDER BY j.jobid),'[]'::jsonb)::text)
    INTO after_hash FROM cron.job AS j;
  IF before_hash IS DISTINCT FROM after_hash OR EXISTS(SELECT 1 FROM cron.job WHERE active) THEN
    RAISE EXCEPTION 'CI_BACKGROUND_JOB_METADATA_CHANGED';
  END IF;
  RAISE NOTICE 'CI background jobs paused: %, definitions preserved; no production job changed',job_count;
END
$ci$;
