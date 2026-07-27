-- ============================================================================
-- Aceleriq OS - secure file approval, private Storage and internal isolation
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Additive schema and compatibility backfill
-- --------------------------------------------------------------------------
ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS agency_approval_status text NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS agency_feedback text,
  ADD COLUMN IF NOT EXISTS agency_reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS agency_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_decided_by uuid,
  ADD COLUMN IF NOT EXISTS client_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS revision_of_file_id uuid,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;

ALTER TABLE public.updates
  ADD COLUMN IF NOT EXISTS client_visible boolean NOT NULL DEFAULT false;

-- Recover metadata for legacy public URLs before the bucket becomes private.
-- Only persist a canonical path that actually exists in storage.objects.
UPDATE public.files AS file_row
SET
  storage_bucket = 'files',
  storage_path = object_row.name
FROM storage.objects AS object_row
WHERE object_row.bucket_id = 'files'
  AND (file_row.storage_bucket IS NULL OR file_row.storage_path IS NULL)
  AND file_row.file_url LIKE '%/storage/v1/object/public/files/%'
  AND object_row.name = split_part(
    split_part(
      file_row.file_url,
      '/storage/v1/object/public/files/',
      2
    ),
    '?',
    1
  );

UPDATE public.files AS file_row
SET
  storage_bucket = 'files',
  storage_path = object_row.name
FROM storage.objects AS object_row
WHERE object_row.bucket_id = 'files'
  AND (file_row.storage_bucket IS NULL OR file_row.storage_path IS NULL)
  AND file_row.file_url = 'files://' || object_row.name;

-- Machine-origin rows marked internal never inherit a legacy approval flag.
-- Old agents used approval_status as processing metadata, so fail closed.
UPDATE public.files
SET
  approval_status = 'none',
  feedback = NULL,
  requires_approval = false
WHERE parent_file_id IS NULL
  AND visibility = 'internal'
  AND source IS DISTINCT FROM 'panel';

-- Rows explicitly released, plus rows that passed through the old panel
-- approval UI before visibility was wired, remain available.
UPDATE public.files
SET
  agency_approval_status = 'approved',
  agency_reviewed_by = COALESCE(agency_reviewed_by, uploaded_by),
  agency_reviewed_at = COALESCE(agency_reviewed_at, updated_at, created_at),
  visibility = 'approval',
  requires_approval = true,
  approval_requested_at = COALESCE(approval_requested_at, created_at),
  client_decided_by = CASE
    WHEN approval_status IN ('approved', 'rejected')
      THEN COALESCE(client_decided_by, client_id)
    ELSE client_decided_by
  END,
  client_decided_at = CASE
    WHEN approval_status IN ('approved', 'rejected')
      THEN COALESCE(client_decided_at, updated_at, created_at)
    ELSE client_decided_at
  END,
  locked_at = CASE
    WHEN approval_status IN ('approved', 'rejected')
      THEN COALESCE(locked_at, updated_at, created_at)
    ELSE locked_at
  END
WHERE parent_file_id IS NULL
  AND approval_status IN ('pending', 'approved', 'rejected')
  AND (
    visibility IN ('approval', 'client_shared')
    OR source = 'panel'
  );

-- Only rows explicitly marked client_shared stay shared. The historical
-- source='panel' default is not evidence that an internal file was released.
UPDATE public.files
SET
  agency_approval_status = 'approved',
  agency_reviewed_by = COALESCE(agency_reviewed_by, uploaded_by),
  agency_reviewed_at = COALESCE(agency_reviewed_at, updated_at, created_at),
  visibility = 'client_shared',
  requires_approval = false,
  approval_status = 'none',
  approval_requested_at = NULL
WHERE parent_file_id IS NULL
  AND visibility = 'client_shared';

-- Old rows explicitly marked for approval but missing a status become pending.
UPDATE public.files
SET
  agency_approval_status = 'approved',
  agency_reviewed_by = COALESCE(agency_reviewed_by, uploaded_by),
  agency_reviewed_at = COALESCE(agency_reviewed_at, updated_at, created_at),
  visibility = 'approval',
  requires_approval = true,
  approval_status = 'pending',
  approval_requested_at = COALESCE(approval_requested_at, created_at)
WHERE parent_file_id IS NULL
  AND visibility = 'approval'
  AND approval_status = 'none';

-- Historical signed contracts are positively linked by contracts.file_id,
-- so they can be migrated to an immutable client-visible delivery.
UPDATE public.files AS file_row
SET
  source = 'contract-public',
  agency_approval_status = 'approved',
  agency_feedback = NULL,
  agency_reviewed_by = COALESCE(
    contract.created_by,
    contract.client_id
  ),
  agency_reviewed_at = contract.client_signed_at,
  visibility = 'client_shared',
  requires_approval = false,
  approval_status = 'approved',
  feedback = NULL,
  client_decided_by = contract.client_id,
  client_decided_at = contract.client_signed_at,
  approval_requested_at = contract.client_signed_at,
  locked_at = contract.client_signed_at
FROM public.contracts AS contract
WHERE contract.file_id = file_row.id
  AND contract.client_id = file_row.client_id
  AND contract.status = 'completed'
  AND contract.client_signed_at IS NOT NULL;

-- Historical carousels occasionally formed multi-level chains. Flatten them
-- to one root before enforcing the new immutable approval boundary.
WITH RECURSIVE file_tree AS (
  SELECT
    root.id,
    root.id AS root_id,
    0 AS depth
  FROM public.files AS root
  WHERE root.parent_file_id IS NULL

  UNION ALL

  SELECT
    child.id,
    file_tree.root_id,
    file_tree.depth + 1
  FROM public.files AS child
  JOIN file_tree
    ON child.parent_file_id = file_tree.id
)
UPDATE public.files AS nested
SET parent_file_id = file_tree.root_id
FROM file_tree
WHERE nested.id = file_tree.id
  AND file_tree.depth > 1;

-- Carousel children inherit the root's effective gate and lock.
UPDATE public.files AS child
SET
  agency_approval_status = root.agency_approval_status,
  agency_reviewed_by = root.agency_reviewed_by,
  agency_reviewed_at = root.agency_reviewed_at,
  visibility = root.visibility,
  requires_approval = false,
  approval_status = 'none',
  approval_requested_at = root.approval_requested_at,
  locked_at = root.locked_at
FROM public.files AS root
WHERE child.parent_file_id = root.id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.files'::regclass
      AND conname = 'files_agency_approval_status_check'
  ) THEN
    ALTER TABLE public.files
      ADD CONSTRAINT files_agency_approval_status_check
      CHECK (
        agency_approval_status IN (
          'not_requested', 'pending', 'approved', 'rejected'
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.files'::regclass
      AND conname = 'files_approval_status_check'
  ) THEN
    ALTER TABLE public.files
      ADD CONSTRAINT files_approval_status_check
      CHECK (approval_status IN ('none', 'pending', 'approved', 'rejected'))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.files'::regclass
      AND conname = 'files_visibility_check'
  ) THEN
    ALTER TABLE public.files
      ADD CONSTRAINT files_visibility_check
      CHECK (visibility IN ('internal', 'client_shared', 'approval'))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.files'::regclass
      AND conname = 'files_revision_of_file_id_fkey'
  ) THEN
    ALTER TABLE public.files
      ADD CONSTRAINT files_revision_of_file_id_fkey
      FOREIGN KEY (revision_of_file_id)
      REFERENCES public.files(id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.files'::regclass
      AND conname = 'files_agency_reviewed_by_fkey'
  ) THEN
    ALTER TABLE public.files
      ADD CONSTRAINT files_agency_reviewed_by_fkey
      FOREIGN KEY (agency_reviewed_by)
      REFERENCES public.profiles(id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.files'::regclass
      AND conname = 'files_client_decided_by_fkey'
  ) THEN
    ALTER TABLE public.files
      ADD CONSTRAINT files_client_decided_by_fkey
      FOREIGN KEY (client_decided_by)
      REFERENCES public.profiles(id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.files'::regclass
      AND conname = 'files_revision_excludes_carousel_child_check'
  ) THEN
    ALTER TABLE public.files
      ADD CONSTRAINT files_revision_excludes_carousel_child_check
      CHECK (
        parent_file_id IS NULL
        OR revision_of_file_id IS NULL
      )
      NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.files
  VALIDATE CONSTRAINT files_agency_approval_status_check;
ALTER TABLE public.files
  VALIDATE CONSTRAINT files_approval_status_check;
ALTER TABLE public.files
  VALIDATE CONSTRAINT files_visibility_check;
ALTER TABLE public.files
  VALIDATE CONSTRAINT files_revision_of_file_id_fkey;
ALTER TABLE public.files
  VALIDATE CONSTRAINT files_agency_reviewed_by_fkey;
ALTER TABLE public.files
  VALIDATE CONSTRAINT files_client_decided_by_fkey;
ALTER TABLE public.files
  VALIDATE CONSTRAINT files_revision_excludes_carousel_child_check;

CREATE UNIQUE INDEX IF NOT EXISTS files_one_revision_per_version_idx
  ON public.files (revision_of_file_id)
  WHERE revision_of_file_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS files_unique_storage_object_idx
  ON public.files (storage_bucket, storage_path)
  WHERE storage_bucket IS NOT NULL
    AND storage_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS files_client_release_idx
  ON public.files (client_id, visibility, approval_status, status)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.file_approval_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid NOT NULL REFERENCES public.files(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  feedback text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT file_approval_events_type_check CHECK (
    event_type IN (
      'agency_review_requested',
      'agency_approved',
      'agency_rejected',
      'released_client_shared',
      'released_for_approval',
      'client_approved',
      'client_rejected',
      'contract_signed'
    )
  )
);

CREATE INDEX IF NOT EXISTS file_approval_events_file_created_idx
  ON public.file_approval_events (file_id, created_at DESC);

