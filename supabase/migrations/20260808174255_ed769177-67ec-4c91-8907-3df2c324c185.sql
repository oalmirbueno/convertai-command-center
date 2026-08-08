CREATE TABLE IF NOT EXISTS social_private.meta_oauth_redirect_uris (
  redirect_uri text PRIMARY KEY,
  active boolean NOT NULL DEFAULT true,
  configured_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_oauth_redirect_uri_length
    CHECK (length(redirect_uri) BETWEEN 1 AND 2048)
);

REVOKE ALL ON TABLE social_private.meta_oauth_redirect_uris
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.social_meta_oauth_register_redirect_uri(
  _redirect_uri text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _normalized text := NULLIF(btrim(_redirect_uri), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'meta oauth redirect configuration denied';
  END IF;

  IF _normalized IS NULL
    OR length(_normalized) > 2048
    OR _normalized LIKE '%..%'
    OR NOT (
      _normalized ~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9](:[0-9]{1,5})?/oauth/meta/callback$'
      OR _normalized ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?/oauth/meta/callback$'
    ) THEN
    RAISE EXCEPTION 'meta oauth redirect uri is invalid';
  END IF;

  UPDATE social_private.meta_oauth_redirect_uris
  SET active = false
  WHERE active
    AND redirect_uri <> _normalized;

  INSERT INTO social_private.meta_oauth_redirect_uris (
    redirect_uri,
    active,
    configured_at
  ) VALUES (
    _normalized,
    true,
    now()
  )
  ON CONFLICT (redirect_uri) DO UPDATE
  SET active = true,
      configured_at = EXCLUDED.configured_at;
END
$$;

REVOKE ALL ON FUNCTION public.social_meta_oauth_register_redirect_uri(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_meta_oauth_register_redirect_uri(text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.social_meta_oauth_create_session(
  _client_id uuid,
  _project_id uuid,
  _redirect_uri text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _actor_id uuid := auth.uid();
  _state text;
  _session_id uuid;
  _expired_session_id uuid;
  _normalized_redirect_uri text := NULLIF(btrim(_redirect_uri), '');
BEGIN
  PERFORM social_private.lock_meta_oauth_lifecycle();

  IF _actor_id IS NULL
    OR _client_id IS NULL
    OR NOT public.can_manage_client(_client_id) THEN
    RAISE EXCEPTION 'meta oauth access denied';
  END IF;

  IF _project_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.projects AS project
    WHERE project.id = _project_id
      AND project.client_id = _client_id
      AND project.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'meta oauth project is unavailable';
  END IF;

  IF _normalized_redirect_uri IS NULL
    OR length(_normalized_redirect_uri) > 2048
    OR NOT EXISTS (
      SELECT 1
      FROM social_private.meta_oauth_redirect_uris AS allowed
      WHERE allowed.redirect_uri = _normalized_redirect_uri
        AND allowed.active
    ) THEN
    RAISE EXCEPTION 'meta oauth redirect uri is invalid';
  END IF;

  FOR _expired_session_id IN
    SELECT session.id
    FROM social_private.oauth_sessions AS session
    WHERE session.actor_id = _actor_id
      AND session.client_id = _client_id
      AND session.project_id = _project_id
      AND session.expires_at <= now()
      AND session.cleaned_at IS NULL
    FOR UPDATE
  LOOP
    PERFORM social_private.cleanup_meta_oauth_session(
      _expired_session_id,
      'expired'
    );
  END LOOP;

  _state := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO social_private.oauth_sessions (
    actor_id,
    client_id,
    project_id,
    state_hash,
    redirect_uri
  ) VALUES (
    _actor_id,
    _client_id,
    _project_id,
    encode(sha256(convert_to(_state, 'UTF8')), 'hex'),
    _normalized_redirect_uri
  )
  RETURNING id INTO _session_id;

  RETURN jsonb_build_object(
    'oauth_session_id', _session_id,
    'state', _state
  );
END
$$;

REVOKE ALL ON FUNCTION public.social_meta_oauth_create_session(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.social_meta_oauth_create_session(uuid, uuid, text)
  TO authenticated;