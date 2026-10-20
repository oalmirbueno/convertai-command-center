-- Synthetic prerequisites for the immutable, client-specific brand data SQL.
-- This template is staged only by prepare-ci-brand-replay.mjs in GitHub CI.
DO $ci$
BEGIN
  IF session_user <> 'postgres'
     OR NOT (current_database()='postgres' OR current_database() LIKE 'acq_isolated_%')
     OR to_regclass('aceleriq_ci_replay.editorial_attestations') IS NULL THEN
    RAISE EXCEPTION 'CI_BRAND_REQUIRES_ISOLATED_REPLAY';
  END IF;
  IF (SELECT count(*) FROM aceleriq_ci_replay.editorial_attestations WHERE restored) <> 2
     OR to_regclass('aceleriq_ci_replay.brand_fixture') IS NOT NULL
     OR EXISTS(SELECT 1 FROM auth.users)
     OR EXISTS(SELECT 1 FROM public.profiles)
     OR EXISTS(SELECT 1 FROM public.projects)
     OR EXISTS(SELECT 1 FROM public.cliente_marcas) THEN
    RAISE EXCEPTION 'CI_BRAND_REQUIRES_EMPTY_DATABASE';
  END IF;
  -- Do not execute an unreviewed INSERT/DELETE trigger or dispatch a network call.
  IF EXISTS(SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
      AND tgrelid IN ('public.profiles'::regclass,'public.projects'::regclass)
      AND (tgtype & 12) <> 0)
     OR EXISTS(SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
       AND tgrelid='auth.users'::regclass AND (tgtype & 4) <> 0
       AND tgfoid <> 'public.handle_new_user()'::regprocedure)
     OR (SELECT prosrc ~* '\m(http|dblink|net|pg_notify|cron|execute|perform)\M'
         FROM pg_proc WHERE oid='public.handle_new_user()'::regprocedure) THEN
    RAISE EXCEPTION 'CI_BRAND_UNREVIEWED_TRIGGER';
  END IF;
  CREATE TABLE aceleriq_ci_replay.brand_fixture (
    singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
    source_sha256 text NOT NULL,
    restored boolean NOT NULL DEFAULT false
  );
  REVOKE ALL ON aceleriq_ci_replay.brand_fixture FROM PUBLIC,anon,authenticated,service_role;
  INSERT INTO aceleriq_ci_replay.brand_fixture(source_sha256) VALUES ('__SOURCE_SHA256__');
  -- No password, session or real personal data; the historical SQL fixes this ID.
  INSERT INTO auth.users(id,email,raw_user_meta_data,banned_until)
  VALUES ('39ebda82-637c-498b-a23a-b622f645e852','brand-replay@ci.invalid',
    '{"full_name":"CI synthetic brand fixture","role":"client"}'::jsonb,'infinity');
  UPDATE public.profiles SET plan_status='inactive' WHERE id='39ebda82-637c-498b-a23a-b622f645e852';
  INSERT INTO public.projects(id,client_id,name,project_type,status,start_date,deadline)
  VALUES
    ('c1b00000-0000-4000-8000-000000000001','39ebda82-637c-498b-a23a-b622f645e852',
      'Presença Digital Estratégica Acerbi [CI synthetic]','marketing','cancelled','2099-01-01','2099-01-01'),
    ('c1b00000-0000-4000-8000-000000000002','39ebda82-637c-498b-a23a-b622f645e852',
      'CME Acerbi [CI synthetic]','marketing','cancelled','2099-01-01','2099-01-01');
END $ci$;
