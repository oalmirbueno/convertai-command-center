-- Real concurrent transactions, exclusively in a disposable loopback database.
-- Deliberately committed synthetic fixtures: dblink sessions must share them.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() NOT LIKE 'acq_isolated_central_%' OR current_setting('aceleriq.isolated_tests',true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'isolated database required'; END IF; END $$;
SELECT no_plan();
INSERT INTO public.profiles(id) VALUES ('00000000-0000-0000-0000-000000000101'),('00000000-0000-0000-0000-000000000103');
INSERT INTO public.user_roles VALUES ('00000000-0000-0000-0000-000000000101','admin'),('00000000-0000-0000-0000-000000000103','client');
INSERT INTO public.projects(id,client_id,status) VALUES ('10000000-0000-0000-0000-000000000103','00000000-0000-0000-0000-000000000103','active');
INSERT INTO public.client_dossiers(client_id,dossier_type,is_current,version,updated_at,content) VALUES ('00000000-0000-0000-0000-000000000103','contexto',true,1,now(),'Synthetic concurrency context');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',false);
INSERT INTO public.reports(id,client_id,project_id,title,summary,next_steps,metrics,period_start,period_end,status)
 SELECT ('35000000-0000-0000-0000-00000000000'||n)::uuid,'00000000-0000-0000-0000-000000000103','10000000-0000-0000-0000-000000000103','Concurrency fixture','Summary','Next',
 jsonb_build_object('ritual_type','weekly','central_review_source',public.central_review_source('00000000-0000-0000-0000-000000000103')),
 date '2026-10-01'+CASE WHEN n=6 THEN 5 ELSE n END,date '2026-10-01'+CASE WHEN n=6 THEN 5 ELSE n END,'draft' FROM generate_series(1,7) n;
CREATE TEMP TABLE central_concurrency_results(k text PRIMARY KEY,v jsonb);
CREATE FUNCTION pg_temp.await_central_lock(_app text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
 FOR i IN 1..150 LOOP
  PERFORM pg_stat_clear_snapshot();
  IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=_app AND wait_event_type='Lock') THEN RETURN true; END IF;
  PERFORM pg_sleep(0.02);
 END LOOP;
 RETURN false;
END $$;
CREATE FUNCTION pg_temp.central_test_conn(_app text) RETURNS text LANGUAGE sql AS $$
 SELECT format('host=127.0.0.1 port=%s dbname=%I user=%I application_name=%s password=%s',
 current_setting('port'),current_database(),session_user,_app,
 ''''||replace(replace(COALESCE(current_setting('aceleriq.test_dblink_password',true),''),E'\\',E'\\\\'),'''',E'\\''')||'''');
$$;
SELECT dblink_connect('central_a',pg_temp.central_test_conn('central_racer_a'));
SELECT dblink_connect('central_b',pg_temp.central_test_conn('central_racer_b'));
SELECT dblink_exec(c, 'SET request.jwt.claim.sub=''00000000-0000-0000-0000-000000000101''') FROM unnest(ARRAY['central_a','central_b']) c;
SELECT dblink_exec(c, 'SET statement_timeout=''15s''') FROM unnest(ARRAY['central_a','central_b']) c;

-- A holds report lock after preparation; exact concurrent retry must wait.
SELECT dblink_exec('central_a','BEGIN');
INSERT INTO central_concurrency_results SELECT 'a',result FROM dblink('central_a',$q$SELECT public.central_review_prepare('35000000-0000-0000-0000-000000000001',1,'{"channel":"portal","recipient":"00000000-0000-0000-0000-000000000103"}','concurrent-prepare-1')$q$) AS t(result jsonb);
SELECT dblink_send_query('central_b',$q$SELECT public.central_review_prepare('35000000-0000-0000-0000-000000000001',1,'{"channel":"portal","recipient":"00000000-0000-0000-0000-000000000103"}','concurrent-prepare-1')$q$);
SELECT ok(pg_temp.await_central_lock('central_racer_b'),'concurrent prepare waits for first transaction');
SELECT dblink_exec('central_a','COMMIT');
INSERT INTO central_concurrency_results SELECT 'retry',result FROM dblink_get_result('central_b') AS t(result jsonb);
SELECT * FROM dblink_get_result('central_b') AS t(result jsonb);
SELECT is((SELECT v->>'id' FROM central_concurrency_results WHERE k='a'),(SELECT v->>'id' FROM central_concurrency_results WHERE k='retry'),'concurrent prepare returns same request');
SELECT is((SELECT count(*) FROM public.operator_approvals WHERE request_key='concurrent-prepare-1'),1::bigint,'concurrent prepare inserts exactly once');

-- Conflicting decisions: the first commit is final.
SELECT dblink_exec('central_a','BEGIN');
-- Query construction uses the snapshot returned by prepare, never guessed IDs.
INSERT INTO central_concurrency_results SELECT 'approved',result FROM dblink('central_a',(SELECT format('SELECT public.central_review_decide(%L,%L,1,%L,%L,NULL,%L)',v->>'id','00000000-0000-0000-0000-000000000103',v->>'payload_hash','aprovado','concurrent-decision-1') FROM central_concurrency_results WHERE k='a')) AS t(result jsonb);
SELECT dblink_send_query('central_b',(SELECT format('SELECT public.central_review_decide(%L,%L,1,%L,%L,%L,%L)',v->>'id','00000000-0000-0000-0000-000000000103',v->>'payload_hash','rejeitado','Conflicting decision','concurrent-decision-2') FROM central_concurrency_results WHERE k='a'));
SELECT ok(pg_temp.await_central_lock('central_racer_b'),'second decision waits on the same report');
SELECT dblink_exec('central_a','COMMIT');
SELECT * FROM dblink_get_result('central_b',false) AS t(result jsonb);
SELECT ok(dblink_error_message('central_b') LIKE '%CENTRAL_ALREADY_DECIDED%','losing decision cannot replace committed approval');
SELECT * FROM dblink_get_result('central_b',false) AS t(result jsonb);
SELECT is((SELECT count(*) FROM public.central_review_events WHERE approval_id=(SELECT (v->>'id')::uuid FROM central_concurrency_results WHERE k='a') AND event IN ('aprovado','rejeitado')),1::bigint,'one final decision event');

-- An edit holding the report lock invalidates approval before a decision reads.
INSERT INTO central_concurrency_results VALUES ('edit',public.central_review_prepare('35000000-0000-0000-0000-000000000003',1,'{"channel":"portal","recipient":"00000000-0000-0000-0000-000000000103"}','concurrent-edit-prepare'));
SELECT dblink_exec('central_a','BEGIN');
SELECT dblink_exec('central_a',$q$UPDATE public.reports SET summary='Edited concurrently' WHERE id='35000000-0000-0000-0000-000000000003'$q$);
SELECT dblink_send_query('central_b',(SELECT format('SELECT public.central_review_decide(%L,%L,1,%L,%L,NULL,%L)',v->>'id','00000000-0000-0000-0000-000000000103',v->>'payload_hash','aprovado','concurrent-edit-decision') FROM central_concurrency_results WHERE k='edit'));
SELECT ok(pg_temp.await_central_lock('central_racer_b'),'decision waits for report edit');
SELECT dblink_exec('central_a','COMMIT');
SELECT * FROM dblink_get_result('central_b',false) AS t(result jsonb);
SELECT ok(dblink_error_message('central_b') LIKE '%CENTRAL_REPORT_VERSION_CONFLICT%','decision rejects committed newer report version');
SELECT * FROM dblink_get_result('central_b',false) AS t(result jsonb);
SELECT is((SELECT status FROM public.operator_approvals WHERE request_key='concurrent-edit-prepare'),'expirado','edit invalidates affected request');

-- Two report IDs in one client/ritual/period serialize on the group lock.
SELECT dblink_exec('central_a','BEGIN');
SELECT * FROM dblink('central_a',$q$SELECT public.central_review_prepare('35000000-0000-0000-0000-000000000005',1,'{"channel":"portal","recipient":"00000000-0000-0000-0000-000000000103"}','concurrent-group-5')$q$) AS t(result jsonb);
SELECT dblink_send_query('central_b',$q$SELECT public.central_review_prepare('35000000-0000-0000-0000-000000000006',1,'{"channel":"portal","recipient":"00000000-0000-0000-0000-000000000103"}','concurrent-group-6')$q$);
SELECT ok(pg_temp.await_central_lock('central_racer_b'),'same-period replacement waits for group lock');
SELECT dblink_exec('central_a','COMMIT');
SELECT * FROM dblink_get_result('central_b') AS t(result jsonb);
SELECT * FROM dblink_get_result('central_b') AS t(result jsonb);
SELECT is((SELECT count(*) FROM public.operator_approvals WHERE request_key IN ('concurrent-group-5','concurrent-group-6') AND status='pendente'),1::bigint,'same period retains one pending version');
SELECT is((SELECT count(*) FROM public.operator_approvals WHERE request_key IN ('concurrent-group-5','concurrent-group-6')),2::bigint,'superseded request history is preserved');

-- Identical decision replay serializes on actor and idempotency key.
INSERT INTO central_concurrency_results VALUES ('replay',public.central_review_prepare('35000000-0000-0000-0000-000000000007',1,'{"channel":"portal","recipient":"00000000-0000-0000-0000-000000000103"}','concurrent-replay-prepare'));
SELECT dblink_exec('central_a','BEGIN');
INSERT INTO central_concurrency_results SELECT 'replay_a',result FROM dblink('central_a',(SELECT format('SELECT public.central_review_decide(%L,%L,1,%L,%L,NULL,%L)',v->>'id','00000000-0000-0000-0000-000000000103',v->>'payload_hash','aprovado','concurrent-replay-decision') FROM central_concurrency_results WHERE k='replay')) AS t(result jsonb);
SELECT dblink_send_query('central_b',(SELECT format('SELECT public.central_review_decide(%L,%L,1,%L,%L,NULL,%L)',v->>'id','00000000-0000-0000-0000-000000000103',v->>'payload_hash','aprovado','concurrent-replay-decision') FROM central_concurrency_results WHERE k='replay'));
SELECT ok(pg_temp.await_central_lock('central_racer_b'),'same decision key waits for previous transaction');
SELECT dblink_exec('central_a','COMMIT');
INSERT INTO central_concurrency_results SELECT 'replay_b',result FROM dblink_get_result('central_b') AS t(result jsonb);
SELECT * FROM dblink_get_result('central_b') AS t(result jsonb);
SELECT is((SELECT v FROM central_concurrency_results WHERE k='replay_a'),(SELECT v FROM central_concurrency_results WHERE k='replay_b'),'concurrent decision replay returns identical result');
SELECT is((SELECT count(*) FROM public.central_review_events WHERE idempotency_key='concurrent-replay-decision'),1::bigint,'concurrent decision replay records one event');
SELECT is((SELECT count(*) FROM public.central_review_dispatches WHERE status IN ('enviado','confirmado')),0::bigint,'concurrent operations do not send messages');
SELECT dblink_disconnect('central_a');
SELECT dblink_disconnect('central_b');
SELECT * FROM finish();
