-- Harden public Workspace inbox links with expiring token generations and an
-- atomic upload reservation ledger. The Edge Function is the only caller of
-- the SECURITY DEFINER RPCs; browser roles cannot inspect or mutate the ledger.

ALTER TABLE public.workspace_nodes
  ADD COLUMN IF NOT EXISTS inbox_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS inbox_token_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS inbox_token_generation uuid,
  ADD COLUMN IF NOT EXISTS inbox_scan_status text;

UPDATE public.workspace_nodes
SET
  inbox_token_created_at = COALESCE(inbox_token_created_at, now()),
  inbox_token_expires_at = COALESCE(inbox_token_expires_at, now() + interval '7 days'),
  inbox_token_generation = COALESCE(inbox_token_generation, gen_random_uuid())
WHERE inbox_token IS NOT NULL;

-- A token on a file was never a valid inbox target. Revoke any such legacy
-- value before validating the stronger folder-only invariant.
UPDATE public.workspace_nodes
SET
  inbox_token = NULL,
  inbox_token_created_at = NULL,
  inbox_token_expires_at = NULL,
  inbox_token_generation = NULL
WHERE inbox_token IS NOT NULL
  AND kind <> 'folder'::public.workspace_kind;

UPDATE public.workspace_nodes
SET
  inbox_token_created_at = NULL,
  inbox_token_expires_at = NULL,
  inbox_token_generation = NULL
WHERE inbox_token IS NULL
  AND (
    inbox_token_created_at IS NOT NULL
    OR inbox_token_expires_at IS NOT NULL
    OR inbox_token_generation IS NOT NULL
  );

CREATE UNIQUE INDEX IF NOT EXISTS workspace_nodes_inbox_token_generation_idx
  ON public.workspace_nodes(inbox_token_generation)
  WHERE inbox_token_generation IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.workspace_nodes'::regclass
      AND conname = 'workspace_nodes_inbox_scan_status_ck'
  ) THEN
    ALTER TABLE public.workspace_nodes
      ADD CONSTRAINT workspace_nodes_inbox_scan_status_ck
      CHECK (inbox_scan_status IS NULL OR inbox_scan_status IN ('pending', 'clean', 'blocked'));
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.sync_workspace_inbox_token_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.inbox_token IS NULL THEN
    NEW.inbox_token_created_at := NULL;
    NEW.inbox_token_expires_at := NULL;
    NEW.inbox_token_generation := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
     OR OLD.inbox_token IS DISTINCT FROM NEW.inbox_token THEN
    NEW.inbox_token_created_at := statement_timestamp();
    NEW.inbox_token_generation := gen_random_uuid();

    IF NEW.inbox_token_expires_at IS NULL
       OR NEW.inbox_token_expires_at <= statement_timestamp() THEN
      NEW.inbox_token_expires_at := statement_timestamp() + interval '7 days';
    END IF;
  ELSE
    -- Generation and creation time are server-owned. A caller may shorten or
    -- extend an active link, but cannot detach reservations from its token.
    NEW.inbox_token_created_at := OLD.inbox_token_created_at;
    NEW.inbox_token_generation := OLD.inbox_token_generation;
    IF NEW.inbox_token_expires_at IS NULL THEN
      -- Keeps older clients that only write inbox_token compatible while
      -- making every active link finite-lived.
      NEW.inbox_token_expires_at := statement_timestamp() + interval '7 days';
    END IF;
  END IF;

  NEW.inbox_token_created_at := COALESCE(
    NEW.inbox_token_created_at,
    statement_timestamp()
  );
  NEW.inbox_token_generation := COALESCE(
    NEW.inbox_token_generation,
    gen_random_uuid()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workspace_nodes_inbox_token_metadata
  ON public.workspace_nodes;

CREATE TRIGGER trg_workspace_nodes_inbox_token_metadata
  BEFORE INSERT OR UPDATE OF
    inbox_token,
    inbox_token_expires_at,
    inbox_token_created_at,
    inbox_token_generation
  ON public.workspace_nodes
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_workspace_inbox_token_metadata();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.workspace_nodes'::regclass
      AND conname = 'workspace_nodes_inbox_token_metadata_ck'
  ) THEN
    ALTER TABLE public.workspace_nodes
      ADD CONSTRAINT workspace_nodes_inbox_token_metadata_ck
      CHECK (
        (
          inbox_token IS NULL
          AND inbox_token_created_at IS NULL
          AND inbox_token_expires_at IS NULL
          AND inbox_token_generation IS NULL
        )
        OR
        (
          inbox_token IS NOT NULL
          AND inbox_token_created_at IS NOT NULL
          AND inbox_token_expires_at IS NOT NULL
          AND inbox_token_generation IS NOT NULL
          AND kind = 'folder'::public.workspace_kind
          AND inbox_token_expires_at > inbox_token_created_at
        )
      );
  END IF;
