-- Template materialized only by prepare-ci-editorial-replay.mjs in GitHub CI.
-- The next immutable historical file runs against the real approved-media body.
DO $ci$
DECLARE regular record; approved record;
BEGIN
  IF session_user <> 'postgres'
     OR NOT (current_database()='postgres' OR current_database() LIKE 'acq_isolated_%')
     OR EXISTS(SELECT 1 FROM public.editorial_posts)
     OR EXISTS(SELECT 1 FROM public.editorial_publications) THEN
    RAISE EXCEPTION 'CI_EDITORIAL_REPLAY_REQUIRES_EMPTY_LOCAL_DATABASE';
  END IF;
  IF to_regprocedure('public.ci_replay_original_editorial(jsonb,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'CI_EDITORIAL_TEMPORARY_NAME_ALREADY_EXISTS';
  END IF;
  SELECT * INTO STRICT regular FROM pg_proc WHERE oid='public.save_editorial_post_unlocked(jsonb,integer)'::regprocedure;
  SELECT * INTO STRICT approved FROM pg_proc WHERE oid='public.save_approved_editorial_post_unlocked(jsonb,integer)'::regprocedure;
  IF md5(approved.prosrc) <> '__EXPECTED_MD5__'
     OR position('approved editorial media is already linked to another content' IN regular.prosrc) > 0
     OR regular.proowner <> 'postgres'::regrole OR approved.proowner <> 'postgres'::regrole
     OR NOT regular.prosecdef OR NOT approved.prosecdef
     OR has_function_privilege('anon',regular.oid,'EXECUTE')
     OR has_function_privilege('authenticated',regular.oid,'EXECUTE')
     OR NOT has_function_privilege('service_role',regular.oid,'EXECUTE')
     OR has_function_privilege('anon',approved.oid,'EXECUTE')
     OR has_function_privilege('authenticated',approved.oid,'EXECUTE')
     OR has_function_privilege('service_role',approved.oid,'EXECUTE') THEN
    RAISE EXCEPTION 'CI_EDITORIAL_CANONICAL_BODY_OR_ACL_MISMATCH';
  END IF;
  CREATE SCHEMA IF NOT EXISTS aceleriq_ci_replay;
  REVOKE ALL ON SCHEMA aceleriq_ci_replay FROM PUBLIC, anon, authenticated, service_role;
  CREATE TABLE IF NOT EXISTS aceleriq_ci_replay.editorial_attestations (
    stage text PRIMARY KEY, regular_oid oid NOT NULL, approved_oid oid NOT NULL,
    regular_body_md5 text NOT NULL, approved_before_md5 text NOT NULL,
    regular_metadata jsonb NOT NULL, approved_metadata jsonb NOT NULL,
    restored boolean NOT NULL DEFAULT false
  );
  IF EXISTS(SELECT 1 FROM aceleriq_ci_replay.editorial_attestations WHERE stage='__STAGE__') THEN
    RAISE EXCEPTION 'CI_EDITORIAL_STAGE_ALREADY_USED';
  END IF;
  INSERT INTO aceleriq_ci_replay.editorial_attestations
    (stage,regular_oid,approved_oid,regular_body_md5,approved_before_md5,regular_metadata,approved_metadata)
    VALUES ('__STAGE__',regular.oid,approved.oid,md5(regular.prosrc),md5(approved.prosrc),
      jsonb_build_object('owner',regular.proowner::text,'definer',regular.prosecdef,'config',regular.proconfig,'acl',regular.proacl::text),
      jsonb_build_object('owner',approved.proowner::text,'definer',approved.prosecdef,'config',approved.proconfig,'acl',approved.proacl::text));
  ALTER FUNCTION public.save_editorial_post_unlocked(jsonb,integer) RENAME TO ci_replay_original_editorial;
  ALTER FUNCTION public.save_approved_editorial_post_unlocked(jsonb,integer) RENAME TO save_editorial_post_unlocked;
END $ci$;
