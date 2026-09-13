-- Run ONLY against the disposable security_contract fixture + new migration.
-- The fixture has inert Vault/HTTP boundaries and only synthetic records.
BEGIN;
SET search_path = public, extensions;
DO $$ BEGIN
  IF current_setting('aceleriq.isolated_tests', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'ISOLATED_SECURITY_FIXTURE_REQUIRED';
  END IF;
END $$;
SELECT * FROM no_plan();

SELECT is((SELECT to_jsonb(p) FROM public.profiles p WHERE id='20000000-0000-4000-8000-000000000009'),
  (SELECT profile FROM public.security_test_before_migration),'migration preserves every existing profile field, including legacy columns');
SELECT is((SELECT to_jsonb(d) FROM public.client_dossiers d WHERE id='70000000-0000-4000-8000-000000000009'),
  (SELECT dossier FROM public.security_test_before_migration),'migration preserves the full existing dossier row');

-- These constants are synthetic UUIDs, not production client identifiers.
INSERT INTO public.profiles(id,full_name,company_name,plan_value,services_config,plan_renewal_date)
VALUES
 ('10000000-0000-4000-8000-000000000001','Admin fixture','Agency fixture',0,'{}','2026-10-01'),
 ('10000000-0000-4000-8000-000000000002','Design fixture','Agency fixture',0,'{}','2026-10-01'),
 ('10000000-0000-4000-8000-000000000003','Manager fixture','Agency fixture',0,'{}','2026-10-01'),
 ('10000000-0000-4000-8000-000000000004','Traffic fixture','Agency fixture',0,'{}','2026-10-01'),
 ('10000000-0000-4000-8000-000000000005','No assignment fixture','Agency fixture',0,'{}','2026-10-01'),
 ('20000000-0000-4000-8000-000000000001','Client A fixture','Company A fixture',597,'{"social":true}','2026-10-01'),
 ('20000000-0000-4000-8000-000000000002','Client B fixture','Company B fixture',1197,'{"trafego":true}','2026-10-02');
INSERT INTO public.user_roles VALUES
 ('10000000-0000-4000-8000-000000000001','admin'),
 ('10000000-0000-4000-8000-000000000002','design'),
 ('10000000-0000-4000-8000-000000000003','manager'),
 ('10000000-0000-4000-8000-000000000004','traffic'),
 ('10000000-0000-4000-8000-000000000005','design'),
 ('20000000-0000-4000-8000-000000000001','client'),
 ('20000000-0000-4000-8000-000000000002','client');
INSERT INTO public.team_client_assignments VALUES
 ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002'),
 ('10000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001');
INSERT INTO public.projects VALUES
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Project A',NULL),
 ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Project B',NULL);
INSERT INTO public.tasks(id,project_id,title) VALUES
 ('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Task A fixture'),
 ('40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','Task B fixture');
INSERT INTO public.feature_flags VALUES ('operators_layer',true);
INSERT INTO public.internal_operators(id,slug,display_name,role,scope) VALUES
 ('50000000-0000-4000-8000-000000000001','fixture-agent','Fixture agent','test','Synthetic only');
INSERT INTO public.operator_approvals(id,operator_id,action_kind,o_que,por_que,status,payload,decided_at) VALUES
 ('60000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',
  'enviar_mensagem','Synthetic order','Fixture only','aprovado','{"fixture":true}',now());
CREATE TEMP TABLE test_ids(key text PRIMARY KEY,id uuid);
GRANT SELECT ON test_ids TO anon,authenticated,service_role;

CREATE FUNCTION pg_temp.act_as(_uid uuid, _role text DEFAULT 'authenticated') RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub',COALESCE(_uid::text,''),true);
  PERFORM set_config('request.jwt.claims',json_build_object('sub',_uid,'role',_role)::text,true);
  EXECUTE format('SET LOCAL ROLE %I',_role);
END $$;
CREATE FUNCTION pg_temp.owner_context() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  EXECUTE 'RESET SESSION AUTHORIZATION';
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{}',true);
END $$;
CREATE FUNCTION pg_temp.request_context() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN EXECUTE 'SET LOCAL SESSION AUTHORIZATION authenticator'; END $$;

-- Effective grants, including inheritance through PUBLIC, not string matching.
SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN (
    'upsert_current_dossier','save_meta_ads_token_from_login','operator_report_event',
    'operator_update','operator_ordens_abertas','operator_ordem_executada',
    'operator_assign_task','editorial_ciclo_publicacao','social_metrics_ciclo','ads_creatives_tick')
    AND has_function_privilege('anon',p.oid,'EXECUTE')),
  'anon has no inherited EXECUTE on any vulnerable RPC');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN (
    'save_meta_ads_token_from_login','operator_report_event','operator_ordens_abertas',
    'operator_ordem_executada','editorial_ciclo_publicacao','social_metrics_ciclo','ads_creatives_tick')
    AND has_function_privilege('authenticated',p.oid,'EXECUTE')),
  'service-only entrypoints reject the shared authenticated database role');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN (
    'save_meta_ads_token_from_login','operator_report_event','operator_ordens_abertas',
    'operator_ordem_executada','editorial_ciclo_publicacao','social_metrics_ciclo','ads_creatives_tick')
    AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')),
  'legitimate backend entrypoints keep service_role EXECUTE');

