-- Fail-closed tenant boundaries and atomic request quotas for the service-role
-- backed API gateway. Existing keys receive discovery-only data scope.

CREATE SCHEMA IF NOT EXISTS api_gateway_private;
REVOKE ALL ON SCHEMA api_gateway_private
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS client_scope_mode text;

UPDATE public.api_keys
SET client_scope_mode = 'none'
WHERE client_scope_mode IS NULL;

ALTER TABLE public.api_keys
  ALTER COLUMN client_scope_mode SET DEFAULT 'none',
  ALTER COLUMN client_scope_mode SET NOT NULL;

-- A duplicated active fingerprint would make LIMIT 1 authorization
-- nondeterministic. Revoke every ambiguous credential, then prevent the state
-- from recurring while retaining old rows for audit history.
UPDATE public.api_keys AS ambiguous_key
SET
  is_active = false,
  revoked_at = COALESCE(ambiguous_key.revoked_at, now()),
  client_scope_mode = 'none'
WHERE EXISTS (
  SELECT 1
  FROM public.api_keys AS duplicate_key
  WHERE duplicate_key.key_hash = ambiguous_key.key_hash
    AND duplicate_key.id <> ambiguous_key.id
    AND duplicate_key.is_active = true
    AND duplicate_key.revoked_at IS NULL
)
  AND ambiguous_key.is_active = true
  AND ambiguous_key.revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS api_keys_active_key_hash_unique_idx
  ON public.api_keys (key_hash)
  WHERE is_active = true AND revoked_at IS NULL;

-- Preserve legacy metadata for audit, but revoke anything that cannot satisfy
-- the current consumer/origin contract before installing the constraints.
UPDATE public.api_keys
SET
  is_active = false,
  revoked_at = COALESCE(revoked_at, statement_timestamp()),
  client_scope_mode = 'none'
