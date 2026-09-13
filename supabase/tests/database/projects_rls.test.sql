-- Run against the disposable full-migration database via supabase test db.
-- Real project/task RLS and API grants are exercised; no policy is replaced by
-- this test. Only synthetic fixture triggers are silenced in this transaction.
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT * FROM no_plan();

ALTER TABLE public.profiles DISABLE TRIGGER USER;
ALTER TABLE public.projects DISABLE TRIGGER USER;
ALTER TABLE public.tasks DISABLE TRIGGER USER;
ALTER TABLE public.team_client_assignments DISABLE TRIGGER USER;

CREATE TEMP TABLE project_test_actors(id uuid PRIMARY KEY,role public.app_role);
INSERT INTO project_test_actors VALUES
 ('b7100000-0000-4000-8000-000000000001','admin'),
 ('b7100000-0000-4000-8000-000000000002','manager'),
 ('b7100000-0000-4000-8000-000000000003','design'),
 ('b7100000-0000-4000-8000-000000000004','traffic'),
 ('b7100000-0000-4000-8000-000000000005','manager'),
 ('b7100000-0000-4000-8000-000000000006','design'),
 ('b7100000-0000-4000-8000-000000000007','traffic'),
 ('b7100000-0000-4000-8000-00000000000a','client'),
 ('b7100000-0000-4000-8000-00000000000b','client');
INSERT INTO auth.users(id,email)
 SELECT id,'projects-rls-' || id::text || '@example.invalid' FROM project_test_actors;
-- The real Auth trigger creates the profile and default client role. The full
-- schema permits one role per user; set each synthetic actor's role in place.
INSERT INTO public.user_roles(user_id,role) SELECT id,role FROM project_test_actors
 ON CONFLICT(user_id) DO UPDATE SET role=EXCLUDED.role;
INSERT INTO public.team_client_assignments(user_id,client_id) VALUES
 ('b7100000-0000-4000-8000-000000000002','b7100000-0000-4000-8000-00000000000a'),
 ('b7100000-0000-4000-8000-000000000003','b7100000-0000-4000-8000-00000000000a'),
 ('b7100000-0000-4000-8000-000000000004','b7100000-0000-4000-8000-00000000000a');
INSERT INTO public.projects(id,client_id,name,project_type,status,start_date,deadline,billing_mode,deleted_at) VALUES
 ('b7200000-0000-4000-8000-000000000001','b7100000-0000-4000-8000-00000000000a','Project RLS active A','recurring','active',current_date,current_date+30,'included',NULL),
 ('b7200000-0000-4000-8000-000000000002','b7100000-0000-4000-8000-00000000000b','Project RLS active B','recurring','active',current_date,current_date+30,'included',NULL),
 ('b7200000-0000-4000-8000-000000000003','b7100000-0000-4000-8000-00000000000a','Project RLS archived A','recurring','active',current_date,current_date+30,'included','2026-09-01T00:00:00Z'),
 ('b7200000-0000-4000-8000-000000000004','b7100000-0000-4000-8000-00000000000b','Project RLS archived B','recurring','active',current_date,current_date+30,'included','2026-09-01T00:00:00Z');
INSERT INTO public.tasks(id,project_id,title,assigned_to) VALUES
 ('b7300000-0000-4000-8000-000000000001','b7200000-0000-4000-8000-000000000001','Project RLS team task',NULL),
 ('b7300000-0000-4000-8000-000000000002','b7200000-0000-4000-8000-000000000002','Task assignment is not a client assignment','b7100000-0000-4000-8000-000000000006');
CREATE TEMP TABLE project_rows_before AS
 SELECT jsonb_agg(to_jsonb(p) ORDER BY id) AS rows FROM public.projects p
 WHERE id BETWEEN 'b7200000-0000-4000-8000-000000000001' AND 'b7200000-0000-4000-8000-000000000004';

CREATE FUNCTION pg_temp.project_act_as(_uid uuid,_role text DEFAULT 'authenticated') RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub',COALESCE(_uid::text,''),true);
  PERFORM set_config('request.jwt.claims',json_build_object('sub',_uid,'role',_role)::text,true);
  EXECUTE format('SET LOCAL ROLE %I',_role);
END $$;
CREATE FUNCTION pg_temp.project_owner() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{}',true);
END $$;
CREATE FUNCTION pg_temp.project_count() RETURNS integer
LANGUAGE sql SECURITY INVOKER AS $$
 SELECT count(*)::integer FROM public.projects
 WHERE id BETWEEN 'b7200000-0000-4000-8000-000000000001' AND 'b7200000-0000-4000-8000-000000000004'