-- Real PostgREST-shaped session: session_user=authenticator, role=API role.
SELECT pg_temp.request_context();
SELECT pg_temp.act_as(NULL,'anon');
SELECT throws_ok($$SELECT public.upsert_current_dossier('20000000-0000-4000-8000-000000000001','forged')$$,
  '42501',NULL,'anon cannot write a dossier');
SELECT throws_ok($$SELECT public.operator_ordens_abertas('fixture-agent')$$,
  '42501',NULL,'anon cannot read the approved order payload');
SELECT throws_ok($$SELECT public.save_meta_ads_token_from_login('synthetic-denied-token')$$,
  '42501',NULL,'anon cannot alter the Vault connection');
SELECT throws_ok($$SELECT public.editorial_ciclo_publicacao()$$,
  '42501',NULL,'anon cannot dispatch the publication wrapper');
SELECT pg_temp.act_as(NULL);
SELECT throws_ok($$SELECT public.upsert_current_dossier('20000000-0000-4000-8000-000000000001','forged')$$,
  '42501','RPC_STAFF_REQUIRED','authenticated role with no uid is not a service');
SELECT pg_temp.act_as('20000000-0000-4000-8000-000000000001');
SELECT throws_ok($$SELECT public.upsert_current_dossier('20000000-0000-4000-8000-000000000001','forged')$$,
  '42501','RPC_STAFF_REQUIRED','client cannot write their own internal dossier');
SELECT throws_ok($$SELECT public.dossie_avancos_texto('20000000-0000-4000-8000-000000000002')$$,
  '42501','RPC_STAFF_REQUIRED','client cannot read another tenant progress via definer RPC');
SELECT pg_temp.act_as('10000000-0000-4000-8000-000000000005');
SELECT throws_ok($$SELECT public.upsert_current_dossier('20000000-0000-4000-8000-000000000001','forged')$$,
  '42501','RPC_CLIENT_SCOPE_DENIED','staff without assignment cannot write a dossier');
SELECT pg_temp.act_as('10000000-0000-4000-8000-000000000002');
SELECT lives_ok($$SELECT public.upsert_current_dossier(
  '20000000-0000-4000-8000-000000000001','A original fixture',_actor=>'forged-admin',_expected_version=>0)$$,
  'assigned design keeps dossier creation');
SELECT throws_ok($$SELECT public.upsert_current_dossier('20000000-0000-4000-8000-000000000002','forged')$$,
  '42501','RPC_CLIENT_SCOPE_DENIED','assigned design cannot cross to tenant B');
SELECT throws_ok($$SELECT public.dossie_registrar_avancos('20000000-0000-4000-8000-000000000002')$$,
  '42501','RPC_CLIENT_SCOPE_DENIED','progress writer does not bypass tenant scope');
