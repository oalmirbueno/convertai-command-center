-- LOCAL ISOLATED DATABASE ONLY. No production rows are imported.
-- Bootstrap supplies roles and auth.uid(). Tables outside the editorial
-- contract are reduced to the columns used here. Core editorial tables and
-- gate/transition functions below are copied verbatim from canonical sources.
-- HTTP, Vault and OAuth credential retrieval are mocked explicitly at the end.
BEGIN;
DO $$ BEGIN
  IF current_setting('aceleriq.isolated_tests', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Publication fixture requires an explicitly isolated database';
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS social_private;
CREATE SCHEMA IF NOT EXISTS net;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_type WHERE typname='app_role' AND typnamespace='public'::regnamespace) THEN
    CREATE TYPE public.app_role AS ENUM('admin','manager','design','traffic','client');
  END IF;
END $$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY, deleted_at timestamptz);
CREATE TABLE public.user_roles(user_id uuid NOT NULL,role public.app_role NOT NULL,PRIMARY KEY(user_id,role));
CREATE TABLE public.team_client_assignments(user_id uuid NOT NULL,client_id uuid NOT NULL);
CREATE TABLE public.projects(id uuid PRIMARY KEY,client_id uuid NOT NULL,deleted_at timestamptz,UNIQUE(id,client_id));
CREATE TABLE public.tasks(id uuid PRIMARY KEY);
CREATE TABLE public.files(id uuid PRIMARY KEY,client_id uuid,project_id uuid,parent_file_id uuid,
  file_name text DEFAULT 'synthetic.png', file_url text DEFAULT 'https://invalid.example/synthetic.png',storage_path text,storage_bucket text DEFAULT 'files',
  sha256 text, mime_type text DEFAULT 'image/png',size_bytes bigint DEFAULT 12,
  archived_at timestamptz,status text DEFAULT 'ready',agency_approval_status text DEFAULT 'approved',
  visibility text DEFAULT 'client_shared',approval_status text DEFAULT 'none',locked_at timestamptz DEFAULT now(),
  client_decided_at timestamptz,created_at timestamptz DEFAULT now());
CREATE TABLE public.external_accounts(id uuid PRIMARY KEY,client_id uuid NOT NULL,platform text NOT NULL DEFAULT 'instagram',status text NOT NULL DEFAULT 'active',UNIQUE(id,client_id));
CREATE TABLE public.project_external_accounts(project_id uuid,external_account_id uuid,client_id uuid);
-- Canonical table: 20260728161129_create_editorial_calendar.sql
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
-- Canonical table: 20260728161129_create_editorial_calendar.sql
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
-- Canonical table: 20260728161129_create_editorial_calendar.sql
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
-- Canonical table: 20260728161129_create_editorial_calendar.sql
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
-- Canonical table: 20260728161129_create_editorial_calendar.sql
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
ALTER TABLE public.editorial_publications ADD COLUMN delivery_mode text NOT NULL DEFAULT 'manual';
-- Canonical table: 20260731175633_meta_oauth_foundation.sql
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
-- Canonical table: 20260731175633_meta_oauth_foundation.sql
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
-- Canonical table: 20260731175633_meta_oauth_foundation.sql
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
-- Canonical table: 20260812140000_editorial_autopublish_worker.sql
CREATE TABLE IF NOT EXISTS social_private.autopublish_settings (
  id boolean PRIMARY KEY DEFAULT true,
  enabled boolean NOT NULL DEFAULT false,
  graph_version text NOT NULL DEFAULT 'v21.0',
  storage_base_url text NOT NULL DEFAULT 'https://invalid.example',
  max_attempts smallint NOT NULL DEFAULT 3,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT autopublish_settings_singleton CHECK (id)
);
-- Canonical table: 20260812140000_editorial_autopublish_worker.sql
CREATE TABLE IF NOT EXISTS social_private.autopublish_jobs (
  publication_id uuid PRIMARY KEY,
  client_id uuid NOT NULL,
  stage text NOT NULL DEFAULT 'queued',
  attempts smallint NOT NULL DEFAULT 0,
  net_request_id bigint,
  child_urls text[] NOT NULL DEFAULT ARRAY[]::text[],
  child_container_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  container_id text,
  media_id text,
  permalink text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT autopublish_jobs_stage_check CHECK (
    stage IN ('queued', 'children', 'parent', 'publish', 'permalink', 'done', 'failed')
  )
);
ALTER TABLE social_private.autopublish_jobs
 ADD COLUMN child_index smallint NOT NULL DEFAULT 0,
 ADD COLUMN poll_count smallint NOT NULL DEFAULT 0,
 ADD COLUMN step_attempts smallint NOT NULL DEFAULT 0,
 ADD COLUMN publish_dispatched boolean NOT NULL DEFAULT false,
 ADD COLUMN child_request_ids bigint[] NOT NULL DEFAULT ARRAY[]::bigint[];
