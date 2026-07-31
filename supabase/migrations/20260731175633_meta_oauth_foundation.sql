BEGIN;

-- Meta OAuth foundation. This migration stores only sanitized connection
-- metadata in public. OAuth sessions, grants and Vault references remain in a
-- schema that is not exposed to API roles. Automatic delivery is prepared but
-- remains disabled until a later worker/activation migration.

CREATE SCHEMA IF NOT EXISTS social_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA social_private
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.external_account_connections (
  external_account_id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'meta',
  connection_status text NOT NULL DEFAULT 'pending',
  automation_enabled boolean NOT NULL DEFAULT false,
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  expires_at timestamptz,
  data_access_expires_at timestamptz,
  connected_at timestamptz,
  connected_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  disconnected_at timestamptz,
  disconnected_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  last_verified_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_account_connections_account_fk
    FOREIGN KEY (external_account_id, client_id)
    REFERENCES public.external_accounts(id, client_id)
    ON DELETE RESTRICT,
  CONSTRAINT external_account_connections_provider_check
    CHECK (provider = 'meta'),
  CONSTRAINT external_account_connections_status_check
    CHECK (
      connection_status IN (
        'pending',
        'connected',
        'expiring',
        'expired',
        'reauth_required',
        'revoked',
        'error'
      )
    ),
  CONSTRAINT external_account_connections_automation_check
    CHECK (NOT automation_enabled OR connection_status = 'connected')
);

CREATE INDEX external_account_connections_client_idx
  ON public.external_account_connections(client_id, connection_status);

ALTER TABLE public.external_account_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY external_account_connections_select
ON public.external_account_connections
FOR SELECT
TO authenticated
USING (public.can_access_client(client_id));

REVOKE ALL ON public.external_account_connections
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.external_account_connections TO authenticated;

CREATE TABLE social_private.oauth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'meta',
  state_hash text NOT NULL UNIQUE,
  redirect_uri text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  consumed_at timestamptz,
  resources_stored_at timestamptz,
  completed_at timestamptz,
  cleaned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_oauth_sessions_project_fk
    FOREIGN KEY (project_id, client_id)
    REFERENCES public.projects(id, client_id)
    ON DELETE RESTRICT,
  CONSTRAINT social_oauth_sessions_provider_check CHECK (provider = 'meta'),
  CONSTRAINT social_oauth_sessions_state_hash_check
    CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT social_oauth_sessions_status_check
    CHECK (
      status IN (
        'pending',
        'consumed',
        'resources_ready',
        'completed',
        'expired',
        'cancelled'
      )
    ),
  CONSTRAINT social_oauth_sessions_expiry_check
    CHECK (expires_at > created_at)
);

CREATE INDEX social_oauth_sessions_actor_idx
  ON social_private.oauth_sessions(actor_id, status, expires_at);
CREATE INDEX social_oauth_sessions_scope_idx
  ON social_private.oauth_sessions(client_id, project_id, status);
CREATE INDEX social_oauth_sessions_cleanup_idx
  ON social_private.oauth_sessions(expires_at)
  WHERE cleaned_at IS NULL;

CREATE TABLE social_private.oauth_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'meta',
  provider_subject text NOT NULL,
  user_access_token_secret_id uuid NOT NULL,
  granted_scopes text[] NOT NULL DEFAULT '{}'::text[],
  declined_scopes text[] NOT NULL DEFAULT '{}'::text[],
  access_token_expires_at timestamptz,
  data_access_expires_at timestamptz,
  graph_version text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  generation integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_oauth_grants_provider_check CHECK (provider = 'meta'),
  CONSTRAINT social_oauth_grants_subject_nonempty
    CHECK (length(btrim(provider_subject)) > 0),
  CONSTRAINT social_oauth_grants_graph_version_check
    CHECK (graph_version ~ '^v[0-9]+\.[0-9]+$'),
  CONSTRAINT social_oauth_grants_status_check
    CHECK (
      status IN (
        'active',
        'expired',
        'revoked',
        'superseded',
        'error'
      )
    ),
  CONSTRAINT social_oauth_grants_generation_positive CHECK (generation > 0),
  CONSTRAINT social_oauth_grants_generation_key
    UNIQUE (client_id, provider, provider_subject, generation)
);

CREATE INDEX social_oauth_grants_active_idx
  ON social_private.oauth_grants(client_id, provider_subject, created_at DESC)
  WHERE status = 'active';