SELECT lives_ok($$SELECT public.dossie_avancos_texto('20000000-0000-4000-8000-000000000001')$$,
  'assigned design keeps progress reader');
SELECT pg_temp.act_as('10000000-0000-4000-8000-000000000003');
SELECT lives_ok($$SELECT public.upsert_current_dossier(
  '20000000-0000-4000-8000-000000000002','B original fixture',_expected_version=>0)$$,
  'assigned manager keeps dossier creation');
SELECT pg_temp.act_as('10000000-0000-4000-8000-000000000004');
SELECT lives_ok($$SELECT public.upsert_current_dossier(
  '20000000-0000-4000-8000-000000000001','A revised fixture',_expected_version=>1)$$,
  'assigned traffic keeps versioned update');
SELECT pg_temp.act_as('10000000-0000-4000-8000-000000000001');
SELECT lives_ok($$SELECT public.upsert_current_dossier(
  '20000000-0000-4000-8000-000000000002','B admin revision',_expected_version=>1)$$,
  'admin keeps access to every client without assignments');
SELECT throws_like($$SELECT public.upsert_current_dossier(
  '20000000-0000-4000-8000-000000000002','stale revision',_expected_version=>1)$$,
  '%version_conflict%','optimistic version check remains intact');
SELECT pg_temp.act_as(NULL,'service_role');
SELECT lives_ok($$SELECT public.upsert_current_dossier(
  '20000000-0000-4000-8000-000000000001','A service revision',_actor=>'mcp:fixture',_expected_version=>2)$$,
  'service_role without uid remains legitimate');
SELECT pg_temp.owner_context();
SELECT is((SELECT count(*)::integer FROM public.client_dossiers WHERE client_id IN
  ('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002')),5,'all prior dossier versions are preserved');
SELECT is((SELECT content FROM public.client_dossiers WHERE client_id='20000000-0000-4000-8000-000000000001' AND version=1),
  'A original fixture','previous dossier content was not rewritten');
SELECT is((SELECT actor FROM public.client_dossiers WHERE client_id='20000000-0000-4000-8000-000000000001' AND version=1),
  'painel:10000000-0000-4000-8000-000000000002','human audit actor is derived from verified uid');
SELECT is((SELECT actor FROM public.client_dossiers WHERE client_id='20000000-0000-4000-8000-000000000001' AND version=3),
  'mcp:fixture','trusted MCP actor contract is preserved');
SELECT lives_ok($$SELECT public.dossie_registrar_avancos_todos()$$,
  'postgres cron without SET ROLE remains authorized through nested dossier functions');
SELECT is((SELECT count(*)::integer FROM public.client_dossiers WHERE version=1),2,
  'cron progress preserves the original version of both clients');

-- Team UI commands enforce the task/link tenant and use a trusted human actor.
SELECT pg_temp.request_context();
SELECT pg_temp.act_as('10000000-0000-4000-8000-000000000002');
SELECT lives_ok($$SELECT public.operator_assign_task('fixture-agent','40000000-0000-4000-8000-000000000001','forged-admin')$$,
  'assigned design can offer their tenant task');
SELECT throws_ok($$SELECT public.operator_assign_task('fixture-agent','40000000-0000-4000-8000-000000000002','forged-admin')$$,
  '42501','RPC_CLIENT_SCOPE_DENIED','design cannot offer another tenant task');
SELECT throws_ok($$SELECT public.operator_update('fixture-agent','forged-admin',_status=>'paused')$$,
  '42501','RPC_ADMIN_REQUIRED','team member cannot forge an organogram command');
SELECT pg_temp.act_as('10000000-0000-4000-8000-000000000001');
SELECT lives_ok($$SELECT public.operator_assign_task('fixture-agent','40000000-0000-4000-8000-000000000002','forged-admin')$$,
  'admin keeps task assignment for any client');
SELECT lives_ok($$SELECT public.operator_update('fixture-agent','forged-admin',_display_name=>'Fixture renamed by admin')$$,
  'admin keeps organogram editing');