-- Canonical function: 20260720163307_ba44c9c5-a2a8-43ce-9493-c36a4a9c769d.sql
CREATE OR REPLACE FUNCTION public.has_role(
  _user_id uuid,
  _role public.app_role
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;
-- Canonical function: 20260720163307_ba44c9c5-a2a8-43ce-9493-c36a4a9c769d.sql
CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN (
        'admin'::public.app_role,
        'design'::public.app_role,
        'traffic'::public.app_role,
        'manager'::public.app_role
      )
  )
$$;
-- Canonical function: 20260724182933_75e9ef71-b40e-4d7f-9ad1-a82a03d6582a.sql
CREATE OR REPLACE FUNCTION public.can_access_client(_client_id uuid)
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
        public.has_role(auth.uid(), 'client'::public.app_role)
        AND auth.uid() = _client_id
      )
      OR (
        (
          public.has_role(auth.uid(), 'manager'::public.app_role)
          OR public.has_role(auth.uid(), 'design'::public.app_role)
          OR public.has_role(auth.uid(), 'traffic'::public.app_role)
        )
        AND EXISTS (
          SELECT 1 FROM public.team_client_assignments tca
          WHERE tca.user_id = auth.uid() AND tca.client_id = _client_id
        )
      )
    )
$$;
-- Canonical function: 20260728161129_create_editorial_calendar.sql
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
-- Canonical function: 20260814050000_client_shared_counts_as_approved.sql
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
      AND file_row.locked_at IS NOT NULL
      AND (
        (file_row.visibility = 'approval' AND file_row.approval_status = 'approved')
        OR file_row.visibility = 'client_shared'
      )
  )
$$;
-- Canonical function: 20260727132145_secure_file_approval_double_gate.sql
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
-- Canonical function: 20260731175633_meta_oauth_foundation.sql
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
-- Canonical function: 20260728235000_sync_editorial_tasks_bidirectionally.sql
CREATE OR REPLACE FUNCTION public.editorial_lock_task_sync()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('aceleriq.editorial-task-sync', 0)
  );
END
$$;
-- Canonical function: 20260728235000_sync_editorial_tasks_bidirectionally.sql
CREATE OR REPLACE FUNCTION public.editorial_lock_task_sync_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.editorial_lock_task_sync();
  RETURN NULL;