CREATE TABLE social_private.oauth_resource_candidates (
  id uuid PRIMARY KEY,
  oauth_session_id uuid NOT NULL
    REFERENCES social_private.oauth_sessions(id) ON DELETE RESTRICT,
  grant_id uuid NOT NULL
    REFERENCES social_private.oauth_grants(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  platform text NOT NULL,
  resource_type text NOT NULL,
  provider_resource_id text NOT NULL,
  display_name text NOT NULL,
  handle text,
  page_id text NOT NULL,
  instagram_user_id text,
  resource_access_token_secret_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  selected_at timestamptz,
  selected_external_account_id uuid,
  discarded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_resource_candidates_project_fk
    FOREIGN KEY (project_id, client_id)
    REFERENCES public.projects(id, client_id)
    ON DELETE RESTRICT,
  CONSTRAINT social_resource_candidates_platform_check
    CHECK (platform IN ('facebook', 'instagram')),
  CONSTRAINT social_resource_candidates_resource_type_check
    CHECK (resource_type IN ('page', 'instagram_business_account')),
  CONSTRAINT social_resource_candidates_provider_id_nonempty
    CHECK (length(btrim(provider_resource_id)) > 0),
  CONSTRAINT social_resource_candidates_display_name_nonempty
    CHECK (length(btrim(display_name)) > 0),
  CONSTRAINT social_resource_candidates_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT social_resource_candidates_session_resource_key
    UNIQUE (oauth_session_id, platform, provider_resource_id)
);

CREATE INDEX social_resource_candidates_session_idx
  ON social_private.oauth_resource_candidates(oauth_session_id, platform);

CREATE TABLE social_private.external_account_grants (
  external_account_id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  grant_id uuid NOT NULL
    REFERENCES social_private.oauth_grants(id) ON DELETE RESTRICT,
  candidate_id uuid NOT NULL
    REFERENCES social_private.oauth_resource_candidates(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'meta',
  platform text NOT NULL,
  provider_resource_id text NOT NULL,
  resource_access_token_secret_id uuid NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  connected_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  CONSTRAINT social_external_account_grants_account_fk
    FOREIGN KEY (external_account_id, client_id)
    REFERENCES public.external_accounts(id, client_id)
    ON DELETE RESTRICT,
  CONSTRAINT social_external_account_grants_provider_check
    CHECK (provider = 'meta'),
  CONSTRAINT social_external_account_grants_platform_check
    CHECK (platform IN ('facebook', 'instagram'))
);

CREATE UNIQUE INDEX social_external_account_grants_resource_idx
  ON social_private.external_account_grants(
    provider,
    platform,
    provider_resource_id
  )
  WHERE revoked_at IS NULL;

ALTER TABLE social_private.oauth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_private.oauth_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_private.oauth_resource_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_private.external_account_grants ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA social_private
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA social_private
  FROM PUBLIC, anon, authenticated, service_role;

-- OAuth connect/disconnect/cleanup operations are administrative and rare.
-- One transaction-scoped lock gives every token lifecycle path the same first
-- lock, preventing grant/candidate and connection/mapping lock inversions.
CREATE OR REPLACE FUNCTION social_private.lock_meta_oauth_lifecycle()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('aceleriq:meta-oauth-token-lifecycle', 0)
  )
$$;

REVOKE ALL ON FUNCTION social_private.lock_meta_oauth_lifecycle()
  FROM PUBLIC, anon, authenticated, service_role;

-- Vault does not expose a delete helper. Replacing a credential with a random,
-- unusable value is the supported revocation path and prevents abandoned OAuth
-- sessions or reconnects from retaining live Meta tokens indefinitely.
CREATE OR REPLACE FUNCTION social_private.revoke_meta_secret(
  _secret_id uuid,
  _description text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF _secret_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM vault.update_secret(
    _secret_id,
    'revoked:' || pg_catalog.gen_random_uuid()::text,
    NULL,
    left(COALESCE(NULLIF(btrim(_description), ''), 'Revoked Meta token'), 500),
    NULL
  );
END
$$;

REVOKE ALL ON FUNCTION social_private.revoke_meta_secret(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION social_private.cleanup_meta_grant(
  _grant_id uuid,
  _terminal_status text,
  _reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _grant social_private.oauth_grants%ROWTYPE;
  _candidate record;
BEGIN
  PERFORM social_private.lock_meta_oauth_lifecycle();

  IF _terminal_status NOT IN ('expired', 'revoked', 'superseded', 'error') THEN
    RAISE EXCEPTION 'invalid meta grant terminal status';
  END IF;

  SELECT * INTO _grant
  FROM social_private.oauth_grants AS grant_row
  WHERE grant_row.id = _grant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- A long-lived user grant may still serve another connected Page/Instagram
  -- resource from the same login. Never revoke it while such a mapping exists.
  IF EXISTS (
    SELECT 1
    FROM social_private.external_account_grants AS mapping
    WHERE mapping.grant_id = _grant.id
      AND mapping.revoked_at IS NULL
  ) THEN
    RETURN false;
  END IF;

  FOR _candidate IN
    SELECT candidate.id, candidate.resource_access_token_secret_id
    FROM social_private.oauth_resource_candidates AS candidate
    WHERE candidate.grant_id = _grant.id
      AND candidate.discarded_at IS NULL
    FOR UPDATE
  LOOP
    PERFORM social_private.revoke_meta_secret(
      _candidate.resource_access_token_secret_id,
      _reason || ' resource token'
    );
    UPDATE social_private.oauth_resource_candidates
    SET discarded_at = now()
    WHERE id = _candidate.id;
  END LOOP;

  PERFORM social_private.revoke_meta_secret(
    _grant.user_access_token_secret_id,
    _reason || ' user token'
  );

  UPDATE social_private.oauth_grants
  SET status = _terminal_status, updated_at = now()
  WHERE id = _grant.id;

  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION social_private.cleanup_meta_grant(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION social_private.cleanup_meta_oauth_session(
  _oauth_session_id uuid,
  _terminal_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _session social_private.oauth_sessions%ROWTYPE;
  _candidate record;
  _grant_id uuid;
  _has_active_mapping boolean;
BEGIN
  PERFORM social_private.lock_meta_oauth_lifecycle();

  IF _terminal_status NOT IN ('completed', 'cancelled', 'expired') THEN
    RAISE EXCEPTION 'invalid meta oauth terminal status';
  END IF;

  SELECT * INTO _session
  FROM social_private.oauth_sessions AS session
  WHERE session.id = _oauth_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Keep only credentials that are currently referenced by a live connection.
  FOR _candidate IN
    SELECT candidate.id, candidate.resource_access_token_secret_id
    FROM social_private.oauth_resource_candidates AS candidate
    WHERE candidate.oauth_session_id = _session.id
      AND candidate.discarded_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM social_private.external_account_grants AS mapping
        WHERE mapping.candidate_id = candidate.id
          AND mapping.revoked_at IS NULL
      )
    FOR UPDATE
  LOOP
    PERFORM social_private.revoke_meta_secret(
      _candidate.resource_access_token_secret_id,
      'Discarded Meta OAuth candidate token'
    );
    UPDATE social_private.oauth_resource_candidates
    SET discarded_at = now()
    WHERE id = _candidate.id;
  END LOOP;

  FOR _grant_id IN
    SELECT DISTINCT candidate.grant_id
    FROM social_private.oauth_resource_candidates AS candidate
    WHERE candidate.oauth_session_id = _session.id
  LOOP
    PERFORM social_private.cleanup_meta_grant(
      _grant_id,
      CASE WHEN _terminal_status = 'expired' THEN 'expired' ELSE 'revoked' END,
      CASE
        WHEN _terminal_status = 'expired' THEN 'Expired Meta OAuth grant'
        ELSE 'Discarded Meta OAuth grant'
      END
    );
  END LOOP;

  SELECT EXISTS (
    SELECT 1
    FROM social_private.oauth_resource_candidates AS candidate
    JOIN social_private.external_account_grants AS mapping
      ON mapping.candidate_id = candidate.id
     AND mapping.revoked_at IS NULL
    WHERE candidate.oauth_session_id = _session.id
  ) INTO _has_active_mapping;

  UPDATE social_private.oauth_sessions
  SET
    status = CASE
      WHEN _has_active_mapping THEN 'completed'
      WHEN _terminal_status = 'completed' THEN 'cancelled'
      ELSE _terminal_status
    END,
    completed_at = CASE
      WHEN _has_active_mapping THEN COALESCE(completed_at, now())
      ELSE completed_at
    END,
    cleaned_at = now(),
    updated_at = now()
  WHERE id = _session.id;
END
$$;

REVOKE ALL ON FUNCTION social_private.cleanup_meta_oauth_session(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION social_private.cleanup_expired_meta_oauth()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _session_id uuid;
  _grant_id uuid;
  _cleaned integer := 0;
BEGIN
  PERFORM social_private.lock_meta_oauth_lifecycle();

  FOR _session_id IN
    SELECT session.id
    FROM social_private.oauth_sessions AS session
    WHERE session.expires_at <= now()
      AND session.cleaned_at IS NULL
    ORDER BY session.expires_at
    LIMIT 1000
  LOOP
    PERFORM social_private.cleanup_meta_oauth_session(
      _session_id,
      'expired'
    );
    _cleaned := _cleaned + 1;
  END LOOP;

  -- Expired grants cannot remain eligible for automation or retain live Vault
  -- values, even if a stale mapping still points to them.
  FOR _grant_id IN
    SELECT grant_row.id
    FROM social_private.oauth_grants AS grant_row
    WHERE grant_row.status = 'active'
      AND (
        (grant_row.access_token_expires_at IS NOT NULL
          AND grant_row.access_token_expires_at <= now())
        OR (grant_row.data_access_expires_at IS NOT NULL
          AND grant_row.data_access_expires_at <= now())
      )
    ORDER BY grant_row.created_at
    LIMIT 1000
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.external_account_connections AS connection
    SET
      connection_status = 'expired',
      automation_enabled = false,
      last_verified_at = now(),
      updated_at = now()
    FROM social_private.external_account_grants AS mapping
    WHERE mapping.grant_id = _grant_id
      AND mapping.revoked_at IS NULL
      AND mapping.external_account_id = connection.external_account_id;

    UPDATE social_private.external_account_grants
    SET revoked_at = COALESCE(revoked_at, now())
    WHERE grant_id = _grant_id
      AND revoked_at IS NULL;

    PERFORM social_private.cleanup_meta_grant(
      _grant_id,
      'expired',
      'Expired Meta grant'
    );
    _cleaned := _cleaned + 1;
  END LOOP;

  RETURN _cleaned;
END
$$;

REVOKE ALL ON FUNCTION social_private.cleanup_expired_meta_oauth()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT cron.schedule(
  'cleanup-meta-oauth-secrets',
  '*/10 * * * *',
  'SELECT social_private.cleanup_expired_meta_oauth();'
);

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
    OR NOT (
      _normalized_redirect_uri ~* '^https://(www\.)?aceleriq\.online/oauth/meta/callback$'
      OR _normalized_redirect_uri ~* '^http://(localhost|127\.0\.0\.1)(:[0-9]+)?/oauth/meta/callback$'
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

REVOKE ALL ON FUNCTION public.social_meta_oauth_create_session(
  uuid,
  uuid,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.social_meta_oauth_create_session(
  uuid,
  uuid,
  text
) TO authenticated;

CREATE OR REPLACE FUNCTION public.social_meta_oauth_consume_session(
  _state text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _actor_id uuid := auth.uid();
  _state_hash text;
  _session social_private.oauth_sessions%ROWTYPE;
BEGIN
  IF _actor_id IS NULL
    OR _state IS NULL
    OR _state !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'meta oauth session is invalid or expired';
  END IF;

  _state_hash := encode(sha256(convert_to(_state, 'UTF8')), 'hex');

  SELECT * INTO _session
  FROM social_private.oauth_sessions AS session
  WHERE session.state_hash = _state_hash
    AND session.actor_id = _actor_id
    AND session.provider = 'meta'
  FOR UPDATE;

  IF NOT FOUND
    OR _session.status <> 'pending'
    OR _session.expires_at <= now()
    OR NOT public.can_manage_client(_session.client_id) THEN
    IF FOUND AND _session.expires_at <= now() THEN
      UPDATE social_private.oauth_sessions
      SET status = 'expired', updated_at = now()
      WHERE id = _session.id;
    END IF;
    RAISE EXCEPTION 'meta oauth session is invalid or expired';
  END IF;

  UPDATE social_private.oauth_sessions
  SET
    status = 'consumed',
    consumed_at = now(),
    updated_at = now()
  WHERE id = _session.id;

  RETURN jsonb_build_object(
    'oauth_session_id', _session.id,
    'client_id', _session.client_id,
    'project_id', _session.project_id
  );
END
$$;

REVOKE ALL ON FUNCTION public.social_meta_oauth_consume_session(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.social_meta_oauth_consume_session(text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.social_meta_oauth_store_resources(
  _actor_id uuid,
  _oauth_session_id uuid,
  _meta_user_id text,
  _user_access_token text,
  _user_access_token_expires_at timestamptz,
  _data_access_expires_at timestamptz,
  _granted_scopes text[],
  _declined_scopes text[],
  _resources jsonb,
  _graph_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _session social_private.oauth_sessions%ROWTYPE;
  _grant_id uuid := gen_random_uuid();
  _user_secret_id uuid;
  _generation integer;
  _resource jsonb;
  _candidate_id uuid;
  _platform text;
  _provider_resource_id text;
  _display_name text;
  _handle text;
  _page_id text;
  _instagram_user_id text;
  _page_access_token text;
  _resource_secret_id uuid;
  _safe_resources jsonb;
BEGIN
  PERFORM social_private.lock_meta_oauth_lifecycle();

  SELECT * INTO _session
  FROM social_private.oauth_sessions AS session
  WHERE session.id = _oauth_session_id
    AND session.actor_id = _actor_id
    AND session.provider = 'meta'
  FOR UPDATE;

  IF NOT FOUND
    OR _session.status <> 'consumed'
    OR _session.expires_at <= now() THEN
    RAISE EXCEPTION 'meta oauth session cannot store resources';
  END IF;

  IF _meta_user_id IS NULL
    OR length(btrim(_meta_user_id)) = 0
    OR length(_meta_user_id) > 128
    OR _user_access_token IS NULL
    OR length(_user_access_token) < 16
    OR length(_user_access_token) > 8192
    OR _graph_version IS NULL
    OR _graph_version !~ '^v[0-9]+\.[0-9]+$' THEN
    RAISE EXCEPTION 'meta oauth grant is invalid';
  END IF;

  IF _user_access_token_expires_at IS NOT NULL
    AND _user_access_token_expires_at <= now() THEN
    RAISE EXCEPTION 'meta oauth token is already expired';
  END IF;

  IF NOT COALESCE(_granted_scopes, '{}'::text[]) @> ARRAY[
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
    'instagram_basic',
    'instagram_content_publish'
  ]::text[] THEN
    RAISE EXCEPTION 'meta oauth required scopes are missing';
  END IF;

  IF _resources IS NULL
    OR jsonb_typeof(_resources) <> 'array'
    OR jsonb_array_length(_resources) > 1000 THEN
    RAISE EXCEPTION 'meta oauth resources payload is invalid';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      _session.client_id::text || ':meta:' || btrim(_meta_user_id),
      0
    )
  );

  SELECT COALESCE(max(grant_row.generation), 0) + 1
  INTO _generation
  FROM social_private.oauth_grants AS grant_row
  WHERE grant_row.client_id = _session.client_id
    AND grant_row.provider = 'meta'
    AND grant_row.provider_subject = btrim(_meta_user_id);

  SELECT vault.create_secret(
    _user_access_token,
    'meta-user-' || _grant_id::text,
    'Meta long-lived user token for client ' || _session.client_id::text,
    NULL
  ) INTO _user_secret_id;

  INSERT INTO social_private.oauth_grants (
    id,
    client_id,
    provider_subject,
    user_access_token_secret_id,
    granted_scopes,
    declined_scopes,
    access_token_expires_at,
    data_access_expires_at,
    graph_version,
    generation
  ) VALUES (
    _grant_id,
    _session.client_id,
    btrim(_meta_user_id),
    _user_secret_id,
    COALESCE(_granted_scopes, '{}'::text[]),
    COALESCE(_declined_scopes, '{}'::text[]),
    _user_access_token_expires_at,
    _data_access_expires_at,
    _graph_version,
    _generation
  );

  FOR _resource IN
    SELECT value
    FROM jsonb_array_elements(_resources)
  LOOP
    IF jsonb_typeof(_resource) <> 'object'
      OR COALESCE(_resource->>'candidate_id', '')
        !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'meta oauth candidate is invalid';
    END IF;

    _candidate_id := (_resource->>'candidate_id')::uuid;
    _platform := lower(NULLIF(btrim(_resource->>'platform'), ''));
    _provider_resource_id := NULLIF(
      btrim(_resource->>'external_account_id'),
      ''
    );
    _display_name := NULLIF(btrim(_resource->>'display_name'), '');
    _handle := NULLIF(btrim(_resource->>'handle'), '');
    _page_id := NULLIF(btrim(_resource->>'page_id'), '');
    _instagram_user_id := NULLIF(
      btrim(_resource->>'instagram_user_id'),
      ''
    );
    _page_access_token := NULLIF(
      _resource->>'page_access_token',
      ''
    );

    IF _platform NOT IN ('facebook', 'instagram')
      OR _provider_resource_id IS NULL
      OR length(_provider_resource_id) > 128
      OR _display_name IS NULL
      OR length(_display_name) > 200
      OR _page_id IS NULL
      OR length(_page_id) > 128
      OR _page_access_token IS NULL
      OR length(_page_access_token) < 16
      OR length(_page_access_token) > 8192
      OR (_platform = 'instagram' AND _instagram_user_id IS NULL) THEN
      RAISE EXCEPTION 'meta oauth resource is invalid';
    END IF;

    SELECT vault.create_secret(
      _page_access_token,
      'meta-resource-' || _candidate_id::text,
      'Meta resource token for ' || _platform || ':' ||
        _provider_resource_id,
      NULL
    ) INTO _resource_secret_id;

    INSERT INTO social_private.oauth_resource_candidates (
      id,
      oauth_session_id,
      grant_id,
      client_id,
      project_id,
      platform,
      resource_type,
      provider_resource_id,
      display_name,
      handle,
      page_id,
      instagram_user_id,
      resource_access_token_secret_id,
      metadata
    ) VALUES (
      _candidate_id,
      _session.id,
      _grant_id,
      _session.client_id,
      _session.project_id,
      _platform,
      CASE
        WHEN _platform = 'instagram'
          THEN 'instagram_business_account'
        ELSE 'page'
      END,
      _provider_resource_id,
      _display_name,
      CASE
        WHEN _handle IS NULL THEN NULL
        WHEN left(_handle, 1) = '@' THEN left(_handle, 180)
        ELSE left('@' || _handle, 180)
      END,
      _page_id,
      _instagram_user_id,
      _resource_secret_id,
      jsonb_build_object(
        'picture_url', NULLIF(btrim(_resource->>'picture_url'), ''),
        'tasks', CASE
          WHEN jsonb_typeof(_resource->'tasks') = 'array'
            THEN _resource->'tasks'
          ELSE '[]'::jsonb
        END
      )
    );
  END LOOP;

  UPDATE social_private.oauth_sessions
  SET
    status = 'resources_ready',
    resources_stored_at = now(),
    updated_at = now()
  WHERE id = _session.id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'candidate_id', candidate.id,
        'platform', candidate.platform,
        'display_name', candidate.display_name,
        'handle', candidate.handle
      )
      ORDER BY candidate.platform, candidate.display_name, candidate.id
    ),
    '[]'::jsonb
  )
  INTO _safe_resources
  FROM social_private.oauth_resource_candidates AS candidate
  WHERE candidate.oauth_session_id = _session.id;

  RETURN jsonb_build_object(
    'oauth_session_id', _session.id,
    'resources', _safe_resources
  );
END
$$;

REVOKE ALL ON FUNCTION public.social_meta_oauth_store_resources(
  uuid,
  uuid,
  text,
  text,
  timestamptz,
  timestamptz,
  text[],
  text[],
  jsonb,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.social_meta_oauth_store_resources(
  uuid,
  uuid,
  text,
  text,
  timestamptz,
  timestamptz,
  text[],
  text[],
  jsonb,
  text
) TO service_role;

CREATE OR REPLACE FUNCTION public.social_meta_oauth_finish_session(
  _oauth_session_id uuid,
  _client_id uuid,
  _project_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _actor_id uuid := auth.uid();
  _session social_private.oauth_sessions%ROWTYPE;
BEGIN
  PERFORM social_private.lock_meta_oauth_lifecycle();

  SELECT * INTO _session
  FROM social_private.oauth_sessions AS session
  WHERE session.id = _oauth_session_id
    AND session.actor_id = _actor_id
    AND session.client_id = _client_id
    AND session.project_id = _project_id
    AND session.provider = 'meta'
  FOR UPDATE;

  IF _actor_id IS NULL
    OR NOT FOUND
    OR NOT public.can_manage_client(_client_id) THEN
    RAISE EXCEPTION 'meta oauth session access denied';
  END IF;

  IF _session.status NOT IN ('resources_ready', 'completed') THEN
    RAISE EXCEPTION 'meta oauth session cannot be finalized';
  END IF;

  PERFORM social_private.cleanup_meta_oauth_session(
    _session.id,
    CASE
      WHEN _session.expires_at <= now() THEN 'expired'
      ELSE 'completed'
    END
  );

  RETURN jsonb_build_object('ok', true);
END
$$;

REVOKE ALL ON FUNCTION public.social_meta_oauth_finish_session(
  uuid,
  uuid,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.social_meta_oauth_finish_session(
  uuid,
  uuid,
  uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.social_meta_connect_resource(
  _oauth_session_id uuid,
  _candidate_id uuid,
  _client_id uuid,
  _project_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _actor_id uuid := auth.uid();
  _session social_private.oauth_sessions%ROWTYPE;
  _candidate social_private.oauth_resource_candidates%ROWTYPE;
  _grant social_private.oauth_grants%ROWTYPE;
  _previous_mapping social_private.external_account_grants%ROWTYPE;
  _had_previous_mapping boolean := false;
  _orphan_grant_id uuid;
  _external_account_id uuid;
  _connection_expires_at timestamptz;
BEGIN
  PERFORM social_private.lock_meta_oauth_lifecycle();

  IF _actor_id IS NULL
    OR _client_id IS NULL
    OR NOT public.can_manage_client(_client_id) THEN
    RAISE EXCEPTION 'meta resource access denied';
  END IF;

  SELECT * INTO _session
  FROM social_private.oauth_sessions AS session
  WHERE session.id = _oauth_session_id
    AND session.actor_id = _actor_id
    AND session.client_id = _client_id
    AND session.project_id = _project_id
    AND session.status IN ('resources_ready', 'completed')
    AND session.expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'meta oauth session is invalid or expired';
  END IF;

  SELECT * INTO _candidate
  FROM social_private.oauth_resource_candidates AS candidate
  WHERE candidate.id = _candidate_id
    AND candidate.oauth_session_id = _session.id
    AND candidate.client_id = _client_id
    AND candidate.project_id = _project_id
    AND candidate.discarded_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'meta resource does not belong to this session';
  END IF;

  SELECT * INTO _grant
  FROM social_private.oauth_grants AS grant_row
  WHERE grant_row.id = _candidate.grant_id
    AND grant_row.client_id = _client_id
    AND grant_row.status = 'active'
  FOR UPDATE;

  IF NOT FOUND
    OR (_grant.access_token_expires_at IS NOT NULL
      AND _grant.access_token_expires_at <= now())
    OR (_grant.data_access_expires_at IS NOT NULL
      AND _grant.data_access_expires_at <= now()) THEN
    RAISE EXCEPTION 'meta authorization needs to be renewed';
  END IF;

  SELECT account.id INTO _external_account_id
  FROM public.external_accounts AS account
  WHERE account.client_id = _client_id
    AND account.platform = _candidate.platform
    AND account.external_id = _candidate.provider_resource_id
  FOR UPDATE;

  IF _external_account_id IS NULL THEN
    INSERT INTO public.external_accounts (
      client_id,
      platform,
      external_id,
      display_name,
      handle,
      status,
      created_by
    ) VALUES (
      _client_id,
      _candidate.platform,
      _candidate.provider_resource_id,
      _candidate.display_name,
      _candidate.handle,
      'active',
      _actor_id
    )
    RETURNING id INTO _external_account_id;
  ELSE
    UPDATE public.external_accounts
    SET
      display_name = _candidate.display_name,
      handle = _candidate.handle,
      status = 'active'
    WHERE id = _external_account_id;
  END IF;

  SELECT * INTO _previous_mapping
  FROM social_private.external_account_grants AS mapping
  WHERE mapping.external_account_id = _external_account_id
  FOR UPDATE;
  _had_previous_mapping := FOUND;

  INSERT INTO public.project_external_accounts (
    client_id,
    project_id,
    external_account_id,
    created_by
  ) VALUES (
    _client_id,
    _project_id,
    _external_account_id,
    _actor_id
  )
  ON CONFLICT (project_id, external_account_id) DO NOTHING;

  _connection_expires_at := CASE
    WHEN _grant.access_token_expires_at IS NOT NULL
      AND _grant.data_access_expires_at IS NOT NULL
      THEN LEAST(
        _grant.access_token_expires_at,
        _grant.data_access_expires_at
      )
    ELSE COALESCE(
      _grant.access_token_expires_at,
      _grant.data_access_expires_at
    )
  END;

  INSERT INTO public.external_account_connections (
    external_account_id,
    client_id,
    provider,
    connection_status,
    automation_enabled,
    scopes,
    expires_at,
    data_access_expires_at,
    connected_at,
    connected_by,
    disconnected_at,
    disconnected_by,
    last_verified_at,
    last_error_code,
    updated_at
  ) VALUES (
    _external_account_id,
    _client_id,
    'meta',
    'connected',
    false,
    _grant.granted_scopes,
    _connection_expires_at,
    _grant.data_access_expires_at,
    now(),
    _actor_id,
    NULL,
    NULL,
    now(),
    NULL,
    now()
  )
  ON CONFLICT (external_account_id) DO UPDATE
  SET
    client_id = EXCLUDED.client_id,
    provider = EXCLUDED.provider,
    connection_status = 'connected',
    automation_enabled = false,
    scopes = EXCLUDED.scopes,
    expires_at = EXCLUDED.expires_at,
    data_access_expires_at = EXCLUDED.data_access_expires_at,
    connected_at = now(),
    connected_by = EXCLUDED.connected_by,
    disconnected_at = NULL,
    disconnected_by = NULL,
    last_verified_at = now(),
    last_error_code = NULL,
    updated_at = now();

  INSERT INTO social_private.external_account_grants (
    external_account_id,
    client_id,
    grant_id,
    candidate_id,
    platform,
    provider_resource_id,
    resource_access_token_secret_id,
    connected_at,
    connected_by,
    revoked_at,
    revoked_by
  ) VALUES (
    _external_account_id,
    _client_id,
    _grant.id,
    _candidate.id,
    _candidate.platform,
    _candidate.provider_resource_id,
    _candidate.resource_access_token_secret_id,
    now(),
    _actor_id,
    NULL,
    NULL
  )
  ON CONFLICT (external_account_id) DO UPDATE
  SET
    client_id = EXCLUDED.client_id,
    grant_id = EXCLUDED.grant_id,
    candidate_id = EXCLUDED.candidate_id,
    platform = EXCLUDED.platform,
    provider_resource_id = EXCLUDED.provider_resource_id,
    resource_access_token_secret_id =
      EXCLUDED.resource_access_token_secret_id,
    connected_at = now(),
    connected_by = EXCLUDED.connected_by,
    revoked_at = NULL,
    revoked_by = NULL;

  IF _had_previous_mapping
    AND _previous_mapping.resource_access_token_secret_id IS DISTINCT FROM
      _candidate.resource_access_token_secret_id THEN
    PERFORM social_private.revoke_meta_secret(
      _previous_mapping.resource_access_token_secret_id,
      'Superseded Meta resource token'
    );
    UPDATE social_private.oauth_resource_candidates
    SET discarded_at = COALESCE(discarded_at, now())
    WHERE id = _previous_mapping.candidate_id;
  END IF;

  IF _had_previous_mapping
    AND _previous_mapping.grant_id IS DISTINCT FROM _grant.id THEN
    PERFORM social_private.cleanup_meta_grant(
      _previous_mapping.grant_id,
      'superseded',
      'Superseded Meta grant'
    );
  END IF;

  -- Reconnection can leave an older generation with no active account. Revoke
  -- only those orphan generations; grants still serving sibling resources stay
  -- active until those resources are reconnected or disconnected.
  FOR _orphan_grant_id IN
    SELECT grant_row.id
    FROM social_private.oauth_grants AS grant_row
    WHERE grant_row.client_id = _client_id
      AND grant_row.provider = 'meta'
      AND grant_row.provider_subject = _grant.provider_subject
      AND grant_row.status = 'active'
      AND grant_row.id <> _grant.id
      AND NOT EXISTS (
        SELECT 1
        FROM social_private.external_account_grants AS mapping
        WHERE mapping.grant_id = grant_row.id
          AND mapping.revoked_at IS NULL
      )
    FOR UPDATE
  LOOP
    PERFORM social_private.cleanup_meta_grant(
      _orphan_grant_id,
      'superseded',
      'Superseded Meta grant'
    );
  END LOOP;

  UPDATE social_private.oauth_resource_candidates
  SET
    selected_at = now(),
    selected_external_account_id = _external_account_id
  WHERE id = _candidate.id;

  UPDATE social_private.oauth_sessions
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE id = _session.id;

  RETURN jsonb_build_object(
    'external_account_id', _external_account_id
  );
END
$$;

REVOKE ALL ON FUNCTION public.social_meta_connect_resource(
  uuid,
  uuid,
  uuid,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.social_meta_connect_resource(
  uuid,
  uuid,
  uuid,
  uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.social_meta_disconnect_account(
  _external_account_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _actor_id uuid := auth.uid();
  _connection public.external_account_connections%ROWTYPE;
  _mapping social_private.external_account_grants%ROWTYPE;
BEGIN
  PERFORM social_private.lock_meta_oauth_lifecycle();

  SELECT * INTO _connection
  FROM public.external_account_connections AS connection
  WHERE connection.external_account_id = _external_account_id
  FOR UPDATE;

  IF _actor_id IS NULL
    OR NOT FOUND
    OR NOT public.can_manage_client(_connection.client_id) THEN
    RAISE EXCEPTION 'meta connection access denied';
  END IF;

  SELECT * INTO _mapping
  FROM social_private.external_account_grants AS mapping
  WHERE mapping.external_account_id = _external_account_id
  FOR UPDATE;

  UPDATE public.external_account_connections
  SET
    connection_status = 'revoked',
    automation_enabled = false,
    disconnected_at = now(),
    disconnected_by = _actor_id,
    last_verified_at = now(),
    updated_at = now()
  WHERE external_account_id = _external_account_id;

  UPDATE social_private.external_account_grants
  SET revoked_at = now(), revoked_by = _actor_id
  WHERE external_account_id = _external_account_id;

  IF _mapping.resource_access_token_secret_id IS NOT NULL THEN
    PERFORM social_private.revoke_meta_secret(
      _mapping.resource_access_token_secret_id,
      'Disconnected Meta resource token'
    );
    UPDATE social_private.oauth_resource_candidates
    SET discarded_at = COALESCE(discarded_at, now())
    WHERE id = _mapping.candidate_id;

    PERFORM social_private.cleanup_meta_grant(
      _mapping.grant_id,
      'revoked',
      'Disconnected Meta grant'
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END
$$;

REVOKE ALL ON FUNCTION public.social_meta_disconnect_account(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.social_meta_disconnect_account(uuid)
  TO authenticated;

-- Freeze the exact approved files selected by the editor. The worker phase can
-- consume this immutable ordering without deriving carousel order again.
ALTER TABLE public.editorial_publications
  ADD COLUMN delivery_mode text NOT NULL DEFAULT 'manual';

ALTER TABLE public.editorial_publications
  ADD CONSTRAINT editorial_publications_delivery_mode_check
  CHECK (delivery_mode IN ('manual', 'automatic'));

CREATE TABLE social_private.editorial_publication_assets (
  publication_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  root_file_id uuid NOT NULL REFERENCES public.files(id) ON DELETE RESTRICT,
  position smallint NOT NULL,
  file_id uuid NOT NULL REFERENCES public.files(id) ON DELETE RESTRICT,
  sha256 text,
  mime_type text,
  size_bytes bigint,
  captured_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_editorial_publication_assets_publication_fk
    FOREIGN KEY (publication_id, client_id)
    REFERENCES public.editorial_publications(id, client_id)
    ON DELETE RESTRICT,
  CONSTRAINT social_editorial_publication_assets_position_check
    CHECK (position BETWEEN 1 AND 100),
  CONSTRAINT social_editorial_publication_assets_sha_check
    CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT social_editorial_publication_assets_size_check
    CHECK (size_bytes IS NULL OR size_bytes >= 0),
  CONSTRAINT social_editorial_publication_assets_position_key
    PRIMARY KEY (publication_id, position),
  CONSTRAINT social_editorial_publication_assets_file_key
    UNIQUE (publication_id, file_id)
);

-- Keep the normalized delivery request separate from the legacy publication
-- fingerprint. Older clients do not send delivery_mode/asset_file_ids, while
-- newer clients need those fields to participate in replay protection.
CREATE TABLE social_private.editorial_publication_delivery_requests (
  publication_id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  request_fingerprint text NOT NULL,
  delivery_mode text NOT NULL,
  asset_count smallint NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_editorial_delivery_request_publication_fk
    FOREIGN KEY (publication_id, client_id)
    REFERENCES public.editorial_publications(id, client_id)
    ON DELETE RESTRICT,
  CONSTRAINT social_editorial_delivery_request_fingerprint_check
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT social_editorial_delivery_request_mode_check
    CHECK (delivery_mode IN ('manual', 'automatic')),
  CONSTRAINT social_editorial_delivery_request_asset_count_check
    CHECK (asset_count BETWEEN 0 AND 100)
);

CREATE INDEX social_editorial_publication_assets_file_idx
  ON social_private.editorial_publication_assets(file_id);

ALTER TABLE social_private.editorial_publication_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_private.editorial_publication_delivery_requests
  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON social_private.editorial_publication_assets
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON social_private.editorial_publication_delivery_requests
  FROM PUBLIC, anon, authenticated, service_role;

-- Delivery mode and the exact ordered asset snapshot are part of the approved
-- immutable version. Replacing this helper also makes the existing transition
-- double-gate reject any out-of-band change to either field.
CREATE OR REPLACE FUNCTION public.editorial_compute_approval_fingerprint(
  _post_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'post_id', post.id,
          'client_id', post.client_id,
          'project_id', post.project_id,
          'primary_file_id', post.primary_file_id,
          'title', post.title,
          'content_type', post.content_type,
          'objective', post.objective,
          'default_caption', post.default_caption,
          'publications', COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'external_account_id',
                    publication.external_account_id,
                  'platform', publication.platform,
                  'file_id', publication.file_id,
                  'caption', publication.caption,
                  'first_comment', publication.first_comment,
                  'alt_text', publication.alt_text,
                  'delivery_mode', publication.delivery_mode,
                  'assets', COALESCE(
                    (
                      SELECT jsonb_agg(
                        jsonb_build_object(
                          'position', asset.position,
                          'file_id', asset.file_id,
                          'root_file_id', asset.root_file_id,
                          'sha256', asset.sha256,
                          'mime_type', asset.mime_type,
                          'size_bytes', asset.size_bytes
                        )
                        ORDER BY asset.position
                      )
                      FROM social_private.editorial_publication_assets AS asset
                      WHERE asset.publication_id = publication.id
                    ),
                    '[]'::jsonb
                  )
                )
                ORDER BY publication.external_account_id
              )
              FROM public.editorial_publications AS publication
              WHERE publication.post_id = post.id
                AND publication.status <> 'cancelled'
            ),
            '[]'::jsonb
          )
        )::text,
        'UTF8'
      )
    ),
    'hex'
  )
  FROM public.editorial_posts AS post
  WHERE post.id = _post_id
$$;

REVOKE ALL ON FUNCTION public.editorial_compute_approval_fingerprint(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Adding the normalized manual/empty delivery state changes the digest of
-- existing approved rows. Rebase only their stored digest; no publication,
-- file or approval decision is changed.
UPDATE public.editorial_post_internal AS internal
SET approval_fingerprint =
  public.editorial_compute_approval_fingerprint(internal.post_id)
WHERE internal.approval_fingerprint IS NOT NULL;

CREATE OR REPLACE FUNCTION social_private.capture_editorial_asset_snapshots(
  _post_id uuid,
  _payload jsonb,
  _is_replay boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _plan jsonb;
  _publication_id uuid;
  _publication public.editorial_publications%ROWTYPE;
  _delivery_request
    social_private.editorial_publication_delivery_requests%ROWTYPE;
  _root_file_id uuid;
  _asset_ids jsonb;
  _stored_asset_ids jsonb;
  _asset_count integer;
  _expected_count integer;
  _delivery_mode text;
  _scheduled_at timestamptz;
  _scheduled_timezone text;
  _request_fingerprint text;
  _asset_ids_were_supplied boolean;
  _delivery_request_exists boolean;
BEGIN
  IF _post_id IS NULL
    OR _payload IS NULL
    OR jsonb_typeof(_payload) <> 'object'
    OR jsonb_typeof(COALESCE(_payload->'publications', '[]'::jsonb))
      <> 'array' THEN
    RETURN;
  END IF;

  FOR _plan IN
    SELECT value
    FROM jsonb_array_elements(
      COALESCE(_payload->'publications', '[]'::jsonb)
    )
  LOOP
    IF jsonb_typeof(_plan) <> 'object'
      OR NULLIF(_plan->>'external_account_id', '') IS NULL THEN
      CONTINUE;
    END IF;

    _publication_id := NULL;

    IF COALESCE(_plan->>'id', '')
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      SELECT publication.id INTO _publication_id
      FROM public.editorial_publications AS publication
      WHERE publication.id = (_plan->>'id')::uuid
        AND publication.post_id = _post_id;
    ELSIF COALESCE(_plan->>'idempotency_key', '')
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      SELECT publication.id INTO _publication_id
      FROM public.editorial_publications AS publication
      JOIN public.editorial_publication_internal AS internal
        ON internal.publication_id = publication.id
      WHERE publication.post_id = _post_id
        AND internal.idempotency_key =
          (_plan->>'idempotency_key')::uuid;
    END IF;

    IF _publication_id IS NULL THEN
      RAISE EXCEPTION 'editorial publication asset snapshot is unresolved';
    END IF;

    SELECT * INTO _publication
    FROM public.editorial_publications AS publication
    WHERE publication.id = _publication_id
      AND publication.post_id = _post_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'editorial publication asset snapshot is unresolved';
    END IF;

    IF _publication.status NOT IN ('planned', 'scheduled') THEN
      RAISE EXCEPTION 'editorial publication delivery snapshot is immutable';
    END IF;

    _delivery_mode := lower(
      COALESCE(NULLIF(btrim(_plan->>'delivery_mode'), ''), 'manual')
    );
    IF _delivery_mode NOT IN ('manual', 'automatic') THEN
      RAISE EXCEPTION 'unsupported editorial delivery mode';
    END IF;

    _scheduled_at := NULLIF(_plan->>'scheduled_at', '')::timestamptz;
    _scheduled_timezone := COALESCE(
      NULLIF(_plan->>'scheduled_timezone', ''),
      'America/Sao_Paulo'
    );
    IF NOT EXISTS (
      SELECT 1
      FROM pg_timezone_names AS timezone_row
      WHERE timezone_row.name = _scheduled_timezone
    ) THEN
      RAISE EXCEPTION 'invalid publication timezone';
    END IF;

    _asset_ids_were_supplied := _plan ? 'asset_file_ids';
    IF _asset_ids_were_supplied THEN
      _asset_ids := _plan->'asset_file_ids';
    ELSE
      SELECT COALESCE(
        jsonb_agg(asset.file_id::text ORDER BY asset.position),
        '[]'::jsonb
      )
      INTO _asset_ids
      FROM social_private.editorial_publication_assets AS asset
      WHERE asset.publication_id = _publication.id;
    END IF;

    IF jsonb_typeof(_asset_ids) <> 'array' THEN
      RAISE EXCEPTION 'editorial asset_file_ids must be an array';
    END IF;

    _asset_count := jsonb_array_length(_asset_ids);
    IF _asset_count > 100
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(_asset_ids) AS asset(file_id)
        WHERE asset.file_id IS NULL
          OR asset.file_id
            !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
      OR (
        SELECT count(*)
        FROM jsonb_array_elements_text(_asset_ids) AS asset(file_id)
      ) <> (
        SELECT count(DISTINCT asset.file_id)
        FROM jsonb_array_elements_text(_asset_ids) AS asset(file_id)
      ) THEN
      RAISE EXCEPTION 'editorial asset snapshot is invalid';
    END IF;

    IF _delivery_mode = 'automatic' AND _asset_count = 0 THEN
      RAISE EXCEPTION
        'automatic delivery requires an ordered approved asset snapshot';
    END IF;
    IF _delivery_mode = 'automatic' AND _asset_count > 10 THEN
      RAISE EXCEPTION
        'automatic Meta delivery supports at most 10 ordered assets';
    END IF;

    SELECT COALESCE(publication.file_id, post.primary_file_id)
    INTO _root_file_id
    FROM public.editorial_publications AS publication
    JOIN public.editorial_posts AS post ON post.id = publication.post_id
    WHERE publication.id = _publication.id
      AND post.client_id = publication.client_id
      AND post.project_id = publication.project_id;

    IF _asset_count > 0 THEN
      IF _root_file_id IS NULL
        OR (_asset_ids->>0)::uuid <> _root_file_id
        OR NOT public.editorial_file_is_publishable_media(
          _root_file_id,
          _publication.client_id,
          _publication.project_id
        ) THEN
        RAISE EXCEPTION 'editorial asset root is not approved for publication';
      END IF;

      SELECT count(*) INTO _expected_count
      FROM public.files AS file_row
      WHERE file_row.id = _root_file_id
        OR file_row.parent_file_id = _root_file_id;

      IF _expected_count <> _asset_count
        OR EXISTS (
          (
            SELECT file_row.id
            FROM public.files AS file_row
            WHERE file_row.id = _root_file_id
              OR file_row.parent_file_id = _root_file_id
          )
          EXCEPT
          (
            SELECT asset.file_id::uuid
            FROM jsonb_array_elements_text(_asset_ids)
              AS asset(file_id)
          )
        )
        OR EXISTS (
          (
            SELECT asset.file_id::uuid
            FROM jsonb_array_elements_text(_asset_ids)
              AS asset(file_id)
          )
          EXCEPT
          (
            SELECT file_row.id
            FROM public.files AS file_row
            WHERE file_row.id = _root_file_id
              OR file_row.parent_file_id = _root_file_id
          )
        ) THEN
        RAISE EXCEPTION
          'editorial asset snapshot must match the complete approved asset';
      END IF;
    END IF;

    _request_fingerprint := encode(
      sha256(
        convert_to(
          jsonb_build_object(
            'delivery_mode', _delivery_mode,
            'asset_file_ids', _asset_ids,
            'scheduled_at', _scheduled_at,
            'scheduled_timezone', _scheduled_timezone
          )::text,
          'UTF8'
        )
      ),
      'hex'
    );

    _delivery_request := NULL;
    SELECT * INTO _delivery_request
    FROM social_private.editorial_publication_delivery_requests AS request_row
    WHERE request_row.publication_id = _publication.id
    FOR UPDATE;
    _delivery_request_exists := FOUND;

    IF _delivery_request_exists THEN
      SELECT COALESCE(
        jsonb_agg(asset.file_id::text ORDER BY asset.position),
        '[]'::jsonb
      )
      INTO _stored_asset_ids
      FROM social_private.editorial_publication_assets AS asset
      WHERE asset.publication_id = _publication.id;

      IF _delivery_request.delivery_mode IS DISTINCT FROM _delivery_mode
        OR _publication.delivery_mode IS DISTINCT FROM _delivery_mode
        OR _delivery_request.asset_count IS DISTINCT FROM _asset_count
        OR _stored_asset_ids IS DISTINCT FROM _asset_ids THEN
        RAISE EXCEPTION
          'approved editorial delivery snapshot is immutable; create a revision';
      END IF;

      IF _is_replay THEN
        IF _delivery_request.request_fingerprint IS DISTINCT FROM
            _request_fingerprint THEN
          RAISE EXCEPTION
            'editorial delivery idempotency key was reused with different data';
        END IF;
        CONTINUE;
      END IF;
    END IF;

    IF _delivery_mode = 'automatic' THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.external_account_connections AS connection
        WHERE connection.external_account_id =
          _publication.external_account_id
          AND connection.client_id = _publication.client_id
          AND connection.provider = 'meta'
          AND connection.connection_status = 'connected'
          AND connection.automation_enabled
          AND (
            connection.expires_at IS NULL
            OR connection.expires_at > now()
          )
      ) THEN
        RAISE EXCEPTION
          'automatic delivery requires an enabled official connection';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(_asset_ids) AS asset(file_id)
        LEFT JOIN public.files AS file_row
          ON file_row.id = asset.file_id::uuid
        WHERE file_row.id IS NULL
          OR file_row.sha256 IS NULL
          OR lower(file_row.sha256) !~ '^[0-9a-f]{64}$'
      ) THEN
        RAISE EXCEPTION
          'automatic delivery requires sha256 for every approved asset';
      END IF;
    END IF;

    IF NOT _delivery_request_exists
      AND _publication.delivery_mode IS DISTINCT FROM _delivery_mode THEN
      UPDATE public.editorial_publications
      SET delivery_mode = _delivery_mode
      WHERE id = _publication.id
      RETURNING * INTO _publication;
    END IF;

    IF NOT _delivery_request_exists AND _asset_ids_were_supplied THEN
      DELETE FROM social_private.editorial_publication_assets
      WHERE publication_id = _publication.id;

      IF _asset_count > 0 THEN
        INSERT INTO social_private.editorial_publication_assets (
          publication_id,
          client_id,
          root_file_id,
          position,
          file_id,
          sha256,
          mime_type,
          size_bytes
        )
        SELECT
          _publication.id,
          _publication.client_id,
          _root_file_id,
          asset.position::smallint,
          file_row.id,
          lower(file_row.sha256),
          file_row.mime_type,
          file_row.size_bytes
        FROM jsonb_array_elements_text(_asset_ids)
          WITH ORDINALITY AS asset(file_id, position)
        JOIN public.files AS file_row
          ON file_row.id = asset.file_id::uuid
        ORDER BY asset.position;
      END IF;
    END IF;

    INSERT INTO social_private.editorial_publication_delivery_requests (
      publication_id,
      client_id,
      request_fingerprint,
      delivery_mode,
      asset_count
    ) VALUES (
      _publication.id,
      _publication.client_id,
      _request_fingerprint,
      _delivery_mode,
      _asset_count
    )
    ON CONFLICT (publication_id) DO UPDATE
    SET
      request_fingerprint = EXCLUDED.request_fingerprint,
      delivery_mode = EXCLUDED.delivery_mode,
      asset_count = EXCLUDED.asset_count,
      updated_at = now();
  END LOOP;

  -- The existing save implementations calculate this before the extension
  -- snapshot exists. Recalculate inside the same transaction so scheduling and
  -- every later transition see the complete immutable approved version.
  UPDATE public.editorial_post_internal
  SET
    approval_fingerprint =
      public.editorial_compute_approval_fingerprint(_post_id),
    updated_by = COALESCE(auth.uid(), updated_by)
  WHERE post_id = _post_id
    AND approval_fingerprint IS NOT NULL;
END
$$;

REVOKE ALL ON FUNCTION social_private.capture_editorial_asset_snapshots(
  uuid,
  jsonb,
  boolean
) FROM PUBLIC, anon, authenticated, service_role;

-- For extension-aware approved saves, keep every requested schedule out of the
-- legacy implementation until delivery validation and fingerprint capture are
-- complete. Legacy payloads are delegated unchanged for byte-for-byte replay
-- compatibility with their existing request fingerprints.
CREATE OR REPLACE FUNCTION social_private.stage_editorial_approved_schedules(
  _payload jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN _payload IS NULL
      OR jsonb_typeof(_payload) <> 'object'
      OR jsonb_typeof(COALESCE(_payload->'publications', '[]'::jsonb))
        <> 'array'
      THEN _payload
    ELSE jsonb_set(
      _payload,
      '{publications}',
      (
        SELECT COALESCE(
          jsonb_agg(
            CASE
              WHEN jsonb_typeof(plan.value) = 'object'
                THEN plan.value - 'scheduled_at'
              ELSE plan.value
            END
            ORDER BY plan.ordinality
          ),
          '[]'::jsonb
        )
        FROM jsonb_array_elements(_payload->'publications')
          WITH ORDINALITY AS plan(value, ordinality)
      ),
      false
    )
  END
$$;

REVOKE ALL ON FUNCTION social_private.stage_editorial_approved_schedules(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION social_private.schedule_captured_editorial_publications(
  _post_id uuid,
  _payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _plan jsonb;
  _publication public.editorial_publications%ROWTYPE;
  _scheduled_at timestamptz;
  _scheduled_timezone text;
BEGIN
  FOR _plan IN
    SELECT value
    FROM jsonb_array_elements(
      COALESCE(_payload->'publications', '[]'::jsonb)
    )
  LOOP
    IF jsonb_typeof(_plan) <> 'object'
      OR NULLIF(_plan->>'scheduled_at', '') IS NULL THEN
      CONTINUE;
    END IF;

    _publication := NULL;
    IF COALESCE(_plan->>'id', '')
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      SELECT * INTO _publication
      FROM public.editorial_publications AS publication
      WHERE publication.id = (_plan->>'id')::uuid
        AND publication.post_id = _post_id
      FOR UPDATE;
    ELSIF COALESCE(_plan->>'idempotency_key', '')
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      SELECT publication.* INTO _publication
      FROM public.editorial_publications AS publication
      JOIN public.editorial_publication_internal AS internal
        ON internal.publication_id = publication.id
      WHERE publication.post_id = _post_id
        AND internal.idempotency_key =
          (_plan->>'idempotency_key')::uuid
      FOR UPDATE OF publication;
    END IF;

    IF _publication.id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM social_private.editorial_publication_delivery_requests AS request_row
        WHERE request_row.publication_id = _publication.id
      ) THEN
      RAISE EXCEPTION 'editorial publication delivery snapshot is unresolved';
    END IF;

    _scheduled_at := (_plan->>'scheduled_at')::timestamptz;
    _scheduled_timezone := COALESCE(
      NULLIF(_plan->>'scheduled_timezone', ''),
      'America/Sao_Paulo'
    );

    IF _publication.status = 'scheduled' THEN
      IF _publication.scheduled_at IS DISTINCT FROM _scheduled_at
        OR _publication.scheduled_timezone IS DISTINCT FROM
          _scheduled_timezone THEN
        RAISE EXCEPTION
          'editorial delivery idempotency key was reused with different data';
      END IF;
      CONTINUE;
    END IF;

    IF _publication.status <> 'planned' THEN
      RAISE EXCEPTION 'editorial publication plan is unavailable or immutable';
    END IF;

    PERFORM public.transition_editorial_publication_unlocked(
      _publication.id,
      'schedule',
      _publication.version,
      _scheduled_at,
      _scheduled_timezone
    );
  END LOOP;
END
$$;

REVOKE ALL ON FUNCTION
  social_private.schedule_captured_editorial_publications(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

-- Preserve the existing save paths and add the snapshot in the same
-- transaction. If snapshot validation fails, the editorial save rolls back.
CREATE OR REPLACE FUNCTION public.save_editorial_post(
  p_payload jsonb,
  p_expected_version integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _client_id uuid;
  _project_id uuid;
  _post_id uuid;
  _primary_file_id uuid;
  _approved_before_post boolean := false;
  _use_approved_path boolean := false;
  _requires_delivery_gate boolean := false;
  _delegate_payload jsonb;
  _result jsonb;
BEGIN
  PERFORM public.editorial_lock_task_sync();

  IF jsonb_typeof(p_payload) = 'object' THEN
    _client_id := NULLIF(p_payload->>'client_id', '')::uuid;
    _project_id := NULLIF(p_payload->>'project_id', '')::uuid;
    _post_id := NULLIF(p_payload->>'id', '')::uuid;
    _primary_file_id := NULLIF(p_payload->>'primary_file_id', '')::uuid;

    IF _primary_file_id IS NOT NULL
      AND public.editorial_file_is_publishable_media(
        _primary_file_id,
        _client_id,
        _project_id
      ) THEN
      IF _post_id IS NULL THEN
        _use_approved_path := true;
      ELSE
        SELECT file_row.client_decided_at <= post.created_at
        INTO _approved_before_post
        FROM public.editorial_posts AS post
        JOIN public.files AS file_row
          ON file_row.id = post.primary_file_id
        WHERE post.id = _post_id
          AND post.client_id = _client_id
          AND post.project_id = _project_id
          AND post.primary_file_id = _primary_file_id;

        IF COALESCE(_approved_before_post, false) THEN
          _use_approved_path := true;
        END IF;
      END IF;
    END IF;
  END IF;

  IF jsonb_typeof(COALESCE(p_payload->'publications', '[]'::jsonb)) =
      'array' THEN
    SELECT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        COALESCE(p_payload->'publications', '[]'::jsonb)
      ) AS plan(value)
      WHERE jsonb_typeof(plan.value) = 'object'
        AND (
          plan.value ? 'delivery_mode'
          OR plan.value ? 'asset_file_ids'
        )
    ) INTO _requires_delivery_gate;
  END IF;

  _delegate_payload := CASE
    WHEN _use_approved_path AND _requires_delivery_gate
      THEN social_private.stage_editorial_approved_schedules(p_payload)
    ELSE p_payload
  END;

  IF _use_approved_path THEN
    _result := public.save_approved_editorial_post_unlocked(
      _delegate_payload,
      p_expected_version
    );
  ELSE
    _result := public.save_editorial_post_unlocked(
      _delegate_payload,
      p_expected_version
    );
  END IF;

  IF _use_approved_path AND _requires_delivery_gate THEN
    PERFORM social_private.capture_editorial_asset_snapshots(
      (_result->>'post_id')::uuid,
      p_payload,
      COALESCE((_result->>'recovered')::boolean, false)
    );

    PERFORM social_private.schedule_captured_editorial_publications(
      (_result->>'post_id')::uuid,
      p_payload
    );
  END IF;

  RETURN _result;
END
$$;

REVOKE ALL ON FUNCTION public.save_editorial_post(jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_editorial_post(jsonb, integer)
  TO authenticated;

COMMIT;