SELECT pg_temp.owner_context();
INSERT INTO test_ids SELECT 'link_a',id FROM public.operator_task_links WHERE kanban_task_id='40000000-0000-4000-8000-000000000001';
INSERT INTO test_ids SELECT 'link_b',id FROM public.operator_task_links WHERE kanban_task_id='40000000-0000-4000-8000-000000000002';
SELECT is((SELECT actor FROM public.operator_audit_log WHERE kanban_task_id='40000000-0000-4000-8000-000000000001' LIMIT 1),
  'painel:10000000-0000-4000-8000-000000000002','operator assignment cannot spoof the human actor');
SELECT ok(EXISTS(SELECT 1 FROM public.operator_audit_log
  WHERE actor='painel:10000000-0000-4000-8000-000000000001' AND action LIKE 'organograma atualizado:%'),
  'organogram audit records the actual admin');
SELECT pg_temp.request_context();
SELECT pg_temp.act_as('10000000-0000-4000-8000-000000000002');
SELECT lives_ok($$SELECT public.operator_human_action((SELECT id FROM pg_temp.test_ids WHERE key='link_a'),'review','Synthetic team review')$$,
  'assigned team can update their execution link');
SELECT throws_ok($$SELECT public.operator_human_action((SELECT id FROM pg_temp.test_ids WHERE key='link_b'),'review')$$,
  '42501','RPC_CLIENT_SCOPE_DENIED','team cannot update another tenant link');
SELECT throws_ok($$SELECT public.operator_expire_stale_runs()$$,
  '42501','RPC_ADMIN_REQUIRED','ordinary staff cannot run global maintenance directly');
SELECT throws_ok($$SELECT public.operator_report_event('fixture-agent','heartbeat','forged','forged-admin')$$,
  '42501',NULL,'browser user cannot impersonate an agent execution');
SELECT pg_temp.act_as(NULL,'service_role');
SELECT lives_ok($$SELECT public.operator_update('fixture-agent','mcp:fixture',_area=>'Synthetic service update')$$,
  'MCP service retains organogram editing through the new guard');
SELECT lives_ok($$SELECT public.operator_report_event('fixture-agent','heartbeat','fixture-run','mcp:fixture')$$,
  'backend agent reporting still executes its real business function');
SELECT results_eq($$SELECT count(*)::integer FROM public.operator_ordens_abertas('fixture-agent')$$,
  $$VALUES (1)$$,'backend receives the synthetic approved order');
SELECT lives_ok($$SELECT public.operator_ordem_executada('fixture-agent','60000000-0000-4000-8000-000000000001','fixture://evidence')$$,
  'backend can record execution evidence without deleting its order');
SELECT pg_temp.owner_context();
SELECT is((SELECT count(*)::integer FROM public.operator_runs WHERE run_key='fixture-run'),1,'service heartbeat persists exactly one run');
SELECT is((SELECT count(*)::integer FROM public.operator_approvals),1,'executed order remains in history');
SELECT ok((SELECT executed_at IS NOT NULL FROM public.operator_approvals WHERE id='60000000-0000-4000-8000-000000000001'),
  'execution evidence reaches the original order');
SELECT is((SELECT count(*)::integer FROM public.tasks),2,'operator commands preserve all tasks');

-- Meta connection and transitive worker calls: inert boundaries, actual callers.
SELECT is((SELECT count(*)::integer FROM vault.decrypted_secrets),0,'denied calls never reached the mock Vault');
SELECT is((SELECT count(*)::integer FROM public.security_test_dispatch),0,'denied wrappers dispatched nothing');
SELECT pg_temp.request_context();
SELECT pg_temp.act_as('10000000-0000-4000-8000-000000000001');
SELECT lives_ok($$SELECT public.ads_contas_conhecidas()$$,
  'admin retains the guarded Meta account catalog with its original result shape');
SELECT throws_ok($$SELECT public.save_meta_ads_token_from_login('synthetic-direct-admin-token')$$,
  '42501',NULL,'admin browser uses the authenticated OAuth Edge, not direct token RPC');
