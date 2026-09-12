-- Run only against publication_contract.sql + the SEC-06 migration, with mocked net.
BEGIN;
DO $$ BEGIN
  IF current_setting('aceleriq.isolated_tests', true) IS DISTINCT FROM 'on'
    OR to_regclass('net.publication_test_http') IS NULL THEN
    RAISE EXCEPTION 'Publication tests require the isolated HTTP mock fixture';
  END IF;
END $$;
SELECT no_plan();
CREATE FUNCTION pg_temp.publication_contract_tests() RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE p uuid; q uuid; before_http bigint; req bigint; n integer := 200; test_case record;
BEGIN
  p := public.publication_test_create(101);
  SELECT count(*) INTO before_http FROM net.publication_test_http;
  PERFORM public.editorial_autopublish_tick();
  RETURN NEXT is((SELECT count(*) FROM net.publication_test_http),before_http+1,'approved scheduled manual post dispatches with connection automation disabled');
  RETURN NEXT ok((SELECT publish_dispatched FROM social_private.autopublish_jobs WHERE publication_id=p),'final dispatch is persisted before commit');
  RETURN NEXT is((SELECT count(*) FROM social_private.autopublish_job_events WHERE publication_id=p AND event='publish_dispatched'),1::bigint,'one final dispatch ledger entry');
  PERFORM public.editorial_autopublish_tick();
  RETURN NEXT is((SELECT count(*) FROM net.publication_test_http),before_http+1,'repeated tick does not duplicate an in-flight final POST');
  RETURN NEXT throws_ok(format('SELECT public.transition_editorial_publication(%L::uuid,''cancel'',1)',p),'55000',NULL,'late cancel rejects rather than reporting a false cancellation');
  RETURN NEXT is((SELECT status FROM public.editorial_publications WHERE id=p),'scheduled','late cancel preserves official scheduled state');
  SELECT net_request_id INTO req FROM social_private.autopublish_jobs WHERE publication_id=p;
  INSERT INTO net._http_response(id,status_code,content) VALUES(req,200,'{"id":"synthetic-media-101"}');
  PERFORM public.editorial_autopublish_tick();
  RETURN NEXT is((SELECT media_id FROM social_private.autopublish_jobs WHERE publication_id=p),'synthetic-media-101','successful final POST retains the exact returned media id');
  SELECT net_request_id INTO req FROM social_private.autopublish_jobs WHERE publication_id=p;
  INSERT INTO net._http_response(id,status_code,content) VALUES(req,200,'{"permalink":"https://invalid.example/p/synthetic-101"}');
  PERFORM public.editorial_autopublish_tick();
  RETURN NEXT is((SELECT status FROM public.editorial_publications WHERE id=p),'published','successful permalink response completes the real publication transition');
  RETURN NEXT is((SELECT stage FROM social_private.autopublish_jobs WHERE publication_id=p),'done','completed job and history are retained');
  RETURN NEXT is((SELECT count(*) FROM net.publication_test_http WHERE method='POST' AND url LIKE '%/media_publish%'),1::bigint,'successful lifecycle uses exactly one final POST');

  p := public.publication_test_create(102,'processing');
  UPDATE social_private.autopublish_jobs SET attempts=3,net_request_id=9000102,child_request_ids=ARRAY[9000101::bigint],container_id='prior-container' WHERE publication_id=p;
  SELECT count(*) INTO before_http FROM net.publication_test_http;
  PERFORM public.transition_editorial_publication(p,'cancel',1);
  RETURN NEXT is((SELECT status FROM public.editorial_publications WHERE id=p),'cancelled','cancel before final dispatch succeeds through the real transition');
  RETURN NEXT is((SELECT stage FROM social_private.autopublish_jobs WHERE publication_id=p),'cancelled','pending job is retained and fenced as cancelled');
  RETURN NEXT is((SELECT attempts::integer FROM social_private.autopublish_jobs WHERE publication_id=p),3,'cancel preserves attempt count');
  RETURN NEXT is((SELECT net_request_id FROM social_private.autopublish_jobs WHERE publication_id=p),9000102::bigint,'cancel preserves the in-flight preparation request id');
  PERFORM public.editorial_autopublish_tick();
  RETURN NEXT is((SELECT count(*) FROM net.publication_test_http),before_http,'a successfully cancelled job issues no subsequent HTTP');
  RETURN NEXT throws_ok(format('SELECT public.retry_autopublish(%L::uuid)',p),'55000',NULL,'retry cannot revive a cancelled job');

  -- Explicitly revise/reopen/reapprove/schedule the cancelled publication.
  -- The core reopen function requires the asset to be editable first.
  UPDATE public.files SET locked_at=NULL,visibility='internal',agency_approval_status='not_requested' WHERE id=md5('file-102')::uuid;
  PERFORM public.transition_editorial_publication(p,'reopen',1);
  UPDATE public.files SET locked_at=now(),visibility='client_shared',agency_approval_status='approved' WHERE id=md5('file-102')::uuid;
  PERFORM public.transition_editorial_publication(p,'schedule',1,p_scheduled_at=>now()-interval '1 minute');
  RETURN NEXT is((SELECT generation FROM social_private.autopublish_jobs WHERE publication_id=p),2,'a newly authorized schedule starts a second generation');
  RETURN NEXT is((SELECT attempts::integer FROM social_private.autopublish_jobs WHERE publication_id=p),3,'new generation preserves lifetime attempts');
  RETURN NEXT is((SELECT detail->>'container_id' FROM social_private.autopublish_job_events WHERE publication_id=p AND event='rescheduled'),'prior-container','new generation archives prior provider container before replacing working state');
  PERFORM public.editorial_autopublish_tick();
  SELECT net_request_id INTO req FROM social_private.autopublish_jobs WHERE publication_id=p;
  INSERT INTO net._http_response(id,status_code,content) VALUES(req,200,'{"id":"synthetic-new-container-102"}');
  PERFORM public.editorial_autopublish_tick();
  PERFORM public.editorial_autopublish_tick();
  RETURN NEXT is((SELECT count(*) FROM social_private.autopublish_job_events WHERE publication_id=p AND generation=2 AND event='publish_dispatched'),1::bigint,'new generation may dispatch exactly once');
  RETURN NEXT is((SELECT count(*) FROM social_private.autopublish_jobs WHERE publication_id=p),1::bigint,'reschedule does not replace or duplicate the original job');

  p := public.publication_test_create(103,'publish','automatic');
  SELECT count(*) INTO before_http FROM net.publication_test_http;
  PERFORM public.editorial_autopublish_tick();
  RETURN NEXT is((SELECT count(*) FROM net.publication_test_http),before_http+1,'approved automatic publication with automation enabled still dispatches');

  -- Exercise real scheduling without fabricating the extension row which the
  -- old manual path did not create. Its approved immutable file is sufficient.
  p := public.publication_test_create(104,'queued','manual',false,true);
  PERFORM public.transition_editorial_publication(p,'schedule',1,p_scheduled_at=>now()-interval '1 minute');
  RETURN NEXT is((SELECT count(*) FROM social_private.editorial_publication_delivery_requests WHERE publication_id=p),0::bigint,'canonical legacy manual scheduling has no delivery extension row');
  SELECT count(*) INTO before_http FROM net.publication_test_http;
  PERFORM public.editorial_autopublish_tick();
  RETURN NEXT is((SELECT count(*) FROM net.publication_test_http),before_http+1,'canonical manual scheduling is consumed by the publisher');

  -- The production cron promotes planned approved files before calling v5.
  p := public.publication_test_create(105,'queued','manual',false,true);
  PERFORM public.editorial_promover_planejados();
  RETURN NEXT is((SELECT status FROM public.editorial_publications WHERE id=p),'scheduled','canonical approved planned promotion still schedules the manual publication');
  RETURN NEXT is((SELECT asset_count::integer FROM social_private.editorial_publication_delivery_requests WHERE publication_id=p),0,'canonical promotion creates a legitimate empty manual snapshot');
  RETURN NEXT ok((SELECT i.approval_fingerprint=public.editorial_compute_approval_fingerprint(i.post_id) FROM public.editorial_post_internal i WHERE i.post_id=md5('post-105')::uuid),'canonical promotion preserves matching approval fingerprint');
  -- Move the synthetic clock target due, without bypassing any approval gate.
  UPDATE public.editorial_publications SET scheduled_at=now()-interval '1 minute' WHERE id=p;
  SELECT count(*) INTO before_http FROM net.publication_test_http;
  PERFORM public.editorial_autopublish_tick();
  RETURN NEXT is((SELECT count(*) FROM net.publication_test_http),before_http+1,'canonical promoted manual empty snapshot reaches the publisher');

  -- Generic documents may exist in editorial planning, but approval alone
  -- must never allow a document through schedule, publish or either HTTP gate.
  p := public.publication_test_create(401,'queued','manual',false,true);
  UPDATE public.files SET file_name='Synthetic document.pdf',mime_type='application/pdf',file_type='application/pdf',extension='pdf'
    WHERE id=md5('file-401')::uuid;
  UPDATE public.editorial_post_internal SET approval_fingerprint=public.editorial_compute_approval_fingerprint(post_id) WHERE post_id=md5('post-401')::uuid;
  RETURN NEXT ok(public.editorial_file_is_publishable(md5('file-401')::uuid,md5('client-401')::uuid,md5('project-401')::uuid)
    AND NOT public.editorial_file_is_publishable_media(md5('file-401')::uuid,md5('client-401')::uuid,md5('project-401')::uuid),'approved PDF fixture passes approval and fails actual media classification');
  RETURN NEXT throws_ok(format('SELECT public.transition_editorial_publication(%L::uuid,''schedule'',1,now()+interval ''1 day'')',p),'P0001','publication requires ready content and approved immutable files','approved PDF cannot schedule through the official transition');
  RETURN NEXT throws_ok(format('SELECT public.transition_editorial_publication(%L::uuid,''publish'',1,p_permalink=>''https://invalid.example/pdf'')',p),'P0001','publication requires ready content and approved immutable files','approved PDF cannot be marked published through the official transition');
  RETURN NEXT is((public.editorial_promover_planejados()->>'promovidos')::integer,0,'automatic promotion reports no successful PDF scheduling');
  RETURN NEXT is((SELECT status FROM public.editorial_publications WHERE id=p),'planned','planned promotion cannot bypass the PDF media gate');
  RETURN NEXT is((SELECT count(*) FROM social_private.editorial_publication_delivery_requests WHERE publication_id=p),0::bigint,'failed PDF promotion leaves no fabricated delivery snapshot');
  -- Model a bad historical schedule without deleting or modifying its history.
  UPDATE public.editorial_publications SET status='scheduled' WHERE id=p;
  INSERT INTO social_private.autopublish_jobs(publication_id,client_id,stage) VALUES(p,md5('client-401')::uuid,'queued');
  SELECT count(*) INTO before_http FROM net.publication_test_http;
  PERFORM public.editorial_autopublish_tick();
  RETURN NEXT is((SELECT count(*) FROM net.publication_test_http),before_http,'legacy scheduled PDF causes zero preparation HTTP calls');
  RETURN NEXT throws_ok(format('SELECT social_private.autopublish_http(%L::uuid,''POST'',''https://graph.invalid/account/media_publish'')',p),'55000','publication files require approved image or video media','PDF cannot cross the final HTTP dispatch boundary');
  RETURN NEXT is((SELECT count(*) FROM net.publication_test_http),before_http,'blocked PDF final dispatch creates no HTTP request');

  p := public.publication_test_create(402,'queued','manual',false,true);
  UPDATE public.editorial_posts SET content_type='video' WHERE id=md5('post-402')::uuid;
  UPDATE public.files SET file_name='Synthetic clip.mp4',mime_type='video/mp4',file_type='video',extension='mp4' WHERE id=md5('file-402')::uuid;
  UPDATE public.editorial_post_internal SET approval_fingerprint=public.editorial_compute_approval_fingerprint(post_id) WHERE post_id=md5('post-402')::uuid;
  PERFORM public.transition_editorial_publication(p,'schedule',1,p_scheduled_at=>now()-interval '1 minute');
  SELECT count(*) INTO before_http FROM net.publication_test_http;
  PERFORM public.editorial_autopublish_tick();
  RETURN NEXT is((SELECT count(*) FROM net.publication_test_http),before_http+1,'approved manual video remains schedulable and reaches media preparation');
  RETURN NEXT ok((SELECT url LIKE '%video_url=%' FROM net.publication_test_http ORDER BY id DESC LIMIT 1),'the manual video uses the v5 video route');
  SELECT net_request_id INTO req FROM social_private.autopublish_jobs WHERE publication_id=p;
  INSERT INTO net._http_response(id,status_code,content) VALUES(req,200,'{"id":"synthetic-video-container-402"}');
  PERFORM public.editorial_autopublish_tick();
  SELECT net_request_id INTO req FROM social_private.autopublish_jobs WHERE publication_id=p;
  INSERT INTO net._http_response(id,status_code,content) VALUES(req,200,'{"status_code":"FINISHED"}');
  PERFORM public.editorial_autopublish_tick();
  PERFORM public.editorial_autopublish_tick();
  RETURN NEXT is((SELECT count(*) FROM social_private.autopublish_job_events WHERE publication_id=p AND event='publish_dispatched'),1::bigint,'approved video passes the final HTTP media gate');
  UPDATE public.files SET mime_type='application/pdf' WHERE id=md5('file-402')::uuid;
  SELECT count(*) INTO before_http FROM net.publication_test_http;
  RETURN NEXT lives_ok(format('SELECT social_private.autopublish_http(%L::uuid,''GET'',''https://graph.invalid/exact-video/status'')',p),'already dispatched video can reconcile its exact result after metadata changes');
  RETURN NEXT is((SELECT count(*) FROM net.publication_test_http),before_http+1,'reconciliation after dispatch adds only the allowed GET');
  RETURN NEXT throws_ok(format('SELECT social_private.autopublish_http(%L::uuid,''POST'',''https://graph.invalid/account/media_publish'')',p),'55000',NULL,'metadata change cannot authorize a second final POST');
  RETURN NEXT is((SELECT count(*) FROM social_private.autopublish_job_events WHERE publication_id=p AND event='publish_dispatched'),1::bigint,'reconciliation preserves the single final dispatch event');

  p := public.publication_test_create(403,'queued','manual',false,true);
  UPDATE public.editorial_posts SET content_type='carousel' WHERE id=md5('post-403')::uuid;
  INSERT INTO public.files(id,client_id,project_id,parent_file_id,file_name,mime_type,requires_approval)
    VALUES(md5('frame-403')::uuid,md5('client-403')::uuid,md5('project-403')::uuid,md5('file-403')::uuid,'Synthetic frame.png','image/png',true);
  UPDATE public.editorial_post_internal SET approval_fingerprint=public.editorial_compute_approval_fingerprint(post_id) WHERE post_id=md5('post-403')::uuid;
  RETURN NEXT ok(public.editorial_file_is_publishable_media(md5('file-403')::uuid,md5('client-403')::uuid,md5('project-403')::uuid),'client_shared carousel retains inherited approval compatibility');
  PERFORM public.transition_editorial_publication(p,'schedule',1,p_scheduled_at=>now()-interval '1 minute');
  INSERT INTO social_private.autopublish_jobs(publication_id,client_id,stage) VALUES(p,md5('client-403')::uuid,'queued');
  RETURN NEXT lives_ok(format('SELECT social_private.autopublish_assert_dispatch(%L::uuid)',p),'released carousel with an approved image child passes dispatch validation');
  UPDATE public.files SET mime_type='application/pdf' WHERE id=md5('frame-403')::uuid;
  RETURN NEXT ok(NOT public.editorial_file_is_publishable_media(md5('file-403')::uuid,md5('client-403')::uuid,md5('project-403')::uuid),'a PDF child cannot disguise itself with a PNG name');
  SELECT count(*) INTO before_http FROM net.publication_test_http;
  RETURN NEXT throws_ok(format('SELECT social_private.autopublish_http(%L::uuid,''POST'',''https://graph.invalid/account/media_publish'')',p),'55000','publication files require approved image or video media','carousel PDF child blocks the final publication request');
  PERFORM public.editorial_autopublish_tick();
  RETURN NEXT is((SELECT count(*) FROM net.publication_test_http),before_http,'carousel with a PDF child issues no HTTP requests');

  -- Each mutation occurs after the job was prepared; every dispatch rechecks it.
  FOR test_case IN SELECT * FROM (VALUES
    ('kill switch', 'UPDATE social_private.autopublish_settings SET enabled=false'),
    ('future schedule', 'UPDATE public.editorial_publications SET scheduled_at=now()+interval ''1 day'' WHERE id=$1'),
    ('archived post', 'UPDATE public.editorial_posts SET production_status=''archived'',archived_at=now() WHERE id=(SELECT post_id FROM public.editorial_publications WHERE id=$1)'),
    ('withdrawn file approval', 'UPDATE public.files SET agency_approval_status=''not_requested'' WHERE id=(SELECT file_id FROM public.editorial_publications WHERE id=$1)'),
    ('missing approval snapshot', 'UPDATE public.editorial_publication_internal SET included_in_approval_snapshot=false WHERE publication_id=$1'),
    ('stale approval fingerprint', 'UPDATE public.editorial_post_internal SET approval_fingerprint=repeat(''f'',64) WHERE post_id=(SELECT post_id FROM public.editorial_publications WHERE id=$1)'),
    ('changed asset bytes', 'UPDATE public.files SET sha256=repeat(''e'',64) WHERE id=(SELECT file_id FROM public.editorial_publications WHERE id=$1)'),
    ('deleted client', 'UPDATE public.profiles SET deleted_at=now() WHERE id=(SELECT client_id FROM public.editorial_publications WHERE id=$1)'),
    ('deleted project', 'UPDATE public.projects SET deleted_at=now() WHERE id=(SELECT project_id FROM public.editorial_publications WHERE id=$1)'),
    ('inactive account', 'UPDATE public.external_accounts SET status=''inactive'' WHERE id=(SELECT external_account_id FROM public.editorial_publications WHERE id=$1)'),
    ('unlinked account', 'UPDATE public.project_external_accounts SET external_account_id=gen_random_uuid() WHERE project_id=(SELECT project_id FROM public.editorial_publications WHERE id=$1)'),
    ('expired connection', 'UPDATE public.external_account_connections SET expires_at=now()-interval ''1 minute'' WHERE external_account_id=(SELECT external_account_id FROM public.editorial_publications WHERE id=$1)'),
    ('wrong job tenant', 'UPDATE social_private.autopublish_jobs SET client_id=gen_random_uuid() WHERE publication_id=$1'),
    ('changed delivery snapshot', 'UPDATE social_private.editorial_publication_delivery_requests SET asset_count=2 WHERE publication_id=$1'),
    ('disabled automatic connection', 'UPDATE public.external_account_connections SET automation_enabled=false WHERE external_account_id=(SELECT external_account_id FROM public.editorial_publications WHERE id=$1)')
  ) AS cases(label,mutation) LOOP
    n := n+1;
    p := public.publication_test_create(n,'publish','automatic');
    SELECT count(*) INTO before_http FROM net.publication_test_http;
    EXECUTE test_case.mutation USING p;
    PERFORM public.editorial_autopublish_tick();
    RETURN NEXT is((SELECT count(*) FROM net.publication_test_http),before_http,test_case.label||' blocks HTTP at execution time');
    RETURN NEXT is((SELECT attempts::integer FROM social_private.autopublish_jobs WHERE publication_id=p),0,test_case.label||' does not consume attempt budget');
  END LOOP;

  p := public.publication_test_create(301);
  PERFORM social_private.autopublish_assert_dispatch(p);
  UPDATE public.editorial_publications SET caption='New approved caption' WHERE id=p;
  UPDATE public.editorial_post_internal SET approval_fingerprint=public.editorial_compute_approval_fingerprint(post_id) WHERE post_id=md5('post-301')::uuid;
  SELECT count(*) INTO before_http FROM net.publication_test_http;
  PERFORM public.editorial_autopublish_tick();
  RETURN NEXT is((SELECT count(*) FROM net.publication_test_http),before_http,'reapproved changed content cannot reuse a previously prepared container');
  RETURN NEXT is((SELECT stage FROM social_private.autopublish_jobs WHERE publication_id=p),'failed','changed prepared snapshot is visible as a failure that can be reviewed and retried');

  p := public.publication_test_create(304);
  UPDATE social_private.autopublish_jobs SET dispatch_fingerprint=NULL WHERE publication_id=p;
  SELECT count(*) INTO before_http FROM net.publication_test_http;
  PERFORM public.editorial_autopublish_tick();
  RETURN NEXT is((SELECT count(*) FROM net.publication_test_http),before_http,'legacy prepared container without provenance cannot bind to a newer snapshot');
  RETURN NEXT is((SELECT detail->>'container_id' FROM social_private.autopublish_job_events WHERE publication_id=p AND event='preparation_invalidated'),'synthetic-container-304','legacy preparation keeps its provider id in history');
  PERFORM public.retry_autopublish(p);
  RETURN NEXT is((SELECT stage FROM social_private.autopublish_jobs WHERE publication_id=p),'queued','authorized legacy retry starts a fresh preparation');
  RETURN NEXT is((SELECT container_id FROM social_private.autopublish_jobs WHERE publication_id=p),NULL::text,'legacy retry cannot reuse the unproven container');

  p := public.publication_test_create(302);
  PERFORM public.editorial_autopublish_tick();
  SELECT net_request_id INTO req FROM social_private.autopublish_jobs WHERE publication_id=p;
  INSERT INTO net._http_response(id,status_code,content,timed_out) VALUES(req,NULL,'synthetic timeout',true);
  PERFORM public.editorial_autopublish_tick();
  RETURN NEXT is((SELECT stage FROM social_private.autopublish_jobs WHERE publication_id=p),'verify','ambiguous final timeout enters verification');
  SELECT net_request_id INTO req FROM social_private.autopublish_jobs WHERE publication_id=p;
  RETURN NEXT is((SELECT method FROM net.publication_test_http WHERE id=req),'GET','verification uses a read, never another final POST');
  INSERT INTO net._http_response(id,status_code,content) VALUES(req,200,'{"status_code":"FINISHED"}');
  PERFORM public.editorial_autopublish_tick();
  RETURN NEXT is((SELECT stage FROM social_private.autopublish_jobs WHERE publication_id=p),'failed','uncertain FINISHED response requires confirmation without blind resend');
  PERFORM public.retry_autopublish(p);
  SELECT count(*) INTO before_http FROM social_private.autopublish_job_events WHERE publication_id=p AND event='retry';
  PERFORM public.retry_autopublish(p);
  RETURN NEXT is((SELECT count(*) FROM social_private.autopublish_job_events WHERE publication_id=p AND event='retry'),before_http,'duplicate retry is idempotent');
  PERFORM public.editorial_autopublish_tick();
  RETURN NEXT is((SELECT count(*) FROM social_private.autopublish_job_events WHERE publication_id=p AND event='publish_dispatched'),1::bigint,'retry after ambiguous delivery never duplicates a final dispatch');
  SELECT net_request_id INTO req FROM social_private.autopublish_jobs WHERE publication_id=p;
  INSERT INTO net._http_response(id,status_code,content) VALUES(req,200,'{"status_code":"PUBLISHED"}');
  PERFORM public.editorial_autopublish_tick();
  RETURN NEXT is((SELECT media_id FROM social_private.autopublish_jobs WHERE publication_id=p),NULL::text,'PUBLISHED without exact media id never adopts another account post');

  p := public.publication_test_create(305,'recover');
  UPDATE social_private.autopublish_jobs SET publish_dispatched=true,net_request_id=9000305 WHERE publication_id=p;
  INSERT INTO net._http_response(id,status_code,content) VALUES(9000305,200,'{"data":[{"id":"unrelated-media","permalink":"https://invalid.example/unrelated"}]}');
  SELECT count(*) INTO before_http FROM net.publication_test_http;
  PERFORM public.editorial_autopublish_tick();
  RETURN NEXT is((SELECT media_id FROM social_private.autopublish_jobs WHERE publication_id=p),NULL::text,'legacy recovery response cannot attribute an unrelated post');
  RETURN NEXT is((SELECT count(*) FROM net.publication_test_http),before_http,'legacy recovery does not issue another request');

  p := public.publication_test_create(303);
  SELECT count(*) INTO before_http FROM net.publication_test_http;
  BEGIN
    PERFORM public.editorial_autopublish_tick();
    RAISE EXCEPTION 'synthetic rollback';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  RETURN NEXT is((SELECT count(*) FROM net.publication_test_http),before_http,'transaction rollback also rolls back the mocked pg_net enqueue');
  RETURN NEXT is((SELECT count(*) FROM social_private.autopublish_job_events WHERE publication_id=p),0::bigint,'rolled-back request leaves no committed dispatch event');
  RETURN NEXT throws_ok('UPDATE social_private.autopublish_job_events SET detail=''{}''','55000',NULL,'dispatch history rejects mutation');
  RETURN NEXT ok(NOT EXISTS(SELECT 1 FROM social_private.autopublish_job_events WHERE detail::text LIKE '%access_token%' OR detail::text LIKE '%synthetic-not-a-token%'),'audit details contain neither provider tokens nor credential URLs');
END $$;
SELECT * FROM pg_temp.publication_contract_tests();
SELECT * FROM finish();
ROLLBACK;
