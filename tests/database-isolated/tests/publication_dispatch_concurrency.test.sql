-- Isolated DB only. Requires publication_contract.sql, SEC-06 and dblink.
-- Deliberately no wrapping transaction: remote sessions must see committed
-- synthetic fixtures. All synthetic evidence is retained; no destructive cleanup.
DO $$ BEGIN
  IF current_setting('aceleriq.isolated_tests',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Concurrency fixture requires an explicitly isolated database';
  END IF;
END $$;
SELECT no_plan();
CREATE SEQUENCE IF NOT EXISTS public.publication_concurrency_sequence START WITH 10000;
CREATE TEMP TABLE publication_concurrency_cases(scenario integer PRIMARY KEY,id uuid);
CREATE FUNCTION pg_temp.await_publication_lock(_app text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  FOR i IN 1..100 LOOP
    PERFORM pg_stat_clear_snapshot();
    IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=_app AND wait_event_type='Lock' AND wait_event='advisory') THEN RETURN true; END IF;
    PERFORM pg_sleep(0.02);
  END LOOP;
  RETURN false;
END $$;
-- libpq quoting, including the optional local CI password supplied over stdin
-- by the isolated runner. No production credential or remote host is used.
CREATE FUNCTION pg_temp.publication_test_conn(_app text) RETURNS text LANGUAGE sql AS $$
  SELECT format('host=127.0.0.1 port=%s dbname=%I user=%I application_name=%s password=%s',
    current_setting('port'),current_database(),session_user,_app,
    '''' || replace(replace(COALESCE(current_setting('aceleriq.test_dblink_password',true),''),
      E'\\',E'\\\\'),'''',E'\\''') || '''');
$$;
SELECT dblink_connect('pub_a',pg_temp.publication_test_conn('publication_racer_a'));
SELECT dblink_connect('pub_b',pg_temp.publication_test_conn('publication_racer_b'));
SELECT dblink_exec('pub_a',format('SET request.jwt.claims=%L',jsonb_build_object('sub',md5('publication-test-admin')::uuid,'role','authenticated')::text));
SELECT dblink_exec('pub_b',format('SET request.jwt.claims=%L',jsonb_build_object('sub',md5('publication-test-admin')::uuid,'role','authenticated')::text));

-- Cancellation gets the first lock: worker waits, then sees the committed fence.
INSERT INTO publication_concurrency_cases SELECT 1,public.publication_test_create(nextval('public.publication_concurrency_sequence')::integer);
SELECT dblink_exec('pub_a','BEGIN');
SELECT * FROM dblink('pub_a',format('SELECT public.transition_editorial_publication(%L::uuid,''cancel'',1)',(SELECT id FROM publication_concurrency_cases WHERE scenario=1))) AS t(result jsonb);
SELECT dblink_send_query('pub_b','SELECT public.editorial_autopublish_tick()');
SELECT ok(pg_temp.await_publication_lock('publication_racer_b'),'worker waits behind the cancelling transaction');
SELECT dblink_exec('pub_a','COMMIT');
SELECT * FROM dblink_get_result('pub_b') AS t(result jsonb);
SELECT * FROM dblink_get_result('pub_b') AS t(result jsonb);
SELECT is((SELECT status FROM public.editorial_publications WHERE id=(SELECT id FROM publication_concurrency_cases WHERE scenario=1)),'cancelled','cancel wins before dispatch and remains official');
SELECT is((SELECT count(*) FROM social_private.autopublish_job_events WHERE publication_id=(SELECT id FROM publication_concurrency_cases WHERE scenario=1) AND event IN ('http_post','publish_dispatched')),0::bigint,'worker losing cancellation race issues zero POSTs');
SELECT is((SELECT stage FROM social_private.autopublish_jobs WHERE publication_id=(SELECT id FROM publication_concurrency_cases WHERE scenario=1)),'cancelled','worker cannot claim the cancelled job');

-- Final enqueue gets the first lock: cancellation waits and is rejected after
-- commit, since pg_net may begin external delivery at that boundary.
INSERT INTO publication_concurrency_cases SELECT 2,public.publication_test_create(nextval('public.publication_concurrency_sequence')::integer);
SELECT dblink_exec('pub_a','BEGIN');
SELECT * FROM dblink('pub_a','SELECT public.editorial_autopublish_tick()') AS t(result jsonb);
SELECT dblink_send_query('pub_b',format('SELECT public.transition_editorial_publication(%L::uuid,''cancel'',1)',(SELECT id FROM publication_concurrency_cases WHERE scenario=2)));
SELECT ok(pg_temp.await_publication_lock('publication_racer_b'),'cancellation waits behind the dispatching transaction');
SELECT dblink_exec('pub_a','COMMIT');
SELECT * FROM dblink_get_result('pub_b',false) AS t(result jsonb);
SELECT ok(dblink_error_message('pub_b') LIKE '%envio a plataforma ja foi iniciado%','late concurrent cancellation reports the point of no return');
SELECT * FROM dblink_get_result('pub_b',false) AS t(result jsonb);
SELECT is((SELECT status FROM public.editorial_publications WHERE id=(SELECT id FROM publication_concurrency_cases WHERE scenario=2)),'scheduled','dispatch winner is never falsely marked cancelled');
SELECT is((SELECT count(*) FROM social_private.autopublish_job_events WHERE publication_id=(SELECT id FROM publication_concurrency_cases WHERE scenario=2) AND event='publish_dispatched'),1::bigint,'dispatch winner retains exactly one final request');

-- Two ticks race on one prepared job: only the first can enqueue the final POST.
INSERT INTO publication_concurrency_cases SELECT 3,public.publication_test_create(nextval('public.publication_concurrency_sequence')::integer);
SELECT dblink_exec('pub_a','BEGIN');
SELECT * FROM dblink('pub_a','SELECT public.editorial_autopublish_tick()') AS t(result jsonb);
SELECT dblink_send_query('pub_b','SELECT public.editorial_autopublish_tick()');
SELECT ok(pg_temp.await_publication_lock('publication_racer_b'),'second tick waits for the first tick claim and enqueue');
SELECT dblink_exec('pub_a','COMMIT');
SELECT * FROM dblink_get_result('pub_b') AS t(result jsonb);
SELECT * FROM dblink_get_result('pub_b') AS t(result jsonb);
SELECT is((SELECT count(*) FROM social_private.autopublish_job_events WHERE publication_id=(SELECT id FROM publication_concurrency_cases WHERE scenario=3) AND event='publish_dispatched'),1::bigint,'concurrent ticks produce only one final dispatch');
SELECT is((SELECT attempts::integer FROM social_private.autopublish_jobs WHERE publication_id=(SELECT id FROM publication_concurrency_cases WHERE scenario=3)),1,'losing tick does not consume an extra attempt');

SELECT dblink_disconnect('pub_a');
SELECT dblink_disconnect('pub_b');
SELECT * FROM finish();
