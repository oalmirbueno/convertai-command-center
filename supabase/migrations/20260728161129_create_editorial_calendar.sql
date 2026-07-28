-- ============================================================================
-- Aceleriq OS - calendário editorial, planos de publicação e histórico
-- ============================================================================
--
-- Este lote é aditivo. Ele não conecta APIs sociais, não guarda tokens e não
-- publica conteúdo automaticamente. A aprovação continua tendo uma única fonte
-- da verdade: a versão raiz em public.files e o double-gate já existente.

-- --------------------------------------------------------------------------
-- 1. Conteúdo editorial e dados internos separados
-- --------------------------------------------------------------------------
CREATE TABLE public.editorial_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  primary_file_id uuid REFERENCES public.files(id) ON DELETE RESTRICT,
  title text NOT NULL,
  content_type text NOT NULL,
  objective text,
  default_caption text,
  production_status text NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT editorial_posts_project_fk
    FOREIGN KEY (project_id, client_id)
    REFERENCES public.projects(id, client_id)
    ON DELETE RESTRICT,
  CONSTRAINT editorial_posts_scope_key UNIQUE (id, client_id, project_id),
  CONSTRAINT editorial_posts_id_client_key UNIQUE (id, client_id),
  CONSTRAINT editorial_posts_title_nonempty
    CHECK (length(btrim(title)) > 0),
  CONSTRAINT editorial_posts_content_type_check
    CHECK (
      content_type IN (
        'static',
        'carousel',
        'reel',
        'story',
        'video',
        'short',
        'article',
        'google_post',
        'other'
      )
    ),
  CONSTRAINT editorial_posts_production_status_check
    CHECK (
      production_status IN (
        'draft',
        'production',
        'ready',
        'cancelled',
        'archived'
      )
    ),
  CONSTRAINT editorial_posts_version_positive CHECK (version > 0),
  CONSTRAINT editorial_posts_archive_state_check CHECK (
    (production_status = 'archived' AND archived_at IS NOT NULL)
    OR (production_status <> 'archived' AND archived_at IS NULL)
  )
);

