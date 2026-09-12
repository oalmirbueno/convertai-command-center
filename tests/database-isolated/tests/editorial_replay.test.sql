BEGIN;
SELECT no_plan();
SELECT is((SELECT count(*)::integer FROM aceleriq_ci_replay.editorial_attestations WHERE restored),2,'both historical addressing adapters restored their names');
SELECT ok(to_regprocedure('public.ci_replay_original_editorial(jsonb,integer)') IS NULL,'no temporary function name remains');
SELECT ok(NOT has_function_privilege('anon','public.save_approved_editorial_post_unlocked(jsonb,integer)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.save_approved_editorial_post_unlocked(jsonb,integer)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.save_approved_editorial_post_unlocked(jsonb,integer)','EXECUTE'),
 'approved helper retains its private original ACL');
SELECT ok(has_function_privilege('service_role','public.save_editorial_post_unlocked(jsonb,integer)','EXECUTE'),
 'regular helper retains legitimate service_role execution');
SELECT ok(NOT EXISTS(SELECT 1 FROM aceleriq_ci_replay.editorial_attestations a
 JOIN pg_proc p ON p.oid=a.regular_oid WHERE md5(p.prosrc)<>a.regular_body_md5),
 'regular business body remains byte-identical through both adapters');
SELECT ok(NOT EXISTS(SELECT 1 FROM aceleriq_ci_replay.editorial_attestations a
 WHERE a.regular_oid <> 'public.save_editorial_post_unlocked(jsonb,integer)'::regprocedure::oid
 OR a.approved_oid <> 'public.save_approved_editorial_post_unlocked(jsonb,integer)'::regprocedure::oid),
 'original function OIDs survive renaming and restoration');

INSERT INTO public.profiles(id) VALUES(md5('replay-admin')::uuid),(md5('replay-client')::uuid);
INSERT INTO public.user_roles VALUES(md5('replay-admin')::uuid,'admin'),(md5('replay-client')::uuid,'client');
INSERT INTO public.projects(id,client_id) VALUES(md5('replay-project')::uuid,md5('replay-client')::uuid);
INSERT INTO public.external_accounts(id,client_id) VALUES(md5('replay-account')::uuid,md5('replay-client')::uuid);
INSERT INTO public.project_external_accounts VALUES(md5('replay-project')::uuid,md5('replay-account')::uuid,md5('replay-client')::uuid);
INSERT INTO public.files(id,client_id,project_id,file_name,visibility,approval_status,client_decided_at)
 SELECT md5('replay-file-'||n)::uuid,md5('replay-client')::uuid,md5('replay-project')::uuid,
 'Synthetic replay '||n||'.png',CASE WHEN n=3 THEN 'client_shared' ELSE 'approval' END,
 CASE WHEN n=3 THEN 'none' ELSE 'approved' END,
 CASE WHEN n=3 THEN NULL ELSE now()-interval '1 day' END
 FROM generate_series(1,6) n;
INSERT INTO public.editorial_posts(id,client_id,project_id,primary_file_id,title,content_type,production_status,archived_at)
 SELECT md5('replay-existing-'||n)::uuid,md5('replay-client')::uuid,md5('replay-project')::uuid,
 CASE WHEN n IN (1,2) THEN md5('replay-file-'||n)::uuid ELSE NULL END,
 'Existing synthetic '||n,'static',CASE WHEN n IN (2,6) THEN 'archived' ELSE 'draft' END,CASE WHEN n IN (2,6) THEN now() ELSE NULL END
 FROM unnest(ARRAY[1,2,5,6]) n;
INSERT INTO public.editorial_publications(id,post_id,client_id,project_id,external_account_id,file_id,platform,status)
 SELECT md5('replay-publication-'||n)::uuid,md5('replay-existing-'||n)::uuid,
 md5('replay-client')::uuid,md5('replay-project')::uuid,md5('replay-account')::uuid,
 md5('replay-file-'||n)::uuid,'instagram','planned' FROM unnest(ARRAY[5,6]) n;
CREATE TEMP TABLE replay_before AS SELECT
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.editorial_posts p) posts,
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.editorial_publications p) publications;
CREATE FUNCTION pg_temp.payload(n integer) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('client_id',md5('replay-client')::uuid,'project_id',md5('replay-project')::uuid,
 'primary_file_id',md5('replay-file-'||n)::uuid,'idempotency_key',md5('replay-idempotency-'||n)::uuid,
 'mutation_id',md5('replay-mutation-'||n)::uuid,'publications','[]'::jsonb);
$$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',md5('replay-admin')::uuid,'role','authenticated')::text,true);
SELECT throws_ok($$SELECT public.save_approved_editorial_post_unlocked(pg_temp.payload(1))$$,
 'P0001','approved editorial media is already linked to another content','live post still locks its approved media');
SELECT throws_ok($$SELECT public.save_approved_editorial_post_unlocked(pg_temp.payload(5))$$,
 'P0001','approved editorial media is already linked to another content','live publication still locks its approved media');
SELECT lives_ok($$SELECT public.save_approved_editorial_post_unlocked(pg_temp.payload(2))$$,'archived post releases approved media through the real function');
SELECT lives_ok($$SELECT public.save_approved_editorial_post_unlocked(pg_temp.payload(6))$$,'publication belonging to an archived post releases approved media');
SELECT lives_ok($$SELECT public.save_approved_editorial_post_unlocked(pg_temp.payload(3))$$,'client_shared media works without a client decision timestamp');
SELECT is((SELECT count(*)::integer FROM public.editorial_posts),7,'three permitted adoptions create real new posts');
SELECT is((SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.editorial_posts p WHERE id IN
 (SELECT (value->>'id')::uuid FROM replay_before,jsonb_array_elements(posts))),(SELECT posts FROM replay_before),
 'existing and archived posts retain every field');
SELECT is((SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.editorial_publications p),(SELECT publications FROM replay_before),
 'existing publications retain every field');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',md5('replay-client')::uuid,'role','authenticated')::text,true);
SELECT throws_ok($$SELECT public.save_approved_editorial_post_unlocked(pg_temp.payload(4))$$,
 'P0001','editorial client access denied','client role cannot use the approved staff flow');
SELECT is((SELECT count(*)::integer FROM public.editorial_events),3,'only allowed adoptions produce audit events');
SELECT * FROM finish();
ROLLBACK;