SELECT pg_temp.act_as(NULL,'service_role');
SELECT lives_ok($$SELECT public.save_meta_ads_token_from_login('synthetic-vault-fixture-one')$$,'OAuth backend can persist a synthetic token');
SELECT lives_ok($$SELECT public.save_meta_ads_token_from_login('synthetic-vault-fixture-two')$$,'OAuth backend retains token replacement contract');
SELECT lives_ok($$SELECT public.editorial_ciclo_publicacao()$$,'service publication wrapper still calls the inert worker');
SELECT lives_ok($$SELECT public.social_metrics_ciclo()$$,'service metrics wrapper still calls its inert worker');
SELECT pg_temp.owner_context();
SELECT is((SELECT count(*)::integer FROM social_private.ads_tokens),2,'previous token records remain preserved');
SELECT is((SELECT count(*)::integer FROM vault.decrypted_secrets),2,'previous synthetic Vault history remains preserved');
SELECT is((SELECT count(*)::integer FROM public.security_test_dispatch),4,'only service wrappers reached four inert downstream steps');
SELECT pg_temp.request_context();
SELECT pg_temp.act_as('10000000-0000-4000-8000-000000000002');
SELECT lives_ok($$SELECT public.collect_ads_now()$$,'existing staff refresh button still works through privileged worker ACLs');
SELECT throws_ok($$SELECT public.ads_contas_conhecidas()$$,
  '42501','RPC_ADMIN_REQUIRED','staff cannot enumerate the global cross-client Meta catalog');

-- Commercial profile fields are protected even for the owner of that row.
SELECT pg_temp.act_as('20000000-0000-4000-8000-000000000001');
SELECT lives_ok($$UPDATE public.profiles SET full_name='Client A edited',company_name='Company A edited',
  phone='0000',avatar_url='fixture://avatar',onboarding_done=true WHERE id=auth.uid()$$,
  'client retains personal profile and first-login tour updates');
SELECT throws_ok($$UPDATE public.profiles SET plan_value=0 WHERE id=auth.uid()$$,
  '42501','PROFILE_COMMERCIAL_FIELDS_ADMIN_ONLY','client cannot alter their plan price');
SELECT throws_ok($$UPDATE public.profiles SET plan_status='inactive' WHERE id=auth.uid()$$,
  '42501','PROFILE_COMMERCIAL_FIELDS_ADMIN_ONLY','client cannot alter plan status');
SELECT throws_ok($$UPDATE public.profiles SET plan_renewal_date='2099-01-01' WHERE id=auth.uid()$$,
  '42501','PROFILE_COMMERCIAL_FIELDS_ADMIN_ONLY','client cannot postpone renewal');
SELECT throws_ok($$UPDATE public.profiles SET services_config='{"internal_company":true}' WHERE id=auth.uid()$$,
  '42501','PROFILE_COMMERCIAL_FIELDS_ADMIN_ONLY','client cannot change contracted services or internal flag');
SELECT throws_ok($$UPDATE public.profiles SET deleted_at=now() WHERE id=auth.uid()$$,
  '42501','PROFILE_COMMERCIAL_FIELDS_ADMIN_ONLY','client cannot hide their commercial record');
SELECT throws_ok($$UPDATE public.profiles SET first_access_token='synthetic-forged-token' WHERE id=auth.uid()$$,
  '42501','PROFILE_COMMERCIAL_FIELDS_ADMIN_ONLY','unlisted legacy fields remain protected and preserved');
SELECT set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000001","role":"service_role"}',true);
SELECT throws_ok($$UPDATE public.profiles SET plan_value=0 WHERE id=auth.uid()$$,
  '42501','PROFILE_COMMERCIAL_FIELDS_ADMIN_ONLY','claim text saying service_role cannot bypass the real database role');
SELECT pg_temp.owner_context();
SELECT is((SELECT plan_value FROM public.profiles WHERE id='20000000-0000-4000-8000-000000000001'),597::numeric,
  'denied edits preserve the existing business price');
SELECT is((SELECT full_name FROM public.profiles WHERE id='20000000-0000-4000-8000-000000000001'),'Client A edited',
  'permitted personal edits are persisted');
