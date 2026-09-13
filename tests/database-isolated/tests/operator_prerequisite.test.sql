BEGIN;
DO $$ BEGIN
 IF current_database() NOT LIKE 'acq_isolated_%'
   OR current_setting('aceleriq.isolated_tests',true) IS DISTINCT FROM 'on' THEN
   RAISE EXCEPTION 'ISOLATED_DATABASE_REQUIRED';
 END IF;
END $$;
SELECT no_plan();
SELECT is((SELECT count(*)::integer FROM public.internal_operators),6,'exactly two parents added to the four canonical pilot operators');
SELECT ok((SELECT frozen FROM aceleriq_ci_replay.operator_parent_attestation),'post-migration prerequisite froze the synthetic parents');
SELECT is((SELECT count(*)::integer FROM public.internal_operators
 WHERE slug IN ('default','atlas') AND status='inactive'
 AND id=md5('aceleriq-ci-operator-'||slug)::uuid AND hermes_profile_ref=''
 AND permissions='{}'::jsonb AND last_run_at IS NULL
 AND scope='CI synthetic organogram prerequisite; no runtime'),2,'both parents have no runtime binding and are inactive');
SELECT is((SELECT jsonb_object_agg(slug,coalesce(parent_slug,'root')) FROM public.internal_operators),
 '{"default":"root","augusto":"default","atlas":"augusto","vertice":"atlas","registro":"atlas","prisma":"atlas"}'::jsonb,
 'the original guarded organogram ran for all six operators');
SELECT is((SELECT jsonb_agg(to_jsonb(o)-ARRAY['display_name','role','area','parent_slug','display_order','is_coordinator','status'] ORDER BY slug)
 FROM public.internal_operators o WHERE slug NOT IN ('default','atlas')),
 (SELECT pilot_stable_fields FROM aceleriq_ci_replay.operator_parent_attestation),
 'the four original operator identities, runtime references, permissions, scope and timestamps survive');
SELECT is((SELECT count(*)::integer FROM public.operator_audit_log
 WHERE actor='carga inicial do organograma' AND action LIKE 'organograma atualizado: %'),6,
 'all six audit rows written by the real organogram remain');
SELECT is((SELECT count(*)::integer FROM public.operator_task_links),0,'no task links created');
SELECT is((SELECT count(*)::integer FROM public.operator_runs),0,'no runs created');
SELECT is((SELECT count(*)::integer FROM net.publication_test_http),0,'no HTTP request emitted');
SELECT is((SELECT count(*)::integer FROM public.profiles),0,'no human or client profile fabricated');
SELECT is((SELECT count(*)::integer FROM public.user_roles),0,'no human role fabricated');
SELECT is((SELECT count(*)::integer FROM public.tasks),0,'no task or order created');
SELECT throws_ok($$SELECT public.operator_update('augusto','CI assertion',_parent_slug=>'missing-parent')$$,
 'P0001','parent_not_found: missing-parent nao e um operador conhecido','unknown parents are still refused by the real function');
SELECT throws_ok($$SELECT public.operator_update('default','CI assertion',_parent_slug=>'vertice')$$,
 'P0001','ciclo: vertice ja responde a default, direta ou indiretamente','hierarchy cycles are still refused');
SELECT throws_ok($$SELECT public.operator_report_event('default','heartbeat','ci-negative-only','CI assertion')$$,
 'P0001','operator_not_found: default nao e um operador interno ativo','inactive default cannot report or start a run');
SELECT throws_ok($$SELECT public.operator_report_event('atlas','started','ci-negative-only','CI assertion')$$,
 'P0001','operator_not_found: atlas nao e um operador interno ativo','inactive atlas cannot start a run');
SELECT throws_ok($$UPDATE public.operator_audit_log SET actor='CI forbidden update'$$,
 'P0001','operator_audit_log e imutavel: UPDATE nao e permitido','historical audit immutability trigger remains enabled');
SELECT is((SELECT count(*)::integer FROM public.operator_audit_log),6,'failed calls do not append or change audit history');
SELECT is((SELECT count(*)::integer FROM public.operator_runs)+(SELECT count(*)::integer FROM public.operator_task_links),0,
 'failed calls leave execution and queue tables empty');
SELECT is((public.operator_reconciliar_vinculos_gemeos()->>'gemeos_reconciliados')::integer,0,
 'reconciliation on the empty fixture is idempotent and has no deletion candidate');
SELECT * FROM finish();
ROLLBACK;
