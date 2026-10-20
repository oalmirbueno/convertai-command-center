-- Assert that the original brand migration really ran, then remove its fixtures.
DO $ci$
BEGIN
  IF session_user <> 'postgres'
     OR NOT (current_database()='postgres' OR current_database() LIKE 'acq_isolated_%')
     OR to_regclass('aceleriq_ci_replay.brand_fixture') IS NULL THEN
    RAISE EXCEPTION 'CI_BRAND_CLEANUP_REQUIRES_ATTESTATION';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM aceleriq_ci_replay.brand_fixture
       WHERE NOT restored AND source_sha256='__SOURCE_SHA256__')
     OR (SELECT count(*) FROM auth.users) <> 1
     OR (SELECT count(*) FROM public.profiles) <> 1
     OR (SELECT count(*) FROM public.projects) <> 2
     OR (SELECT count(*) FROM public.cliente_marcas) <> 2
     OR (SELECT count(*) FROM public.cliente_marcas
       WHERE client_id='39ebda82-637c-498b-a23a-b622f645e852'
         AND ((nome='Acerbi' AND principal AND project_id='c1b00000-0000-4000-8000-000000000001')
           OR (nome='CME' AND NOT principal AND project_id='c1b00000-0000-4000-8000-000000000002'))) <> 2 THEN
    RAISE EXCEPTION 'CI_BRAND_MIGRATION_RESULT_MISMATCH';
  END IF;
  DELETE FROM auth.users WHERE id='39ebda82-637c-498b-a23a-b622f645e852' AND email='brand-replay@ci.invalid';
  IF EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM public.profiles)
     OR EXISTS(SELECT 1 FROM public.projects) OR EXISTS(SELECT 1 FROM public.cliente_marcas)
     OR EXISTS(SELECT 1 FROM public.user_roles) THEN
    RAISE EXCEPTION 'CI_BRAND_FIXTURES_NOT_REMOVED';
  END IF;
  UPDATE aceleriq_ci_replay.brand_fixture SET restored=true;
END $ci$;