END
$$;

-- The production project already has this private bucket. Creating it here as
-- an idempotent prerequisite makes a fresh portable project complete without
-- changing limits of an existing bucket used by authenticated large uploads.
INSERT INTO storage.buckets (id, name, public)
VALUES ('workspace', 'workspace', false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.workspace_inbox_upload_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  folder_id uuid NOT NULL REFERENCES public.workspace_nodes(id) ON DELETE CASCADE,
  token_generation uuid NOT NULL,
  node_id uuid REFERENCES public.workspace_nodes(id) ON DELETE SET NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 26214400),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed', 'orphaned', 'cleaned')),
  storage_path text NOT NULL UNIQUE,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS workspace_inbox_reservations_quota_idx
  ON public.workspace_inbox_upload_reservations(
    folder_id,
    token_generation,
    created_at DESC
  );

ALTER TABLE public.workspace_inbox_upload_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_inbox_upload_reservations FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.workspace_inbox_upload_reservations
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.workspace_inbox_upload_reservations TO service_role;

CREATE OR REPLACE FUNCTION public.inspect_workspace_inbox(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _folder public.workspace_nodes%ROWTYPE;
  _files_24h bigint;
  _bytes_24h bigint;
  _uploads_1m bigint;
  _now timestamptz := statement_timestamp();
BEGIN
  SELECT *
  INTO _folder
  FROM public.workspace_nodes
  WHERE inbox_token = p_token
    AND kind = 'folder'::public.workspace_kind;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'INBOX_INVALID_TOKEN';
  END IF;

  IF _folder.inbox_token_expires_at IS NULL
     OR _folder.inbox_token_expires_at <= _now THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'INBOX_TOKEN_EXPIRED';
  END IF;

  SELECT
    count(*) FILTER (
      WHERE status IN ('pending', 'completed', 'orphaned')
        AND created_at >= _now - interval '24 hours'
    ),
    COALESCE(sum(size_bytes) FILTER (
      WHERE status IN ('pending', 'completed', 'orphaned')
        AND created_at >= _now - interval '24 hours'
    ), 0),
    count(*) FILTER (
      WHERE created_at >= _now - interval '1 minute'
    )
  INTO _files_24h, _bytes_24h, _uploads_1m
  FROM public.workspace_inbox_upload_reservations
  WHERE folder_id = _folder.id
    AND token_generation = _folder.inbox_token_generation;

  RETURN jsonb_build_object(
    'folder', jsonb_build_object(
      'id', _folder.id,
      'name', _folder.name,
      'scope', _folder.scope,
      'client_id', _folder.client_id
    ),
    'expires_at', _folder.inbox_token_expires_at,
    'limits', jsonb_build_object(
      'max_file_bytes', 26214400,
      'max_files_per_24h', 20,
      'max_bytes_per_24h', 104857600,
      'max_uploads_per_minute', 10
    ),
    'usage', jsonb_build_object(
      'files_24h', _files_24h,
      'bytes_24h', _bytes_24h,
      'uploads_1m', _uploads_1m
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_workspace_inbox_upload(
  p_token uuid,
  p_size_bytes bigint,
  p_request_id uuid,
  p_extension text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _folder public.workspace_nodes%ROWTYPE;
  _reservation_id uuid := gen_random_uuid();
  _files_24h bigint;
  _bytes_24h bigint;
  _uploads_1m bigint;
  _now timestamptz := statement_timestamp();
  _existing public.workspace_inbox_upload_reservations%ROWTYPE;
  _storage_path text;
BEGIN
  IF p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'INBOX_EMPTY_FILE';
  END IF;

  IF p_size_bytes > 26214400 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'INBOX_FILE_TOO_LARGE';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'INBOX_INVALID_REQUEST_ID';
  END IF;

  IF p_extension IS NULL OR p_extension !~ '^[a-z0-9]{1,10}$' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'INBOX_INVALID_EXTENSION';
  END IF;

  -- Serializes reservations for a folder/token generation. Rotation and
  -- revocation also update this row, so an old token cannot reserve afterward.
  SELECT *
  INTO _folder
  FROM public.workspace_nodes
  WHERE inbox_token = p_token
    AND kind = 'folder'::public.workspace_kind
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'INBOX_INVALID_TOKEN';
  END IF;

  IF _folder.inbox_token_expires_at IS NULL
     OR _folder.inbox_token_expires_at <= _now THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'INBOX_TOKEN_EXPIRED';
  END IF;

  SELECT *
  INTO _existing
  FROM public.workspace_inbox_upload_reservations
  WHERE request_id = p_request_id;

  IF FOUND THEN
    IF _existing.folder_id IS DISTINCT FROM _folder.id
       OR _existing.token_generation IS DISTINCT FROM _folder.inbox_token_generation
       OR _existing.size_bytes IS DISTINCT FROM p_size_bytes
       OR right(_existing.storage_path, length(p_extension) + 1) <> ('.' || p_extension)
       OR _existing.status IN ('failed', 'orphaned', 'cleaned') THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'INBOX_REQUEST_REUSED';
    END IF;

    RETURN jsonb_build_object(
      'reservation_id', _existing.id,
      'storage_path', _existing.storage_path,
      'status', _existing.status,
      'node_id', _existing.node_id,
      'folder', jsonb_build_object(
        'id', _folder.id,
        'name', _folder.name,
        'scope', _folder.scope,
        'client_id', _folder.client_id
      )
    );
  END IF;

  UPDATE public.workspace_inbox_upload_reservations
  SET
    status = 'orphaned',
    failure_code = 'reservation_timeout',
    completed_at = _now
  WHERE folder_id = _folder.id
    AND token_generation = _folder.inbox_token_generation
    AND status = 'pending'
    AND created_at < _now - interval '15 minutes';

  DELETE FROM public.workspace_inbox_upload_reservations
  WHERE folder_id = _folder.id
    AND status IN ('failed', 'cleaned', 'completed')
    AND created_at < _now - interval '30 days';

  SELECT
    count(*) FILTER (
      WHERE status IN ('pending', 'completed', 'orphaned')
        AND created_at >= _now - interval '24 hours'
    ),
    COALESCE(sum(size_bytes) FILTER (
      WHERE status IN ('pending', 'completed', 'orphaned')
        AND created_at >= _now - interval '24 hours'
    ), 0),
    count(*) FILTER (
      WHERE created_at >= _now - interval '1 minute'
    )
  INTO _files_24h, _bytes_24h, _uploads_1m
  FROM public.workspace_inbox_upload_reservations
  WHERE folder_id = _folder.id
    AND token_generation = _folder.inbox_token_generation;

  IF _uploads_1m >= 10 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'INBOX_RATE_LIMIT';
  END IF;

  IF _files_24h >= 20 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'INBOX_FILE_QUOTA';
  END IF;

  IF _bytes_24h + p_size_bytes > 104857600 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'INBOX_BYTE_QUOTA';
  END IF;

  _storage_path := CASE
    WHEN _folder.scope = 'client'::public.workspace_scope
      THEN 'client/' || _folder.client_id::text || '/inbox/'
    ELSE 'global/global/inbox/'
  END || _reservation_id::text || '.' || p_extension;

  INSERT INTO public.workspace_inbox_upload_reservations (
    id,
    request_id,
    folder_id,
    token_generation,
    size_bytes,
    storage_path
  ) VALUES (
    _reservation_id,
    p_request_id,
    _folder.id,
    _folder.inbox_token_generation,
    p_size_bytes,
    _storage_path
  );

  RETURN jsonb_build_object(
    'reservation_id', _reservation_id,
    'storage_path', _storage_path,
    'status', 'pending',
    'folder', jsonb_build_object(
      'id', _folder.id,
      'name', _folder.name,
      'scope', _folder.scope,
      'client_id', _folder.client_id
    ),
    'usage', jsonb_build_object(
      'files_24h', _files_24h + 1,
      'bytes_24h', _bytes_24h + p_size_bytes,
      'uploads_1m', _uploads_1m + 1
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_workspace_inbox_upload(
  p_reservation_id uuid,
  p_token uuid,
  p_request_id uuid,
  p_name text,
  p_mime text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _reservation public.workspace_inbox_upload_reservations%ROWTYPE;
  _folder public.workspace_nodes%ROWTYPE;
  _node_id uuid := gen_random_uuid();
BEGIN
  SELECT *
  INTO _reservation
  FROM public.workspace_inbox_upload_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'INBOX_INVALID_RESERVATION';
  END IF;

  IF _reservation.status = 'completed' AND _reservation.node_id IS NOT NULL THEN
    RETURN _reservation.node_id;
  END IF;

  IF _reservation.status <> 'pending' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'INBOX_INVALID_RESERVATION';
  END IF;

  IF _reservation.request_id IS DISTINCT FROM p_request_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'INBOX_INVALID_RESERVATION';
  END IF;

  SELECT *
  INTO _folder
  FROM public.workspace_nodes
  WHERE id = _reservation.folder_id
  FOR UPDATE;

  IF NOT FOUND
     OR _folder.inbox_token IS NULL
     OR _folder.inbox_token IS DISTINCT FROM p_token
     OR _folder.inbox_token_generation IS DISTINCT FROM _reservation.token_generation
     OR _folder.inbox_token_expires_at IS NULL
     OR _folder.inbox_token_expires_at <= statement_timestamp() THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'INBOX_RESERVATION_REVOKED';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' OR length(p_name) > 240 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'INBOX_INVALID_FILE_NAME';
  END IF;

  INSERT INTO public.workspace_nodes (
    id,
    name,
    kind,
    scope,
    client_id,
    parent_id,
    mime,
    size_bytes,
    storage_path,
    created_by,
    inbox_scan_status
  ) VALUES (
    _node_id,
    p_name,
    'file'::public.workspace_kind,
    _folder.scope,
    _folder.client_id,
    _folder.id,
    NULLIF(left(COALESCE(p_mime, ''), 255), ''),
    _reservation.size_bytes,
    _reservation.storage_path,
    NULL,
    'pending'
  );

  UPDATE public.workspace_inbox_upload_reservations
  SET
    status = 'completed',
    node_id = _node_id,
    completed_at = statement_timestamp()
  WHERE id = _reservation.id;

  RETURN _node_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_workspace_inbox_upload(
  p_reservation_id uuid,
  p_failure_code text DEFAULT 'upload_failed',
  p_storage_orphaned boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.workspace_inbox_upload_reservations
  SET
    status = CASE WHEN p_storage_orphaned THEN 'orphaned' ELSE 'failed' END,
    failure_code = left(COALESCE(NULLIF(p_failure_code, ''), 'upload_failed'), 80),
    completed_at = statement_timestamp()
  WHERE id = p_reservation_id
    AND status = 'pending';
END;
$$;

CREATE OR REPLACE FUNCTION public.manage_workspace_inbox_token(
  p_folder_id uuid,
  p_action text DEFAULT 'ensure'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _folder public.workspace_nodes%ROWTYPE;
  _now timestamptz := statement_timestamp();
BEGIN
  IF p_action NOT IN ('ensure', 'rotate', 'revoke') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'WORKSPACE_INBOX_INVALID_ACTION';
  END IF;

  -- This function remains RLS-bound to the authenticated staff member. The
  -- row lock makes ensure/rotate return the same token that was committed.
  SELECT *
  INTO _folder
  FROM public.workspace_nodes
  WHERE id = p_folder_id
    AND kind = 'folder'::public.workspace_kind
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'WORKSPACE_INBOX_FOLDER_NOT_FOUND';
  END IF;

  IF p_action = 'revoke' THEN
    UPDATE public.workspace_nodes
    SET
      inbox_token = NULL,
      inbox_token_expires_at = NULL
    WHERE id = _folder.id
    RETURNING * INTO _folder;
  ELSIF p_action = 'rotate'
        OR _folder.inbox_token IS NULL
        OR _folder.inbox_token_expires_at IS NULL
        OR _folder.inbox_token_expires_at <= _now THEN
    UPDATE public.workspace_nodes
    SET
      inbox_token = gen_random_uuid(),
      inbox_token_expires_at = _now + interval '7 days'
    WHERE id = _folder.id
    RETURNING * INTO _folder;
  END IF;

  RETURN jsonb_build_object(
    'token', _folder.inbox_token,
    'expires_at', _folder.inbox_token_expires_at,
    'revoked', _folder.inbox_token IS NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_workspace_inbox_token_metadata() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inspect_workspace_inbox(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_workspace_inbox_upload(uuid, bigint, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_workspace_inbox_upload(uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_workspace_inbox_upload(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.manage_workspace_inbox_token(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.inspect_workspace_inbox(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_workspace_inbox_upload(uuid, bigint, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_workspace_inbox_upload(uuid, uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_workspace_inbox_upload(uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.manage_workspace_inbox_token(uuid, text) TO authenticated;
