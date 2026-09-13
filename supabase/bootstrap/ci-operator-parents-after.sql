-- Freeze only the two CI fixtures immediately after the unchanged organogram.
-- Keep all six historical audit INSERTs and every operator row.
DO $ci$
DECLARE changed integer;
BEGIN
  IF session_user <> 'postgres'
     OR NOT (current_database()='postgres' OR current_database() LIKE 'acq_isolated_%')
     OR to_regclass('aceleriq_ci_replay.operator_parent_attestation') IS NULL THEN
    RAISE EXCEPTION 'CI_OPERATOR_PARENTS_REQUIRE_ISOLATED_REPLAY';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM aceleriq_ci_replay.operator_parent_attestation WHERE NOT frozen)
     OR EXISTS(SELECT 1 FROM public.operator_runs)
     OR EXISTS(SELECT 1 FROM public.operator_task_links)
     OR (SELECT count(*) FROM public.internal_operators) <> 6
     OR (SELECT count(*) FROM public.operator_audit_log) <> 6
     OR (SELECT count(*) FROM public.operator_audit_log
       WHERE actor='carga inicial do organograma' AND action LIKE 'organograma atualizado: %') <> 6
     OR EXISTS(SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
       AND tgrelid='public.internal_operators'::regclass AND (tgtype & 16) <> 0) THEN
    RAISE EXCEPTION 'CI_OPERATOR_PARENTS_UNEXPECTED_ACTIVITY';
  END IF;
  IF (SELECT jsonb_agg(to_jsonb(o)-ARRAY['display_name','role','area','parent_slug','display_order','is_coordinator','status'] ORDER BY slug)
      FROM public.internal_operators o WHERE slug NOT IN ('default','atlas'))
      IS DISTINCT FROM (SELECT pilot_stable_fields FROM aceleriq_ci_replay.operator_parent_attestation)
     OR EXISTS(SELECT 1 FROM (VALUES ('default',NULL::text),('augusto','default'),
       ('atlas','augusto'),('vertice','atlas'),('registro','atlas'),('prisma','atlas')) expected(slug,parent_slug)
       LEFT JOIN public.internal_operators o USING(slug)
       WHERE o.id IS NULL OR o.parent_slug IS DISTINCT FROM expected.parent_slug OR o.status <> 'active') THEN
    RAISE EXCEPTION 'CI_OPERATOR_PARENTS_ORGANOGRAM_NOT_PRESERVED';
  END IF;
  UPDATE public.internal_operators SET status='inactive'
    WHERE slug IN ('default','atlas') AND id=md5('aceleriq-ci-operator-'||slug)::uuid
      AND scope='CI synthetic organogram prerequisite; no runtime'
      AND permissions='{}'::jsonb AND hermes_profile_ref='' AND last_run_at IS NULL;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed <> 2 THEN RAISE EXCEPTION 'CI_OPERATOR_PARENTS_FIXTURE_IDENTITY_MISMATCH'; END IF;
  UPDATE aceleriq_ci_replay.operator_parent_attestation SET frozen=true;
END
$ci$;