END
$$;
-- Canonical function: 20260728161129_create_editorial_calendar.sql
CREATE OR REPLACE FUNCTION public.transition_editorial_publication_unlocked(
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
-- Canonical function: 20260728235000_sync_editorial_tasks_bidirectionally.sql
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
BEGIN
  PERFORM public.editorial_lock_task_sync();
  RETURN public.transition_editorial_publication_unlocked(
    p_publication_id,
    p_action,
    p_expected_version,
    p_scheduled_at,
    p_timezone,
    p_permalink,
    p_external_post_id,
    p_failure_code,
    p_failure_reason,
    p_published_at
  );
END
$$;
CREATE TRIGGER editorial_publications_sync_lock_update_trg
 BEFORE UPDATE OF status ON public.editorial_publications FOR EACH STATEMENT EXECUTE FUNCTION public.editorial_lock_task_sync_trigger();
-- Canonical function: 20260812140000_editorial_autopublish_worker.sql
CREATE OR REPLACE FUNCTION social_private.autopublish_file_url(_file_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN file_row.file_url IS NOT NULL AND file_row.file_url LIKE 'http%'
      THEN file_row.file_url
    WHEN file_row.storage_path IS NOT NULL
      THEN (SELECT settings.storage_base_url FROM social_private.autopublish_settings AS settings WHERE settings.id)
        || '/storage/v1/object/public/'
        || COALESCE(file_row.storage_bucket, 'files')
        || '/' || file_row.storage_path
    ELSE NULL
  END
  FROM public.files AS file_row
  WHERE file_row.id = _file_id;
$function$;
-- Canonical function: 20260812140000_editorial_autopublish_worker.sql
CREATE OR REPLACE FUNCTION social_private.autopublish_urlencode(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT COALESCE(
    string_agg(
      CASE
        WHEN piece ~ '^[A-Za-z0-9_.~-]$' THEN piece
        ELSE upper('%' || encode(convert_to(piece, 'UTF8'), 'hex'))
      END,
      ''
    ),
    ''
  )
  FROM regexp_split_to_table(COALESCE(_value, ''), '') AS piece;
$function$;
-- Canonical function: 20260813210000_autopublish_v3_hardening.sql
CREATE OR REPLACE FUNCTION social_private.autopublish_mark_failed(
  _publication_id uuid,
  _reason text,
  _admin uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _version integer;
BEGIN
  UPDATE social_private.autopublish_jobs
  SET stage = 'failed',
      net_request_id = NULL,
      last_error = left(COALESCE(_reason, 'falha sem detalhe'), 500),
      updated_at = now()
  WHERE publication_id = _publication_id;

  -- Baixa oficial: acende o "Falhou" na agenda e o motivo no detalhe.
  -- Em bloco próprio: se não der, o job já está failed e o erro já está visível.
  IF _admin IS NOT NULL THEN
    BEGIN
      SELECT version INTO _version
      FROM public.editorial_publications
      WHERE id = _publication_id;

      PERFORM set_config(
        'request.jwt.claims',
        json_build_object('sub', _admin::text, 'role', 'authenticated')::text,
        true
      );
      PERFORM public.transition_editorial_publication(
        p_publication_id => _publication_id,
        p_action => 'fail',
        p_expected_version => _version,
        p_failure_code => 'autopublish',
        p_failure_reason => left(COALESCE(_reason, 'falha sem detalhe'), 500)
      );
    EXCEPTION WHEN OTHERS THEN
      UPDATE social_private.autopublish_jobs
      SET last_error = left(COALESCE(_reason, '') || ' | baixa oficial falhou: ' || SQLERRM, 500),
          updated_at = now()
      WHERE publication_id = _publication_id;
    END;
  END IF;
END;
$function$;
-- Canonical function: 20260813230000_autopublish_v4_signed_urls.sql
CREATE OR REPLACE FUNCTION social_private.autopublish_storage_paths(
  _publication_id uuid,
  _root_file_id uuid
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _paths text[];
BEGIN
  -- Ordem oficial: a lista congelada no agendamento.
  SELECT ARRAY(
    SELECT file_row.storage_path
    FROM social_private.editorial_publication_assets AS asset
    JOIN public.files AS file_row ON file_row.id = asset.file_id
    WHERE asset.publication_id = _publication_id
      AND file_row.storage_path IS NOT NULL
    ORDER BY asset.position
  )
  INTO _paths;

  IF _paths IS NOT NULL AND array_length(_paths, 1) >= 1 THEN
    RETURN _paths;
  END IF;

  -- Agendamento antigo sem lista congelada: capa + cartões pelo nome.
  SELECT ARRAY(
    SELECT path FROM (
      SELECT root_row.storage_path AS path, -1 AS order_index, NULL::timestamptz AS created_at
      FROM public.files AS root_row
      WHERE root_row.id = _root_file_id
      UNION ALL
      SELECT
        child.storage_path,
        COALESCE(
          NULLIF(substring(child.file_name FROM '(?i)(?:card|slide|p[aá]gina|page)[ ._-]*(\d+)'), '')::int,
          NULLIF(substring(child.file_name FROM '^(\d+)[ ._-]'), '')::int,
          32000
        ),
        child.created_at
      FROM public.files AS child
      WHERE child.parent_file_id = _root_file_id
        AND child.archived_at IS NULL
        AND COALESCE(child.status, 'ready') NOT IN ('deleted', 'failed')
    ) AS all_items
    WHERE path IS NOT NULL
    ORDER BY order_index, created_at NULLS LAST
  )
  INTO _paths;

  RETURN COALESCE(_paths, ARRAY[]::text[]);
END;
$function$;
-- Explicit network/secret dependency mocks. No real keys, queues or HTTP.
CREATE TABLE IF NOT EXISTS net._http_response(id bigint PRIMARY KEY,status_code integer,content text,timed_out boolean DEFAULT false,error_msg text);
CREATE TABLE net.publication_test_http(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,method text,url text,body jsonb,created_at timestamptz DEFAULT clock_timestamp());
CREATE OR REPLACE FUNCTION net.http_post(url text,body jsonb DEFAULT '{}'::jsonb,params jsonb DEFAULT '{}'::jsonb,headers jsonb DEFAULT '{}'::jsonb,timeout_milliseconds integer DEFAULT 2000)
RETURNS bigint LANGUAGE plpgsql AS $$ DECLARE req bigint; BEGIN
 INSERT INTO net.publication_test_http(method,url,body) VALUES('POST',url,body) RETURNING id INTO req; RETURN req;
END $$;
CREATE OR REPLACE FUNCTION net.http_get(url text,params jsonb DEFAULT '{}'::jsonb,headers jsonb DEFAULT '{}'::jsonb,timeout_milliseconds integer DEFAULT 2000)
RETURNS bigint LANGUAGE plpgsql AS $$ DECLARE req bigint; BEGIN
 INSERT INTO net.publication_test_http(method,url) VALUES('GET',url) RETURNING id INTO req; RETURN req;
END $$;
CREATE OR REPLACE FUNCTION social_private.autopublish_account_token(_external_account_id uuid)
RETURNS TABLE(resource_id text,access_token text) LANGUAGE sql STABLE AS $$ SELECT 'synthetic-account','synthetic-not-a-token' $$;
CREATE OR REPLACE FUNCTION social_private.autopublish_service_key() RETURNS text LANGUAGE sql AS $$ SELECT 'synthetic-not-a-key' $$;

-- Canonical function: 20260831020000_agendado_aprovado_vai_ao_ar.sql
create or replace function public.editorial_promover_planejados(
  _janela_de_atraso interval default interval '6 hours'
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  _pub record;
  _assets jsonb;
  _fingerprint text;
  _admin uuid;
  _quando timestamptz;
  _promovidos integer := 0;
  _ignorados integer := 0;
  _falhas jsonb := '[]'::jsonb;
begin
  -- A transicao oficial exige ator autenticado e o cron nao tem JWT. Mesmo
  -- padrao que editorial_autopublish_tick usa para dar a baixa: assume o
  -- admin, para o evento na trilha ter autor real em vez de nascer orfao.
  select user_id into _admin
    from public.user_roles
   where role = 'admin'::public.app_role
   order by user_id limit 1;

  if _admin is null then
    return jsonb_build_object('promovidos', 0, 'nao_promovidos', 0,
      'falhas', jsonb_build_array(jsonb_build_object(
        'erro', 'nenhum admin cadastrado: nao ha em nome de quem promover')),
      'em', now());
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', _admin::text, 'role', 'authenticated')::text, true);

  for _pub in
    select p.id, p.post_id, p.client_id, p.project_id, p.version, p.scheduled_at,
           coalesce(p.scheduled_timezone, 'America/Sao_Paulo') as tz,
           coalesce(p.delivery_mode, 'manual') as delivery_mode,
           po.title
      from public.editorial_publications p
      join public.editorial_posts po on po.id = p.post_id
     where p.status = 'planned'
       and p.scheduled_at is not null
       and p.external_account_id is not null
       and po.content_type in ('static', 'story', 'carousel', 'reel', 'video', 'short')
       -- A APROVACAO, em uma linha: a arte estar liberada ja significa que
       -- o admin subiu e, quando havia aprovacao de cliente, o cliente
       -- aprovou. Nao ha nada mais para conferir.
       and coalesce(public.editorial_file_is_publishable(
             coalesce(p.file_id, po.primary_file_id), p.client_id, p.project_id
           ), false)
       -- Atrasado demais nao entra sozinho: vira alarme, nao post.
       and p.scheduled_at >= now() - _janela_de_atraso
     order by p.scheduled_at
     limit 100
  loop
    begin
      -- A transicao recusa horario no passado. Sem esta linha a janela de
      -- atraso seria decorativa: um post que perdesse o minuto ficaria
      -- preso para sempre, porque o horario dele so envelhece. Recuperar
      -- um atrasado significa dar a ele um horario NOVO — e o original
      -- continua na trilha, no evento de criacao.
      _quando := greatest(_pub.scheduled_at, now() + interval '1 minute');

      -- O snapshot de entrega, que faltava. Sem ele, um save posterior
      -- volta a abortar com "delivery snapshot is unresolved" e a
      -- publicacao trava de novo pelo mesmo motivo.
      select coalesce(jsonb_agg(a.file_id::text order by a.position), '[]'::jsonb)
        into _assets
        from social_private.editorial_publication_assets a
       where a.publication_id = _pub.id;

      _fingerprint := encode(sha256(convert_to(jsonb_build_object(
        'delivery_mode', _pub.delivery_mode,
        'asset_file_ids', _assets,
        'scheduled_at', _quando,
        'scheduled_timezone', _pub.tz
      )::text, 'UTF8')), 'hex');

      insert into social_private.editorial_publication_delivery_requests
        (publication_id, client_id, request_fingerprint, delivery_mode, asset_count)
      values
        (_pub.id, _pub.client_id, _fingerprint, _pub.delivery_mode,
         jsonb_array_length(_assets))
      on conflict (publication_id) do nothing;

      -- CRIAR O SNAPSHOT MUDA A IMPRESSAO DE APROVACAO.
      --
      -- A funcao original de captura recalcula isto no fim, e diz por que:
      -- "recalculate inside the same transaction so scheduling and every
      -- later transition see the complete immutable approved version".
      -- Sem esta linha o post publica no Instagram e a BAIXA no painel
      -- falha com "requires ready content and approved immutable files" —
      -- post no ar, painel achando que nao saiu. Foi exatamente o que
      -- aconteceu na primeira tentativa desta correcao.
      update public.editorial_post_internal
         set approval_fingerprint = public.editorial_compute_approval_fingerprint(_pub.post_id),
             updated_by = coalesce(auth.uid(), updated_by)
       where post_id = _pub.post_id
         and approval_fingerprint is not null;

      -- A transicao OFICIAL: ela dispara os guards, grava o evento e
      -- mantem a versao. Escrever o status na mao pularia tudo isso.
      perform public.transition_editorial_publication_unlocked(
        _pub.id, 'schedule', _pub.version, _quando, _pub.tz
      );
      _promovidos := _promovidos + 1;
    exception when others then
      -- Uma publicacao que nao promove nao pode derrubar as outras. E a
      -- falha vai NOMEADA no retorno: promover em silencio e o defeito que
      -- estamos consertando.
      _ignorados := _ignorados + 1;
      _falhas := _falhas || jsonb_build_object(
        'publication_id', _pub.id, 'titulo', _pub.title, 'erro', sqlerrm
      );
    end;
  end loop;

  return jsonb_build_object(
    'promovidos', _promovidos,
    'nao_promovidos', _ignorados,
    'falhas', _falhas,
    'em', now()
  );
end;
$$;

-- Reusable synthetic factory for pgTAP and two-session dblink scenarios.
CREATE OR REPLACE FUNCTION public.publication_test_create(n integer,_stage text DEFAULT 'publish',_mode text DEFAULT 'manual',_delivery boolean DEFAULT true,_planned boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE p uuid:=md5('pub-'||n)::uuid; c uuid:=md5('client-'||n)::uuid; pr uuid:=md5('project-'||n)::uuid;
 po uuid:=md5('post-'||n)::uuid; f uuid:=md5('file-'||n)::uuid; a uuid:=md5('account-'||n)::uuid; actor uuid:=md5('publication-test-admin')::uuid;
BEGIN
 -- Retire earlier synthetic scenarios without deleting their audit evidence.
 UPDATE social_private.autopublish_jobs SET stage='done' WHERE stage NOT IN ('done','cancelled');
 INSERT INTO public.profiles(id) VALUES(actor),(c) ON CONFLICT DO NOTHING;
 INSERT INTO public.user_roles(user_id,role) VALUES(actor,'admin'),(c,'client') ON CONFLICT DO NOTHING;
 INSERT INTO public.projects(id,client_id) VALUES(pr,c);
 INSERT INTO public.files(id,client_id,project_id,sha256) VALUES(f,c,pr,repeat('a',64));
 INSERT INTO public.external_accounts(id,client_id) VALUES(a,c);
 INSERT INTO public.project_external_accounts VALUES(pr,a,c);
 INSERT INTO public.external_account_connections(external_account_id,client_id,connection_status,automation_enabled)
 VALUES(a,c,'connected',_mode='automatic');
 INSERT INTO public.editorial_posts(id,client_id,project_id,primary_file_id,title,content_type,production_status)
 VALUES(po,c,pr,f,'Synthetic publication','static','ready');
 INSERT INTO public.editorial_post_internal(post_id,client_id,idempotency_key,request_fingerprint,created_by,updated_by)
 VALUES(po,c,gen_random_uuid(),repeat('a',64),actor,actor);
 INSERT INTO public.editorial_publications(id,post_id,client_id,project_id,external_account_id,file_id,platform,scheduled_at,status,delivery_mode)
 VALUES(p,po,c,pr,a,f,'instagram',now()-interval '2 minutes',CASE WHEN _planned THEN 'planned' ELSE 'scheduled' END,_mode);
 INSERT INTO public.editorial_publication_internal(publication_id,client_id,idempotency_key,request_fingerprint,included_in_approval_snapshot,created_by,updated_by)
 VALUES(p,c,gen_random_uuid(),repeat('a',64),true,actor,actor);
 IF _delivery THEN
   INSERT INTO social_private.editorial_publication_assets(publication_id,client_id,root_file_id,position,file_id,sha256,mime_type,size_bytes)
   VALUES(p,c,f,1,f,repeat('a',64),'image/png',12);
   INSERT INTO social_private.editorial_publication_delivery_requests(publication_id,client_id,request_fingerprint,delivery_mode,asset_count)
   VALUES(p,c,repeat('b',64),_mode,1);
 END IF;
 UPDATE public.editorial_post_internal SET approval_fingerprint=public.editorial_compute_approval_fingerprint(po) WHERE post_id=po;
 INSERT INTO social_private.autopublish_settings(id,enabled) VALUES(true,true) ON CONFLICT(id) DO UPDATE SET enabled=true;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,false);
 IF NOT _planned THEN
   INSERT INTO social_private.autopublish_jobs(publication_id,client_id,stage) VALUES(p,c,'queued');
   -- Model preparation under the new gate, then select the desired scenario.
   PERFORM social_private.autopublish_assert_dispatch(p);
   UPDATE social_private.autopublish_jobs SET stage=_stage,container_id=CASE WHEN _stage='publish' THEN 'synthetic-container-'||n END WHERE publication_id=p;
 END IF;
 RETURN p;
END $$;

COMMIT;