$$;
CREATE FUNCTION pg_temp.project_scope(_uid uuid,_client uuid,_label text) RETURNS SETOF text
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  PERFORM pg_temp.project_act_as(_uid);
  RETURN NEXT is((SELECT count(*)::integer FROM public.projects WHERE client_id=_client AND deleted_at IS NULL),1,_label || ' reads the assigned or owned active project');
  RETURN NEXT is((SELECT count(*)::integer FROM public.projects WHERE client_id=_client AND deleted_at IS NOT NULL),1,_label || ' retains authorized archived project history');
  RETURN NEXT is((SELECT count(*)::integer FROM public.projects WHERE client_id<>_client
    AND id BETWEEN 'b7200000-0000-4000-8000-000000000001' AND 'b7200000-0000-4000-8000-000000000004'),0,_label || ' cannot read other client active or archived projects');
END $$;
CREATE FUNCTION pg_temp.anonymous_projects_denied() RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  RETURN pg_temp.project_count()=0;
EXCEPTION WHEN insufficient_privilege THEN
  -- Both a denied table grant and zero rows under RLS are valid for anon.
  RETURN true;
END $$;

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.projects'::regclass),'projects RLS remains enabled');
SELECT ok(has_table_privilege('authenticated','public.projects','SELECT'),'authenticated SELECT privilege exists before row isolation is tested');
-- SET ROLE exercises RLS without requiring postgres to be a superuser. The
-- isolated caller suite separately verifies authenticator session identity.
SELECT * FROM pg_temp.project_scope('b7100000-0000-4000-8000-000000000002','b7100000-0000-4000-8000-00000000000a','assigned manager');
SELECT * FROM pg_temp.project_scope('b7100000-0000-4000-8000-000000000003','b7100000-0000-4000-8000-00000000000a','assigned design');
SELECT * FROM pg_temp.project_scope('b7100000-0000-4000-8000-000000000004','b7100000-0000-4000-8000-00000000000a','assigned traffic');
SELECT lives_ok($$SELECT task.id FROM public.tasks task JOIN public.projects project ON project.id=task.project_id
 WHERE task.id='b7300000-0000-4000-8000-000000000001'$$,'project/task RLS joins do not recurse');
SELECT is((SELECT count(*)::integer FROM public.tasks WHERE id='b7300000-0000-4000-8000-000000000001'),1,'client assignment preserves task access without an individual task assignment');
SELECT * FROM pg_temp.project_scope('b7100000-0000-4000-8000-00000000000a','b7100000-0000-4000-8000-00000000000a','client A');
SELECT * FROM pg_temp.project_scope('b7100000-0000-4000-8000-00000000000b','b7100000-0000-4000-8000-00000000000b','client B');
SELECT pg_temp.project_act_as('b7100000-0000-4000-8000-000000000005');
SELECT is(pg_temp.project_count(),0,'unassigned manager cannot read any active or archived project');
SELECT pg_temp.project_act_as('b7100000-0000-4000-8000-000000000006');
SELECT is(pg_temp.project_count(),0,'unassigned design cannot read any project even with an individually assigned task');
SELECT is((SELECT count(*)::integer FROM public.tasks WHERE id='b7300000-0000-4000-8000-000000000002'),0,'task assignment alone still does not bypass the existing client boundary');
SELECT pg_temp.project_act_as('b7100000-0000-4000-8000-000000000007');
SELECT is(pg_temp.project_count(),0,'unassigned traffic cannot read any active or archived project');
SELECT pg_temp.project_act_as('b7100000-0000-4000-8000-000000000001');
SELECT is(pg_temp.project_count(),4,'admin retains every project without requiring client assignments');
SELECT pg_temp.project_act_as(NULL,'anon');
SELECT ok(pg_temp.anonymous_projects_denied(),'anonymous request cannot read any project');
SELECT pg_temp.project_act_as(NULL);
SELECT is(pg_temp.project_count(),0,'authenticated request without uid cannot read projects');
SELECT pg_temp.project_act_as(NULL,'service_role');
SELECT is(pg_temp.project_count(),4,'trusted service retains all active and archived projects');
SELECT pg_temp.project_owner();
SELECT is((SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.projects p
 WHERE id BETWEEN 'b7200000-0000-4000-8000-000000000001' AND 'b7200000-0000-4000-8000-000000000004'),
 (SELECT rows FROM project_rows_before),'authorization checks preserve all project fields and historical rows');
SELECT * FROM finish();
ROLLBACK;
