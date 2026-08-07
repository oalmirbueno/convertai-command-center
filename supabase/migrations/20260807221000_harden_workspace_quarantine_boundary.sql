-- EXPAND phase for the Workspace inbox quarantine. It adds bounded tokens,
-- an audited release RPC and the Storage predicate while preserving the old
-- browser transition and Storage policies until the new UI/Edge release is
-- proven. A later forward-only CUTOVER migration attaches the predicate to
-- every SELECT policy and blocks direct scan-state updates.

UPDATE public.workspace_nodes
SET
  inbox_token_created_at = COALESCE(inbox_token_created_at, statement_timestamp()),
  inbox_token_expires_at = LEAST(
    COALESCE(
      inbox_token_expires_at,
      COALESCE(inbox_token_created_at, statement_timestamp()) + interval '7 days'
    ),
    COALESCE(inbox_token_created_at, statement_timestamp()) + interval '7 days'
  )
WHERE inbox_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_workspace_inbox_token_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  _now timestamptz := statement_timestamp();
BEGIN
  IF NEW.inbox_token IS NULL THEN
    NEW.inbox_token_created_at := NULL;
    NEW.inbox_token_expires_at := NULL;
    NEW.inbox_token_generation := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
     OR OLD.inbox_token IS DISTINCT FROM NEW.inbox_token THEN
    NEW.inbox_token_created_at := _now;
    NEW.inbox_token_generation := gen_random_uuid();
    NEW.inbox_token_expires_at := _now + interval '7 days';
  ELSE
    NEW.inbox_token_created_at := OLD.inbox_token_created_at;
    NEW.inbox_token_generation := OLD.inbox_token_generation;
    NEW.inbox_token_expires_at := LEAST(
      COALESCE(NEW.inbox_token_expires_at, OLD.inbox_token_created_at + interval '7 days'),
      OLD.inbox_token_created_at + interval '7 days'
    );
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE public.workspace_nodes
  DROP CONSTRAINT IF EXISTS workspace_nodes_inbox_token_max_ttl_ck;

ALTER TABLE public.workspace_nodes
  ADD CONSTRAINT workspace_nodes_inbox_token_max_ttl_ck
  CHECK (
    inbox_token IS NULL
    OR inbox_token_expires_at <= inbox_token_created_at + interval '7 days'
  );

CREATE OR REPLACE FUNCTION public.guard_workspace_inbox_security_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user = 'authenticated' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.inbox_token IS NOT NULL
         OR NEW.inbox_token_created_at IS NOT NULL
         OR NEW.inbox_token_expires_at IS NOT NULL
         OR NEW.inbox_token_generation IS NOT NULL THEN
        RAISE EXCEPTION USING
          ERRCODE = '42501',
          MESSAGE = 'WORKSPACE_INBOX_SECURITY_FIELDS_SERVER_ONLY';
      END IF;
    ELSIF NEW.inbox_token IS DISTINCT FROM OLD.inbox_token
       OR NEW.inbox_token_created_at IS DISTINCT FROM OLD.inbox_token_created_at
       OR NEW.inbox_token_expires_at IS DISTINCT FROM OLD.inbox_token_expires_at
       OR NEW.inbox_token_generation IS DISTINCT FROM OLD.inbox_token_generation THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'WORKSPACE_INBOX_SECURITY_FIELDS_SERVER_ONLY';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workspace_nodes_inbox_security_guard
  ON public.workspace_nodes;

CREATE TRIGGER trg_workspace_nodes_inbox_security_guard
  BEFORE INSERT OR UPDATE OF
    inbox_token,
    inbox_token_created_at,
    inbox_token_expires_at,
    inbox_token_generation
  ON public.workspace_nodes
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_workspace_inbox_security_columns();

