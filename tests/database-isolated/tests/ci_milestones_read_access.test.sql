BEGIN;
SELECT no_plan();
SELECT throws_ok(__GRANT_SCRIPT__,'P0001','CI_MILESTONES_REQUIRES_ISOLATED_REPLAY',
  'missing explicit CI execution marker fails closed');
SET aceleriq.ci_legacy_read_grants='on';
SELECT throws_ok(__GRANT_SCRIPT__,'P0001','CI_MILESTONES_REQUIRES_REPLAY_ATTESTATION',
  'an unfinished replay cannot install the legacy read prerequisite');
UPDATE aceleriq_ci_replay.operator_parent_attestation SET frozen=true;
SELECT ok(NOT has_table_privilege('authenticated','public.milestones','SELECT'),
  'fresh replay reproduces the missing authenticated read privilege');

CREATE TEMP TABLE milestone_metadata_before AS
SELECT jsonb_build_object('oid',c.oid,'owner',c.relowner,'rls',c.relrowsecurity,
  'force_rls',c.relforcerowsecurity,
  'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p WHERE p.polrelid=c.oid),
  'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_default_acl d)) AS metadata,
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.grantor,x.grantee,x.privilege_type)
   FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x
   WHERE NOT (x.grantee='authenticated'::regrole AND x.privilege_type='SELECT')) AS other_acl
FROM pg_class c WHERE c.oid='public.milestones'::regclass;
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  'SELECT t.id,p.name,a.id,a.full_name,m.id,m.title FROM public.tasks t
   LEFT JOIN public.projects p ON p.id=t.project_id
   LEFT JOIN public.profiles a ON a.id=t.assigned_to
   LEFT JOIN public.milestones m ON m.id=t.milestone_id',
  '42501','permission denied for table milestones',
  'the real embedded join is denied even when the task table is empty');
RESET ROLE;
SELECT lives_ok(__GRANT_SCRIPT__,'guarded prerequisite installs the single legacy SELECT grant');
SELECT ok(has_table_privilege('authenticated','public.milestones','SELECT'),
  'authenticated can read milestones for the PostgREST join');
SELECT ok(NOT has_table_privilege('authenticated','public.milestones','SELECT WITH GRANT OPTION'),
  'authenticated cannot delegate the new read privilege');
SELECT ok(NOT has_table_privilege('authenticated','public.milestones','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'no authenticated write, truncate, reference or trigger privilege was added');
SELECT ok(NOT has_table_privilege('anon','public.milestones','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'the broad legacy anon ACL was not copied');
SELECT ok(NOT has_table_privilege('service_role','public.milestones','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'the service role ACL was not broadened');
SELECT is(
  (SELECT jsonb_build_object('oid',c.oid,'owner',c.relowner,'rls',c.relrowsecurity,
    'force_rls',c.relforcerowsecurity,
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p WHERE p.polrelid=c.oid),
    'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_default_acl d))
   FROM pg_class c WHERE c.oid='public.milestones'::regclass),
  (SELECT metadata FROM milestone_metadata_before),
  'table identity, RLS, policy identities/bodies/roles and default privileges are unchanged');
SELECT is(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.grantor,x.grantee,x.privilege_type)
   FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x
   WHERE c.oid='public.milestones'::regclass
     AND NOT (x.grantee='authenticated'::regrole AND x.privilege_type='SELECT')),
  (SELECT other_acl FROM milestone_metadata_before),'every other ACL entry is unchanged');
SELECT lives_ok(__GRANT_SCRIPT__,'reapplying the empty CI prerequisite is idempotent');

SET LOCAL ROLE authenticated;
SELECT lives_ok(
  'SELECT t.id,p.name,a.id,a.full_name,m.id,m.title FROM public.tasks t
   LEFT JOIN public.projects p ON p.id=t.project_id
   LEFT JOIN public.profiles a ON a.id=t.assigned_to
   LEFT JOIN public.milestones m ON m.id=t.milestone_id',
  'the unchanged real embedded join is allowed after the grant');
RESET ROLE;

-- Populate only disposable identities after the empty-stack grant guard ran.
INSERT INTO auth.users(id)
SELECT ('76000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,5)n;
INSERT INTO public.profiles(id,full_name,email)
SELECT id,'CI synthetic milestone role','fixture@example.test' FROM auth.users;
INSERT INTO public.user_roles(user_id,role)
SELECT id,CASE right(id::text,1) WHEN '1' THEN 'admin'::app_role
  WHEN '4' THEN 'design'::app_role ELSE 'client'::app_role END FROM auth.users;
INSERT INTO public.projects(id,client_id,name,project_type,start_date,deadline)
VALUES
 ('76100000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000002','CI project A','social_media',current_date,current_date+30),
 ('76100000-0000-4000-8000-000000000002','76000000-0000-4000-8000-000000000003','CI project B','social_media',current_date,current_date+30);
INSERT INTO public.milestones(id,project_id,title,target_date)
VALUES
 ('76200000-0000-4000-8000-000000000001','76100000-0000-4000-8000-000000000001','CI milestone A',current_date+7),
 ('76200000-0000-4000-8000-000000000002','76100000-0000-4000-8000-000000000002','CI milestone B',current_date+7);
INSERT INTO public.tasks(id,project_id,title,milestone_id,assigned_to)
VALUES
 ('76300000-0000-4000-8000-000000000001','76100000-0000-4000-8000-000000000001','CI task A','76200000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000004'),
 ('76300000-0000-4000-8000-000000000002','76100000-0000-4000-8000-000000000002','CI task B','76200000-0000-4000-8000-000000000002',NULL);
SELECT throws_ok(__GRANT_SCRIPT__,'P0001','CI_MILESTONES_REQUIRES_EMPTY_STACK',
  'the prerequisite refuses any populated application stack');
SELECT is((SELECT count(*)::integer FROM public.milestones),2,'denied reapplication preserves every synthetic row');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='76000000-0000-4000-8000-000000000001';
SELECT is((SELECT count(*)::integer FROM public.milestones),2,'canonical RLS still allows admin global reads');
SET LOCAL request.jwt.claim.sub='76000000-0000-4000-8000-000000000002';
SELECT results_eq('SELECT title FROM public.milestones ORDER BY title',
  ARRAY['CI milestone A']::text[],'client A sees its own milestone only');
SET LOCAL request.jwt.claim.sub='76000000-0000-4000-8000-000000000003';
SELECT results_eq('SELECT title FROM public.milestones ORDER BY title',
  ARRAY['CI milestone B']::text[],'client B sees its own milestone only');
SET LOCAL request.jwt.claim.sub='76000000-0000-4000-8000-000000000005';
SELECT is((SELECT count(*)::integer FROM public.milestones),0,'an unrelated client sees no milestones');
SET LOCAL request.jwt.claim.sub='76000000-0000-4000-8000-000000000004';
SELECT is((SELECT count(*)::integer FROM public.milestones),2,
  'existing staff milestone read policy remains unchanged');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok('SELECT id FROM public.milestones','42501','permission denied for table milestones',
  'anonymous direct read is still denied by the untouched CI ACL');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
