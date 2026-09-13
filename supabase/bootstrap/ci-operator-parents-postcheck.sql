-- Read-only postcondition for the complete CI schema, after supabase start.
-- This file is never staged as a production migration.
DO $ci$
DECLARE relation_name text; activity boolean;
BEGIN
  IF session_user <> 'postgres'
     OR NOT (current_database()='postgres' OR current_database() LIKE 'acq_isolated_%')
     OR to_regclass('aceleriq_ci_replay.operator_parent_attestation') IS NULL THEN
    RAISE EXCEPTION 'CI_OPERATOR_POSTCHECK_REQUIRES_ISOLATED_REPLAY';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM aceleriq_ci_replay.operator_parent_attestation WHERE frozen)
     OR (SELECT count(*) FROM public.internal_operators
       WHERE slug IN ('default','atlas') AND status='inactive'
       AND id=md5('aceleriq-ci-operator-'||slug)::uuid
       AND permissions='{}'::jsonb AND hermes_profile_ref='' AND last_run_at IS NULL
       AND scope='CI synthetic organogram prerequisite; no runtime') <> 2 THEN
    RAISE EXCEPTION 'CI_OPERATOR_POSTCHECK_PARENTS_NOT_INERT';
  END IF;
  -- All six real tables use operator_id, verified in their canonical migrations.
  FOREACH relation_name IN ARRAY ARRAY['operator_task_links','operator_runs',
    'operator_approvals','operator_participations','assignment_proposals','operator_deliveries'] LOOP
    IF to_regclass('public.'||relation_name) IS NULL THEN
      RAISE EXCEPTION 'CI_OPERATOR_POSTCHECK_MISSING_TABLE: %',relation_name;
    END IF;
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I t JOIN public.internal_operators o ON o.id=t.operator_id WHERE o.slug IN (''default'',''atlas''))',relation_name)
      INTO activity;
    IF activity THEN RAISE EXCEPTION 'CI_OPERATOR_POSTCHECK_UNEXPECTED_ACTIVITY: %',relation_name; END IF;
  END LOOP;
  RAISE NOTICE 'CI operator parents remain inactive without runtime bindings, links, runs, approvals, participations, proposals or deliveries';
END
$ci$;
