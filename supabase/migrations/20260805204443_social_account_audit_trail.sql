BEGIN;

-- Immutable operational history for social account routing. Tokens and OAuth
-- secrets remain in social_private/Vault and must never be copied here.
CREATE TABLE public.social_account_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  project_id uuid,
  external_account_id uuid,
  actor_id uuid,
  actor_kind text NOT NULL DEFAULT 'user',
  provider text NOT NULL DEFAULT 'meta',
  event_type text NOT NULL,
  source text NOT NULL,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_account_events_actor_kind_check
    CHECK (actor_kind IN ('user', 'system')),
  CONSTRAINT social_account_events_provider_check
    CHECK (provider = 'meta'),
  CONSTRAINT social_account_events_type_check
    CHECK (
      event_type IN (
        'connected',
        'reconnected',
        'disconnected',
        'expired',
        'connection_status_changed',
        'project_linked',
        'project_unlinked'
      )
    ),
  CONSTRAINT social_account_events_source_check
    CHECK (source IN ('oauth', 'routing', 'system')),
  CONSTRAINT social_account_events_reason_code_check
    CHECK (reason IS NULL OR reason ~ '^[a-z0-9_:-]{1,100}$'),
  CONSTRAINT social_account_events_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX social_account_events_client_created_idx
  ON public.social_account_events(client_id, created_at DESC);
CREATE INDEX social_account_events_project_created_idx
  ON public.social_account_events(project_id, created_at DESC)
  WHERE project_id IS NOT NULL;
CREATE INDEX social_account_events_account_created_idx
  ON public.social_account_events(external_account_id, created_at DESC)
  WHERE external_account_id IS NOT NULL;
CREATE INDEX social_account_events_operation_idx
  ON public.social_account_events(operation_id);

ALTER TABLE public.social_account_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY social_account_events_select
ON public.social_account_events
FOR SELECT
TO authenticated
USING (public.can_manage_client(client_id));

REVOKE ALL ON public.social_account_events
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.social_account_events TO authenticated;

CREATE OR REPLACE FUNCTION public.social_account_events_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'social account events are immutable';
END;
$$;

REVOKE ALL ON FUNCTION public.social_account_events_immutable_guard()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER social_account_events_immutable_trg
BEFORE UPDATE OR DELETE ON public.social_account_events
FOR EACH ROW EXECUTE FUNCTION public.social_account_events_immutable_guard();

CREATE OR REPLACE FUNCTION social_private.record_social_account_event(
  _operation_id uuid,
  _client_id uuid,
  _project_id uuid,
  _external_account_id uuid,
  _actor_id uuid,
  _event_type text,
  _source text,
  _reason text DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _safe_metadata jsonb := COALESCE(_metadata, '{}'::jsonb);
BEGIN
  IF _client_id IS NULL
    OR jsonb_typeof(_safe_metadata) <> 'object'
    OR octet_length(_safe_metadata::text) > 4096 THEN
    RAISE EXCEPTION 'invalid social account event';
  END IF;

  IF _reason IS NOT NULL
    AND btrim(_reason) !~ '^[a-z0-9_:-]{1,100}$' THEN
    RAISE EXCEPTION 'invalid social account event reason';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(_safe_metadata) AS metadata_key(key)
    WHERE metadata_key.key NOT IN (
      'previous_status',
      'connection_status',
      'automation_enabled'
    )
  ) THEN
    RAISE EXCEPTION 'sensitive fields are forbidden in social account events';
  END IF;

  IF _safe_metadata ? 'previous_status'
    AND _safe_metadata->'previous_status' <> 'null'::jsonb
    AND COALESCE(_safe_metadata->>'previous_status', '') NOT IN (
      'pending',
      'connected',
      'expiring',
      'expired',
      'reauth_required',
      'revoked',
      'error'
    ) THEN
    RAISE EXCEPTION 'invalid previous social connection status';
  END IF;

  IF _safe_metadata ? 'connection_status'
    AND COALESCE(_safe_metadata->>'connection_status', '') NOT IN (
      'pending',
      'connected',
      'expiring',
      'expired',
      'reauth_required',
      'revoked',
      'error'
    ) THEN
    RAISE EXCEPTION 'invalid social connection status';
  END IF;

  IF _safe_metadata ? 'automation_enabled'
    AND jsonb_typeof(_safe_metadata->'automation_enabled') <> 'boolean' THEN
    RAISE EXCEPTION 'invalid social automation state';
  END IF;

  INSERT INTO public.social_account_events (
    operation_id,
    client_id,
    project_id,
    external_account_id,
    actor_id,
    actor_kind,
    provider,
    event_type,
    source,
    reason,
    metadata
  ) VALUES (
    COALESCE(_operation_id, gen_random_uuid()),
    _client_id,
    _project_id,
    _external_account_id,
    _actor_id,
    CASE WHEN _actor_id IS NULL THEN 'system' ELSE 'user' END,
    'meta',
    _event_type,
    _source,
    NULLIF(btrim(_reason), ''),
    _safe_metadata
  );
