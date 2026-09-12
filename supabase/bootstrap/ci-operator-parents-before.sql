-- CI-only data prerequisite, materialized by prepare-ci-editorial-replay.mjs.
-- The immutable 20260828140000 organogram requires these two parent slugs.
-- No human account, runtime binding, task, order or execution is created.
DO $ci$
BEGIN
  IF session_user <> 'postgres'
     OR NOT (current_database()='postgres' OR current_database() LIKE 'acq_isolated_%')
     OR to_regclass('aceleriq_ci_replay.editorial_attestations') IS NULL THEN
    RAISE EXCEPTION 'CI_OPERATOR_PARENTS_REQUIRE_ISOLATED_REPLAY';
  END IF;
  IF (SELECT count(*) FROM aceleriq_ci_replay.editorial_attestations WHERE restored) <> 2
     OR to_regclass('aceleriq_ci_replay.operator_parent_attestation') IS NOT NULL
     OR EXISTS(SELECT 1 FROM public.operator_runs)
     OR EXISTS(SELECT 1 FROM public.operator_task_links)
     OR EXISTS(SELECT 1 FROM public.operator_audit_log)
     OR (SELECT array_agg(slug ORDER BY slug) FROM public.internal_operators)
       IS DISTINCT FROM ARRAY['augusto','prisma','registro','vertice']::text[] THEN
    RAISE EXCEPTION 'CI_OPERATOR_PARENTS_REQUIRE_EMPTY_PILOT';
  END IF;
  -- Fail closed if the reviewed INSERT/UPDATE operations could dispatch a trigger.
  IF EXISTS(SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
      AND ((tgrelid='public.internal_operators'::regclass AND (tgtype & 20) <> 0)
        OR (tgrelid='public.operator_audit_log'::regclass AND (tgtype & 4) <> 0))) THEN
    RAISE EXCEPTION 'CI_OPERATOR_PARENTS_UNREVIEWED_TRIGGER';
  END IF;
  CREATE TABLE aceleriq_ci_replay.operator_parent_attestation (
    singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
    pilot_stable_fields jsonb NOT NULL,
    frozen boolean NOT NULL DEFAULT false
  );
  REVOKE ALL ON aceleriq_ci_replay.operator_parent_attestation FROM PUBLIC,anon,authenticated,service_role;
  INSERT INTO aceleriq_ci_replay.operator_parent_attestation(pilot_stable_fields)
  SELECT jsonb_agg(to_jsonb(o)-ARRAY['display_name','role','area','parent_slug','display_order','is_coordinator','status'] ORDER BY slug)
  FROM public.internal_operators o;
  INSERT INTO public.internal_operators
    (id,slug,display_name,role,status,scope,permissions,hermes_profile_ref,last_run_at,parent_slug)
  SELECT md5('aceleriq-ci-operator-'||slug)::uuid,slug,'CI synthetic parent: '||slug,
    'CI prerequisite only','inactive','CI synthetic organogram prerequisite; no runtime',
    '{}'::jsonb,'',NULL,NULL
  FROM unnest(ARRAY['default','atlas']) slug;
END
$ci$;