SELECT pg_temp.request_context();
SELECT pg_temp.act_as('10000000-0000-4000-8000-000000000001');
SELECT lives_ok($$UPDATE public.profiles SET plan_value=697,plan_renewal_date='2026-11-01',services_config='{"social":true,"trafego":true}'
  WHERE id='20000000-0000-4000-8000-000000000001'$$,'Almir/admin retains full commercial profile editing');
SELECT pg_temp.act_as(NULL,'service_role');
SELECT lives_ok($$UPDATE public.profiles SET plan_status='standby' WHERE id='20000000-0000-4000-8000-000000000002'$$,
  'service-role financial/renewal processing is retained');
SELECT pg_temp.owner_context();
SELECT is((SELECT count(*)::integer FROM public.profiles),8,'all profile records remain present, including the pre-migration legacy row');
SELECT is((SELECT plan_value FROM public.profiles WHERE id='20000000-0000-4000-8000-000000000001'),697::numeric,
  'authorized admin commercial change succeeds');
SELECT is((SELECT plan_status FROM public.profiles WHERE id='20000000-0000-4000-8000-000000000002'),'standby',
  'service update actually changes the authorized row, not a silent zero-row result');
-- Scheduled maintenance uses the same atomic admin/service RPC as the optional
-- admin button. Calls preserve all rows and never revive or execute old orders.
SELECT results_eq($$SELECT schedule,command,username FROM cron.job WHERE jobname='operator-maintenance-5min'$$,
  $$VALUES ('*/5 * * * *'::text,'SELECT public.operator_maintenance_tick();'::text,'postgres'::text)$$,
  'migration registers exactly one five-minute SQL job owned by postgres');
INSERT INTO public.tasks(id,project_id,title,status,deleted_at) VALUES
 ('40000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001','Removed synthetic task','backlog',now()),
 ('40000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000001','Done synthetic task','done',NULL);
INSERT INTO public.assignment_proposals(id,kanban_task_id,status,decision_note) VALUES
 ('80000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000003','pendente','Existing synthetic note'),
 ('80000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000004','pendente',NULL),
 ('80000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000001','pendente',NULL);
INSERT INTO public.operator_task_links(id,operator_id,kanban_task_id,status,last_evidence) VALUES
 ('90000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','in_progress','fixture://stale-evidence'),
 ('90000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000003','queued','fixture://orphan-evidence');
INSERT INTO public.operator_runs(operator_id,run_key,task_link_id,status,heartbeat_at,error) VALUES
 ('50000000-0000-4000-8000-000000000001','stale-maintenance','90000000-0000-4000-8000-000000000001','progress',now()-interval '2 hours','Original synthetic diagnostic'),
 ('50000000-0000-4000-8000-000000000001','orphan-maintenance','90000000-0000-4000-8000-000000000002','awaiting_input',now(),NULL);
CREATE TEMP TABLE maintenance_history AS SELECT
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.operator_approvals x) approvals,
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.operator_audit_log x) audit,
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tasks x) tasks,
 (SELECT count(*) FROM public.operator_runs) runs_count,
 (SELECT count(*) FROM public.operator_task_links) links_count;
SELECT pg_temp.request_context();
SELECT pg_temp.act_as(NULL,'anon');
SELECT throws_ok($$SELECT public.operator_maintenance_tick()$$,'42501',NULL,'anonymous caller cannot start maintenance');
SELECT pg_temp.act_as('20000000-0000-4000-8000-000000000001');
SELECT throws_ok($$SELECT public.operator_maintenance_tick()$$,'42501','RPC_ADMIN_REQUIRED','client cannot start global maintenance');
SELECT pg_temp.act_as('10000000-0000-4000-8000-000000000002');
SELECT throws_ok($$SELECT public.operator_maintenance_tick()$$,'42501','RPC_ADMIN_REQUIRED','assigned staff cannot start global maintenance');
SELECT throws_ok($$SELECT public.operator_fechar_orfaos()$$,'42501','RPC_ADMIN_REQUIRED','staff cannot bypass maintenance guard through the old orphan RPC');
SELECT pg_temp.owner_context();
SELECT is((SELECT status FROM public.operator_runs WHERE run_key='stale-maintenance'),'progress','denied maintenance calls leave pending work untouched');
SELECT pg_temp.request_context();
SELECT pg_temp.act_as('10000000-0000-4000-8000-000000000001');
SELECT is(public.operator_maintenance_tick(),
 '{"stale_runs_expired":1,"orphans":{"propostas_fechadas":2,"runs_expirados":1,"vinculos_encerrados":1}}'::jsonb,
 'admin atomically expires one stale run and closes only obsolete proposals/run/link');