END;
$$;

REVOKE ALL ON FUNCTION social_private.record_social_account_event(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION social_private.log_project_account_routing_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _row public.project_external_accounts%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _row := OLD;
  ELSE
    _row := NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.external_accounts AS account
    WHERE account.id = _row.external_account_id
      AND account.client_id = _row.client_id
      AND account.platform IN ('facebook', 'instagram')
  ) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  PERFORM social_private.record_social_account_event(
    gen_random_uuid(),
    _row.client_id,
    _row.project_id,
    _row.external_account_id,
    CASE
      WHEN TG_OP = 'DELETE' THEN auth.uid()
      ELSE COALESCE(auth.uid(), _row.created_by)
    END,
    CASE WHEN TG_OP = 'DELETE' THEN 'project_unlinked' ELSE 'project_linked' END,
    'routing',
    NULL,
    '{}'::jsonb
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION social_private.log_project_account_routing_event()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER project_external_accounts_audit_trg
AFTER INSERT OR DELETE ON public.project_external_accounts
FOR EACH ROW EXECUTE FUNCTION social_private.log_project_account_routing_event();

CREATE OR REPLACE FUNCTION social_private.log_external_account_connection_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _event_type text;
  _actor_id uuid;
  _operation_id uuid := gen_random_uuid();
  _project_id uuid;
  _has_project boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _event_type := CASE
      WHEN NEW.connection_status = 'connected' THEN 'connected'
      WHEN NEW.connection_status = 'expired' THEN 'expired'
      ELSE 'connection_status_changed'
    END;
  ELSIF NEW.connection_status IS DISTINCT FROM OLD.connection_status THEN
    IF NEW.connection_status = 'connected' THEN
      -- The private grant trigger below distinguishes a real new grant from an
      -- idempotent retry and records the reconnection exactly once.
      RETURN NEW;
    END IF;
    _event_type := CASE NEW.connection_status
      WHEN 'revoked' THEN 'disconnected'
      WHEN 'expired' THEN 'expired'
      ELSE 'connection_status_changed'
    END;
  ELSE
    RETURN NEW;
  END IF;

  _actor_id := CASE
    WHEN _event_type = 'disconnected'
      THEN COALESCE(NEW.disconnected_by, auth.uid())
    WHEN _event_type = 'expired' THEN NULL
    ELSE COALESCE(auth.uid(), NEW.connected_by)
  END;

  FOR _project_id IN
    SELECT link.project_id
    FROM public.project_external_accounts AS link
    WHERE link.client_id = NEW.client_id
      AND link.external_account_id = NEW.external_account_id
    ORDER BY link.project_id
  LOOP
    _has_project := true;
    PERFORM social_private.record_social_account_event(
      _operation_id,
      NEW.client_id,
      _project_id,
      NEW.external_account_id,
      _actor_id,
      _event_type,
      CASE WHEN _actor_id IS NULL THEN 'system' ELSE 'oauth' END,
      NULL,
      jsonb_build_object(
        'previous_status', CASE WHEN TG_OP = 'UPDATE'
          THEN OLD.connection_status ELSE NULL END,
        'connection_status', NEW.connection_status,
        'automation_enabled', NEW.automation_enabled
      )
    );
  END LOOP;

  IF NOT _has_project THEN
    PERFORM social_private.record_social_account_event(
      _operation_id,
      NEW.client_id,
      NULL,
      NEW.external_account_id,
      _actor_id,
      _event_type,
      CASE WHEN _actor_id IS NULL THEN 'system' ELSE 'oauth' END,
      NULL,
      jsonb_build_object(
        'previous_status', CASE WHEN TG_OP = 'UPDATE'
          THEN OLD.connection_status ELSE NULL END,
        'connection_status', NEW.connection_status,
        'automation_enabled', NEW.automation_enabled
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION social_private.log_external_account_connection_event()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER external_account_connections_audit_trg
AFTER INSERT OR UPDATE ON public.external_account_connections
FOR EACH ROW EXECUTE FUNCTION social_private.log_external_account_connection_event();

CREATE OR REPLACE FUNCTION social_private.log_external_account_reconnect_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _connection public.external_account_connections%ROWTYPE;
  _operation_id uuid := gen_random_uuid();
  _project_id uuid;
  _has_project boolean := false;
BEGIN
  IF NEW.revoked_at IS NOT NULL OR NOT (
    OLD.revoked_at IS NOT NULL
    OR NEW.grant_id IS DISTINCT FROM OLD.grant_id
    OR NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
    OR NEW.resource_access_token_secret_id IS DISTINCT FROM
      OLD.resource_access_token_secret_id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO _connection
  FROM public.external_account_connections AS connection
  WHERE connection.external_account_id = NEW.external_account_id;

  IF NOT FOUND OR _connection.connection_status <> 'connected' THEN
    RETURN NEW;
  END IF;

  FOR _project_id IN
    SELECT link.project_id
    FROM public.project_external_accounts AS link
    WHERE link.client_id = NEW.client_id
      AND link.external_account_id = NEW.external_account_id
    ORDER BY link.project_id
  LOOP
    _has_project := true;
    PERFORM social_private.record_social_account_event(
      _operation_id,
      NEW.client_id,
      _project_id,
      NEW.external_account_id,
      COALESCE(auth.uid(), NEW.connected_by),
      'reconnected',
      'oauth',
      NULL,
      jsonb_build_object(
        'previous_status', NULL,
        'connection_status', _connection.connection_status,
        'automation_enabled', _connection.automation_enabled
      )
    );
  END LOOP;

  IF NOT _has_project THEN
    PERFORM social_private.record_social_account_event(
      _operation_id,
      NEW.client_id,
      NULL,
      NEW.external_account_id,
      COALESCE(auth.uid(), NEW.connected_by),
      'reconnected',
      'oauth',
      NULL,
      jsonb_build_object(
        'previous_status', NULL,
        'connection_status', _connection.connection_status,
        'automation_enabled', _connection.automation_enabled
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION social_private.log_external_account_reconnect_event()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER external_account_grants_reconnect_audit_trg
AFTER UPDATE ON social_private.external_account_grants
FOR EACH ROW EXECUTE FUNCTION social_private.log_external_account_reconnect_event();

-- A resource authorized by Meta can have only one active destination. The
-- existing unique index remains the race-safe backstop; this trigger provides
-- a controlled error before a generic constraint failure.
CREATE OR REPLACE FUNCTION social_private.external_account_grants_scope_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.revoked_at IS NULL AND EXISTS (
    SELECT 1
    FROM social_private.external_account_grants AS mapping
    WHERE mapping.provider = NEW.provider
      AND mapping.platform = NEW.platform
      AND mapping.provider_resource_id = NEW.provider_resource_id
      AND mapping.revoked_at IS NULL
      AND mapping.external_account_id <> NEW.external_account_id
  ) THEN
    RAISE EXCEPTION
      'this Meta account is already connected; disconnect it before reassignment';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION social_private.external_account_grants_scope_guard()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER external_account_grants_scope_guard_trg
BEFORE INSERT OR UPDATE ON social_private.external_account_grants
FOR EACH ROW EXECUTE FUNCTION social_private.external_account_grants_scope_guard();

-- Official provider identity is immutable after the first OAuth connection.
-- Display name, handle and status can still follow legitimate provider changes.
CREATE OR REPLACE FUNCTION public.external_accounts_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'id is immutable on external_accounts';
    END IF;
    IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN
      RAISE EXCEPTION 'client_id is immutable on external_accounts';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'created_at is immutable on external_accounts';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'created_by is immutable on external_accounts';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.external_account_connections AS connection
      WHERE connection.external_account_id = OLD.id
    ) AND (
      NEW.platform IS DISTINCT FROM OLD.platform
      OR NEW.external_id IS DISTINCT FROM OLD.external_id
    ) THEN
      RAISE EXCEPTION
        'platform and external_id are immutable for connected accounts';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.external_accounts_guard()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