CREATE OR REPLACE FUNCTION public.manage_workspace_inbox_token(
  p_folder_id uuid,
  p_action text DEFAULT 'ensure'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _actor uuid := auth.uid();
  _folder public.workspace_nodes%ROWTYPE;
  _now timestamptz := statement_timestamp();
BEGIN
  IF _actor IS NULL OR NOT public.is_staff(_actor) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'WORKSPACE_INBOX_FORBIDDEN';
  END IF;
  IF p_action NOT IN ('ensure', 'rotate', 'revoke') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'WORKSPACE_INBOX_INVALID_ACTION';
  END IF;

  SELECT *
  INTO _folder
  FROM public.workspace_nodes
  WHERE id = p_folder_id
    AND kind = 'folder'::public.workspace_kind
  FOR UPDATE;

  IF NOT FOUND
     OR (
       _folder.scope = 'client'::public.workspace_scope
       AND (
         _folder.client_id IS NULL
         OR NOT public.can_access_client(_folder.client_id)
       )
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'WORKSPACE_INBOX_FOLDER_NOT_FOUND';
  END IF;

  IF p_action = 'revoke' THEN
    UPDATE public.workspace_nodes
    SET inbox_token = NULL, inbox_token_expires_at = NULL
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

CREATE TABLE IF NOT EXISTS public.workspace_inbox_scan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id uuid NOT NULL REFERENCES public.workspace_nodes(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  previous_status text,
  next_status text NOT NULL,
  method text NOT NULL,
  reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (previous_status IS NULL OR previous_status IN ('pending', 'clean', 'blocked')),
  CHECK (next_status IN ('pending', 'clean', 'blocked')),
  CHECK (length(method) BETWEEN 1 AND 64),
  CHECK (reference IS NULL OR length(reference) <= 500)
);

ALTER TABLE public.workspace_inbox_scan_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_inbox_scan_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.workspace_inbox_scan_events
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.workspace_inbox_scan_events TO service_role;

CREATE OR REPLACE FUNCTION public.mark_workspace_inbox_scan_clean(
  p_node_id uuid,
  p_reference text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _actor uuid := auth.uid();
  _node public.workspace_nodes%ROWTYPE;
BEGIN
  IF _actor IS NULL
     OR NOT public.has_role(_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'WORKSPACE_INBOX_VERIFICATION_FORBIDDEN';
  END IF;
  IF p_reference IS NOT NULL AND length(p_reference) > 500 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'WORKSPACE_INBOX_REFERENCE_TOO_LONG';
  END IF;

  SELECT *
  INTO _node
  FROM public.workspace_nodes
  WHERE id = p_node_id
    AND kind = 'file'::public.workspace_kind
  FOR UPDATE;

  IF NOT FOUND OR _node.inbox_scan_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'WORKSPACE_INBOX_NOT_PENDING';
  END IF;

  UPDATE public.workspace_nodes
  SET inbox_scan_status = 'clean'
  WHERE id = _node.id;

  INSERT INTO public.workspace_inbox_scan_events (
    node_id,
    actor_id,
    previous_status,
    next_status,
    method,
    reference
  ) VALUES (
    _node.id,
    _actor,
    _node.inbox_scan_status,
    'clean',
    'manual_admin',
    NULLIF(btrim(p_reference), '')
  );

  RETURN jsonb_build_object(
    'node_id', _node.id,
    'status', 'clean',
    'verified_at', statement_timestamp()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.workspace_storage_object_is_releasable(
  _name text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN _name LIKE 'client/%/inbox/%'
      OR _name LIKE 'global/global/inbox/%'
    THEN EXISTS (
      SELECT 1
      FROM public.workspace_nodes AS node
      WHERE node.storage_path = _name
        AND node.kind = 'file'::public.workspace_kind
        AND node.inbox_scan_status = 'clean'
    )
    ELSE true
  END
$$;

-- Deliberately do not attach workspace_storage_object_is_releasable() to the
-- existing permissive Storage policies in the EXPAND release. The current UI
-- still updates inbox_scan_status directly. Once the audited RPC is deployed
-- and its smoke passes, a separate CUTOVER migration must replace every
-- overlapping SELECT policy and include this predicate.

REVOKE ALL ON FUNCTION public.guard_workspace_inbox_security_columns()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_workspace_inbox_token_metadata()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.manage_workspace_inbox_token(uuid, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_workspace_inbox_scan_clean(uuid, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workspace_storage_object_is_releasable(text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.manage_workspace_inbox_token(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_workspace_inbox_scan_clean(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_storage_object_is_releasable(text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