SELECT pg_temp.owner_context();
SELECT results_eq($$SELECT run_key,status,error FROM public.operator_runs WHERE run_key IN ('stale-maintenance','orphan-maintenance') ORDER BY run_key$$,
 $$VALUES ('orphan-maintenance'::text,'timeout'::text,'encerrada: a tarefa foi excluída'::text),
 ('stale-maintenance'::text,'timeout'::text,'Original synthetic diagnostic'::text)$$,
 'maintenance records timeout while preserving the original diagnostic');
SELECT results_eq($$SELECT status,last_evidence FROM public.operator_task_links WHERE id IN ('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000002') ORDER BY id$$,
 $$VALUES ('blocked'::text,'fixture://stale-evidence'::text),('blocked'::text,'fixture://orphan-evidence'::text)$$,
 'obsolete execution links are blocked with all evidence retained');
SELECT is((SELECT decision_note FROM public.assignment_proposals WHERE id='80000000-0000-4000-8000-000000000001'),'Existing synthetic note',
 'closing a proposal preserves its existing decision note');
SELECT is((SELECT status FROM public.assignment_proposals WHERE id='80000000-0000-4000-8000-000000000003'),'pendente',
 'a proposal for a live task remains pending');
SELECT is((SELECT count(*)::integer FROM public.assignment_proposals),3,'all proposals remain in history');
SELECT is((SELECT count(*) FROM public.operator_runs),(SELECT runs_count FROM maintenance_history),'all runs remain in history');
SELECT is((SELECT count(*) FROM public.operator_task_links),(SELECT links_count FROM maintenance_history),'all execution links remain in history');
SELECT is((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.operator_approvals x),(SELECT approvals FROM maintenance_history),
 'maintenance does not reopen, approve, execute or rewrite old orders');
SELECT is((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.operator_audit_log x),(SELECT audit FROM maintenance_history),
 'maintenance preserves the entire execution audit trail');
SELECT is((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tasks x),(SELECT tasks FROM maintenance_history),
 'maintenance preserves every task including logically removed tasks');
CREATE TEMP TABLE maintenance_after_first AS SELECT
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.operator_runs x) runs,
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.operator_task_links x) links,
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.assignment_proposals x) proposals;
SELECT pg_temp.request_context();
SELECT pg_temp.act_as(NULL,'service_role');
SELECT is(public.operator_maintenance_tick(),
 '{"stale_runs_expired":0,"orphans":{"propostas_fechadas":0,"runs_expirados":0,"vinculos_encerrados":0}}'::jsonb,
 'service without uid can repeat maintenance and receives zero changes');
SELECT pg_temp.owner_context();
SELECT is(public.operator_maintenance_tick(),
 '{"stale_runs_expired":0,"orphans":{"propostas_fechadas":0,"runs_expirados":0,"vinculos_encerrados":0}}'::jsonb,
 'postgres cron without JWT repeats the same guarded SQL maintenance successfully');
SELECT ok((SELECT runs IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.operator_runs x)
 AND links IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.operator_task_links x)
 AND proposals IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.assignment_proposals x)
 FROM maintenance_after_first),'repeated maintenance is idempotent over every field and timestamp');
