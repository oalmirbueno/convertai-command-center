-- CI replay prerequisite only; never a production migration.
-- Read-only catalog review of jjjtkowvxemvituvywvf on 2026-09-12 confirmed
-- authenticated SELECT and this exact RLS predicate. The tracked 2026-02-23
-- table creation relied on legacy Supabase default grants; no historical SQL
-- grants milestones access explicitly. Restore only the read privilege needed
-- by the real tasks -> milestones PostgREST embed, not the legacy broad ACL.
DO $ci$
DECLARE
  before_relation jsonb;
  after_relation jsonb;
  before_other_acl jsonb;
  after_other_acl jsonb;
  before_defaults jsonb;
BEGIN
  IF session_user <> 'postgres'
    OR current_setting('aceleriq.ci_legacy_read_grants', true) IS DISTINCT FROM 'on'
    OR (current_database() <> 'postgres' AND NOT (
      current_database() LIKE 'acq_isolated_%'
      AND current_setting('aceleriq.isolated_tests', true) = 'on'
    ))
    OR to_regclass('aceleriq_ci_replay.operator_parent_attestation') IS NULL THEN
    RAISE EXCEPTION 'CI_MILESTONES_REQUIRES_ISOLATED_REPLAY';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM aceleriq_ci_replay.operator_parent_attestation WHERE frozen
  ) THEN
    RAISE EXCEPTION 'CI_MILESTONES_REQUIRES_REPLAY_ATTESTATION';
  END IF;
  IF EXISTS(SELECT 1 FROM auth.users)
    OR EXISTS(SELECT 1 FROM public.profiles)
    OR EXISTS(SELECT 1 FROM public.user_roles)
    OR EXISTS(SELECT 1 FROM public.projects)
    OR EXISTS(SELECT 1 FROM public.tasks)
    OR EXISTS(SELECT 1 FROM public.milestones) THEN
    RAISE EXCEPTION 'CI_MILESTONES_REQUIRES_EMPTY_STACK';
  END IF;
  PERFORM set_config('search_path', 'public,pg_catalog', true);
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c WHERE c.oid='public.milestones'::regclass
      AND c.relowner='postgres'::regrole AND c.relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policy p WHERE p.polrelid='public.milestones'::regclass
      AND p.polname='milestones_select' AND p.polcmd='r' AND p.polpermissive
      AND p.polroles=ARRAY['authenticated'::regrole::oid]
      AND pg_get_expr(p.polqual,p.polrelid)=
        '(is_staff(auth.uid()) OR user_owns_project(auth.uid(), project_id))'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid='public.tasks'::regclass
      AND conname='tasks_milestone_id_fkey' AND contype='f'
      AND confrelid='public.milestones'::regclass
  ) THEN
    RAISE EXCEPTION 'CI_MILESTONES_CANONICAL_SCHEMA_DRIFT';
  END IF;

  SELECT jsonb_build_object('oid',c.oid,'owner',c.relowner,
    'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid)
      FROM pg_policy p WHERE p.polrelid=c.oid))
  INTO before_relation FROM pg_class c WHERE c.oid='public.milestones'::regclass;
  SELECT jsonb_agg(to_jsonb(x) ORDER BY x.grantor,x.grantee,x.privilege_type)
  INTO before_other_acl FROM pg_class c
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x
  WHERE c.oid='public.milestones'::regclass
    AND NOT (x.grantee='authenticated'::regrole AND x.privilege_type='SELECT');
  SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) INTO before_defaults FROM pg_default_acl d;

  GRANT SELECT ON public.milestones TO authenticated;

  SELECT jsonb_build_object('oid',c.oid,'owner',c.relowner,
    'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid)
      FROM pg_policy p WHERE p.polrelid=c.oid))
  INTO after_relation FROM pg_class c WHERE c.oid='public.milestones'::regclass;
  SELECT jsonb_agg(to_jsonb(x) ORDER BY x.grantor,x.grantee,x.privilege_type)
  INTO after_other_acl FROM pg_class c
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x
  WHERE c.oid='public.milestones'::regclass
    AND NOT (x.grantee='authenticated'::regrole AND x.privilege_type='SELECT');
  IF after_relation IS DISTINCT FROM before_relation
    OR after_other_acl IS DISTINCT FROM before_other_acl
    OR (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_default_acl d)
      IS DISTINCT FROM before_defaults
    OR NOT has_table_privilege('authenticated','public.milestones','SELECT')
    OR has_table_privilege('authenticated','public.milestones','SELECT WITH GRANT OPTION') THEN
    RAISE EXCEPTION 'CI_MILESTONES_UNEXPECTED_PERMISSION_CHANGE';
  END IF;
  RAISE NOTICE 'CI restored only authenticated SELECT on milestones; identity, RLS, policies, other ACLs and default privileges preserved';
END
$ci$;