CREATE TABLE public.editorial_post_internal (
  post_id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  responsible_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  revision_of_post_id uuid REFERENCES public.editorial_posts(id)
    ON DELETE RESTRICT,
  internal_notes text,
  idempotency_key uuid NOT NULL,
  request_fingerprint text NOT NULL,
  last_mutation_id uuid,
  last_mutation_fingerprint text,
  approval_fingerprint text,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT editorial_post_internal_post_fk
    FOREIGN KEY (post_id, client_id)
    REFERENCES public.editorial_posts(id, client_id)
    ON DELETE RESTRICT,
  CONSTRAINT editorial_post_internal_idempotency_key UNIQUE (idempotency_key),
  CONSTRAINT editorial_post_internal_fingerprint_check
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT editorial_post_internal_last_mutation_pair_check
    CHECK (
      (last_mutation_id IS NULL) =
      (last_mutation_fingerprint IS NULL)
    ),
  CONSTRAINT editorial_post_internal_last_mutation_fingerprint_check
    CHECK (
      last_mutation_fingerprint IS NULL
      OR last_mutation_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT editorial_post_internal_approval_fingerprint_check
    CHECK (
      approval_fingerprint IS NULL
      OR approval_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT editorial_post_internal_revision_not_self
    CHECK (revision_of_post_id IS NULL OR revision_of_post_id <> post_id)
);

CREATE INDEX editorial_post_revision_idx
  ON public.editorial_post_internal(revision_of_post_id)
  WHERE revision_of_post_id IS NOT NULL;

CREATE INDEX editorial_posts_client_status_created_idx
  ON public.editorial_posts(client_id, production_status, created_at DESC);
CREATE INDEX editorial_posts_project_status_idx
  ON public.editorial_posts(project_id, production_status);
CREATE UNIQUE INDEX editorial_posts_primary_file_unique_idx
  ON public.editorial_posts(primary_file_id)
  WHERE primary_file_id IS NOT NULL;
CREATE INDEX editorial_post_internal_task_idx
  ON public.editorial_post_internal(task_id)
  WHERE task_id IS NOT NULL;
CREATE INDEX editorial_post_internal_responsible_idx
  ON public.editorial_post_internal(responsible_id)
  WHERE responsible_id IS NOT NULL;

-- --------------------------------------------------------------------------
-- 2. Uma publicação por conteúdo e conta, com dados técnicos separados
-- --------------------------------------------------------------------------
CREATE TABLE public.editorial_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL,
  client_id uuid NOT NULL,
  project_id uuid NOT NULL,
  external_account_id uuid NOT NULL,
  file_id uuid REFERENCES public.files(id) ON DELETE RESTRICT,
  platform text NOT NULL,
  caption text,
  first_comment text,
  alt_text text,
  scheduled_at timestamptz,
  scheduled_timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  status text NOT NULL DEFAULT 'planned',
  published_at timestamptz,
  permalink text,
  external_post_id text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT editorial_publications_post_fk
    FOREIGN KEY (post_id, client_id, project_id)
    REFERENCES public.editorial_posts(id, client_id, project_id)
    ON DELETE RESTRICT,
  CONSTRAINT editorial_publications_account_fk
    FOREIGN KEY (external_account_id, client_id)
    REFERENCES public.external_accounts(id, client_id)
    ON DELETE RESTRICT,
  CONSTRAINT editorial_publications_id_client_key UNIQUE (id, client_id),
  CONSTRAINT editorial_publications_post_account_key
    UNIQUE (post_id, external_account_id),
  CONSTRAINT editorial_publications_platform_check
    CHECK (
      platform IN (
        'instagram',
        'facebook',
        'tiktok',
        'linkedin',
        'youtube',
        'google_business'
      )
    ),
  CONSTRAINT editorial_publications_status_check
    CHECK (
      status IN (
        'planned',
        'scheduled',
        'published',
        'failed',
        'cancelled'
      )
    ),
  CONSTRAINT editorial_publications_version_positive CHECK (version > 0),
  CONSTRAINT editorial_publications_scheduled_fields_check CHECK (
    status NOT IN ('scheduled', 'published', 'failed')
    OR scheduled_at IS NOT NULL
  ),
  CONSTRAINT editorial_publications_published_fields_check CHECK (
    status <> 'published'
    OR (
      published_at IS NOT NULL
      AND permalink IS NOT NULL
      AND length(btrim(permalink)) > 0
      AND file_id IS NOT NULL
    )
  )
);

CREATE TABLE public.editorial_publication_internal (
  publication_id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  request_fingerprint text NOT NULL,
  included_in_approval_snapshot boolean NOT NULL DEFAULT false,
  failure_code text,
  failure_reason text,
  attempt_count integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  scheduled_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  published_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT editorial_publication_internal_publication_fk
    FOREIGN KEY (publication_id, client_id)
    REFERENCES public.editorial_publications(id, client_id)
    ON DELETE RESTRICT,
  CONSTRAINT editorial_publication_internal_idempotency_key
    UNIQUE (idempotency_key),
  CONSTRAINT editorial_publication_internal_fingerprint_check
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT editorial_publication_internal_attempts_nonnegative
    CHECK (attempt_count >= 0)
);

CREATE UNIQUE INDEX editorial_publication_external_post_idx
  ON public.editorial_publications(external_account_id, external_post_id)
  WHERE external_post_id IS NOT NULL;
CREATE INDEX editorial_publications_post_idx
  ON public.editorial_publications(post_id);
CREATE INDEX editorial_publications_client_calendar_idx
  ON public.editorial_publications(client_id, scheduled_at, status);
CREATE INDEX editorial_publications_project_calendar_idx
  ON public.editorial_publications(project_id, scheduled_at, status);
CREATE INDEX editorial_publications_account_calendar_idx
  ON public.editorial_publications(external_account_id, scheduled_at, status);
CREATE INDEX editorial_publications_scheduled_queue_idx
  ON public.editorial_publications(scheduled_at, id)
  WHERE status = 'scheduled';

-- --------------------------------------------------------------------------
-- 3. Histórico append-only
-- --------------------------------------------------------------------------
CREATE TABLE public.editorial_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  post_id uuid NOT NULL REFERENCES public.editorial_posts(id)
    ON DELETE RESTRICT,
  publication_id uuid REFERENCES public.editorial_publications(id)
    ON DELETE RESTRICT,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT editorial_events_type_nonempty
    CHECK (length(btrim(event_type)) > 0),
  CONSTRAINT editorial_events_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX editorial_events_client_created_idx
  ON public.editorial_events(client_id, created_at DESC);
CREATE INDEX editorial_events_post_created_idx
  ON public.editorial_events(post_id, created_at DESC);
CREATE INDEX editorial_events_publication_created_idx
  ON public.editorial_events(publication_id, created_at DESC)
  WHERE publication_id IS NOT NULL;

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
                  'alt_text', publication.alt_text
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

-- --------------------------------------------------------------------------
-- 4. Helpers de acesso e integridade
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.editorial_staff_can_access_client(
  _client_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR (
        (
          public.has_role(auth.uid(), 'manager'::public.app_role)
          OR public.has_role(auth.uid(), 'design'::public.app_role)
          OR public.has_role(auth.uid(), 'traffic'::public.app_role)
        )
        AND EXISTS (
          SELECT 1
          FROM public.team_client_assignments AS assignment
          WHERE assignment.user_id = auth.uid()
            AND assignment.client_id = _client_id
        )
      )
    )
$$;

CREATE OR REPLACE FUNCTION public.editorial_can_publish_client(
  _client_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR (
        public.has_role(auth.uid(), 'manager'::public.app_role)
        AND EXISTS (
          SELECT 1
          FROM public.team_client_assignments AS assignment
          WHERE assignment.user_id = auth.uid()
            AND assignment.client_id = _client_id
        )
      )
    )
$$;

CREATE OR REPLACE FUNCTION public.editorial_client_can_read_post(
  _post_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.editorial_posts AS post
    JOIN public.editorial_post_internal AS internal
      ON internal.post_id = post.id
    WHERE post.id = _post_id
      AND post.archived_at IS NULL
      AND post.production_status = 'ready'
      AND auth.uid() = post.client_id
      AND public.has_role(auth.uid(), 'client'::public.app_role)
      AND post.primary_file_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.files AS file_row
        WHERE file_row.id = post.primary_file_id
          AND file_row.parent_file_id IS NULL
          AND file_row.client_id = post.client_id
          AND file_row.project_id = post.project_id
          AND file_row.archived_at IS NULL
          AND COALESCE(file_row.status, 'ready') = 'ready'
          AND file_row.agency_approval_status = 'approved'
          AND file_row.visibility = 'approval'
          AND file_row.approval_status = 'approved'
          AND file_row.locked_at IS NOT NULL
          AND internal.approval_fingerprint IS NOT NULL
      )
      AND EXISTS (
        SELECT 1
        FROM public.editorial_publications AS publication
        JOIN public.editorial_publication_internal AS publication_internal
          ON publication_internal.publication_id = publication.id
        JOIN public.files AS effective_file
          ON effective_file.id =
            COALESCE(publication.file_id, post.primary_file_id)
        WHERE publication.post_id = post.id
          AND publication.status IN ('scheduled', 'published')
          AND publication_internal.included_in_approval_snapshot
          AND effective_file.parent_file_id IS NULL
          AND effective_file.client_id = post.client_id
          AND effective_file.project_id = post.project_id
          AND effective_file.archived_at IS NULL
          AND COALESCE(effective_file.status, 'ready') = 'ready'
          AND effective_file.agency_approval_status = 'approved'
          AND effective_file.visibility = 'approval'
          AND effective_file.approval_status = 'approved'
          AND effective_file.locked_at IS NOT NULL
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.editorial_file_is_publishable(
  _file_id uuid,
  _client_id uuid,
  _project_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.files AS file_row
    WHERE file_row.id = _file_id
      AND file_row.parent_file_id IS NULL
      AND file_row.client_id = _client_id
      AND file_row.project_id = _project_id
      AND file_row.archived_at IS NULL
      AND COALESCE(file_row.status, 'ready') = 'ready'
      AND file_row.agency_approval_status = 'approved'
      AND file_row.visibility = 'approval'
      AND file_row.approval_status = 'approved'
      AND file_row.locked_at IS NOT NULL
  )
$$;

CREATE OR REPLACE FUNCTION public.editorial_client_can_read_publication(
  _publication_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.editorial_publications AS publication
    JOIN public.editorial_posts AS post
      ON post.id = publication.post_id
    WHERE publication.id = _publication_id
      AND publication.status IN ('scheduled', 'published')
      AND public.editorial_client_can_read_post(post.id)
      AND public.editorial_file_is_publishable(
        COALESCE(publication.file_id, post.primary_file_id),
        publication.client_id,
        publication.project_id
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.get_editorial_approval_preview(
  p_file_id uuid
)
RETURNS TABLE (
  post_id uuid,
  title text,
  content_type text,
  objective text,
  default_caption text,
  plans jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH requested_file AS MATERIALIZED (
    SELECT
      file_row.id,
      file_row.client_id,
      file_row.project_id
    FROM public.files AS file_row
    WHERE file_row.id = p_file_id
      AND file_row.parent_file_id IS NULL
      AND file_row.archived_at IS NULL
      AND COALESCE(file_row.status, 'ready') = 'ready'
      AND (
        (
          auth.uid() = file_row.client_id
          AND public.has_role(
            auth.uid(),
            'client'::public.app_role
          )
          AND file_row.agency_approval_status = 'approved'
          AND file_row.visibility = 'approval'
          AND file_row.requires_approval = true
          AND file_row.approval_status IN (
            'pending',
            'approved',
            'rejected'
          )
        )
        OR (
          public.editorial_staff_can_access_client(file_row.client_id)
          AND file_row.agency_approval_status IN (
            'pending',
            'approved',
            'rejected'
          )
        )
      )
  )
  SELECT
    post.id AS post_id,
    post.title,
    post.content_type,
    post.objective,
    post.default_caption,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'platform', publication.platform,
            'account_name', account.display_name,
            'account_handle', account.handle,
            'caption', publication.caption,
            'first_comment', publication.first_comment,
            'alt_text', publication.alt_text
          )
          ORDER BY
            publication.platform,
            publication.external_account_id
        )
        FROM public.editorial_publications AS publication
        JOIN public.editorial_publication_internal AS publication_internal
          ON publication_internal.publication_id = publication.id
        LEFT JOIN public.external_accounts AS account
          ON account.id = publication.external_account_id
          AND account.client_id = publication.client_id
        WHERE publication.post_id = post.id
          AND publication.status <> 'cancelled'
          AND publication_internal.included_in_approval_snapshot
      ),
      '[]'::jsonb
    ) AS plans
  FROM requested_file AS requested
  JOIN public.editorial_posts AS post
    ON post.client_id = requested.client_id
    AND post.project_id = requested.project_id
  JOIN public.editorial_post_internal AS internal
    ON internal.post_id = post.id
  WHERE post.archived_at IS NULL
    AND internal.approval_fingerprint IS NOT NULL
    AND internal.approval_fingerprint =
      public.editorial_compute_approval_fingerprint(post.id)
    AND (
      post.primary_file_id = requested.id
      OR EXISTS (
        SELECT 1
        FROM public.editorial_publications AS publication
        JOIN public.editorial_publication_internal AS publication_internal
          ON publication_internal.publication_id = publication.id
        WHERE publication.post_id = post.id
          AND publication.file_id = requested.id
          AND publication.status <> 'cancelled'
          AND publication_internal.included_in_approval_snapshot
      )
    )
  ORDER BY post.created_at, post.id
$$;

REVOKE ALL ON FUNCTION public.editorial_staff_can_access_client(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.editorial_can_publish_client(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.editorial_client_can_read_post(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.editorial_file_is_publishable(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.editorial_client_can_read_publication(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_editorial_approval_preview(uuid)
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.editorial_staff_can_access_client(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.editorial_can_publish_client(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.editorial_client_can_read_post(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.editorial_client_can_read_publication(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_editorial_approval_preview(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.editorial_events_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'editorial history is append-only';
END
$$;

REVOKE ALL ON FUNCTION public.editorial_events_immutable()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER editorial_events_no_update_delete
BEFORE UPDATE OR DELETE ON public.editorial_events
FOR EACH ROW EXECUTE FUNCTION public.editorial_events_immutable();

CREATE TRIGGER editorial_events_no_truncate
BEFORE TRUNCATE ON public.editorial_events
FOR EACH STATEMENT EXECUTE FUNCTION public.editorial_events_immutable();

CREATE OR REPLACE FUNCTION public.editorial_events_scope_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.editorial_posts AS post
    WHERE post.id = NEW.post_id
      AND post.client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'editorial event must match the post client';
  END IF;

  IF NEW.publication_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.editorial_publications AS publication
      WHERE publication.id = NEW.publication_id
        AND publication.post_id = NEW.post_id
        AND publication.client_id = NEW.client_id
    ) THEN
    RAISE EXCEPTION 'editorial event must match the publication scope';
  END IF;

  NEW.created_at := COALESCE(NEW.created_at, now());
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.editorial_events_scope_guard()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER editorial_events_scope_guard_trg
BEFORE INSERT ON public.editorial_events
FOR EACH ROW EXECUTE FUNCTION public.editorial_events_scope_guard();

CREATE OR REPLACE FUNCTION public.editorial_record_file_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _snapshot record;
  _current_fingerprint text;
BEGIN
  IF NEW.event_type NOT IN (
    'agency_approved',
    'agency_rejected',
    'client_approved',
    'client_rejected'
  ) THEN
    RETURN NEW;
  END IF;

  FOR _snapshot IN
    SELECT DISTINCT
      post.id AS post_id,
      post.client_id,
      internal.approval_fingerprint
    FROM public.editorial_posts AS post
    JOIN public.editorial_post_internal AS internal
      ON internal.post_id = post.id
    WHERE post.client_id = NEW.client_id
      AND post.archived_at IS NULL
      AND (
        post.primary_file_id = NEW.file_id
        OR EXISTS (
          SELECT 1
          FROM public.editorial_publications AS publication
          JOIN public.editorial_publication_internal
            AS publication_internal
            ON publication_internal.publication_id = publication.id
          WHERE publication.post_id = post.id
            AND publication.file_id = NEW.file_id
            AND publication.status <> 'cancelled'
            AND publication_internal.included_in_approval_snapshot
        )
      )
  LOOP
    _current_fingerprint :=
      public.editorial_compute_approval_fingerprint(_snapshot.post_id);

    IF _snapshot.approval_fingerprint IS NULL
      OR _snapshot.approval_fingerprint IS DISTINCT FROM
        _current_fingerprint THEN
      RAISE EXCEPTION 'editorial approval snapshot is unavailable or stale';
    END IF;

    INSERT INTO public.editorial_events (
      client_id,
      post_id,
      actor_id,
      event_type,
      from_status,
      to_status,
      metadata
    ) VALUES (
      _snapshot.client_id,
      _snapshot.post_id,
      NEW.actor_id,
      CASE
        WHEN NEW.event_type = 'agency_approved'
          THEN 'approval_snapshot_agency_approved'
        WHEN NEW.event_type = 'agency_rejected'
          THEN 'approval_snapshot_agency_rejected'
        WHEN NEW.event_type = 'client_approved'
          THEN 'approval_snapshot_client_approved'
        ELSE
          'approval_snapshot_client_rejected'
      END,
      NEW.from_status,
      NEW.to_status,
      jsonb_build_object(
        'file_id', NEW.file_id,
        'file_approval_event_id', NEW.id,
        'approval_fingerprint', _current_fingerprint
      )
    );
  END LOOP;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.editorial_record_file_decision()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER file_approval_events_editorial_snapshot_trg
AFTER INSERT ON public.file_approval_events
FOR EACH ROW EXECUTE FUNCTION public.editorial_record_file_decision();

-- --------------------------------------------------------------------------
-- 5. Guardas estruturais. Mesmo o backend confiável não cruza clientes.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.editorial_posts_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _file public.files%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'editorial posts are archived, never deleted';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.client_id IS DISTINCT FROM OLD.client_id
      OR NEW.project_id IS DISTINCT FROM OLD.project_id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'editorial post identity and scope are immutable';
    END IF;
    IF OLD.production_status = 'archived' THEN
      RAISE EXCEPTION 'archived editorial posts are immutable';
    END IF;
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
  ELSE
    NEW.version := 1;
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.updated_at := NEW.created_at;
  END IF;

  IF NEW.primary_file_id IS NOT NULL THEN
    SELECT * INTO _file
    FROM public.files
    WHERE id = NEW.primary_file_id
      AND parent_file_id IS NULL;

    IF NOT FOUND
      OR _file.client_id IS DISTINCT FROM NEW.client_id
      OR _file.project_id IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'editorial primary file must be a root file from the same client and project';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.editorial_post_internal_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _post public.editorial_posts%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'editorial internal records are never deleted';
  END IF;

  SELECT * INTO _post
  FROM public.editorial_posts
  WHERE id = NEW.post_id;
  IF NOT FOUND OR _post.client_id IS DISTINCT FROM NEW.client_id THEN
    RAISE EXCEPTION 'editorial internal record must match the post client';
  END IF;

  IF TG_OP = 'INSERT'
    OR (
      TG_OP = 'UPDATE'
      AND NEW.task_id IS DISTINCT FROM OLD.task_id
    ) THEN
    IF NEW.task_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.tasks AS task
        WHERE task.id = NEW.task_id
          AND task.project_id = _post.project_id
          AND task.deleted_at IS NULL
      ) THEN
      RAISE EXCEPTION 'editorial task must belong to the same active project';
    END IF;
  END IF;

  IF TG_OP = 'INSERT'
    OR (
      TG_OP = 'UPDATE'
      AND NEW.responsible_id IS DISTINCT FROM OLD.responsible_id
    ) THEN
    IF NEW.responsible_id IS NOT NULL
      AND NOT (
        public.has_role(NEW.responsible_id, 'admin'::public.app_role)
        OR (
          (
            public.has_role(NEW.responsible_id, 'manager'::public.app_role)
            OR public.has_role(NEW.responsible_id, 'design'::public.app_role)
            OR public.has_role(NEW.responsible_id, 'traffic'::public.app_role)
          )
          AND EXISTS (
            SELECT 1
            FROM public.team_client_assignments AS assignment
            WHERE assignment.user_id = NEW.responsible_id
              AND assignment.client_id = NEW.client_id
          )
        )
      ) THEN
      RAISE EXCEPTION 'editorial responsible must be assigned to the client';
    END IF;
  END IF;

  IF NEW.revision_of_post_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.editorial_posts AS source_post
      WHERE source_post.id = NEW.revision_of_post_id
        AND source_post.client_id = NEW.client_id
        AND source_post.project_id = _post.project_id
    ) THEN
    RAISE EXCEPTION 'editorial revision must stay in the same client and project';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.post_id IS DISTINCT FROM OLD.post_id
      OR NEW.client_id IS DISTINCT FROM OLD.client_id
      OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
      OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.revision_of_post_id IS DISTINCT FROM OLD.revision_of_post_id THEN
      RAISE EXCEPTION 'editorial internal identity fields are immutable';
    END IF;
    NEW.updated_at := now();
  ELSE
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.updated_at := NEW.created_at;
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.editorial_publications_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _account public.external_accounts%ROWTYPE;
  _file public.files%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'editorial publications are cancelled, never deleted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.editorial_posts AS post
    WHERE post.id = NEW.post_id
      AND post.client_id = NEW.client_id
      AND post.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'editorial publication must match its post scope';
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.status IN ('failed', 'cancelled') THEN
    IF NEW.external_account_id IS DISTINCT FROM OLD.external_account_id
      OR NEW.platform IS DISTINCT FROM OLD.platform THEN
      RAISE EXCEPTION 'cleanup transitions cannot change the editorial account';
    END IF;
    -- Uma conta pode ser desativada ou desvinculada depois do agendamento.
    -- Isso nunca impede registrar falha, cancelar ou arquivar o plano.
    NEW.platform := OLD.platform;
  ELSE
    SELECT * INTO _account
    FROM public.external_accounts
    WHERE id = NEW.external_account_id
      AND client_id = NEW.client_id;
    IF NOT FOUND
      OR _account.status <> 'active'
      OR _account.platform NOT IN (
        'instagram',
        'facebook',
        'tiktok',
        'linkedin',
        'youtube',
        'google_business'
      ) THEN
      RAISE EXCEPTION 'editorial publication requires an active publishable account';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.project_external_accounts AS link
      WHERE link.project_id = NEW.project_id
        AND link.external_account_id = NEW.external_account_id
        AND link.client_id = NEW.client_id
    ) THEN
      RAISE EXCEPTION 'editorial account must be linked to the project';
    END IF;
    NEW.platform := _account.platform;
  END IF;

  IF NEW.file_id IS NOT NULL THEN
    SELECT * INTO _file
    FROM public.files
    WHERE id = NEW.file_id
      AND parent_file_id IS NULL;
    IF NOT FOUND
      OR _file.client_id IS DISTINCT FROM NEW.client_id
      OR _file.project_id IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'editorial publication file must match the client and project';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_timezone_names
    WHERE name = NEW.scheduled_timezone
  ) THEN
    RAISE EXCEPTION 'invalid editorial timezone';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.post_id IS DISTINCT FROM OLD.post_id
      OR NEW.client_id IS DISTINCT FROM OLD.client_id
      OR NEW.project_id IS DISTINCT FROM OLD.project_id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'editorial publication identity and scope are immutable';
    END IF;
    IF OLD.status = 'published' THEN
      RAISE EXCEPTION 'published editorial records are immutable';
    END IF;
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
  ELSE
    NEW.version := 1;
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.updated_at := NEW.created_at;
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.editorial_publication_internal_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'editorial publication internals are never deleted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.editorial_publications AS publication
    WHERE publication.id = NEW.publication_id
      AND publication.client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'editorial publication internal scope mismatch';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.publication_id IS DISTINCT FROM OLD.publication_id
      OR NEW.client_id IS DISTINCT FROM OLD.client_id
      OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
      OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'editorial publication internal identity is immutable';
    END IF;
    NEW.updated_at := now();
  ELSE
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.updated_at := NEW.created_at;
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.editorial_posts_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.editorial_post_internal_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.editorial_publications_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.editorial_publication_internal_guard()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER editorial_posts_guard_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.editorial_posts
FOR EACH ROW EXECUTE FUNCTION public.editorial_posts_guard();

CREATE TRIGGER editorial_post_internal_guard_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.editorial_post_internal
FOR EACH ROW EXECUTE FUNCTION public.editorial_post_internal_guard();

CREATE TRIGGER editorial_publications_guard_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.editorial_publications
FOR EACH ROW EXECUTE FUNCTION public.editorial_publications_guard();

CREATE TRIGGER editorial_publication_internal_guard_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.editorial_publication_internal
FOR EACH ROW EXECUTE FUNCTION public.editorial_publication_internal_guard();

-- --------------------------------------------------------------------------
-- 6. Escrita transacional de rascunho e planos por plataforma
-- --------------------------------------------------------------------------
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
  _actor uuid := auth.uid();
  _post public.editorial_posts%ROWTYPE;
  _existing_post public.editorial_posts%ROWTYPE;
  _existing_post_internal public.editorial_post_internal%ROWTYPE;
  _publication public.editorial_publications%ROWTYPE;
  _existing_publication public.editorial_publications%ROWTYPE;
  _existing_publication_internal
    public.editorial_publication_internal%ROWTYPE;
  _account public.external_accounts%ROWTYPE;
  _project public.projects%ROWTYPE;
  _client_id uuid;
  _project_id uuid;
  _post_id uuid;
  _task_id uuid;
  _responsible_id uuid;
  _primary_file_id uuid;
  _revision_of_post_id uuid;
  _post_idempotency_key uuid;
  _mutation_id uuid;
  _post_fingerprint text;
  _approval_fingerprint text;
  _publication_id uuid;
  _publication_idempotency_key uuid;
  _publication_fingerprint text;
  _publication_file_id uuid;
  _scheduled_at timestamptz;
  _scheduled_timezone text;
  _requested_file_ids uuid[] := ARRAY[]::uuid[];
  _locked_file public.files%ROWTYPE;
  _locked_file_count integer := 0;
  _plan jsonb;
  _seen_publications uuid[] := ARRAY[]::uuid[];
  _cancelled record;
  _is_new boolean := false;
  _recovered boolean := false;
BEGIN
  IF _actor IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid or unauthenticated editorial request';
  END IF;

  _client_id := NULLIF(p_payload->>'client_id', '')::uuid;
  _project_id := NULLIF(p_payload->>'project_id', '')::uuid;
  _post_id := NULLIF(p_payload->>'id', '')::uuid;
  _task_id := NULLIF(p_payload->>'task_id', '')::uuid;
  _responsible_id := NULLIF(p_payload->>'responsible_id', '')::uuid;
  _primary_file_id := NULLIF(p_payload->>'primary_file_id', '')::uuid;
  _revision_of_post_id :=
    NULLIF(p_payload->>'revision_of_post_id', '')::uuid;
  _post_idempotency_key :=
    NULLIF(p_payload->>'idempotency_key', '')::uuid;
  _mutation_id := NULLIF(p_payload->>'mutation_id', '')::uuid;
  _post_fingerprint :=
    encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');

  IF _client_id IS NULL
    OR _project_id IS NULL
    OR _post_idempotency_key IS NULL
    OR _mutation_id IS NULL
    OR NOT public.editorial_staff_can_access_client(_client_id) THEN
    RAISE EXCEPTION 'editorial client access denied';
  END IF;
  IF COALESCE(length(btrim(p_payload->>'title')), 0) = 0 THEN
    RAISE EXCEPTION 'editorial title is required';
  END IF;
  IF COALESCE(p_payload->>'content_type', '') NOT IN (
    'static',
    'carousel',
    'reel',
    'story',
    'video',
    'short',
    'article',
    'google_post',
    'other'
  ) THEN
    RAISE EXCEPTION 'invalid editorial content type';
  END IF;
  IF COALESCE(p_payload->>'production_status', 'draft') NOT IN (
    'draft',
    'production',
    'ready',
    'cancelled'
  ) THEN
    RAISE EXCEPTION 'invalid editable editorial status';
  END IF;
  IF NOT p_payload ? 'publications'
    OR jsonb_typeof(p_payload->'publications') <> 'array' THEN
    RAISE EXCEPTION 'the complete editorial publications array is required';
  END IF;
  SELECT * INTO _project
  FROM public.projects
  WHERE id = _project_id
    AND client_id = _client_id
    AND deleted_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'editorial project must be active and belong to the client';
  END IF;

  IF _post_id IS NULL THEN
    SELECT post.* INTO _existing_post
    FROM public.editorial_posts AS post
    JOIN public.editorial_post_internal AS internal
      ON internal.post_id = post.id
    WHERE internal.idempotency_key = _post_idempotency_key
    FOR UPDATE OF post;

    IF FOUND THEN
      SELECT * INTO _existing_post_internal
      FROM public.editorial_post_internal
      WHERE post_id = _existing_post.id;

      IF _existing_post.client_id IS DISTINCT FROM _client_id
        OR _existing_post.project_id IS DISTINCT FROM _project_id
        OR _existing_post_internal.request_fingerprint IS DISTINCT FROM
          _post_fingerprint THEN
        RAISE EXCEPTION 'editorial idempotency key was reused with different data';
      END IF;
      RETURN jsonb_build_object(
        'post_id', _existing_post.id,
        'version', _existing_post.version,
        'recovered', true
      );
    END IF;

    _post_id := gen_random_uuid();
    _is_new := true;
  ELSE
    SELECT * INTO _existing_post
    FROM public.editorial_posts
    WHERE id = _post_id
    FOR UPDATE;

    IF NOT FOUND
      OR _existing_post.client_id IS DISTINCT FROM _client_id
      OR _existing_post.project_id IS DISTINCT FROM _project_id
      OR NOT public.editorial_staff_can_access_client(
        _existing_post.client_id
      ) THEN
      RAISE EXCEPTION 'editorial post not found or access denied';
    END IF;
    SELECT * INTO _existing_post_internal
    FROM public.editorial_post_internal
    WHERE post_id = _existing_post.id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'editorial post internal state is missing';
    END IF;
    IF _existing_post_internal.last_mutation_id = _mutation_id THEN
      IF _existing_post_internal.last_mutation_fingerprint
        IS DISTINCT FROM _post_fingerprint THEN
        RAISE EXCEPTION 'editorial mutation id was reused with different data';
      END IF;
      RETURN jsonb_build_object(
        'post_id', _existing_post.id,
        'version', _existing_post.version,
        'recovered', true
      );
    END IF;
    IF p_expected_version IS NULL
      OR _existing_post.version <> p_expected_version THEN
      RAISE EXCEPTION 'editorial post changed; refresh before saving'
        USING ERRCODE = '40001';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.editorial_publications AS publication
      WHERE publication.post_id = _post_id
        AND publication.status NOT IN ('planned', 'cancelled')
    ) THEN
      RAISE EXCEPTION 'scheduled or terminal publications cannot be edited';
    END IF;
  END IF;

  SELECT COALESCE(
    array_agg(requested.file_id ORDER BY requested.file_id),
    ARRAY[]::uuid[]
  )
  INTO _requested_file_ids
  FROM (
    SELECT DISTINCT all_files.file_id
    FROM (
      SELECT _primary_file_id AS file_id
      UNION ALL
      SELECT _existing_post.primary_file_id
      UNION ALL
      SELECT NULLIF(plan.value->>'file_id', '')::uuid
      FROM jsonb_array_elements(
        COALESCE(p_payload->'publications', '[]'::jsonb)
      ) AS plan(value)
      UNION ALL
      SELECT publication.file_id
      FROM public.editorial_publications AS publication
      WHERE publication.post_id = _post_id
        AND publication.status <> 'cancelled'
    ) AS all_files
    WHERE all_files.file_id IS NOT NULL
  ) AS requested;

  _locked_file_count := 0;
  FOR _locked_file IN
    SELECT file_row.*
    FROM public.files AS file_row
    WHERE file_row.id = ANY(_requested_file_ids)
    ORDER BY file_row.id
    FOR UPDATE
  LOOP
    _locked_file_count := _locked_file_count + 1;
    IF _locked_file.parent_file_id IS NOT NULL
      OR _locked_file.client_id IS DISTINCT FROM _client_id
      OR _locked_file.project_id IS DISTINCT FROM _project_id
      OR _locked_file.archived_at IS NOT NULL
      OR NOT public.can_read_file(_locked_file.id) THEN
      RAISE EXCEPTION 'editorial files must be readable root files from the selected client and project';
    END IF;
  END LOOP;

  IF _locked_file_count <> cardinality(_requested_file_ids) THEN
    RAISE EXCEPTION 'one or more editorial files are unavailable';
  END IF;

  IF _primary_file_id IS NOT NULL
    AND (
      _is_new
      OR _existing_post.primary_file_id IS DISTINCT FROM _primary_file_id
    )
    AND NOT COALESCE(
      public.file_is_editable(_primary_file_id),
      false
    ) THEN
    RAISE EXCEPTION 'the editorial primary file is already under review; create a revision';
  END IF;

  IF NOT _is_new
    AND _existing_post.primary_file_id IS NOT NULL
    AND _existing_post.primary_file_id IS DISTINCT FROM _primary_file_id
    AND NOT COALESCE(
      public.file_is_editable(_existing_post.primary_file_id),
      false
    ) THEN
    RAISE EXCEPTION 'the approved editorial version is immutable; create a revision';
  END IF;

  IF _task_id IS NOT NULL
    AND (
      _is_new
      OR _existing_post_internal.task_id IS DISTINCT FROM _task_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.tasks AS task
      WHERE task.id = _task_id
        AND task.project_id = _project_id
        AND task.deleted_at IS NULL
    ) THEN
    RAISE EXCEPTION 'editorial task must belong to the selected project';
  END IF;

  IF _responsible_id IS NOT NULL
    AND (
      _is_new
      OR _existing_post_internal.responsible_id IS DISTINCT FROM
        _responsible_id
    )
    AND NOT (
      public.has_role(_responsible_id, 'admin'::public.app_role)
      OR (
        (
          public.has_role(_responsible_id, 'manager'::public.app_role)
          OR public.has_role(_responsible_id, 'design'::public.app_role)
          OR public.has_role(_responsible_id, 'traffic'::public.app_role)
        )
        AND EXISTS (
          SELECT 1
          FROM public.team_client_assignments AS assignment
          WHERE assignment.user_id = _responsible_id
            AND assignment.client_id = _client_id
        )
      )
    ) THEN
    RAISE EXCEPTION 'editorial responsible is not assigned to this client';
  END IF;

  IF _is_new THEN
    INSERT INTO public.editorial_posts (
      id,
      client_id,
      project_id,
      primary_file_id,
      title,
      content_type,
      objective,
      default_caption,
      production_status
    ) VALUES (
      _post_id,
      _client_id,
      _project_id,
      _primary_file_id,
      btrim(p_payload->>'title'),
      p_payload->>'content_type',
      NULLIF(btrim(p_payload->>'objective'), ''),
      NULLIF(p_payload->>'default_caption', ''),
      COALESCE(p_payload->>'production_status', 'draft')
    )
    RETURNING * INTO _post;

    INSERT INTO public.editorial_post_internal (
      post_id,
      client_id,
      task_id,
      responsible_id,
      revision_of_post_id,
      internal_notes,
      idempotency_key,
      request_fingerprint,
      last_mutation_id,
      last_mutation_fingerprint,
      created_by,
      updated_by
    ) VALUES (
      _post_id,
      _client_id,
      _task_id,
      _responsible_id,
      _revision_of_post_id,
      NULLIF(p_payload->>'internal_notes', ''),
      _post_idempotency_key,
      _post_fingerprint,
      _mutation_id,
      _post_fingerprint,
      _actor,
      _actor
    );

    INSERT INTO public.editorial_events (
      client_id,
      post_id,
      actor_id,
      event_type,
      to_status,
      metadata
    ) VALUES (
      _client_id,
      _post_id,
      _actor,
      'post_created',
      _post.production_status,
      jsonb_strip_nulls(
        jsonb_build_object(
          'content_type', _post.content_type,
          'project_id', _post.project_id,
          'primary_file_id', _post.primary_file_id,
          'task_id', _task_id,
          'responsible_id', _responsible_id
        )
      )
    );
  ELSE
    UPDATE public.editorial_posts
    SET
      primary_file_id = _primary_file_id,
      title = btrim(p_payload->>'title'),
      content_type = p_payload->>'content_type',
      objective = NULLIF(btrim(p_payload->>'objective'), ''),
      default_caption = NULLIF(p_payload->>'default_caption', ''),
      production_status =
        COALESCE(p_payload->>'production_status', 'draft')
    WHERE id = _post_id
    RETURNING * INTO _post;

    UPDATE public.editorial_post_internal
    SET
      task_id = _task_id,
      responsible_id = _responsible_id,
      internal_notes = NULLIF(p_payload->>'internal_notes', ''),
      last_mutation_id = _mutation_id,
      last_mutation_fingerprint = _post_fingerprint,
      updated_by = _actor
    WHERE post_id = _post_id;

    INSERT INTO public.editorial_events (
      client_id,
      post_id,
      actor_id,
      event_type,
      from_status,
      to_status,
      metadata
    ) VALUES (
      _client_id,
      _post_id,
      _actor,
      CASE
        WHEN _existing_post.production_status IS DISTINCT FROM
          _post.production_status
          THEN 'production_status_changed'
        ELSE 'post_updated'
      END,
      _existing_post.production_status,
      _post.production_status,
      jsonb_strip_nulls(
        jsonb_build_object(
          'version', _post.version,
          'primary_file_id_before', _existing_post.primary_file_id,
          'primary_file_id_after', _post.primary_file_id,
          'task_id_before', _existing_post_internal.task_id,
          'task_id_after', _task_id,
          'responsible_id_before',
            _existing_post_internal.responsible_id,
          'responsible_id_after', _responsible_id,
          'internal_notes_changed',
            _existing_post_internal.internal_notes IS DISTINCT FROM
              NULLIF(p_payload->>'internal_notes', '')
        )
      )
    );
  END IF;

  FOR _plan IN
    SELECT value
    FROM jsonb_array_elements(
      COALESCE(p_payload->'publications', '[]'::jsonb)
    )
  LOOP
    IF jsonb_typeof(_plan) <> 'object' THEN
      RAISE EXCEPTION 'invalid editorial publication plan';
    END IF;

    _publication_id := NULLIF(_plan->>'id', '')::uuid;
    _publication_idempotency_key :=
      NULLIF(_plan->>'idempotency_key', '')::uuid;
    _publication_fingerprint :=
      encode(sha256(convert_to(_plan::text, 'UTF8')), 'hex');
    _publication_file_id := NULLIF(_plan->>'file_id', '')::uuid;
    _scheduled_at := NULLIF(_plan->>'scheduled_at', '')::timestamptz;
    _scheduled_timezone :=
      COALESCE(NULLIF(_plan->>'scheduled_timezone', ''), 'America/Sao_Paulo');

    IF _publication_idempotency_key IS NULL THEN
      RAISE EXCEPTION 'publication idempotency key is required';
    END IF;

    SELECT * INTO _account
    FROM public.external_accounts
    WHERE id = NULLIF(_plan->>'external_account_id', '')::uuid
      AND client_id = _client_id
      AND status = 'active'
    FOR SHARE;
    IF NOT FOUND
      OR _account.platform NOT IN (
        'instagram',
        'facebook',
        'tiktok',
        'linkedin',
        'youtube',
        'google_business'
      )
      THEN
      RAISE EXCEPTION 'publication account is inactive, unsupported or not linked to the project';
    END IF;

    PERFORM 1
    FROM public.project_external_accounts AS link
    WHERE link.project_id = _project_id
      AND link.external_account_id = _account.id
      AND link.client_id = _client_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'publication account is inactive, unsupported or not linked to the project';
    END IF;

    IF _publication_file_id IS NOT NULL
      AND (
        NOT EXISTS (
          SELECT 1
          FROM public.files AS file_row
          WHERE file_row.id = _publication_file_id
            AND file_row.parent_file_id IS NULL
            AND file_row.client_id = _client_id
            AND file_row.project_id = _project_id
        )
        OR NOT public.can_read_file(_publication_file_id)
      ) THEN
      RAISE EXCEPTION 'publication file is unavailable or outside the project';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_timezone_names WHERE name = _scheduled_timezone
    ) THEN
      RAISE EXCEPTION 'invalid publication timezone';
    END IF;

    IF _publication_id IS NULL THEN
      SELECT publication.* INTO _existing_publication
      FROM public.editorial_publications AS publication
      JOIN public.editorial_publication_internal AS internal
        ON internal.publication_id = publication.id
      WHERE internal.idempotency_key = _publication_idempotency_key
      FOR UPDATE OF publication;

      IF FOUND THEN
        SELECT * INTO _existing_publication_internal
        FROM public.editorial_publication_internal
        WHERE publication_id = _existing_publication.id;

        IF _existing_publication.post_id IS DISTINCT FROM _post_id
          OR _existing_publication.external_account_id IS DISTINCT FROM
            _account.id
          OR _existing_publication_internal.request_fingerprint
            IS DISTINCT FROM _publication_fingerprint THEN
          RAISE EXCEPTION 'publication idempotency key was reused with different data';
        END IF;
        _publication_id := _existing_publication.id;
        _recovered := true;
      ELSE
        _publication_id := gen_random_uuid();
      END IF;
    ELSE
      SELECT * INTO _existing_publication
      FROM public.editorial_publications
      WHERE id = _publication_id
      FOR UPDATE;
      IF NOT FOUND
        OR _existing_publication.post_id IS DISTINCT FROM _post_id
        OR _existing_publication.status <> 'planned' THEN
        RAISE EXCEPTION 'publication plan is unavailable or immutable';
      END IF;
    END IF;

    IF NOT _recovered AND _existing_publication.id IS NULL THEN
      INSERT INTO public.editorial_publications (
        id,
        post_id,
        client_id,
        project_id,
        external_account_id,
        file_id,
        platform,
        caption,
        first_comment,
        alt_text,
        scheduled_at,
        scheduled_timezone,
        status
      ) VALUES (
        _publication_id,
        _post_id,
        _client_id,
        _project_id,
        _account.id,
        _publication_file_id,
        _account.platform,
        NULLIF(_plan->>'caption', ''),
        NULLIF(_plan->>'first_comment', ''),
        NULLIF(_plan->>'alt_text', ''),
        _scheduled_at,
        _scheduled_timezone,
        'planned'
      )
      RETURNING * INTO _publication;

      INSERT INTO public.editorial_publication_internal (
        publication_id,
        client_id,
        idempotency_key,
        request_fingerprint,
        created_by,
        updated_by
      ) VALUES (
        _publication_id,
        _client_id,
        _publication_idempotency_key,
        _publication_fingerprint,
        _actor,
        _actor
      );

      INSERT INTO public.editorial_events (
        client_id,
        post_id,
        publication_id,
        actor_id,
        event_type,
        to_status,
        metadata
      ) VALUES (
        _client_id,
        _post_id,
        _publication_id,
        _actor,
        'publication_created',
        'planned',
        jsonb_build_object(
          'platform', _publication.platform,
          'scheduled_at', _publication.scheduled_at
        )
      );
    ELSIF NOT _recovered THEN
      UPDATE public.editorial_publications
      SET
        external_account_id = _account.id,
        file_id = _publication_file_id,
        platform = _account.platform,
        caption = NULLIF(_plan->>'caption', ''),
        first_comment = NULLIF(_plan->>'first_comment', ''),
        alt_text = NULLIF(_plan->>'alt_text', ''),
        scheduled_at = _scheduled_at,
        scheduled_timezone = _scheduled_timezone,
        status = 'planned',
        published_at = NULL,
        permalink = NULL,
        external_post_id = NULL
      WHERE id = _publication_id
      RETURNING * INTO _publication;

      UPDATE public.editorial_publication_internal
      SET
        failure_code = NULL,
        failure_reason = NULL,
        updated_by = _actor
      WHERE publication_id = _publication_id;

      INSERT INTO public.editorial_events (
        client_id,
        post_id,
        publication_id,
        actor_id,
        event_type,
        from_status,
        to_status,
        metadata
      ) VALUES (
        _client_id,
        _post_id,
        _publication_id,
        _actor,
        'publication_updated',
        _existing_publication.status,
        'planned',
        jsonb_build_object('version', _publication.version)
      );
    END IF;

    _seen_publications :=
      array_append(_seen_publications, _publication_id);
    _existing_publication := NULL;
    _existing_publication_internal := NULL;
    _recovered := false;
  END LOOP;

  FOR _cancelled IN
    SELECT id, status
    FROM public.editorial_publications
    WHERE post_id = _post_id
      AND status = 'planned'
      AND (
        cardinality(_seen_publications) = 0
        OR id <> ALL(_seen_publications)
      )
    FOR UPDATE
  LOOP
    UPDATE public.editorial_publications
    SET status = 'cancelled'
    WHERE id = _cancelled.id;

    INSERT INTO public.editorial_events (
      client_id,
      post_id,
      publication_id,
      actor_id,
      event_type,
      from_status,
      to_status,
      metadata
    ) VALUES (
      _client_id,
      _post_id,
      _cancelled.id,
      _actor,
      'publication_cancelled',
      _cancelled.status,
      'cancelled',
      jsonb_build_object('reason', 'removed_from_plan')
    );
  END LOOP;

  _approval_fingerprint :=
    public.editorial_compute_approval_fingerprint(_post.id);

  IF EXISTS (
      SELECT 1
      FROM unnest(_requested_file_ids) AS requested(file_id)
      WHERE NOT COALESCE(
        public.file_is_editable(requested.file_id),
        false
      )
    )
    AND (
      _is_new
      OR _existing_post_internal.approval_fingerprint
        IS DISTINCT FROM _approval_fingerprint
    ) THEN
    RAISE EXCEPTION 'approved editorial copy is immutable; create a revision';
  END IF;

  UPDATE public.editorial_post_internal
  SET
    approval_fingerprint = _approval_fingerprint,
    updated_by = _actor
  WHERE post_id = _post.id;

  UPDATE public.editorial_publication_internal AS internal
  SET
    included_in_approval_snapshot =
      publication.status <> 'cancelled',
    updated_by = _actor
  FROM public.editorial_publications AS publication
  WHERE publication.post_id = _post.id
    AND internal.publication_id = publication.id;

  RETURN jsonb_build_object(
    'post_id', _post.id,
    'version', _post.version,
    'recovered', false
  );
END
$$;

-- --------------------------------------------------------------------------
-- 7. Transições críticas: só admin ou manager atribuído, com CAS e double-gate
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transition_editorial_publication(
  p_publication_id uuid,
  p_action text,
  p_expected_version integer,
  p_scheduled_at timestamptz DEFAULT NULL,
  p_timezone text DEFAULT NULL,
  p_permalink text DEFAULT NULL,
  p_external_post_id text DEFAULT NULL,
  p_failure_code text DEFAULT NULL,
  p_failure_reason text DEFAULT NULL,
  p_published_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _actor uuid := auth.uid();
  _publication public.editorial_publications%ROWTYPE;
  _post public.editorial_posts%ROWTYPE;
  _post_internal public.editorial_post_internal%ROWTYPE;
  _internal public.editorial_publication_internal%ROWTYPE;
  _account public.external_accounts%ROWTYPE;
  _project public.projects%ROWTYPE;
  _lookup_post_id uuid;
  _lookup_client_id uuid;
  _effective_file_id uuid;
  _next_scheduled_at timestamptz;
  _next_timezone text;
  _next_published_at timestamptz;
  _event_type text;
  _from_status text;
  _to_status text;
  _requested_file_ids uuid[] := ARRAY[]::uuid[];
  _locked_file public.files%ROWTYPE;
  _locked_file_count integer := 0;
  _reason text := NULLIF(btrim(p_failure_reason), '');
  _recovered boolean := false;
  _snapshot_extended boolean := false;
BEGIN
  IF _actor IS NULL
    OR p_action IS NULL
    OR p_action NOT IN (
      'schedule',
      'publish',
      'fail',
      'cancel',
      'reopen'
    ) THEN
    RAISE EXCEPTION 'invalid or unauthenticated publication transition';
  END IF;

  SELECT publication.post_id, publication.client_id
  INTO _lookup_post_id, _lookup_client_id
  FROM public.editorial_publications AS publication
  WHERE id = p_publication_id;
  IF NOT FOUND
    OR NOT public.editorial_can_publish_client(_lookup_client_id) THEN
    RAISE EXCEPTION 'publication not found or transition access denied';
  END IF;

  SELECT * INTO _post
  FROM public.editorial_posts
  WHERE id = _lookup_post_id
  FOR UPDATE;
  IF NOT FOUND
    OR _post.client_id IS DISTINCT FROM _lookup_client_id
    OR _post.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'editorial post is unavailable';
  END IF;

  SELECT * INTO _publication
  FROM public.editorial_publications
  WHERE id = p_publication_id
    AND post_id = _post.id
    AND client_id = _post.client_id
  FOR UPDATE;
  IF NOT FOUND
    OR NOT public.editorial_can_publish_client(_publication.client_id) THEN
    RAISE EXCEPTION 'publication not found or transition access denied';
  END IF;
  IF p_expected_version IS NULL THEN
    RAISE EXCEPTION 'publication expected version is required';
  END IF;
  _from_status := _publication.status;

  SELECT * INTO _internal
  FROM public.editorial_publication_internal
  WHERE publication_id = _publication.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'publication internal state is missing';
  END IF;

  SELECT * INTO _post_internal
  FROM public.editorial_post_internal
  WHERE post_id = _post.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'editorial post internal state is missing';
  END IF;

  _next_scheduled_at := COALESCE(p_scheduled_at, _publication.scheduled_at);
  _next_timezone :=
    COALESCE(NULLIF(p_timezone, ''), _publication.scheduled_timezone);
  _next_published_at := COALESCE(p_published_at, now());
  _effective_file_id :=
    COALESCE(_publication.file_id, _post.primary_file_id);

  IF p_action = 'schedule'
    AND _publication.status = 'scheduled'
    AND _publication.scheduled_at IS NOT DISTINCT FROM _next_scheduled_at
    AND _publication.scheduled_timezone = _next_timezone THEN
    _recovered := true;
  ELSIF p_action = 'publish'
    AND _publication.status = 'published'
    AND _publication.permalink IS NOT DISTINCT FROM
      NULLIF(btrim(p_permalink), '')
    AND _publication.external_post_id IS NOT DISTINCT FROM
      NULLIF(btrim(p_external_post_id), '')
    AND (
      p_published_at IS NULL
      OR _publication.published_at IS NOT DISTINCT FROM p_published_at
    ) THEN
    _recovered := true;
  ELSIF p_action = 'fail'
    AND _publication.status = 'failed'
    AND _internal.failure_code IS NOT DISTINCT FROM
      NULLIF(btrim(p_failure_code), '')
    AND _internal.failure_reason IS NOT DISTINCT FROM _reason THEN
    _recovered := true;
  ELSIF p_action = 'cancel'
    AND _publication.status = 'cancelled' THEN
    _recovered := true;
  ELSIF p_action = 'reopen'
    AND _publication.status = 'planned' THEN
    _recovered := true;
  ELSIF _publication.version <> p_expected_version THEN
    RAISE EXCEPTION 'publication changed; refresh before transitioning'
      USING ERRCODE = '40001';
  END IF;

  IF _recovered THEN
    RETURN jsonb_build_object(
      'publication_id', _publication.id,
      'status', _publication.status,
      'version', _publication.version,
      'recovered', true
    );
  END IF;

  IF p_action IN ('schedule', 'publish', 'reopen') THEN
    SELECT * INTO _project
    FROM public.projects
    WHERE id = _publication.project_id
      AND client_id = _publication.client_id
      AND deleted_at IS NULL
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'publication project is inactive or unavailable';
    END IF;

    SELECT * INTO _account
    FROM public.external_accounts
    WHERE id = _publication.external_account_id
      AND client_id = _publication.client_id
      AND status = 'active'
    FOR SHARE;
    IF NOT FOUND
      OR _account.platform <> _publication.platform THEN
      RAISE EXCEPTION 'publication account is inactive, changed or unlinked';
    END IF;

    PERFORM 1
    FROM public.project_external_accounts AS link
    WHERE link.project_id = _publication.project_id
      AND link.external_account_id = _publication.external_account_id
      AND link.client_id = _publication.client_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'publication account is inactive, changed or unlinked';
    END IF;
  END IF;

  IF p_action IN ('schedule', 'publish')
    OR (
      p_action = 'reopen'
      AND NOT _internal.included_in_approval_snapshot
    )
    OR (
      p_action = 'cancel'
      AND _internal.included_in_approval_snapshot
    ) THEN
    SELECT COALESCE(
      array_agg(requested.file_id ORDER BY requested.file_id),
      ARRAY[]::uuid[]
    )
    INTO _requested_file_ids
    FROM (
      SELECT DISTINCT file_id
      FROM unnest(
        ARRAY[_post.primary_file_id, _effective_file_id]
      ) AS file_ids(file_id)
      WHERE file_id IS NOT NULL
    ) AS requested;

    _locked_file_count := 0;
    FOR _locked_file IN
      SELECT file_row.*
      FROM public.files AS file_row
      WHERE file_row.id = ANY(_requested_file_ids)
      ORDER BY file_row.id
      FOR SHARE
    LOOP
      _locked_file_count := _locked_file_count + 1;
    END LOOP;

    IF _locked_file_count <> cardinality(_requested_file_ids) THEN
      RAISE EXCEPTION 'one or more publication files are unavailable';
    END IF;
  END IF;

  IF p_action IN ('schedule', 'publish')
    AND (
      _post.production_status <> 'ready'
      OR _post_internal.approval_fingerprint IS NULL
      OR _post_internal.approval_fingerprint IS DISTINCT FROM
        public.editorial_compute_approval_fingerprint(_post.id)
      OR NOT _internal.included_in_approval_snapshot
      OR NOT public.editorial_file_is_publishable(
        _post.primary_file_id,
        _publication.client_id,
        _publication.project_id
      )
      OR NOT public.editorial_file_is_publishable(
        _effective_file_id,
        _publication.client_id,
        _publication.project_id
      )
    ) THEN
    RAISE EXCEPTION 'publication requires ready content and approved immutable files';
  END IF;

  IF p_action IN ('schedule', 'publish')
    AND NOT EXISTS (
      SELECT 1 FROM pg_timezone_names WHERE name = _next_timezone
    ) THEN
    RAISE EXCEPTION 'invalid publication timezone';
  END IF;

  IF p_action = 'reopen'
    AND NOT _internal.included_in_approval_snapshot
    AND (
      cardinality(_requested_file_ids) = 0
      OR EXISTS (
        SELECT 1
        FROM unnest(_requested_file_ids) AS requested(file_id)
        WHERE NOT COALESCE(
          public.file_is_editable(requested.file_id),
          false
        )
      )
    ) THEN
    RAISE EXCEPTION 'this cancelled plan was not approved; create a revision';
  END IF;

  IF p_action = 'cancel'
    AND _internal.included_in_approval_snapshot THEN
    IF _post_internal.approval_fingerprint IS NULL
      OR _post_internal.approval_fingerprint IS DISTINCT FROM
        public.editorial_compute_approval_fingerprint(_post.id) THEN
      RAISE EXCEPTION 'editorial approval snapshot changed; refresh before cancelling';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM unnest(_requested_file_ids) AS requested(file_id)
      WHERE NOT COALESCE(
        public.file_is_editable(requested.file_id),
        false
      )
        AND NOT public.editorial_file_is_publishable(
          requested.file_id,
          _publication.client_id,
          _publication.project_id
        )
    ) THEN
      RAISE EXCEPTION 'cannot cancel a plan while its approval is in progress; create a revision';
    END IF;
  END IF;

  IF p_action = 'schedule' THEN
    IF _publication.status NOT IN (
      'planned',
      'scheduled',
      'failed'
    ) OR _next_scheduled_at IS NULL THEN
      RAISE EXCEPTION 'publication cannot be scheduled from its current state';
    END IF;
    IF _next_scheduled_at < now() - interval '5 minutes' THEN
      RAISE EXCEPTION 'scheduled time cannot be in the past';
    END IF;
    _event_type := CASE
      WHEN _publication.status = 'scheduled'
        THEN 'publication_rescheduled'
      ELSE 'publication_scheduled'
    END;
    _to_status := 'scheduled';

    UPDATE public.editorial_publications
    SET
      file_id = _effective_file_id,
      scheduled_at = _next_scheduled_at,
      scheduled_timezone = _next_timezone,
      status = 'scheduled',
      published_at = NULL,
      permalink = NULL,
      external_post_id = NULL
    WHERE id = _publication.id
    RETURNING * INTO _publication;

    UPDATE public.editorial_publication_internal
    SET
      failure_code = NULL,
      failure_reason = NULL,
      scheduled_by = _actor,
      updated_by = _actor
    WHERE publication_id = _publication.id;

  ELSIF p_action = 'publish' THEN
    IF _publication.status NOT IN ('planned', 'scheduled', 'failed')
      OR COALESCE(length(btrim(p_permalink)), 0) = 0
      OR btrim(p_permalink) !~* '^https?://[^[:space:]]+$' THEN
      RAISE EXCEPTION 'published confirmation requires a valid public URL';
    END IF;
    IF _next_scheduled_at IS NULL THEN
      _next_scheduled_at := _next_published_at;
    END IF;

    _event_type := 'publication_published';
    _to_status := 'published';

    UPDATE public.editorial_publications
    SET
      file_id = _effective_file_id,
      scheduled_at = _next_scheduled_at,
      scheduled_timezone = _next_timezone,
      status = 'published',
      published_at = _next_published_at,
      permalink = btrim(p_permalink),
      external_post_id = NULLIF(btrim(p_external_post_id), '')
    WHERE id = _publication.id
    RETURNING * INTO _publication;

    UPDATE public.editorial_publication_internal
    SET
      failure_code = NULL,
      failure_reason = NULL,
      attempt_count = attempt_count + 1,
      last_attempt_at = now(),
      published_by = _actor,
      updated_by = _actor
    WHERE publication_id = _publication.id;

  ELSIF p_action = 'fail' THEN
    IF _publication.status NOT IN ('scheduled', 'failed')
      OR COALESCE(length(_reason), 0) < 5 THEN
      RAISE EXCEPTION 'failed publication requires a reason';
    END IF;

    _event_type := 'publication_failed';
    _to_status := 'failed';

    UPDATE public.editorial_publications
    SET status = 'failed'
    WHERE id = _publication.id
    RETURNING * INTO _publication;

    UPDATE public.editorial_publication_internal
    SET
      failure_code = NULLIF(btrim(p_failure_code), ''),
      failure_reason = _reason,
      attempt_count = attempt_count + 1,
      last_attempt_at = now(),
      updated_by = _actor
    WHERE publication_id = _publication.id;

  ELSIF p_action = 'cancel' THEN
    IF _publication.status = 'published' THEN
      RAISE EXCEPTION 'published records cannot be cancelled';
    END IF;

    _event_type := 'publication_cancelled';
    _to_status := 'cancelled';

    UPDATE public.editorial_publications
    SET status = 'cancelled'
    WHERE id = _publication.id
    RETURNING * INTO _publication;

    UPDATE public.editorial_publication_internal
    SET
      included_in_approval_snapshot = false,
      failure_code = NULL,
      failure_reason = _reason,
      updated_by = _actor
    WHERE publication_id = _publication.id;

    UPDATE public.editorial_post_internal
    SET
      approval_fingerprint =
        public.editorial_compute_approval_fingerprint(_post.id),
      updated_by = _actor
    WHERE post_id = _post.id;

  ELSE
    IF _publication.status NOT IN ('failed', 'cancelled') THEN
      RAISE EXCEPTION 'only failed or cancelled publications can be reopened';
    END IF;

    _event_type := 'publication_reopened';
    _to_status := 'planned';
    _snapshot_extended :=
      NOT _internal.included_in_approval_snapshot;

    UPDATE public.editorial_publications
    SET
      status = 'planned',
      published_at = NULL,
      permalink = NULL,
      external_post_id = NULL
    WHERE id = _publication.id
    RETURNING * INTO _publication;

    UPDATE public.editorial_publication_internal
    SET
      included_in_approval_snapshot = true,
      failure_code = NULL,
      failure_reason = NULL,
      updated_by = _actor
    WHERE publication_id = _publication.id;

    IF _snapshot_extended THEN
      UPDATE public.editorial_post_internal
      SET
        approval_fingerprint =
          public.editorial_compute_approval_fingerprint(_post.id),
        updated_by = _actor
      WHERE post_id = _post.id;
    END IF;
  END IF;

  -- The editor sends the complete active publication collection. Advancing
  -- the parent CAS on every real transition prevents a stale editor from
  -- undoing a concurrent cancel/reopen/status change.
  UPDATE public.editorial_posts
  SET updated_at = now()
  WHERE id = _post.id
  RETURNING * INTO _post;

  INSERT INTO public.editorial_events (
    client_id,
    post_id,
    publication_id,
    actor_id,
    event_type,
    from_status,
    to_status,
    metadata
  ) VALUES (
    _publication.client_id,
    _publication.post_id,
    _publication.id,
    _actor,
    _event_type,
    _from_status,
    _to_status,
    jsonb_strip_nulls(
      jsonb_build_object(
        'scheduled_at', _publication.scheduled_at,
        'published_at', _publication.published_at,
        'permalink', _publication.permalink,
        'failure_code', NULLIF(btrim(p_failure_code), ''),
        'failure_reason', _reason,
        'approval_snapshot_extended', _snapshot_extended,
        'post_version', _post.version,
        'version', _publication.version
      )
    )
  );

  RETURN jsonb_build_object(
    'publication_id', _publication.id,
    'status', _publication.status,
    'version', _publication.version,
    'post_version', _post.version,
    'recovered', false
  );
END
$$;

CREATE OR REPLACE FUNCTION public.archive_editorial_post(
  p_post_id uuid,
  p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _actor uuid := auth.uid();
  _post public.editorial_posts%ROWTYPE;
  _cancelled record;
  _from_status text;
BEGIN
  SELECT * INTO _post
  FROM public.editorial_posts
  WHERE id = p_post_id
  FOR UPDATE;

  IF NOT FOUND
    OR _actor IS NULL
    OR NOT public.editorial_can_publish_client(_post.client_id) THEN
    RAISE EXCEPTION 'editorial post not found or archive access denied';
  END IF;
  IF p_expected_version IS NULL THEN
    RAISE EXCEPTION 'editorial post expected version is required';
  END IF;
  IF _post.version <> p_expected_version THEN
    IF _post.production_status = 'archived' THEN
      RETURN jsonb_build_object(
        'post_id', _post.id,
        'version', _post.version,
        'recovered', true
      );
    END IF;
    RAISE EXCEPTION 'editorial post changed; refresh before archiving'
      USING ERRCODE = '40001';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.editorial_publications
    WHERE post_id = _post.id
      AND status = 'scheduled'
  ) THEN
    RAISE EXCEPTION 'cancel scheduled publications before archiving';
  END IF;
  _from_status := _post.production_status;

  FOR _cancelled IN
    SELECT id, status
    FROM public.editorial_publications
    WHERE post_id = _post.id
      AND status IN ('planned', 'failed')
    FOR UPDATE
  LOOP
    UPDATE public.editorial_publications
    SET status = 'cancelled'
    WHERE id = _cancelled.id;

    INSERT INTO public.editorial_events (
      client_id,
      post_id,
      publication_id,
      actor_id,
      event_type,
      from_status,
      to_status,
      metadata
    ) VALUES (
      _post.client_id,
      _post.id,
      _cancelled.id,
      _actor,
      'publication_cancelled',
      _cancelled.status,
      'cancelled',
      jsonb_build_object('reason', 'post_archived')
    );
  END LOOP;

  UPDATE public.editorial_posts
  SET
    production_status = 'archived',
    archived_at = now()
  WHERE id = _post.id
  RETURNING * INTO _post;

  INSERT INTO public.editorial_events (
    client_id,
    post_id,
    actor_id,
    event_type,
    from_status,
    to_status,
    metadata
  ) VALUES (
    _post.client_id,
    _post.id,
    _actor,
    'post_archived',
    _from_status,
    'archived',
    jsonb_build_object('version', _post.version)
  );

  RETURN jsonb_build_object(
    'post_id', _post.id,
    'version', _post.version,
    'recovered', false
  );
END
$$;

REVOKE ALL ON FUNCTION public.save_editorial_post(jsonb, integer)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.transition_editorial_publication(
  uuid,
  text,
  integer,
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  timestamptz
) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.archive_editorial_post(uuid, integer)
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.save_editorial_post(jsonb, integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_editorial_publication(
  uuid,
  text,
  integer,
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  timestamptz
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_editorial_post(uuid, integer)
  TO authenticated;

-- --------------------------------------------------------------------------
-- 8. RLS e grants explícitos para a Data API
-- --------------------------------------------------------------------------
ALTER TABLE public.editorial_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.editorial_post_internal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.editorial_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.editorial_publication_internal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.editorial_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.editorial_posts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.editorial_post_internal FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.editorial_publications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.editorial_publication_internal
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.editorial_events FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.editorial_posts TO authenticated;
GRANT SELECT ON public.editorial_post_internal TO authenticated;
GRANT SELECT ON public.editorial_publications TO authenticated;
GRANT SELECT ON public.editorial_publication_internal TO authenticated;
GRANT SELECT ON public.editorial_events TO authenticated;

REVOKE ALL ON public.editorial_posts FROM service_role;
REVOKE ALL ON public.editorial_post_internal FROM service_role;
REVOKE ALL ON public.editorial_publications FROM service_role;
REVOKE ALL ON public.editorial_publication_internal FROM service_role;
REVOKE ALL ON public.editorial_events FROM service_role;

-- Nesta fase não há worker social. O service_role pode auditar, mas não pode
-- contornar CAS, double-gate ou histórico por escrita direta.
GRANT SELECT ON public.editorial_posts TO service_role;
GRANT SELECT ON public.editorial_post_internal TO service_role;
GRANT SELECT ON public.editorial_publications TO service_role;
GRANT SELECT ON public.editorial_publication_internal TO service_role;
GRANT SELECT ON public.editorial_events TO service_role;

CREATE POLICY editorial_posts_staff_select
ON public.editorial_posts
FOR SELECT TO authenticated
USING (public.editorial_staff_can_access_client(client_id));

CREATE POLICY editorial_posts_client_select
ON public.editorial_posts
FOR SELECT TO authenticated
USING (public.editorial_client_can_read_post(id));

CREATE POLICY editorial_post_internal_staff_select
ON public.editorial_post_internal
FOR SELECT TO authenticated
USING (public.editorial_staff_can_access_client(client_id));

CREATE POLICY editorial_publications_staff_select
ON public.editorial_publications
FOR SELECT TO authenticated
USING (public.editorial_staff_can_access_client(client_id));

CREATE POLICY editorial_publications_client_select
ON public.editorial_publications
FOR SELECT TO authenticated
USING (public.editorial_client_can_read_publication(id));

CREATE POLICY editorial_publication_internal_staff_select
ON public.editorial_publication_internal
FOR SELECT TO authenticated
USING (public.editorial_staff_can_access_client(client_id));

CREATE POLICY editorial_events_staff_select
ON public.editorial_events
FOR SELECT TO authenticated
USING (public.editorial_staff_can_access_client(client_id));

-- Realtime atualiza o calendário sem transformar o banco em fila de publicação.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'editorial_posts'
  ) THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.editorial_posts;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'editorial_publications'
  ) THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.editorial_publications;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'editorial_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.editorial_events;
  END IF;
END
$$;

COMMENT ON TABLE public.editorial_posts IS
  'Conteúdo editorial seguro para agência e cliente após liberação em Arquivos.';
COMMENT ON TABLE public.editorial_post_internal IS
  'Dados operacionais internos do conteúdo; nunca expostos ao cliente.';
COMMENT ON TABLE public.editorial_publications IS
  'Plano e resultado independente de publicação por conta/plataforma.';
COMMENT ON TABLE public.editorial_publication_internal IS
  'Idempotência, atores e falhas técnicas de publicação, somente equipe.';
COMMENT ON TABLE public.editorial_events IS
  'Histórico editorial append-only.';
COMMENT ON COLUMN public.editorial_post_internal.approval_fingerprint IS
  'SHA-256 canônico de mídia, copy e variações por plataforma.';