WHERE (
  audience IS NOT NULL
  AND audience NOT IN ('mcp', 'api-gateway')
) OR (
  audience = 'api-gateway'
  AND (
    origin IS NULL
    OR origin NOT IN ('api-docs', 'external-api')
  )
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.api_keys'::regclass
      AND conname = 'api_keys_client_scope_mode_valid'
  ) THEN
    ALTER TABLE public.api_keys
      ADD CONSTRAINT api_keys_client_scope_mode_valid
      CHECK (client_scope_mode IN ('none', 'explicit', 'all'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.api_keys'::regclass
      AND conname = 'api_keys_gateway_data_scope_owner_required'
  ) THEN
    ALTER TABLE public.api_keys
      ADD CONSTRAINT api_keys_gateway_data_scope_owner_required
      CHECK (
        audience IS DISTINCT FROM 'api-gateway'
        OR client_scope_mode = 'none'
        OR created_by IS NOT NULL
        OR (is_active = false AND revoked_at IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.api_keys'::regclass
      AND conname = 'api_keys_audience_supported'
  ) THEN
    ALTER TABLE public.api_keys
      ADD CONSTRAINT api_keys_audience_supported
      CHECK (
        audience IS NULL
        OR audience IN ('mcp', 'api-gateway')
        OR (is_active = false AND revoked_at IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.api_keys'::regclass
      AND conname = 'api_keys_gateway_origin_supported'
  ) THEN
    ALTER TABLE public.api_keys
      ADD CONSTRAINT api_keys_gateway_origin_supported
      CHECK (
        audience IS DISTINCT FROM 'api-gateway'
        OR (
          origin IS NOT NULL
          AND origin IN ('api-docs', 'external-api')
        )
        OR (is_active = false AND revoked_at IS NOT NULL)
      );
  END IF;
END
$$;

CREATE TABLE api_gateway_private.api_gateway_key_client_scopes (
  key_id uuid NOT NULL
    REFERENCES public.api_keys(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  client_role public.app_role NOT NULL DEFAULT 'client'::public.app_role
    CHECK (client_role = 'client'::public.app_role),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key_id, client_id),
  FOREIGN KEY (client_id, client_role)
    REFERENCES public.user_roles(user_id, role) ON DELETE CASCADE
);

CREATE INDEX api_gateway_key_client_scopes_client_idx
  ON api_gateway_private.api_gateway_key_client_scopes(client_id, key_id);

ALTER TABLE api_gateway_private.api_gateway_key_client_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_gateway_private.api_gateway_key_client_scopes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE api_gateway_private.api_gateway_key_client_scopes
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON COLUMN public.api_keys.client_scope_mode IS
  'API gateway data boundary: none is discovery-only, explicit uses private client mappings, all is global admin access.';
COMMENT ON TABLE api_gateway_private.api_gateway_key_client_scopes IS
  'Private allowlist of client tenants reachable by an explicit-scope API gateway key.';

CREATE FUNCTION public.configure_api_gateway_key_scope(
  p_key_id uuid,
  p_scope_mode text,
  p_client_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _caller_id uuid := auth.uid();
  _owner_id uuid;
  _requested_client_ids uuid[] := COALESCE(p_client_ids, ARRAY[]::uuid[]);
  _distinct_client_count integer;
  _inserted_client_count integer := 0;
BEGIN
  IF _caller_id IS NULL THEN
    RAISE EXCEPTION 'administrator role required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.user_roles
  WHERE user_id = _caller_id
    AND role = 'admin'::public.app_role
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'administrator role required'
      USING ERRCODE = '42501';
  END IF;

  IF p_key_id IS NULL
    OR p_scope_mode IS NULL
    OR p_scope_mode NOT IN ('none', 'explicit', 'all') THEN
    RAISE EXCEPTION 'key and a valid client scope mode are required'
      USING ERRCODE = '22023';
  END IF;

  IF array_position(_requested_client_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'client scope identifiers cannot contain NULL'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT requested.client_id)::integer
  INTO _distinct_client_count
  FROM unnest(_requested_client_ids) AS requested(client_id);

  IF _distinct_client_count <> cardinality(_requested_client_ids) THEN
    RAISE EXCEPTION 'client scope identifiers must be unique'
      USING ERRCODE = '22023';
  END IF;

  IF p_scope_mode = 'explicit' AND cardinality(_requested_client_ids) = 0 THEN
    RAISE EXCEPTION 'explicit scope requires at least one client'
      USING ERRCODE = '22023';
  END IF;

  IF p_scope_mode <> 'explicit' AND cardinality(_requested_client_ids) <> 0 THEN
    RAISE EXCEPTION 'client identifiers are accepted only for explicit scope'
      USING ERRCODE = '22023';
  END IF;

  SELECT key_row.created_by
  INTO _owner_id
  FROM public.api_keys AS key_row
  WHERE key_row.id = p_key_id
    AND key_row.audience = 'api-gateway'
    AND key_row.is_active = true
    AND key_row.revoked_at IS NULL
    AND (key_row.expires_at IS NULL OR key_row.expires_at > now())
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active API gateway key not found'
      USING ERRCODE = '22023';
  END IF;

  IF _owner_id IS NULL THEN
    RAISE EXCEPTION 'API gateway key owner must be an administrator'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.user_roles
  WHERE user_id = _owner_id
    AND role = 'admin'::public.app_role
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'API gateway key owner must be an administrator'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM api_gateway_private.api_gateway_key_client_scopes
  WHERE key_id = p_key_id;

  IF p_scope_mode = 'explicit' THEN
    INSERT INTO api_gateway_private.api_gateway_key_client_scopes (
      key_id,
      client_id
    )
    SELECT
      p_key_id,
      requested.client_id
    FROM unnest(_requested_client_ids) AS requested(client_id)
    INNER JOIN public.user_roles AS client_role
      ON client_role.user_id = requested.client_id
      AND client_role.role = 'client'::public.app_role;

    GET DIAGNOSTICS _inserted_client_count = ROW_COUNT;
    IF _inserted_client_count <> cardinality(_requested_client_ids) THEN
      RAISE EXCEPTION 'every explicit scope identifier must have the client role'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.api_keys
  SET client_scope_mode = p_scope_mode
  WHERE id = p_key_id;
END;
$$;

COMMENT ON FUNCTION public.configure_api_gateway_key_scope(uuid, text, uuid[]) IS
  'Atomically replaces one API gateway key client boundary; callable only by a current administrator.';

REVOKE ALL ON FUNCTION public.configure_api_gateway_key_scope(uuid, text, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.configure_api_gateway_key_scope(uuid, text, uuid[])
  TO authenticated;

CREATE TABLE api_gateway_private.api_gateway_rate_limits (
  key_fingerprint text NOT NULL
    CHECK (key_fingerprint ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1
    CHECK (request_count > 0),
  PRIMARY KEY (key_fingerprint, window_started_at)
);

ALTER TABLE api_gateway_private.api_gateway_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_gateway_private.api_gateway_rate_limits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE api_gateway_private.api_gateway_rate_limits
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE api_gateway_private.api_gateway_rate_limits IS
  'Private fixed-window counters for the API gateway; keyed only by SHA-256 credential fingerprint.';

CREATE INDEX api_gateway_rate_limits_retention_idx
  ON api_gateway_private.api_gateway_rate_limits(window_started_at);

-- EXPAND compatibility: the API gateway already running in production still
-- calls validate_api_key(text). Keep that exact, service-role-only contract
-- until the audience-aware Edge Function is deployed and verified. A later
-- CUTOVER migration may remove it after no live runtime depends on it.
CREATE OR REPLACE FUNCTION public.validate_api_key(_key_hash text)
RETURNS TABLE(
  id uuid,
  name text,
  scopes text[],
  origin text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    key_row.id,
    key_row.name,
    key_row.scopes,
    key_row.origin
  FROM public.api_keys AS key_row
  WHERE key_row.key_hash = _key_hash
    AND (
      (
        key_row.audience IS NULL
        AND COALESCE(lower(btrim(key_row.origin)), '') <> 'mcp'
      )
      OR (
        key_row.audience = 'api-gateway'
        AND key_row.origin IN ('api-docs', 'external-api')
      )
    )
    AND key_row.is_active = true
    AND key_row.revoked_at IS NULL
    AND (key_row.expires_at IS NULL OR key_row.expires_at > now())
  LIMIT 1
$$;

COMMENT ON FUNCTION public.validate_api_key(text) IS
  'Temporary EXPAND compatibility for the previously deployed API gateway; remove only in a later CUTOVER migration.';

REVOKE ALL ON FUNCTION public.validate_api_key(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_api_key(text)
  TO service_role;

DROP FUNCTION IF EXISTS public.validate_api_key_for_audience(text, text);

CREATE FUNCTION public.validate_api_key_for_audience(
  _key_hash text,
  _audience text
)
RETURNS TABLE(
  id uuid,
  name text,
  scopes text[],
  origin text,
  audience text,
  created_by uuid,
  owner_is_admin boolean,
  client_scope_mode text,
  client_ids uuid[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    key_row.id,
    key_row.name,
    key_row.scopes,
    key_row.origin,
    key_row.audience,
    key_row.created_by,
    EXISTS (
      SELECT 1
      FROM public.user_roles AS owner_role
      WHERE owner_role.user_id = key_row.created_by
        AND owner_role.role = 'admin'::public.app_role
    ) AS owner_is_admin,
    key_row.client_scope_mode,
    COALESCE(
      array_agg(scope_row.client_id ORDER BY scope_row.client_id)
        FILTER (
          WHERE key_row.client_scope_mode = 'explicit'
            AND scope_row.client_id IS NOT NULL
        ),
      ARRAY[]::uuid[]
    ) AS client_ids
  FROM public.api_keys AS key_row
  LEFT JOIN api_gateway_private.api_gateway_key_client_scopes AS scope_row
    ON scope_row.key_id = key_row.id
  WHERE key_row.key_hash = _key_hash
    AND key_row.audience = _audience
    AND _audience IS NOT NULL
    AND _audience <> ''
    AND key_row.is_active = true
    AND key_row.revoked_at IS NULL
    AND (key_row.expires_at IS NULL OR key_row.expires_at > now())
  GROUP BY
    key_row.id,
    key_row.name,
    key_row.scopes,
    key_row.origin,
    key_row.audience,
    key_row.created_by,
    key_row.client_scope_mode
  LIMIT 1
$$;

COMMENT ON FUNCTION public.validate_api_key_for_audience(text, text) IS
  'Validates one active audience-bound key and returns its current owner/admin and fail-closed client scope.';

REVOKE ALL ON FUNCTION public.validate_api_key_for_audience(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_api_key_for_audience(text, text)
  TO service_role;

CREATE FUNCTION public.consume_api_gateway_rate_limit(
  _key_fingerprint text
)
RETURNS TABLE(
  is_allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _window_started_at timestamptz := date_trunc('minute', clock_timestamp());
  _request_count integer;
BEGIN
  IF _key_fingerprint IS NULL
    OR _key_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid API key fingerprint';
  END IF;

  DELETE FROM api_gateway_private.api_gateway_rate_limits AS old_window
  WHERE old_window.window_started_at < _window_started_at - interval '1 day';

  INSERT INTO api_gateway_private.api_gateway_rate_limits (
    key_fingerprint,
    window_started_at,
    request_count
  )
  VALUES (_key_fingerprint, _window_started_at, 1)
  ON CONFLICT (key_fingerprint, window_started_at)
  DO UPDATE
    SET request_count = api_gateway_rate_limits.request_count + 1
  RETURNING request_count INTO _request_count;

  RETURN QUERY
  SELECT
    _request_count <= 120,
    GREATEST(0, 120 - _request_count),
    GREATEST(
      1,
      CEIL(EXTRACT(
        epoch FROM ((_window_started_at + interval '1 minute') - clock_timestamp())
      ))::integer
    );
END;
$$;

COMMENT ON FUNCTION public.consume_api_gateway_rate_limit(text) IS
  'Atomically enforces the fixed API gateway quota of 120 authenticated requests per credential and minute.';

REVOKE ALL ON FUNCTION public.consume_api_gateway_rate_limit(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_api_gateway_rate_limit(text)
  TO service_role;