-- Project reads use the same client boundary as the existing child resources.
-- These extra actors/rows are added after the earlier preservation assertions.
INSERT INTO public.profiles(id,full_name,email) VALUES
 ('10000000-0000-4000-8000-000000000006','Unassigned manager fixture','manager-unassigned@example.invalid'),
 ('10000000-0000-4000-8000-000000000007','Unassigned traffic fixture','traffic-unassigned@example.invalid');
INSERT INTO public.user_roles VALUES
 ('10000000-0000-4000-8000-000000000006','manager'),
 ('10000000-0000-4000-8000-000000000007','traffic');
INSERT INTO public.projects VALUES
 ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','Archived Project A','2026-09-01T00:00:00Z'),
 ('30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000002','Archived Project B','2026-09-01T00:00:00Z');
INSERT INTO public.tasks(id,project_id,title,assigned_to) VALUES
 ('40000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000002','Assignment alone is not client authorization','10000000-0000-4000-8000-000000000005');
CREATE TEMP TABLE project_scope_before AS
 SELECT jsonb_agg(to_jsonb(p) ORDER BY id) AS rows FROM public.projects p;
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.projects'::regclass),'project SELECT tests execute with RLS enabled');
SELECT is((SELECT oid FROM pg_policy WHERE polrelid='public.projects'::regclass AND polname='projects_select'),
 (SELECT projects_policy_oid FROM public.security_test_before_migration),'ALTER preserves the existing projects_select policy identity');
SELECT ok(has_table_privilege('authenticated','public.projects','SELECT'),'authenticated project SELECT grant exists independently of RLS');

CREATE FUNCTION pg_temp.check_project_scope(_uid uuid,_client uuid,_label text)
RETURNS SETOF text LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  PERFORM pg_temp.act_as(_uid);
  RETURN NEXT is((SELECT count(*)::integer FROM public.projects WHERE client_id=_client AND deleted_at IS NULL),1,_label || ' reads the assigned or owned active project');
  RETURN NEXT is((SELECT count(*)::integer FROM public.projects WHERE client_id=_client AND deleted_at IS NOT NULL),1,_label || ' retains authorized project history');
  RETURN NEXT is((SELECT count(*)::integer FROM public.projects WHERE client_id<>_client),0,_label || ' cannot read another client active or archived project');
END $$;
SELECT pg_temp.request_context();
SELECT * FROM pg_temp.check_project_scope('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','assigned design');
SELECT * FROM pg_temp.check_project_scope('10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002','assigned manager');
SELECT * FROM pg_temp.check_project_scope('10000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','assigned traffic');
SELECT * FROM pg_temp.check_project_scope('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','client A');
SELECT * FROM pg_temp.check_project_scope('20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','client B');
SELECT pg_temp.act_as('10000000-0000-4000-8000-000000000005');
SELECT is((SELECT count(*)::integer FROM public.projects),0,'unassigned design cannot read any project even with an assigned task');
SELECT pg_temp.act_as('10000000-0000-4000-8000-000000000006');
SELECT is((SELECT count(*)::integer FROM public.projects),0,'unassigned manager cannot read any project');
SELECT pg_temp.act_as('10000000-0000-4000-8000-000000000007');
SELECT is((SELECT count(*)::integer FROM public.projects),0,'unassigned traffic cannot read any project');
SELECT pg_temp.act_as('10000000-0000-4000-8000-000000000001');
SELECT is((SELECT count(*)::integer FROM public.projects),4,'admin retains every active and archived project without assignments');
SELECT pg_temp.act_as(NULL,'anon');
SELECT is((SELECT count(*)::integer FROM public.projects),0,'anonymous request cannot read projects despite table SELECT privilege');
SELECT pg_temp.act_as(NULL);
SELECT is((SELECT count(*)::integer FROM public.projects),0,'authenticated request without uid cannot read projects');
SELECT pg_temp.act_as(NULL,'service_role');
SELECT is((SELECT count(*)::integer FROM public.projects),4,'trusted service retains all project history');
SELECT pg_temp.owner_context();
SELECT is((SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.projects p),(SELECT rows FROM project_scope_before),
 'project authorization checks preserve every project field and archived record');
SELECT * FROM finish();
ROLLBACK;
