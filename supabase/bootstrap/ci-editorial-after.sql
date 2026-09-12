-- Restore names/OIDs and the approved helper's original private ACL.
-- Historical REVOKE/GRANT addressed the temporary alias, so it must not leave
-- an unintended service_role entrypoint into the approved implementation.
DO $ci$
DECLARE saved record; regular record; approved record;
BEGIN
  SELECT * INTO STRICT saved FROM aceleriq_ci_replay.editorial_attestations WHERE stage='__STAGE__' AND NOT restored;
  IF 'public.ci_replay_original_editorial(jsonb,integer)'::regprocedure::oid <> saved.regular_oid
     OR 'public.save_editorial_post_unlocked(jsonb,integer)'::regprocedure::oid <> saved.approved_oid
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=saved.approved_oid) <> '__EXPECTED_MD5__'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=saved.regular_oid) <> saved.regular_body_md5 THEN
    RAISE EXCEPTION 'CI_EDITORIAL_PATCH_DID_NOT_PRODUCE_CANONICAL_BODY';
  END IF;
  ALTER FUNCTION public.save_editorial_post_unlocked(jsonb,integer) RENAME TO save_approved_editorial_post_unlocked;
  ALTER FUNCTION public.ci_replay_original_editorial(jsonb,integer) RENAME TO save_editorial_post_unlocked;
  REVOKE ALL ON FUNCTION public.save_approved_editorial_post_unlocked(jsonb,integer) FROM PUBLIC, anon, authenticated, service_role;
  SELECT * INTO STRICT regular FROM pg_proc WHERE oid=saved.regular_oid;
  SELECT * INTO STRICT approved FROM pg_proc WHERE oid=saved.approved_oid;
  IF jsonb_build_object('owner',regular.proowner::text,'definer',regular.prosecdef,'config',regular.proconfig,'acl',regular.proacl::text) IS DISTINCT FROM saved.regular_metadata
     OR jsonb_build_object('owner',approved.proowner::text,'definer',approved.prosecdef,'config',approved.proconfig,'acl',approved.proacl::text) IS DISTINCT FROM saved.approved_metadata THEN
    RAISE EXCEPTION 'CI_EDITORIAL_METADATA_OR_ACL_NOT_RESTORED';
  END IF;
  UPDATE aceleriq_ci_replay.editorial_attestations SET restored=true WHERE stage='__STAGE__';
END $ci$;