ALTER TABLE public.file_approval_events ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 2. Shared authorization helpers
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.try_uuid(_value text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN _value::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.files_reference_matches(
  _url text,
  _path text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    _url IS NOT NULL
    AND _path IS NOT NULL
    AND (
      _url = 'files://' || _path
      OR right(
        _url,
        length('/storage/v1/object/public/files/' || _path)
      ) = '/storage/v1/object/public/files/' || _path
  )
$$;

CREATE OR REPLACE FUNCTION public.files_reference_path(_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _marker text;
  _position integer;
BEGIN
  IF _url IS NULL THEN
    RETURN NULL;
  END IF;
  IF left(_url, length('files://')) = 'files://' THEN
    RETURN substring(_url FROM length('files://') + 1);
  END IF;

  FOREACH _marker IN ARRAY ARRAY[
    '/storage/v1/object/public/files/',
    '/storage/v1/object/sign/files/',
    '/storage/v1/object/authenticated/files/'
  ]
  LOOP
    _position := strpos(_url, _marker);
    IF _position > 0 THEN
      RETURN split_part(
        substring(_url FROM _position + length(_marker)),
        '?',
        1
      );
    END IF;
  END LOOP;

  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.file_root_id(_file_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(f.parent_file_id, f.id)
  FROM public.files AS f
  WHERE f.id = _file_id
$$;

CREATE OR REPLACE FUNCTION public.file_is_locked(_file_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(root.locked_at, f.locked_at) IS NOT NULL
  FROM public.files AS f
  LEFT JOIN public.files AS root
    ON root.id = COALESCE(f.parent_file_id, f.id)
  WHERE f.id = _file_id
$$;

CREATE OR REPLACE FUNCTION public.file_is_editable(_file_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    root.locked_at IS NULL
    AND root.visibility = 'internal'
    AND root.agency_approval_status = 'not_requested'
    AND root.approval_status = 'none'
  FROM public.files AS f
  JOIN public.files AS root
    ON root.id = COALESCE(f.parent_file_id, f.id)
  WHERE f.id = _file_id
$$;

CREATE OR REPLACE FUNCTION public.can_client_read_file(_file_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND public.has_role(auth.uid(), 'client'::public.app_role)
    AND f.client_id = root.client_id
    AND f.archived_at IS NULL
    AND COALESCE(f.status, 'ready') = 'ready'
    AND root.client_id = auth.uid()
    AND root.archived_at IS NULL
    AND COALESCE(root.status, 'ready') = 'ready'
    AND root.agency_approval_status = 'approved'
    AND (
      f.id = root.id
      OR (
        f.parent_file_id = root.id
        AND f.visibility = root.visibility
        AND f.agency_approval_status = root.agency_approval_status
        AND f.approval_status = 'none'
        AND NOT COALESCE(f.requires_approval, false)
      )
    )
    AND (
      root.visibility = 'client_shared'
      OR (
        root.visibility = 'approval'
        AND root.approval_status IN ('pending', 'approved', 'rejected')
      )
    )
  FROM public.files AS f
  JOIN public.files AS root
    ON root.id = COALESCE(f.parent_file_id, f.id)
  WHERE f.id = _file_id
$$;

CREATE OR REPLACE FUNCTION public.can_read_file(_file_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.files AS f
    WHERE f.id = _file_id
      AND (
        (
          (
            public.has_role(auth.uid(), 'admin'::public.app_role)
            OR public.has_role(auth.uid(), 'manager'::public.app_role)
            OR public.has_role(auth.uid(), 'design'::public.app_role)
            OR public.has_role(auth.uid(), 'traffic'::public.app_role)
          )
          AND public.can_access_client(f.client_id)
        )
        OR public.can_client_read_file(f.id)
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_write_file(_file_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.files AS f
    WHERE f.id = _file_id
      AND (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.has_role(auth.uid(), 'manager'::public.app_role)
        OR public.has_role(auth.uid(), 'design'::public.app_role)
        OR public.has_role(auth.uid(), 'traffic'::public.app_role)
      )
      AND public.can_access_client(f.client_id)
      AND public.file_is_editable(f.id)
  )
$$;

CREATE OR REPLACE FUNCTION public.can_staff_access_project(_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects AS p
    WHERE p.id = _project_id
      AND (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.has_role(auth.uid(), 'manager'::public.app_role)
        OR public.has_role(auth.uid(), 'design'::public.app_role)
        OR public.has_role(auth.uid(), 'traffic'::public.app_role)
      )
      AND public.can_access_client(p.client_id)
  )
$$;

CREATE OR REPLACE FUNCTION public.file_storage_matches_client(
  _bucket text,
  _path text,
  _client_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _folders text[] := storage.foldername(_path);
BEGIN
  IF _bucket IS NULL AND _path IS NULL THEN
    RETURN true;
  END IF;
  IF _bucket IS NULL OR _path IS NULL OR _client_id IS NULL THEN
    RETURN false;
  END IF;

  IF _bucket IN ('files', 'mcp-files') THEN
    IF public.try_uuid(_folders[1]) = _client_id THEN
      RETURN true;
    END IF;
    IF _folders[1] IN ('contracts', 'reports')
      AND public.try_uuid(_folders[2]) = _client_id THEN
      RETURN true;
    END IF;
    IF _bucket = 'files' AND _folders[1] = 'task-attachments' THEN
      RETURN EXISTS (
        SELECT 1
        FROM public.tasks AS task
        JOIN public.projects AS project ON project.id = task.project_id
        WHERE task.id = public.try_uuid(_folders[2])
          AND project.client_id = _client_id
      );
    END IF;
    RETURN false;
  END IF;

  IF _bucket = 'workspace' THEN
    RETURN _folders[1] = 'client'
      AND public.try_uuid(_folders[2]) = _client_id;
  END IF;

  RETURN false;
END
$$;

CREATE OR REPLACE FUNCTION public.file_storage_reference_is_canonical(
  _url text,
  _bucket text,
  _path text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN _url LIKE 'files://%' THEN
      _bucket = 'files'
      AND _path = substring(_url FROM length('files://') + 1)
    WHEN _url LIKE 'mcp-files://%' THEN
      _bucket = 'mcp-files'
      AND _path = substring(_url FROM length('mcp-files://') + 1)
    WHEN _url LIKE 'workspace://%' THEN
      _bucket = 'workspace'
      AND _path = substring(_url FROM length('workspace://') + 1)
    ELSE true
  END
$$;

REVOKE ALL ON FUNCTION public.try_uuid(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.files_reference_matches(text, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.files_reference_path(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.file_root_id(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.file_is_locked(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.file_is_editable(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_client_read_file(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_file(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_write_file(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_staff_access_project(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.file_storage_matches_client(text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.file_storage_reference_is_canonical(
  text, text, text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.try_uuid(text) FROM authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.files_reference_matches(text, text)
  FROM authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.file_root_id(uuid)
  FROM authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.file_is_locked(uuid)
  FROM authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.file_is_editable(uuid)
  FROM authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_client_read_file(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_file(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write_file(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_staff_access_project(uuid)
  TO authenticated, service_role;

-- --------------------------------------------------------------------------
-- 3. Guard direct writes and preserve terminal versions
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.files_secure_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _trusted_approval_write boolean :=
    COALESCE(auth.role(), current_user)
      NOT IN ('anon', 'authenticated', 'service_role', 'authenticator');
  _previous public.files%ROWTYPE;
  _contract public.contracts%ROWTYPE;
  _root_locked boolean;
  _root_visibility text;
  _root_agency_status text;
  _root_approval_status text;
  _root_editable boolean;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF NEW.project_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.projects AS project
        WHERE project.id = NEW.project_id
          AND project.client_id = NEW.client_id
      ) THEN
      RAISE EXCEPTION 'file project must belong to the same client';
    END IF;
    IF NOT public.file_storage_matches_client(
      NEW.storage_bucket,
      NEW.storage_path,
      NEW.client_id
    ) THEN
      RAISE EXCEPTION 'file storage path must belong to the same client';
    END IF;
    IF NOT public.file_storage_reference_is_canonical(
      NEW.file_url,
      NEW.storage_bucket,
      NEW.storage_path
    ) THEN
      RAISE EXCEPTION 'private file URL must match its storage metadata';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.parent_file_id IS NOT NULL THEN
      SELECT
        file_row.client_id,
        file_row.parent_file_id,
        file_row.locked_at,
        file_row.visibility,
        file_row.agency_approval_status,
        file_row.approval_status,
        file_row.version
      INTO
        _previous.client_id,
        _previous.parent_file_id,
        _previous.locked_at,
        _previous.visibility,
        _previous.agency_approval_status,
        _previous.approval_status,
        _previous.version
      FROM public.files
      AS file_row
      WHERE file_row.id = NEW.parent_file_id
      FOR UPDATE;

      IF NOT FOUND OR _previous.client_id IS DISTINCT FROM NEW.client_id THEN
        RAISE EXCEPTION 'carousel parent must belong to the same client';
      END IF;
      IF _previous.parent_file_id IS NOT NULL THEN
        RAISE EXCEPTION 'nested carousel children are not allowed';
      END IF;
      IF _previous.locked_at IS NOT NULL
        OR _previous.visibility <> 'internal'
        OR _previous.agency_approval_status <> 'not_requested'
        OR _previous.approval_status <> 'none' THEN
        RAISE EXCEPTION 'carousel children can only be added before review';
      END IF;
      IF NEW.revision_of_file_id IS NOT NULL THEN
        RAISE EXCEPTION 'a revision cannot also be a carousel child';
      END IF;
    END IF;

    IF NEW.revision_of_file_id IS NOT NULL THEN
      SELECT
        file_row.client_id,
        file_row.parent_file_id,
        file_row.locked_at,
        file_row.visibility,
        file_row.agency_approval_status,
        file_row.approval_status,
        file_row.version
      INTO
        _previous.client_id,
        _previous.parent_file_id,
        _previous.locked_at,
        _previous.visibility,
        _previous.agency_approval_status,
        _previous.approval_status,
        _previous.version
      FROM public.files
      AS file_row
      WHERE file_row.id = NEW.revision_of_file_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'revision source not found';
      END IF;
      IF _previous.parent_file_id IS NOT NULL THEN
        RAISE EXCEPTION 'revision source must be a root file';
      END IF;
      IF _previous.client_id IS DISTINCT FROM NEW.client_id THEN
        RAISE EXCEPTION 'revision source belongs to another client';
      END IF;
      IF (
        _previous.approval_status <> 'rejected'
        AND _previous.agency_approval_status <> 'rejected'
      )
        OR _previous.locked_at IS NULL THEN
        RAISE EXCEPTION 'only a terminal rejected version can be revised';
      END IF;

      NEW.version := COALESCE(_previous.version, 1) + 1;
    ELSE
      NEW.version := COALESCE(NEW.version, 1);
    END IF;

    IF NEW.source = 'contract-public' THEN
      IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'contract-public inserts require the trusted signing backend';
      END IF;

      SELECT contract.* INTO _contract
      FROM public.contracts AS contract
      WHERE contract.client_id = NEW.client_id
        AND contract.status = 'completed'
        AND contract.client_signed_at IS NOT NULL
        AND contract.file_id IS NULL
        AND contract.original_file_name = NEW.file_name
        AND (
          (
            NEW.storage_path IS NOT NULL
            AND public.files_reference_matches(
              contract.original_file_url,
              NEW.storage_path
            )
          )
          OR (
            NEW.storage_path IS NULL
            AND contract.original_file_url = NEW.file_url
          )
        )
      ORDER BY contract.client_signed_at DESC
      LIMIT 1
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'signed contract not found or already registered';
      END IF;

      NEW.project_id := _contract.project_id;
      NEW.uploaded_by := COALESCE(_contract.created_by, _contract.client_id);
      NEW.file_name := _contract.original_file_name;
      NEW.file_url := CASE
        WHEN NEW.storage_path IS NOT NULL THEN 'files://' || NEW.storage_path
        ELSE _contract.original_file_url
      END;
      NEW.file_type := 'application/pdf';
      NEW.folder := 'contratos';
      NEW.description := format(
        'Contrato assinado por %s em %s',
        COALESCE(_contract.client_signature_name, 'cliente'),
        _contract.client_signed_at
      );
      NEW.parent_file_id := NULL;
      NEW.revision_of_file_id := NULL;
      NEW.version := COALESCE(NEW.version, 1);
      NEW.agency_approval_status := 'approved';
      NEW.agency_feedback := NULL;
      NEW.agency_reviewed_by :=
        COALESCE(_contract.created_by, _contract.client_id);
      NEW.agency_reviewed_at := _contract.client_signed_at;
      NEW.approval_status := 'approved';
      NEW.feedback := NULL;
      NEW.client_decided_by := _contract.client_id;
      NEW.client_decided_at := _contract.client_signed_at;
      NEW.approval_requested_at := _contract.client_signed_at;
      NEW.locked_at := _contract.client_signed_at;
      NEW.visibility := 'client_shared';
      NEW.requires_approval := false;
      NEW.source := 'contract-public';
      NEW.status := 'ready';
      NEW.storage_bucket := CASE
        WHEN NEW.storage_path IS NOT NULL THEN 'files'
        ELSE NULL
      END;
      RETURN NEW;
    END IF;

    NEW.agency_approval_status := 'not_requested';
    NEW.agency_feedback := NULL;
    NEW.agency_reviewed_by := NULL;
    NEW.agency_reviewed_at := NULL;
    NEW.approval_status := 'none';
    NEW.feedback := NULL;
    NEW.client_decided_by := NULL;
    NEW.client_decided_at := NULL;
    NEW.approval_requested_at := NULL;
    NEW.locked_at := NULL;
    NEW.visibility := 'internal';
    NEW.requires_approval := false;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT
      COALESCE(root.locked_at, file_row.locked_at) IS NOT NULL,
      root.visibility,
      root.agency_approval_status,
      root.approval_status
    INTO
      _root_locked,
      _root_visibility,
      _root_agency_status,
      _root_approval_status
    FROM public.files AS file_row
    JOIN public.files AS root
      ON root.id = COALESCE(file_row.parent_file_id, file_row.id)
    WHERE file_row.id = OLD.id;

    IF COALESCE(_root_locked, false) THEN
      RAISE EXCEPTION 'terminal file versions are immutable';
    END IF;
    _root_editable :=
      _root_visibility = 'internal'
      AND _root_agency_status = 'not_requested'
      AND _root_approval_status = 'none';
    IF NOT _trusted_approval_write
      AND NOT COALESCE(_root_editable, false) THEN
      RAISE EXCEPTION 'file versions under review or released are immutable';
    END IF;
    RETURN OLD;
  END IF;

  SELECT
    COALESCE(root.locked_at, file_row.locked_at) IS NOT NULL,
    root.visibility,
    root.agency_approval_status,
    root.approval_status
  INTO
    _root_locked,
    _root_visibility,
    _root_agency_status,
    _root_approval_status
  FROM public.files AS file_row
  JOIN public.files AS root
    ON root.id = COALESCE(file_row.parent_file_id, file_row.id)
  WHERE file_row.id = OLD.id;

  IF COALESCE(_root_locked, false) THEN
    RAISE EXCEPTION 'terminal file versions are immutable';
  END IF;
  _root_editable :=
    _root_visibility = 'internal'
    AND _root_agency_status = 'not_requested'
    AND _root_approval_status = 'none';
  IF NOT _trusted_approval_write
    AND NOT COALESCE(_root_editable, false) THEN
    RAISE EXCEPTION 'file versions under review or released are immutable';
  END IF;

  IF NOT _trusted_approval_write AND (
    NEW.agency_approval_status IS DISTINCT FROM OLD.agency_approval_status
    OR NEW.agency_feedback IS DISTINCT FROM OLD.agency_feedback
    OR NEW.agency_reviewed_by IS DISTINCT FROM OLD.agency_reviewed_by
    OR NEW.agency_reviewed_at IS DISTINCT FROM OLD.agency_reviewed_at
    OR NEW.approval_status IS DISTINCT FROM OLD.approval_status
    OR NEW.feedback IS DISTINCT FROM OLD.feedback
    OR NEW.client_decided_by IS DISTINCT FROM OLD.client_decided_by
    OR NEW.client_decided_at IS DISTINCT FROM OLD.client_decided_at
    OR NEW.approval_requested_at IS DISTINCT FROM OLD.approval_requested_at
    OR NEW.visibility IS DISTINCT FROM OLD.visibility
    OR NEW.requires_approval IS DISTINCT FROM OLD.requires_approval
    OR NEW.locked_at IS DISTINCT FROM OLD.locked_at
    OR NEW.revision_of_file_id IS DISTINCT FROM OLD.revision_of_file_id
    OR NEW.version IS DISTINCT FROM OLD.version
  ) THEN
    RAISE EXCEPTION 'approval state can only change through guarded functions';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.files_secure_guard() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS files_secure_guard_trg ON public.files;
CREATE TRIGGER files_secure_guard_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.files
FOR EACH ROW EXECUTE FUNCTION public.files_secure_guard();

CREATE OR REPLACE FUNCTION public.files_contract_signed_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _contract_id uuid;
BEGIN
  IF NEW.source IS DISTINCT FROM 'contract-public' THEN
    RETURN NEW;
  END IF;

  WITH target_contract AS (
    SELECT contract.id
    FROM public.contracts AS contract
    WHERE contract.client_id = NEW.client_id
      AND contract.status = 'completed'
      AND contract.client_signed_at = NEW.client_decided_at
      AND contract.file_id IS NULL
      AND contract.original_file_name = NEW.file_name
      AND (
        (
          NEW.storage_path IS NOT NULL
          AND public.files_reference_matches(
            contract.original_file_url,
            NEW.storage_path
          )
        )
        OR (
          NEW.storage_path IS NULL
          AND contract.original_file_url = NEW.file_url
        )
      )
    ORDER BY contract.client_signed_at DESC, contract.id
    LIMIT 1
    FOR UPDATE
  )
  UPDATE public.contracts AS contract
  SET file_id = NEW.id
  WHERE contract.id = (SELECT id FROM target_contract)
  RETURNING contract.id INTO _contract_id;

  IF _contract_id IS NULL THEN
    RAISE EXCEPTION 'signed contract registration failed';
  END IF;

  INSERT INTO public.file_approval_events (
    file_id,
    client_id,
    actor_id,
    event_type,
    from_status,
    to_status,
    metadata
  ) VALUES (
    NEW.id,
    NEW.client_id,
    NEW.client_decided_by,
    'contract_signed',
    'pending',
    'approved',
    jsonb_build_object(
      'contract_id', _contract_id,
      'version', COALESCE(NEW.version, 1)
    )
  );

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.files_contract_signed_event()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS files_contract_signed_event_trg ON public.files;
CREATE TRIGGER files_contract_signed_event_trg
AFTER INSERT ON public.files
FOR EACH ROW
WHEN (NEW.source = 'contract-public')
EXECUTE FUNCTION public.files_contract_signed_event();

CREATE OR REPLACE FUNCTION public.file_approval_events_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'file approval events are append-only';
END
$$;

REVOKE ALL ON FUNCTION public.file_approval_events_immutable()
  FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS file_approval_events_immutable_trg
  ON public.file_approval_events;
CREATE TRIGGER file_approval_events_immutable_trg
BEFORE UPDATE OR DELETE ON public.file_approval_events
FOR EACH ROW EXECUTE FUNCTION public.file_approval_events_immutable();

-- --------------------------------------------------------------------------
-- 4. Protect contracts and complete public signatures atomically
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contracts_secure_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  _actor uuid := auth.uid();
  _service_write boolean := auth.role() = 'service_role';
  _trusted_write boolean :=
    current_user NOT IN ('anon', 'authenticated', 'service_role', 'authenticator');
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft'
      OR OLD.admin_signed_at IS NOT NULL
      OR OLD.sent_at IS NOT NULL
      OR OLD.client_signed_at IS NOT NULL
      OR OLD.file_id IS NOT NULL THEN
      RAISE EXCEPTION 'sent and signed contracts are immutable';
    END IF;
    IF _service_write THEN
      RETURN OLD;
    END IF;
    IF _actor IS NULL
      OR NOT public.can_manage_client(OLD.client_id) THEN
      RAISE EXCEPTION 'contract deletion access denied';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.project_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.projects AS project
      WHERE project.id = NEW.project_id
        AND project.client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'contract project must belong to the same client';
  END IF;
  IF public.files_reference_path(NEW.original_file_url) IS NOT NULL
    AND NOT public.file_storage_matches_client(
      'files',
      public.files_reference_path(NEW.original_file_url),
      NEW.client_id
    ) THEN
    RAISE EXCEPTION 'contract file must belong to the same client';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft'
      OR NEW.admin_signature_name IS NOT NULL
      OR NEW.admin_signed_at IS NOT NULL
      OR NEW.admin_signature_ip IS NOT NULL
      OR NEW.client_signature_name IS NOT NULL
      OR NEW.client_signed_at IS NOT NULL
      OR NEW.client_signature_ip IS NOT NULL
      OR NEW.sent_at IS NOT NULL
      OR NEW.file_id IS NOT NULL THEN
      RAISE EXCEPTION 'new contracts must start as an unsigned draft';
    END IF;
    IF NOT _service_write AND (
      _actor IS NULL
      OR NOT public.can_manage_client(NEW.client_id)
      OR NEW.created_by IS DISTINCT FROM _actor
    ) THEN
      RAISE EXCEPTION 'contract creation access denied';
    END IF;
    RETURN NEW;
  END IF;

  IF _trusted_write THEN
    RETURN NEW;
  END IF;

  IF _service_write THEN
    IF OLD.status = 'sent' THEN
      IF NEW.status <> 'sent'
        OR (
          to_jsonb(NEW) - 'sent_at' - 'updated_at'
        ) IS DISTINCT FROM (
          to_jsonb(OLD) - 'sent_at' - 'updated_at'
        ) THEN
        RAISE EXCEPTION 'sent and signed contracts are immutable';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'sent and signed contracts are immutable';
    END IF;
    IF NEW.client_id IS DISTINCT FROM OLD.client_id
      OR NEW.client_signature_name IS DISTINCT FROM OLD.client_signature_name
      OR NEW.client_signed_at IS DISTINCT FROM OLD.client_signed_at
      OR NEW.client_signature_ip IS DISTINCT FROM OLD.client_signature_ip
      OR NEW.sign_token IS DISTINCT FROM OLD.sign_token
      OR NEW.file_id IS DISTINCT FROM OLD.file_id
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'protected contract fields are immutable';
    END IF;
    IF NEW.status NOT IN ('draft', 'sent', 'cancelled') THEN
      RAISE EXCEPTION 'invalid service contract transition';
    END IF;
    IF NEW.status = 'sent'
      AND (
        NULLIF(btrim(NEW.admin_signature_name), '') IS NULL
        OR NEW.admin_signed_at IS NULL
      ) THEN
      RAISE EXCEPTION 'agency signature is required before sending';
    END IF;
    RETURN NEW;
  END IF;

  IF _actor IS NULL
    OR NOT public.can_manage_client(OLD.client_id)
    OR NOT public.can_manage_client(NEW.client_id) THEN
    RAISE EXCEPTION 'contract update access denied';
  END IF;
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'sent and signed contracts are immutable';
  END IF;
  IF NEW.client_id IS DISTINCT FROM OLD.client_id
    OR NEW.original_file_url IS DISTINCT FROM OLD.original_file_url
    OR NEW.original_file_name IS DISTINCT FROM OLD.original_file_name
    OR NEW.client_signature_name IS DISTINCT FROM OLD.client_signature_name
    OR NEW.client_signed_at IS DISTINCT FROM OLD.client_signed_at
    OR NEW.client_signature_ip IS DISTINCT FROM OLD.client_signature_ip
    OR NEW.sign_token IS DISTINCT FROM OLD.sign_token
    OR NEW.file_id IS DISTINCT FROM OLD.file_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'protected contract fields are immutable';
  END IF;
  IF NEW.status NOT IN ('draft', 'sent') THEN
    RAISE EXCEPTION 'invalid authenticated contract transition';
  END IF;
  IF NEW.status = 'sent'
    AND (
      NULLIF(btrim(NEW.admin_signature_name), '') IS NULL
      OR NEW.admin_signed_at IS NULL
    ) THEN
    RAISE EXCEPTION 'agency signature is required before sending';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.contracts_secure_guard()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS contracts_secure_guard_trg ON public.contracts;
CREATE TRIGGER contracts_secure_guard_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.contracts
FOR EACH ROW EXECUTE FUNCTION public.contracts_secure_guard();

CREATE OR REPLACE FUNCTION public.complete_contract_signature(
  p_token text,
  p_signature_name text,
  p_signature_ip text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _contract public.contracts%ROWTYPE;
  _file_id uuid;
  _signed_at timestamptz;
  _signer_name text := NULLIF(btrim(p_signature_name), '');
  _storage_path text;
  _recovering boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'contract completion requires the trusted signing backend';
  END IF;
  IF NULLIF(btrim(p_token), '') IS NULL
    OR _signer_name IS NULL
    OR length(_signer_name) > 200 THEN
    RAISE EXCEPTION 'invalid contract signature input';
  END IF;

  SELECT * INTO _contract
  FROM public.contracts
  WHERE sign_token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract not found';
  END IF;
  IF _contract.file_id IS NOT NULL
    AND _contract.client_signed_at IS NOT NULL
    AND _contract.status = 'completed' THEN
    RETURN _contract.file_id;
  END IF;

  _recovering :=
    _contract.client_signed_at IS NOT NULL
    AND _contract.file_id IS NULL
    AND _contract.status = 'completed';

  IF NOT _recovering
    AND (
      _contract.status NOT IN ('sent', 'signed')
      OR _contract.admin_signed_at IS NULL
    ) THEN
    RAISE EXCEPTION 'contract is not available for signing';
  END IF;

  _signed_at := COALESCE(_contract.client_signed_at, now());
  _signer_name := COALESCE(
    NULLIF(btrim(_contract.client_signature_name), ''),
    _signer_name
  );

  IF left(_contract.original_file_url, length('files://')) = 'files://' THEN
    _storage_path := substring(
      _contract.original_file_url
      FROM length('files://') + 1
    );
  ELSIF _contract.original_file_url LIKE
    '%/storage/v1/object/public/files/%' THEN
    _storage_path := split_part(
      split_part(
        _contract.original_file_url,
        '/storage/v1/object/public/files/',
        2
      ),
      '?',
      1
    );
  ELSE
    _storage_path := NULL;
  END IF;

  IF NOT _recovering THEN
    UPDATE public.contracts
    SET
      client_signature_name = _signer_name,
      client_signed_at = _signed_at,
      client_signature_ip = COALESCE(
        NULLIF(btrim(p_signature_ip), ''),
        'unknown'
      ),
      status = 'completed'
    WHERE id = _contract.id;
  END IF;

  INSERT INTO public.files (
    client_id,
    project_id,
    uploaded_by,
    file_name,
    file_url,
    file_type,
    folder,
    source,
    status,
    storage_bucket,
    storage_path
  ) VALUES (
    _contract.client_id,
    _contract.project_id,
    COALESCE(_contract.created_by, _contract.client_id),
    _contract.original_file_name,
    CASE
      WHEN _storage_path IS NOT NULL THEN 'files://' || _storage_path
      ELSE _contract.original_file_url
    END,
    'application/pdf',
    'contratos',
    'contract-public',
    'ready',
    CASE WHEN _storage_path IS NOT NULL THEN 'files' ELSE NULL END,
    _storage_path
  )
  RETURNING id INTO _file_id;

  RETURN _file_id;
END
$$;

REVOKE ALL ON FUNCTION public.complete_contract_signature(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_contract_signature(text, text, text)
  TO service_role;

DO $$
DECLARE
  _policy record;
BEGIN
  FOR _policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'contracts'
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON public.contracts',
      _policy.policyname
    );
  END LOOP;
END
$$;

CREATE POLICY contracts_secure_select
ON public.contracts
FOR SELECT TO authenticated
USING (
  client_id = auth.uid()
  OR (
    public.is_staff(auth.uid())
    AND public.can_access_client(client_id)
  )
);

CREATE POLICY contracts_manager_insert
ON public.contracts
FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND public.can_manage_client(client_id)
);

CREATE POLICY contracts_manager_update
ON public.contracts
FOR UPDATE TO authenticated
USING (public.can_manage_client(client_id))
WITH CHECK (public.can_manage_client(client_id));

CREATE POLICY contracts_admin_delete
ON public.contracts
FOR DELETE TO authenticated
USING (
  status = 'draft'
  AND admin_signed_at IS NULL
  AND sent_at IS NULL
  AND client_signed_at IS NULL
  AND file_id IS NULL
  AND
  public.has_role(auth.uid(), 'admin'::public.app_role)
  AND public.can_access_client(client_id)
);

REVOKE ALL ON public.contracts FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.contracts TO authenticated;
GRANT INSERT (
  client_id,
  project_id,
  title,
  description,
  original_file_url,
  original_file_name,
  status,
  created_by
) ON public.contracts TO authenticated;
GRANT UPDATE (
  title,
  description,
  project_id,
  admin_signature_name,
  admin_signed_at,
  admin_signature_ip,
  status,
  updated_at
) ON public.contracts TO authenticated;

-- --------------------------------------------------------------------------
-- 4b. Reports and client requests never expose internal drafts
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reports_secure_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  _path text;
  _actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'published' THEN
      RAISE EXCEPTION 'published reports are immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.status NOT IN ('draft', 'published') THEN
    RAISE EXCEPTION 'invalid report status';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.projects AS project
    WHERE project.id = NEW.project_id
      AND project.client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'report project must belong to the same client';
  END IF;

  _path := public.files_reference_path(NEW.file_url);
  IF _path IS NOT NULL
    AND NOT public.file_storage_matches_client(
      'files',
      _path,
      NEW.client_id
    ) THEN
    RAISE EXCEPTION 'report file must belong to the same client';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF auth.role() = 'authenticated'
      AND NEW.created_by IS DISTINCT FROM _actor THEN
      RAISE EXCEPTION 'report creator must be the authenticated actor';
    END IF;
    IF NEW.status = 'published'
      AND (
        _actor IS NULL
        OR NOT public.can_manage_client(NEW.client_id)
      ) THEN
      RAISE EXCEPTION 'only an assigned manager can publish reports';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'published reports are immutable';
  END IF;
  IF NEW.client_id IS DISTINCT FROM OLD.client_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'protected report fields are immutable';
  END IF;
  IF NEW.status = 'published'
    AND (
      _actor IS NULL
      OR NOT public.can_manage_client(NEW.client_id)
    ) THEN
    RAISE EXCEPTION 'only an assigned manager can publish reports';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.reports_secure_guard()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS reports_secure_guard_trg ON public.reports;
CREATE TRIGGER reports_secure_guard_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.reports
FOR EACH ROW EXECUTE FUNCTION public.reports_secure_guard();

DO $$
DECLARE
  _policy record;
BEGIN
  FOR _policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'reports'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.reports', _policy.policyname);
  END LOOP;
END
$$;

CREATE POLICY reports_secure_select
ON public.reports
FOR SELECT TO authenticated
USING (
  (
    client_id = auth.uid()
    AND status = 'published'
  )
  OR (
    public.is_staff(auth.uid())
    AND public.can_access_client(client_id)
  )
);

CREATE POLICY reports_secure_insert
ON public.reports
FOR INSERT TO authenticated
WITH CHECK (
  public.is_staff(auth.uid())
  AND public.can_access_client(client_id)
  AND created_by = auth.uid()
  AND (
    status = 'draft'
    OR public.can_manage_client(client_id)
  )
);

CREATE POLICY reports_manager_update
ON public.reports
FOR UPDATE TO authenticated
USING (public.can_manage_client(client_id))
WITH CHECK (public.can_manage_client(client_id));

CREATE POLICY reports_admin_delete
ON public.reports
FOR DELETE TO authenticated
USING (
  status = 'draft'
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
  AND public.can_access_client(client_id)
);

REVOKE SELECT ON public.reports FROM authenticated;
GRANT SELECT (
  id,
  project_id,
  client_id,
  title,
  period_start,
  period_end,
  metrics,
  summary,
  file_url,
  status,
  created_by,
  created_at,
  highlights,
  next_steps,
  chart_type,
  chart_data,
  images
) ON public.reports TO authenticated;

CREATE OR REPLACE FUNCTION public.client_requests_secure_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.project_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.projects AS project
      WHERE project.id = NEW.project_id
        AND project.client_id = NEW.client_id
    ) THEN
    RAISE EXCEPTION 'request project must belong to the same client';
  END IF;
  IF auth.role() = 'authenticated' THEN
    IF TG_OP = 'INSERT' AND NEW.ai_draft IS NOT NULL THEN
      RAISE EXCEPTION 'internal request draft is backend-only';
    END IF;
    IF TG_OP = 'UPDATE'
      AND NEW.ai_draft IS DISTINCT FROM OLD.ai_draft THEN
      RAISE EXCEPTION 'internal request draft is backend-only';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.client_requests_secure_guard()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS client_requests_secure_guard_trg
  ON public.client_requests;
CREATE TRIGGER client_requests_secure_guard_trg
BEFORE INSERT OR UPDATE ON public.client_requests
FOR EACH ROW EXECUTE FUNCTION public.client_requests_secure_guard();

DO $$
DECLARE
  _policy record;
BEGIN
  FOR _policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'client_requests'
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON public.client_requests',
      _policy.policyname
    );
  END LOOP;
END
$$;

CREATE POLICY client_requests_secure_select
ON public.client_requests
FOR SELECT TO authenticated
USING (
  client_id = auth.uid()
  OR (
    public.is_staff(auth.uid())
    AND public.can_access_client(client_id)
  )
);

CREATE POLICY client_requests_secure_insert
ON public.client_requests
FOR INSERT TO authenticated
WITH CHECK (
  (
    client_id = auth.uid()
    AND status = 'new'
  )
  OR (
    public.is_staff(auth.uid())
    AND public.can_access_client(client_id)
  )
);

CREATE POLICY client_requests_manager_update
ON public.client_requests
FOR UPDATE TO authenticated
USING (public.can_manage_client(client_id))
WITH CHECK (public.can_manage_client(client_id));

CREATE POLICY client_requests_admin_delete
ON public.client_requests
FOR DELETE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  AND public.can_access_client(client_id)
);

REVOKE SELECT ON public.client_requests FROM authenticated;
GRANT SELECT (
  id,
  client_id,
  project_id,
  title,
  description,
  priority,
  status,
  created_at,
  updated_at
) ON public.client_requests TO authenticated;

-- --------------------------------------------------------------------------
-- 5. Double Gate RPCs
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_file_agency_review(p_file_id uuid)
RETURNS public.files
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _file public.files%ROWTYPE;
  _actor uuid := auth.uid();
BEGIN
  IF _actor IS NULL
    OR NOT (
      public.has_role(_actor, 'admin'::public.app_role)
      OR public.has_role(_actor, 'manager'::public.app_role)
      OR public.has_role(_actor, 'design'::public.app_role)
      OR public.has_role(_actor, 'traffic'::public.app_role)
    ) THEN
    RAISE EXCEPTION 'only assigned team members can request agency review';
  END IF;

  SELECT * INTO _file
  FROM public.files
  WHERE id = p_file_id
    AND parent_file_id IS NULL
  FOR UPDATE;

  IF NOT FOUND OR NOT public.can_access_client(_file.client_id) THEN
    RAISE EXCEPTION 'file not found or access denied';
  END IF;
  IF _file.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'terminal file versions are immutable';
  END IF;
  IF _file.visibility <> 'internal'
    OR _file.agency_approval_status <> 'not_requested' THEN
    RAISE EXCEPTION 'file is not eligible for agency review';
  END IF;
  IF COALESCE(_file.status, 'ready') <> 'ready' THEN
    RAISE EXCEPTION 'file must be ready before review';
  END IF;

  UPDATE public.files
  SET
    agency_approval_status = 'pending',
    agency_feedback = NULL,
    agency_reviewed_by = NULL,
    agency_reviewed_at = NULL
  WHERE id = p_file_id
     OR parent_file_id = p_file_id;

  INSERT INTO public.file_approval_events (
    file_id, client_id, actor_id, event_type, from_status, to_status
  ) VALUES (
    _file.id,
    _file.client_id,
    _actor,
    'agency_review_requested',
    _file.agency_approval_status,
    'pending'
  );

  SELECT * INTO _file FROM public.files WHERE id = p_file_id;
  RETURN _file;
END
$$;

CREATE OR REPLACE FUNCTION public.review_file_agency(
  p_file_id uuid,
  p_decision text,
  p_feedback text DEFAULT NULL
)
RETURNS public.files
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _file public.files%ROWTYPE;
  _actor uuid := auth.uid();
  _feedback text := NULLIF(btrim(p_feedback), '');
BEGIN
  IF p_decision IS NULL
    OR p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid agency review decision';
  END IF;

  SELECT * INTO _file
  FROM public.files
  WHERE id = p_file_id
    AND parent_file_id IS NULL
  FOR UPDATE;

  IF NOT FOUND
    OR _actor IS NULL
    OR NOT public.can_manage_client(_file.client_id) THEN
    RAISE EXCEPTION 'file not found or review access denied';
  END IF;
  IF _file.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'terminal file versions are immutable';
  END IF;
  IF _file.agency_approval_status <> 'pending'
    OR _file.visibility <> 'internal' THEN
    RAISE EXCEPTION 'file is not pending agency review';
  END IF;
  IF p_decision = 'rejected'
    AND COALESCE(length(_feedback), 0) < 10 THEN
    RAISE EXCEPTION 'agency feedback must contain at least 10 characters';
  END IF;

  UPDATE public.files
  SET
    agency_approval_status = p_decision,
    agency_feedback = CASE
      WHEN p_decision = 'rejected' THEN _feedback
      ELSE NULL
    END,
    agency_reviewed_by = _actor,
    agency_reviewed_at = now(),
    locked_at = CASE
      WHEN p_decision = 'rejected' THEN now()
      ELSE NULL
    END
  WHERE parent_file_id = p_file_id;

  UPDATE public.files
  SET
    agency_approval_status = p_decision,
    agency_feedback = CASE
      WHEN p_decision = 'rejected' THEN _feedback
      ELSE NULL
    END,
    agency_reviewed_by = _actor,
    agency_reviewed_at = now(),
    locked_at = CASE
      WHEN p_decision = 'rejected' THEN now()
      ELSE NULL
    END
  WHERE id = p_file_id;

  INSERT INTO public.file_approval_events (
    file_id,
    client_id,
    actor_id,
    event_type,
    from_status,
    to_status,
    feedback
  ) VALUES (
    _file.id,
    _file.client_id,
    _actor,
    CASE
      WHEN p_decision = 'approved' THEN 'agency_approved'
      ELSE 'agency_rejected'
    END,
    _file.agency_approval_status,
    p_decision,
    _feedback
  );

  SELECT * INTO _file FROM public.files WHERE id = p_file_id;
  RETURN _file;
END
$$;

CREATE OR REPLACE FUNCTION public.release_file_to_client(
  p_file_id uuid,
  p_mode text
)
RETURNS public.files
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _file public.files%ROWTYPE;
  _actor uuid := auth.uid();
BEGIN
  IF p_mode IS NULL
    OR p_mode NOT IN ('client_shared', 'approval') THEN
    RAISE EXCEPTION 'invalid release mode';
  END IF;

  SELECT * INTO _file
  FROM public.files
  WHERE id = p_file_id
    AND parent_file_id IS NULL
  FOR UPDATE;

  IF NOT FOUND
    OR _actor IS NULL
    OR NOT public.can_manage_client(_file.client_id) THEN
    RAISE EXCEPTION 'file not found or release access denied';
  END IF;
  IF _file.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'terminal file versions are immutable';
  END IF;
  IF _file.agency_approval_status <> 'approved'
    OR _file.visibility <> 'internal'
    OR COALESCE(_file.status, 'ready') <> 'ready'
    OR _file.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'file must pass agency review before release';
  END IF;

  UPDATE public.files
  SET
    visibility = p_mode,
    requires_approval = (p_mode = 'approval'),
    approval_status = 'none',
    feedback = NULL,
    client_decided_by = NULL,
    client_decided_at = NULL,
    approval_requested_at = CASE
      WHEN p_mode = 'approval' THEN now()
      ELSE NULL
    END,
    locked_at = CASE
      WHEN p_mode = 'client_shared' THEN now()
      ELSE NULL
    END
  WHERE parent_file_id = p_file_id;

  UPDATE public.files
  SET
    visibility = p_mode,
    requires_approval = (p_mode = 'approval'),
    approval_status = CASE
      WHEN p_mode = 'approval' THEN 'pending'
      ELSE 'none'
    END,
    feedback = NULL,
    client_decided_by = NULL,
    client_decided_at = NULL,
    approval_requested_at = CASE
      WHEN p_mode = 'approval' THEN now()
      ELSE NULL
    END,
    locked_at = CASE
      WHEN p_mode = 'client_shared' THEN now()
      ELSE NULL
    END
  WHERE id = p_file_id;

  INSERT INTO public.file_approval_events (
    file_id,
    client_id,
    actor_id,
    event_type,
    from_status,
    to_status,
    metadata
  ) VALUES (
    _file.id,
    _file.client_id,
    _actor,
    CASE
      WHEN p_mode = 'approval' THEN 'released_for_approval'
      ELSE 'released_client_shared'
    END,
    'internal',
    p_mode,
    jsonb_build_object('version', COALESCE(_file.version, 1))
  );

  INSERT INTO public.notifications (
    user_id, message, notification_type, link
  ) VALUES (
    _file.client_id,
    CASE
      WHEN p_mode = 'approval'
        THEN 'Nova entrega aguardando sua aprovação: ' || _file.file_name
      ELSE 'Nova entrega disponível: ' || _file.file_name
    END,
    CASE WHEN p_mode = 'approval' THEN 'approval' ELSE 'delivery' END,
    CASE WHEN p_mode = 'approval' THEN '/aprovacoes' ELSE '/documentos' END
  );

  SELECT * INTO _file FROM public.files WHERE id = p_file_id;
  RETURN _file;
END
$$;

CREATE OR REPLACE FUNCTION public.decide_file_approval(
  p_file_id uuid,
  p_expected_version integer,
  p_decision text,
  p_feedback text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _file public.files%ROWTYPE;
  _actor uuid := auth.uid();
  _feedback text := NULLIF(btrim(p_feedback), '');
BEGIN
  IF p_decision IS NULL
    OR p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid client decision';
  END IF;

  SELECT * INTO _file
  FROM public.files
  WHERE id = p_file_id
    AND parent_file_id IS NULL
  FOR UPDATE;

  IF NOT FOUND
    OR _actor IS NULL
    OR NOT public.has_role(_actor, 'client'::public.app_role)
    OR _file.client_id <> _actor THEN
    RAISE EXCEPTION 'file not found or client decision access denied';
  END IF;
  IF p_expected_version IS NULL
    OR COALESCE(_file.version, 1) <> p_expected_version THEN
    RAISE EXCEPTION 'file version changed; refresh before deciding';
  END IF;
  IF _file.agency_approval_status <> 'approved'
    OR _file.visibility <> 'approval'
    OR _file.approval_status <> 'pending'
    OR _file.locked_at IS NOT NULL
    OR _file.archived_at IS NOT NULL
    OR COALESCE(_file.status, 'ready') <> 'ready' THEN
    RAISE EXCEPTION 'file is not awaiting this client decision';
  END IF;
  IF p_decision = 'rejected'
    AND COALESCE(length(_feedback), 0) < 10 THEN
    RAISE EXCEPTION 'client feedback must contain at least 10 characters';
  END IF;

  UPDATE public.files
  SET
    approval_status = 'none',
    client_decided_by = NULL,
    client_decided_at = NULL,
    locked_at = now()
  WHERE parent_file_id = p_file_id;

  UPDATE public.files
  SET
    approval_status = p_decision,
    feedback = CASE
      WHEN p_decision = 'rejected' THEN _feedback
      ELSE NULL
    END,
    client_decided_by = _actor,
    client_decided_at = now(),
    locked_at = now()
  WHERE id = p_file_id;

  INSERT INTO public.file_approval_events (
    file_id,
    client_id,
    actor_id,
    event_type,
    from_status,
    to_status,
    feedback,
    metadata
  ) VALUES (
    _file.id,
    _file.client_id,
    _actor,
    CASE
      WHEN p_decision = 'approved' THEN 'client_approved'
      ELSE 'client_rejected'
    END,
    _file.approval_status,
    p_decision,
    _feedback,
    jsonb_build_object('version', p_expected_version)
  );

  IF p_decision = 'rejected' AND _file.project_id IS NOT NULL THEN
    INSERT INTO public.tasks (
      project_id,
      title,
      description,
      status,
      priority,
      assigned_to,
      source
    ) VALUES (
      _file.project_id,
      'Ajustar: ' || _file.file_name,
      'Feedback do cliente:' || E'\n' || _feedback,
      'backlog',
      'high',
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.user_roles AS role_row
          WHERE role_row.user_id = _file.uploaded_by
            AND (
              role_row.role = 'admin'::public.app_role
              OR (
                role_row.role IN (
                  'manager'::public.app_role,
                  'design'::public.app_role,
                  'traffic'::public.app_role
                )
                AND EXISTS (
                  SELECT 1
                  FROM public.team_client_assignments AS assignment
                  WHERE assignment.user_id = _file.uploaded_by
                    AND assignment.client_id = _file.client_id
                )
              )
            )
        ) THEN _file.uploaded_by
        ELSE NULL
      END,
      'client_feedback'
    );
  END IF;

  INSERT INTO public.notifications (
    user_id, message, notification_type, link
  )
  SELECT DISTINCT
    recipients.user_id,
    CASE
      WHEN p_decision = 'approved'
        THEN 'Cliente aprovou: ' || _file.file_name
      ELSE 'Cliente solicitou ajustes em: ' || _file.file_name
    END,
    'approval',
    '/aprovacoes'
  FROM (
    SELECT ur.user_id
    FROM public.user_roles AS ur
    WHERE ur.role = 'admin'::public.app_role

    UNION

    SELECT assignment.user_id
    FROM public.team_client_assignments AS assignment
    WHERE assignment.client_id = _file.client_id
  ) AS recipients;

  RETURN p_file_id;
END
$$;

REVOKE ALL ON FUNCTION public.request_file_agency_review(uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.review_file_agency(uuid, text, text)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.release_file_to_client(uuid, text)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.decide_file_approval(uuid, integer, text, text)
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.request_file_agency_review(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_file_agency(uuid, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_file_to_client(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_file_approval(uuid, integer, text, text)
  TO authenticated;

-- --------------------------------------------------------------------------
-- 5. File rows and approval audit RLS
-- --------------------------------------------------------------------------
DO $$
DECLARE
  _policy record;
BEGIN
  FOR _policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'files'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.files', _policy.policyname);
  END LOOP;
END
$$;

ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

CREATE POLICY files_secure_select
ON public.files
FOR SELECT TO authenticated
USING (public.can_read_file(id));

CREATE POLICY files_secure_insert
ON public.files
FOR INSERT TO authenticated
WITH CHECK (
  (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'design'::public.app_role)
    OR public.has_role(auth.uid(), 'traffic'::public.app_role)
  )
  AND public.can_access_client(client_id)
  AND uploaded_by = auth.uid()
);

CREATE POLICY files_secure_update
ON public.files
FOR UPDATE TO authenticated
USING (public.can_write_file(id))
WITH CHECK (public.can_write_file(id));

CREATE POLICY files_secure_delete
ON public.files
FOR DELETE TO authenticated
USING (public.can_write_file(id));

REVOKE ALL ON public.files FROM PUBLIC, anon;
REVOKE UPDATE ON public.files FROM authenticated;
REVOKE SELECT ON public.files FROM authenticated;
GRANT INSERT, DELETE ON public.files TO authenticated;
GRANT SELECT (
  id,
  client_id,
  project_id,
  uploaded_by,
  file_name,
  file_url,
  file_type,
  folder,
  description,
  caption,
  carousel_text,
  approval_status,
  feedback,
  client_decided_by,
  client_decided_at,
  approval_requested_at,
  visibility,
  requires_approval,
  status,
  archived_at,
  created_at,
  updated_at,
  parent_file_id,
  revision_of_file_id,
  locked_at,
  version,
  storage_bucket,
  storage_path,
  mime_type,
  extension,
  size_bytes,
  page_count,
  sheet_count,
  slide_count
) ON public.files TO authenticated;
GRANT UPDATE (
  file_name,
  file_type,
  folder,
  project_id,
  description,
  caption,
  carousel_text,
  tags,
  sensitivity,
  status,
  archived_at,
  updated_at
) ON public.files TO authenticated;

CREATE OR REPLACE VIEW public.staff_files_secure
WITH (security_barrier = true)
AS
SELECT
  file_row.*,
  jsonb_build_object(
    'full_name',
    uploader.full_name
  ) AS uploader,
  jsonb_build_object(
    'name',
    project.name
  ) AS project,
  jsonb_build_object(
    'full_name',
    client.full_name,
    'company_name',
    client.company_name
  ) AS client
FROM public.files AS file_row
LEFT JOIN public.profiles AS uploader
  ON uploader.id = file_row.uploaded_by
LEFT JOIN public.projects AS project
  ON project.id = file_row.project_id
LEFT JOIN public.profiles AS client
  ON client.id = file_row.client_id
WHERE public.is_staff(auth.uid())
  AND public.can_access_client(file_row.client_id);

REVOKE ALL ON public.staff_files_secure
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.staff_files_secure TO authenticated;

DO $$
DECLARE
  _policy record;
BEGIN
  FOR _policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'file_approval_events'
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON public.file_approval_events',
      _policy.policyname
    );
  END LOOP;
END
$$;

CREATE POLICY file_approval_events_secure_select
ON public.file_approval_events
FOR SELECT TO authenticated
USING (
  (
    (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'manager'::public.app_role)
      OR public.has_role(auth.uid(), 'design'::public.app_role)
      OR public.has_role(auth.uid(), 'traffic'::public.app_role)
    )
    AND public.can_access_client(client_id)
  )
  OR (
    client_id = auth.uid()
    AND event_type IN (
      'released_client_shared',
      'released_for_approval',
      'client_approved',
      'client_rejected'
    )
    AND public.can_client_read_file(file_id)
  )
);

REVOKE ALL ON public.file_approval_events
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.file_approval_events TO authenticated;
GRANT SELECT ON public.file_approval_events TO service_role;

-- --------------------------------------------------------------------------
-- 6. Private Storage backed by database metadata
-- --------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('files', 'files', false),
  ('mcp-files', 'mcp-files', false)
ON CONFLICT (id) DO UPDATE
SET public = false;

CREATE OR REPLACE FUNCTION public.storage_client_from_path(_name text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _first text := (storage.foldername(_name))[1];
  _second text := (storage.foldername(_name))[2];
BEGIN
  IF _first IN ('contracts', 'reports') THEN
    RETURN public.try_uuid(_second);
  END IF;
  RETURN public.try_uuid(_first);
END
$$;

CREATE OR REPLACE FUNCTION public.storage_object_read_allowed(
  _bucket text,
  _name text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _client_id uuid;
  _is_staff boolean;
BEGIN
  IF auth.uid() IS NULL OR _bucket NOT IN ('files', 'mcp-files') THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.files AS f
    WHERE f.storage_bucket = _bucket
      AND f.storage_path = _name
      AND public.can_read_file(f.id)
  ) THEN
    RETURN true;
  END IF;

  _is_staff :=
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'design'::public.app_role)
    OR public.has_role(auth.uid(), 'traffic'::public.app_role);

  IF _bucket = 'files' AND EXISTS (
    SELECT 1
    FROM public.reports AS report
    WHERE public.files_reference_matches(report.file_url, _name)
      AND public.file_storage_matches_client(
        'files',
        _name,
        report.client_id
      )
      AND (
        (_is_staff AND public.can_access_client(report.client_id))
        OR (
          report.client_id = auth.uid()
          AND report.status = 'published'
        )
      )
  ) THEN
    RETURN true;
  END IF;

  IF _bucket = 'files' AND EXISTS (
    SELECT 1
    FROM public.contracts AS contract
    WHERE public.files_reference_matches(contract.original_file_url, _name)
      AND public.file_storage_matches_client(
        'files',
        _name,
        contract.client_id
      )
      AND (
        (_is_staff AND public.can_access_client(contract.client_id))
        OR (
          contract.client_id = auth.uid()
          AND contract.status IN ('sent', 'signed', 'completed')
        )
      )
  ) THEN
    RETURN true;
  END IF;

  IF _bucket = 'files' AND _is_staff AND EXISTS (
    SELECT 1
    FROM public.task_attachments AS attachment
    JOIN public.tasks AS task ON task.id = attachment.task_id
    JOIN public.projects AS project ON project.id = task.project_id
    WHERE public.files_reference_matches(attachment.file_url, _name)
      AND public.can_access_client(project.client_id)
  ) THEN
    RETURN true;
  END IF;

  -- Transitional uploads get staff-only access from their client-scoped path.
  IF _is_staff THEN
    _client_id := public.storage_client_from_path(_name);
    IF _client_id IS NOT NULL
      AND public.can_access_client(_client_id) THEN
      RETURN true;
    END IF;

    IF _bucket = 'files'
      AND (storage.foldername(_name))[1] = 'task-attachments'
      AND EXISTS (
        SELECT 1
        FROM public.tasks AS task
        JOIN public.projects AS project ON project.id = task.project_id
        WHERE task.id = public.try_uuid((storage.foldername(_name))[2])
          AND public.can_access_client(project.client_id)
      ) THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END
$$;

CREATE OR REPLACE FUNCTION public.storage_object_write_allowed(
  _bucket text,
  _name text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _client_id uuid;
  _is_staff boolean;
BEGIN
  IF auth.uid() IS NULL OR _bucket NOT IN ('files', 'mcp-files') THEN
    RETURN false;
  END IF;

  _is_staff :=
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'design'::public.app_role)
    OR public.has_role(auth.uid(), 'traffic'::public.app_role);

  IF NOT _is_staff THEN
    RETURN false;
  END IF;

  -- A contract PDF is frozen as soon as the agency signs it, before the
  -- public client signature creates the terminal public.files row.
  IF _bucket = 'files' AND EXISTS (
    SELECT 1
    FROM public.contracts AS contract
    WHERE public.files_reference_matches(contract.original_file_url, _name)
      AND (
        contract.admin_signed_at IS NOT NULL
        OR contract.status <> 'draft'
      )
  ) THEN
    RETURN false;
  END IF;

  IF _bucket = 'files' AND EXISTS (
    SELECT 1
    FROM public.reports AS report
    WHERE public.files_reference_matches(report.file_url, _name)
      AND report.status = 'published'
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.files AS f
    WHERE f.storage_bucket = _bucket
      AND f.storage_path = _name
  ) THEN
    RETURN
      EXISTS (
        SELECT 1
        FROM public.files AS f
        WHERE f.storage_bucket = _bucket
          AND f.storage_path = _name
          AND public.can_write_file(f.id)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.files AS f
        WHERE f.storage_bucket = _bucket
          AND f.storage_path = _name
          AND NOT public.can_write_file(f.id)
      );
  END IF;

  IF _bucket = 'files'
    AND (storage.foldername(_name))[1] = 'task-attachments' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.tasks AS task
      JOIN public.projects AS project ON project.id = task.project_id
      WHERE task.id = public.try_uuid((storage.foldername(_name))[2])
        AND public.can_access_client(project.client_id)
    );
  END IF;

  _client_id := public.storage_client_from_path(_name);
  RETURN _client_id IS NOT NULL
    AND public.can_access_client(_client_id);
END
$$;

CREATE OR REPLACE FUNCTION public.can_staff_access_workspace_path(_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _folders text[] := storage.foldername(_name);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RETURN false;
  END IF;

  IF _folders[1] = 'global' THEN
    RETURN true;
  END IF;

  RETURN _folders[1] = 'client'
    AND public.can_access_client(public.try_uuid(_folders[2]));
END
$$;

REVOKE ALL ON FUNCTION public.storage_client_from_path(text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.storage_object_read_allowed(text, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.storage_object_write_allowed(text, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_staff_access_workspace_path(text)
  FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.storage_client_from_path(text)
  FROM authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storage_object_read_allowed(text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storage_object_write_allowed(text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_staff_access_workspace_path(text)
  TO authenticated, service_role;

DROP POLICY IF EXISTS "Anyone can read files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can read files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can delete files" ON storage.objects;
DROP POLICY IF EXISTS "files owner or staff read" ON storage.objects;
DROP POLICY IF EXISTS "mcp-files: staff read" ON storage.objects;
DROP POLICY IF EXISTS "mcp-files: staff write" ON storage.objects;
DROP POLICY IF EXISTS "mcp-files: owner read" ON storage.objects;
DROP POLICY IF EXISTS "mcp-files: linked client read" ON storage.objects;
DROP POLICY IF EXISTS "files secure read" ON storage.objects;
DROP POLICY IF EXISTS "files secure insert" ON storage.objects;
DROP POLICY IF EXISTS "files secure update" ON storage.objects;
DROP POLICY IF EXISTS "files secure delete" ON storage.objects;

CREATE POLICY "files secure read"
ON storage.objects
FOR SELECT TO authenticated
USING (
  storage.objects.bucket_id IN ('files', 'mcp-files')
  AND public.storage_object_read_allowed(
    storage.objects.bucket_id,
    storage.objects.name
  )
);

CREATE POLICY "files secure insert"
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  storage.objects.bucket_id IN ('files', 'mcp-files')
  AND public.storage_object_write_allowed(
    storage.objects.bucket_id,
    storage.objects.name
  )
);

CREATE POLICY "files secure update"
ON storage.objects
FOR UPDATE TO authenticated
USING (
  storage.objects.bucket_id IN ('files', 'mcp-files')
  AND public.storage_object_write_allowed(
    storage.objects.bucket_id,
    storage.objects.name
  )
)
WITH CHECK (
  storage.objects.bucket_id IN ('files', 'mcp-files')
  AND public.storage_object_write_allowed(
    storage.objects.bucket_id,
    storage.objects.name
  )
);

CREATE POLICY "files secure delete"
ON storage.objects
FOR DELETE TO authenticated
USING (
  storage.objects.bucket_id IN ('files', 'mcp-files')
  AND public.storage_object_write_allowed(
    storage.objects.bucket_id,
    storage.objects.name
  )
);

-- The workspace bucket keeps its staff policies, but its client bridge now
-- honors the same release gate as public.files.
DROP POLICY IF EXISTS "workspace_bucket_staff_select" ON storage.objects;
DROP POLICY IF EXISTS "workspace_bucket_staff_insert" ON storage.objects;
DROP POLICY IF EXISTS "workspace_bucket_staff_update" ON storage.objects;
DROP POLICY IF EXISTS "workspace_bucket_staff_delete" ON storage.objects;
DROP POLICY IF EXISTS "workspace: linked approval read" ON storage.objects;
DROP POLICY IF EXISTS "workspace: secure linked file read" ON storage.objects;

CREATE POLICY "workspace_bucket_assigned_staff_select"
ON storage.objects
FOR SELECT TO authenticated
USING (
  storage.objects.bucket_id = 'workspace'
  AND public.can_staff_access_workspace_path(storage.objects.name)
);

CREATE POLICY "workspace_bucket_assigned_staff_insert"
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  storage.objects.bucket_id = 'workspace'
  AND public.can_staff_access_workspace_path(storage.objects.name)
);

CREATE POLICY "workspace_bucket_assigned_staff_update"
ON storage.objects
FOR UPDATE TO authenticated
USING (
  storage.objects.bucket_id = 'workspace'
  AND public.can_staff_access_workspace_path(storage.objects.name)
)
WITH CHECK (
  storage.objects.bucket_id = 'workspace'
  AND public.can_staff_access_workspace_path(storage.objects.name)
);

CREATE POLICY "workspace_bucket_assigned_staff_delete"
ON storage.objects
FOR DELETE TO authenticated
USING (
  storage.objects.bucket_id = 'workspace'
  AND public.can_staff_access_workspace_path(storage.objects.name)
);

CREATE POLICY "workspace: secure linked file read"
ON storage.objects
FOR SELECT TO authenticated
USING (
  storage.objects.bucket_id = 'workspace'
  AND EXISTS (
    SELECT 1
    FROM public.files AS f
    WHERE f.storage_bucket = 'workspace'
      AND f.storage_path = storage.objects.name
      AND public.can_client_read_file(f.id)
  )
);

DO $$
DECLARE
  _policy record;
BEGIN
  FOR _policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workspace_nodes'
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON public.workspace_nodes',
      _policy.policyname
    );
  END LOOP;
END
$$;

CREATE POLICY workspace_nodes_assigned_staff_select
ON public.workspace_nodes
FOR SELECT TO authenticated
USING (
  public.is_staff(auth.uid())
  AND (
    scope = 'global'::public.workspace_scope
    OR (
      scope = 'client'::public.workspace_scope
      AND client_id IS NOT NULL
      AND public.can_access_client(client_id)
    )
  )
);

CREATE POLICY workspace_nodes_assigned_staff_insert
ON public.workspace_nodes
FOR INSERT TO authenticated
WITH CHECK (
  public.is_staff(auth.uid())
  AND created_by = auth.uid()
  AND (
    scope = 'global'::public.workspace_scope
    OR (
      scope = 'client'::public.workspace_scope
      AND client_id IS NOT NULL
      AND public.can_access_client(client_id)
    )
  )
);

CREATE POLICY workspace_nodes_assigned_staff_update
ON public.workspace_nodes
FOR UPDATE TO authenticated
USING (
  public.is_staff(auth.uid())
  AND (
    scope = 'global'::public.workspace_scope
    OR (
      scope = 'client'::public.workspace_scope
      AND client_id IS NOT NULL
      AND public.can_access_client(client_id)
    )
  )
)
WITH CHECK (
  public.is_staff(auth.uid())
  AND (
    scope = 'global'::public.workspace_scope
    OR (
      scope = 'client'::public.workspace_scope
      AND client_id IS NOT NULL
      AND public.can_access_client(client_id)
    )
  )
);

CREATE POLICY workspace_nodes_assigned_staff_delete
ON public.workspace_nodes
FOR DELETE TO authenticated
USING (
  public.is_staff(auth.uid())
  AND (
    scope = 'global'::public.workspace_scope
    OR (
      scope = 'client'::public.workspace_scope
      AND client_id IS NOT NULL
      AND public.can_access_client(client_id)
    )
  )
);

-- --------------------------------------------------------------------------
-- 7. Internal production data stays internal at the database boundary
-- --------------------------------------------------------------------------
DO $$
DECLARE
  _table_name text;
  _policy record;
BEGIN
  FOREACH _table_name IN ARRAY ARRAY[
    'tasks',
    'task_comments',
    'task_attachments',
    'task_checklist_items',
    'file_content_chunks',
    'file_processing_jobs',
    'updates'
  ]
  LOOP
    FOR _policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = _table_name
    LOOP
      EXECUTE format(
        'DROP POLICY %I ON public.%I',
        _policy.policyname,
        _table_name
      );
    END LOOP;
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.task_comments TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.task_attachments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_checklist_items TO authenticated;
GRANT SELECT ON public.file_content_chunks TO authenticated;
GRANT SELECT ON public.file_processing_jobs TO authenticated;
GRANT SELECT ON public.projects TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.updates TO authenticated;

CREATE POLICY tasks_staff_select
ON public.tasks
FOR SELECT TO authenticated
USING (public.can_staff_access_project(project_id));

CREATE POLICY tasks_staff_insert
ON public.tasks
FOR INSERT TO authenticated
WITH CHECK (public.can_staff_access_project(project_id));

CREATE POLICY tasks_staff_update
ON public.tasks
FOR UPDATE TO authenticated
USING (public.can_staff_access_project(project_id))
WITH CHECK (public.can_staff_access_project(project_id));

CREATE POLICY tasks_staff_delete
ON public.tasks
FOR DELETE TO authenticated
USING (public.can_staff_access_project(project_id));

CREATE POLICY task_comments_staff_select
ON public.task_comments
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.tasks AS task
    WHERE task.id = task_comments.task_id
      AND public.can_staff_access_project(task.project_id)
  )
);

CREATE POLICY task_comments_staff_insert
ON public.task_comments
FOR INSERT TO authenticated
WITH CHECK (
  author_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.tasks AS task
    WHERE task.id = task_comments.task_id
      AND public.can_staff_access_project(task.project_id)
  )
);

CREATE POLICY task_comments_staff_delete
ON public.task_comments
FOR DELETE TO authenticated
USING (
  (
    author_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  )
  AND EXISTS (
    SELECT 1
    FROM public.tasks AS task
    WHERE task.id = task_comments.task_id
      AND public.can_staff_access_project(task.project_id)
  )
);

CREATE POLICY task_attachments_staff_select
ON public.task_attachments
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.tasks AS task
    WHERE task.id = task_attachments.task_id
      AND public.can_staff_access_project(task.project_id)
  )
);

CREATE POLICY task_attachments_staff_insert
ON public.task_attachments
FOR INSERT TO authenticated
WITH CHECK (
  uploaded_by = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.tasks AS task
    WHERE task.id = task_attachments.task_id
      AND public.can_staff_access_project(task.project_id)
  )
);

CREATE POLICY task_attachments_staff_delete
ON public.task_attachments
FOR DELETE TO authenticated
USING (
  (
    uploaded_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  )
  AND EXISTS (
    SELECT 1
    FROM public.tasks AS task
    WHERE task.id = task_attachments.task_id
      AND public.can_staff_access_project(task.project_id)
  )
);

CREATE POLICY task_checklist_staff_select
ON public.task_checklist_items
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.tasks AS task
    WHERE task.id = task_checklist_items.task_id
      AND public.can_staff_access_project(task.project_id)
  )
);

CREATE POLICY task_checklist_staff_insert
ON public.task_checklist_items
FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.tasks AS task
    WHERE task.id = task_checklist_items.task_id
      AND public.can_staff_access_project(task.project_id)
  )
);

CREATE POLICY task_checklist_staff_update
ON public.task_checklist_items
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.tasks AS task
    WHERE task.id = task_checklist_items.task_id
      AND public.can_staff_access_project(task.project_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.tasks AS task
    WHERE task.id = task_checklist_items.task_id
      AND public.can_staff_access_project(task.project_id)
  )
);

CREATE POLICY task_checklist_staff_delete
ON public.task_checklist_items
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.tasks AS task
    WHERE task.id = task_checklist_items.task_id
      AND public.can_staff_access_project(task.project_id)
  )
);

CREATE POLICY file_content_chunks_staff_select
ON public.file_content_chunks
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.files AS f
    WHERE f.id = file_content_chunks.file_id
      AND (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.has_role(auth.uid(), 'manager'::public.app_role)
        OR public.has_role(auth.uid(), 'design'::public.app_role)
        OR public.has_role(auth.uid(), 'traffic'::public.app_role)
      )
      AND public.can_access_client(f.client_id)
  )
);

CREATE POLICY file_processing_jobs_staff_select
ON public.file_processing_jobs
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.files AS f
    WHERE f.id = file_processing_jobs.file_id
      AND (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.has_role(auth.uid(), 'manager'::public.app_role)
        OR public.has_role(auth.uid(), 'design'::public.app_role)
        OR public.has_role(auth.uid(), 'traffic'::public.app_role)
      )
      AND public.can_access_client(f.client_id)
  )
);

CREATE POLICY updates_secure_select
ON public.updates
FOR SELECT TO authenticated
USING (
  public.can_staff_access_project(project_id)
  OR (
    client_visible
    AND public.user_owns_project(auth.uid(), project_id)
  )
);

CREATE POLICY updates_staff_insert
ON public.updates
FOR INSERT TO authenticated
WITH CHECK (
  author_id = auth.uid()
  AND public.can_staff_access_project(project_id)
  AND (
    NOT client_visible
    OR EXISTS (
      SELECT 1
      FROM public.projects AS project
      WHERE project.id = updates.project_id
        AND public.can_manage_client(project.client_id)
    )
  )
);

CREATE POLICY updates_manager_update
ON public.updates
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.projects AS project
    WHERE project.id = updates.project_id
      AND public.can_manage_client(project.client_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.projects AS project
    WHERE project.id = updates.project_id
      AND public.can_manage_client(project.client_id)
  )
);

CREATE POLICY updates_manager_delete
ON public.updates
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.projects AS project
    WHERE project.id = updates.project_id
      AND public.can_manage_client(project.client_id)
  )
);

REVOKE ALL ON public.file_content_chunks FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.file_content_chunks FROM authenticated;
