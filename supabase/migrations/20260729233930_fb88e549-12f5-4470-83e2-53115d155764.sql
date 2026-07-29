BEGIN;

-- This migration keeps the public editorial RPC signature and the advisory
-- lock installed by 20260728235000_sync_editorial_tasks_bidirectionally.sql.
-- The existing editable-file implementation remains untouched. Only content
-- created from a file that completed the double gate is routed through the
-- private implementation below.

CREATE OR REPLACE FUNCTION public.editorial_file_is_publishable_media(
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
    FROM public.files AS root
    WHERE root.id = _file_id
      AND public.editorial_file_is_publishable(
        root.id,
        _client_id,
        _project_id
      )
      AND NOT (
        lower(COALESCE(root.mime_type, '')) = 'application/pdf'
        OR lower(COALESCE(root.mime_type, '')) IN (
          'application/msword',
          'application/vnd.ms-powerpoint',
          'application/vnd.ms-excel',
          'text/csv'
        )
        OR lower(COALESCE(root.mime_type, '')) LIKE
          'application/vnd.openxmlformats-officedocument.%'
        OR lower(COALESCE(root.mime_type, '')) LIKE
          'application/vnd.oasis.opendocument.%'
        OR lower(COALESCE(root.extension, '')) IN (
          'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx',
          'csv', 'odt', 'ods', 'odp'
        )
        OR lower(root.file_name) ~
          '\.(pdf|docx?|pptx?|xlsx?|csv|odt|ods|odp)([?#].*)?$'
        OR lower(COALESCE(root.file_type, '')) IN (
          'pdf',
          'application/pdf',
          'application/msword',
          'application/vnd.ms-powerpoint',
          'application/vnd.ms-excel',
          'document',
          'documento',
          'contract',
          'contrato',
          'report',
          'relatorio',
          'relatório',
          'office'
        )
      )
      AND (
        lower(COALESCE(root.mime_type, '')) LIKE 'image/%'
        OR lower(COALESCE(root.mime_type, '')) LIKE 'video/%'
        OR lower(COALESCE(root.extension, '')) IN (
          'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg',
          'bmp', 'mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi'
        )
        OR lower(root.file_name) ~
          '\.(jpe?g|png|gif|webp|avif|svg|bmp|mp4|webm|mov|m4v|mkv|avi)([?#].*)?$'
        OR lower(COALESCE(root.file_type, '')) IN (
          'image',
          'imagem',
          'photo',
          'foto',
          'video',
          'vídeo'
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.files AS child
        WHERE child.parent_file_id = root.id
          AND (
            child.client_id IS DISTINCT FROM root.client_id
            OR child.project_id IS DISTINCT FROM root.project_id
            OR child.archived_at IS NOT NULL
            OR COALESCE(child.status, 'ready') <> 'ready'
            OR child.agency_approval_status <> 'approved'
            OR child.visibility <> 'approval'
            OR child.approval_status <> 'none'
            OR COALESCE(child.requires_approval, false)
            OR child.locked_at IS NULL
            OR NOT (
              lower(COALESCE(child.mime_type, '')) LIKE 'image/%'
              OR lower(COALESCE(child.extension, '')) IN (
                'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg',
                'bmp'
              )
              OR lower(child.file_name) ~
                '\.(jpe?g|png|gif|webp|avif|svg|bmp)([?#].*)?$'
              OR lower(COALESCE(child.file_type, '')) IN (
                'image',
                'imagem',
                'photo',
                'foto'
              )
            )
          )
      )
  )
$$;

REVOKE ALL ON FUNCTION public.editorial_file_is_publishable_media(
  uuid,
  uuid,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_approved_editorial_post_unlocked(
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
  _canonical_payload jsonb;
  _canonical_publications jsonb := '[]'::jsonb;
  _canonical_title text;
  _canonical_objective text;
  _canonical_caption text;
  _canonical_content_type text;
  _post public.editorial_posts%ROWTYPE;
  _existing_post public.editorial_posts%ROWTYPE;
  _post_internal public.editorial_post_internal%ROWTYPE;
  _primary_file public.files%ROWTYPE;
  _account public.external_accounts%ROWTYPE;
  _publication public.editorial_publications%ROWTYPE;
  _existing_publication public.editorial_publications%ROWTYPE;
  _existing_publication_internal
    public.editorial_publication_internal%ROWTYPE;
  _publication_id uuid;
  _publication_idempotency_key uuid;
  _publication_fingerprint text;
  _scheduled_at timestamptz;
  _scheduled_timezone text;
  _plan jsonb;
  _canonical_plan jsonb;
  _seen_publications uuid[] := ARRAY[]::uuid[];
  _cancelled record;
  _scheduled record;
  _approval_fingerprint text;
  _is_new boolean := false;
  _recovered boolean := false;
  _has_schedule boolean := false;
BEGIN
  PERFORM public.editorial_lock_task_sync();

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

  IF _client_id IS NULL
    OR _project_id IS NULL
    OR _primary_file_id IS NULL
    OR _post_idempotency_key IS NULL
    OR _mutation_id IS NULL
    OR NOT public.editorial_staff_can_access_client(_client_id) THEN
    RAISE EXCEPTION 'editorial client access denied';
  END IF;
  IF NOT p_payload ? 'publications'
    OR jsonb_typeof(p_payload->'publications') <> 'array' THEN
    RAISE EXCEPTION 'the complete editorial publications array is required';
  END IF;

  PERFORM 1
  FROM public.projects AS project
  WHERE project.id = _project_id
    AND project.client_id = _client_id
    AND project.deleted_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'editorial project must be active and belong to the client';
  END IF;

  SELECT * INTO _primary_file
  FROM public.files AS file_row
  WHERE file_row.id = _primary_file_id
  FOR UPDATE;

  IF NOT FOUND
    OR NOT public.editorial_file_is_publishable_media(
      _primary_file_id,
      _client_id,
      _project_id
    )
    OR _primary_file.client_decided_at IS NULL THEN
    RAISE EXCEPTION 'approved editorial media is unavailable, unsupported or outside the project';
  END IF;

  _canonical_title := btrim(_primary_file.file_name);
  _canonical_objective :=
    NULLIF(btrim(_primary_file.description), '');
  _canonical_caption := NULLIF(btrim(_primary_file.caption), '');
  _canonical_content_type := CASE
    WHEN lower(COALESCE(_primary_file.mime_type, '')) LIKE 'video/%'
      OR lower(COALESCE(_primary_file.extension, '')) IN (
        'mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi'
      )
      OR lower(COALESCE(_primary_file.file_type, '')) IN (
        'video', 'vídeo'
      )
      THEN 'video'
    WHEN EXISTS (
      SELECT 1
      FROM public.files AS child
      WHERE child.parent_file_id = _primary_file.id
        AND child.archived_at IS NULL
        AND COALESCE(child.status, 'ready') = 'ready'
    )
      THEN 'carousel'
    ELSE 'static'
  END;

  IF length(_canonical_title) = 0 THEN
    RAISE EXCEPTION 'approved editorial media requires a name';
  END IF;

  SELECT COALESCE(
    jsonb_agg(canonical.plan ORDER BY canonical.ordinality),
    '[]'::jsonb
  )
  INTO _canonical_publications
  FROM (
    SELECT
      source.ordinality,
      jsonb_strip_nulls(
        jsonb_build_object(
          'id', NULLIF(source.value->>'id', ''),
          'external_account_id',
            NULLIF(source.value->>'external_account_id', ''),
          'file_id', _primary_file_id,
          'caption', _canonical_caption,
          'first_comment', NULL,
          'alt_text', NULL,
          'scheduled_at', NULLIF(source.value->>'scheduled_at', ''),
          'scheduled_timezone',
            COALESCE(
              NULLIF(source.value->>'scheduled_timezone', ''),
              'America/Sao_Paulo'
            ),
          'idempotency_key',
            NULLIF(source.value->>'idempotency_key', '')
        )
      ) AS plan
    FROM jsonb_array_elements(p_payload->'publications')
      WITH ORDINALITY AS source(value, ordinality)
  ) AS canonical;

  _canonical_payload := jsonb_strip_nulls(
    jsonb_build_object(
      'id', NULLIF(p_payload->>'id', ''),
      'client_id', _client_id,
      'project_id', _project_id,
      'primary_file_id', _primary_file_id,
      'task_id', _task_id,
      'responsible_id', _responsible_id,
      'revision_of_post_id', _revision_of_post_id,
      'idempotency_key', _post_idempotency_key,
      'mutation_id', _mutation_id,
      'title', _canonical_title,
      'content_type', _canonical_content_type,
      'objective', _canonical_objective,
      'default_caption', _canonical_caption,
      'production_status', 'ready',
      'internal_notes',
        NULLIF(btrim(p_payload->>'internal_notes'), ''),
      'publications', _canonical_publications
    )
  );
  _post_fingerprint :=
    encode(sha256(convert_to(_canonical_payload::text, 'UTF8')), 'hex');

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(_canonical_publications) AS plan(value)
    GROUP BY NULLIF(plan.value->>'external_account_id', '')::uuid
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'an editorial account can only appear once per post';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_payload->'publications') AS plan(value)
    WHERE NULLIF(plan.value->>'file_id', '')::uuid IS NOT NULL
      AND NULLIF(plan.value->>'file_id', '')::uuid
        IS DISTINCT FROM _primary_file_id
  ) THEN
    RAISE EXCEPTION 'approved editorial plans must keep the selected media';
  END IF;

  IF _post_id IS NULL THEN
    SELECT post.* INTO _existing_post
    FROM public.editorial_posts AS post
    JOIN public.editorial_post_internal AS internal
      ON internal.post_id = post.id
    WHERE internal.idempotency_key = _post_idempotency_key
    FOR UPDATE OF post;

    IF FOUND THEN
      SELECT * INTO _post_internal
      FROM public.editorial_post_internal
      WHERE post_id = _existing_post.id;

      IF _existing_post.client_id IS DISTINCT FROM _client_id
        OR _existing_post.project_id IS DISTINCT FROM _project_id
        OR _post_internal.request_fingerprint IS DISTINCT FROM
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
      OR _existing_post.primary_file_id IS DISTINCT FROM
        _primary_file_id
      OR NOT public.editorial_staff_can_access_client(
        _existing_post.client_id
      ) THEN
      RAISE EXCEPTION 'approved editorial post not found or access denied';
    END IF;

    SELECT * INTO _post_internal
    FROM public.editorial_post_internal
    WHERE post_id = _post_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'editorial post internal state is missing';
    END IF;
    IF _post_internal.last_mutation_id = _mutation_id THEN
      IF _post_internal.last_mutation_fingerprint
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
    IF _primary_file.client_decided_at > _existing_post.created_at THEN
      RAISE EXCEPTION 'the approved editorial snapshot is immutable; create a revision';
    END IF;
    IF _existing_post.title IS DISTINCT FROM _canonical_title
      OR _existing_post.objective IS DISTINCT FROM _canonical_objective
      OR _existing_post.default_caption IS DISTINCT FROM
        _canonical_caption
      OR _existing_post.content_type IS DISTINCT FROM
        _canonical_content_type
      OR _existing_post.production_status <> 'ready'
      OR _post_internal.approval_fingerprint IS NULL
      OR _post_internal.approval_fingerprint IS DISTINCT FROM
        public.editorial_compute_approval_fingerprint(_post_id) THEN
      RAISE EXCEPTION 'approved editorial copy is immutable; create a revision';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.editorial_publications AS publication
      WHERE publication.post_id = _post_id
        AND publication.status NOT IN (
          'planned',
          'scheduled',
          'cancelled'
        )
    ) THEN
      RAISE EXCEPTION 'failed or published publications cannot be edited';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.editorial_posts AS post
    WHERE post.primary_file_id = _primary_file_id
      AND post.id IS DISTINCT FROM _post_id
  ) OR EXISTS (
    SELECT 1
    FROM public.editorial_publications AS publication
    WHERE publication.file_id = _primary_file_id
      AND publication.post_id IS DISTINCT FROM _post_id
      AND publication.status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'approved editorial media is already linked to another content';
  END IF;

  IF _task_id IS NOT NULL
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
      _canonical_title,
      _canonical_content_type,
      _canonical_objective,
      _canonical_caption,
      'ready'
    )
    RETURNING * INTO _post;

    IF _primary_file.client_decided_at > _post.created_at THEN
      RAISE EXCEPTION 'approved media decision must predate editorial adoption';
    END IF;

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
      NULLIF(btrim(p_payload->>'internal_notes'), ''),
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
      'approved_media_adopted',
      'ready',
      jsonb_build_object(
        'project_id', _project_id,
        'primary_file_id', _primary_file_id,
        'file_client_decided_at', _primary_file.client_decided_at,
        'task_id', _task_id
      )
    );
  ELSE
    UPDATE public.editorial_posts
    SET
      title = _canonical_title,
      objective = _canonical_objective,
      default_caption = _canonical_caption,
      production_status = 'ready'
    WHERE id = _post_id
    RETURNING * INTO _post;

    UPDATE public.editorial_post_internal
    SET
      task_id = _task_id,
      responsible_id = _responsible_id,
      internal_notes =
        NULLIF(btrim(p_payload->>'internal_notes'), ''),
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
      'approved_media_plan_updated',
      'ready',
      'ready',
      jsonb_build_object(
        'version', _post.version,
        'primary_file_id', _primary_file_id
      )
    );
  END IF;

  FOR _plan IN
    SELECT value
    FROM jsonb_array_elements(_canonical_publications)
  LOOP
    _publication_id := NULLIF(_plan->>'id', '')::uuid;
    _publication_idempotency_key :=
      NULLIF(_plan->>'idempotency_key', '')::uuid;
    _scheduled_at := NULLIF(_plan->>'scheduled_at', '')::timestamptz;
    _scheduled_timezone :=
      COALESCE(
        NULLIF(_plan->>'scheduled_timezone', ''),
        'America/Sao_Paulo'
      );

    IF _publication_idempotency_key IS NULL
      OR NULLIF(_plan->>'external_account_id', '') IS NULL THEN
      RAISE EXCEPTION 'publication account and idempotency key are required';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_timezone_names
      WHERE name = _scheduled_timezone
    ) THEN
      RAISE EXCEPTION 'invalid publication timezone';
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
      OR NOT EXISTS (
        SELECT 1
        FROM public.project_external_accounts AS link
        WHERE link.project_id = _project_id
          AND link.external_account_id = _account.id
          AND link.client_id = _client_id
      ) THEN
      RAISE EXCEPTION 'publication account is inactive, unsupported or not linked to the project';
    END IF;

    _canonical_plan := jsonb_strip_nulls(
      jsonb_build_object(
        'id', _publication_id,
        'external_account_id', _account.id,
        'file_id', _primary_file_id,
        'caption', _canonical_caption,
        'first_comment', NULL,
        'alt_text', NULL,
        'scheduled_at', _scheduled_at,
        'scheduled_timezone', _scheduled_timezone,
        'idempotency_key', _publication_idempotency_key
      )
    );
    _publication_fingerprint :=
      encode(
        sha256(convert_to(_canonical_plan::text, 'UTF8')),
        'hex'
      );
    _existing_publication := NULL;
    _existing_publication_internal := NULL;
    _recovered := false;

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
        IF _existing_publication.status NOT IN ('planned', 'scheduled') THEN
          RAISE EXCEPTION 'publication plan is unavailable or immutable';
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
        OR _existing_publication.status NOT IN ('planned', 'scheduled') THEN
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
        _primary_file_id,
        _account.platform,
        _canonical_caption,
        NULL,
        NULL,
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
          'scheduled_at', _publication.scheduled_at,
          'approved_media', true
        )
      );
    ELSIF NOT _recovered THEN
      UPDATE public.editorial_publications
      SET
        external_account_id = _account.id,
        file_id = _primary_file_id,
        platform = _account.platform,
        caption = _canonical_caption,
        first_comment = NULL,
        alt_text = NULL,
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
        jsonb_build_object(
          'version', _publication.version,
          'approved_media', true
        )
      );
    END IF;

    _seen_publications :=
      array_append(_seen_publications, _publication_id);
  END LOOP;

  FOR _cancelled IN
    SELECT publication.id, publication.status
    FROM public.editorial_publications AS publication
    WHERE publication.post_id = _post_id
      AND publication.status IN ('planned', 'scheduled')
      AND (
        cardinality(_seen_publications) = 0
        OR publication.id <> ALL(_seen_publications)
      )
    FOR UPDATE
  LOOP
    UPDATE public.editorial_publications
    SET status = 'cancelled'
    WHERE id = _cancelled.id;

    UPDATE public.editorial_publication_internal
    SET
      included_in_approval_snapshot = false,
      failure_code = NULL,
      failure_reason = NULL,
      updated_by = _actor
    WHERE publication_id = _cancelled.id;

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
      jsonb_build_object('reason', 'removed_from_approved_media_plan')
    );
  END LOOP;

  _approval_fingerprint :=
    public.editorial_compute_approval_fingerprint(_post_id);

  UPDATE public.editorial_post_internal
  SET
    approval_fingerprint = _approval_fingerprint,
    updated_by = _actor
  WHERE post_id = _post_id;

  UPDATE public.editorial_publication_internal AS internal
  SET
    included_in_approval_snapshot =
      publication.status <> 'cancelled',
    updated_by = _actor
  FROM public.editorial_publications AS publication
  WHERE publication.post_id = _post_id
    AND internal.publication_id = publication.id;

  SELECT EXISTS (
    SELECT 1
    FROM public.editorial_publications AS publication
    WHERE publication.post_id = _post_id
      AND publication.status = 'planned'
      AND publication.scheduled_at IS NOT NULL
  )
  INTO _has_schedule;

  IF _has_schedule
    AND NOT public.editorial_can_publish_client(_client_id) THEN
    RAISE EXCEPTION 'only an assigned manager or admin can schedule approved media';
  END IF;

  FOR _scheduled IN
    SELECT
      publication.id,
      publication.version,
      publication.scheduled_at,
      publication.scheduled_timezone
    FROM public.editorial_publications AS publication
    WHERE publication.post_id = _post_id
      AND publication.status = 'planned'
      AND publication.scheduled_at IS NOT NULL
    ORDER BY publication.id
  LOOP
    PERFORM public.transition_editorial_publication_unlocked(
      _scheduled.id,
      'schedule',
      _scheduled.version,
      _scheduled.scheduled_at,
      _scheduled.scheduled_timezone
    );
  END LOOP;

  SELECT * INTO _post
  FROM public.editorial_posts
  WHERE id = _post_id;

  RETURN jsonb_build_object(
    'post_id', _post.id,
    'version', _post.version,
    'recovered', false
  );
END
$$;

REVOKE ALL ON FUNCTION public.save_approved_editorial_post_unlocked(
  jsonb,
  integer
) FROM PUBLIC, anon, authenticated, service_role;

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
BEGIN
  PERFORM public.editorial_lock_task_sync();

  IF jsonb_typeof(p_payload) = 'object' THEN
    _client_id := NULLIF(p_payload->>'client_id', '')::uuid;
    _project_id := NULLIF(p_payload->>'project_id', '')::uuid;
    _post_id := NULLIF(p_payload->>'id', '')::uuid;
    _primary_file_id :=
      NULLIF(p_payload->>'primary_file_id', '')::uuid;

    IF _primary_file_id IS NOT NULL
      AND public.editorial_file_is_publishable_media(
        _primary_file_id,
        _client_id,
        _project_id
      ) THEN
      IF _post_id IS NULL THEN
        RETURN public.save_approved_editorial_post_unlocked(
          p_payload,
          p_expected_version
        );
      END IF;

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
        RETURN public.save_approved_editorial_post_unlocked(
          p_payload,
          p_expected_version
        );
      END IF;
    END IF;
  END IF;

  RETURN public.save_editorial_post_unlocked(
    p_payload,
    p_expected_version
  );
END
$$;

REVOKE ALL ON FUNCTION public.save_editorial_post(jsonb, integer)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_editorial_post(jsonb, integer)
  TO authenticated;

-- A publication receipt is emitted only after the guarded transition records
-- its immutable published actor. This keeps the comment, notifications,
-- permalink and published state in the same database transaction.
CREATE OR REPLACE FUNCTION public.editorial_record_published_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _publication public.editorial_publications%ROWTYPE;
  _post public.editorial_posts%ROWTYPE;
  _task_id uuid;
  _task_assignee uuid;
  _comment text;
BEGIN
  IF NEW.published_by IS NULL
    OR NEW.published_by IS NOT DISTINCT FROM OLD.published_by THEN
    RETURN NEW;
  END IF;

  SELECT * INTO _publication
  FROM public.editorial_publications AS publication
  WHERE publication.id = NEW.publication_id
    AND publication.client_id = NEW.client_id
    AND publication.status = 'published'
    AND publication.permalink IS NOT NULL
    AND btrim(publication.permalink) ~* '^https?://[^[:space:]]+$';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'published receipt requires a confirmed public permalink';
  END IF;

  SELECT post.* INTO _post
  FROM public.editorial_posts AS post
  WHERE post.id = _publication.post_id
    AND post.client_id = _publication.client_id
    AND post.project_id = _publication.project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'published receipt post scope mismatch';
  END IF;

  SELECT internal.task_id
  INTO _task_id
  FROM public.editorial_post_internal AS internal
  WHERE internal.post_id = _post.id
    AND internal.client_id = _post.client_id;

  IF _task_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT task.assigned_to
  INTO _task_assignee
  FROM public.tasks AS task
  WHERE task.id = _task_id
    AND task.project_id = _post.project_id
    AND task.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'published receipt task scope mismatch';
  END IF;

  _comment := format(
    'Publicado em %s: %s',
    _publication.platform,
    btrim(_publication.permalink)
  );

  INSERT INTO public.task_comments (
    task_id,
    author_id,
    content
  ) VALUES (
    _task_id,
    NEW.published_by,
    _comment
  );

  INSERT INTO public.notifications (
    user_id,
    message,
    notification_type,
    link
  )
  SELECT DISTINCT
    recipient.user_id,
    format(
      'Conteúdo publicado em %s: %s',
      _publication.platform,
      _post.title
    ),
    'publication',
    '/kanban?task=' || _task_id::text
  FROM (
    SELECT _task_assignee AS user_id
    WHERE _task_assignee IS NOT NULL

    UNION

    SELECT role_row.user_id
    FROM public.user_roles AS role_row
    WHERE role_row.role = 'admin'::public.app_role

    UNION

    SELECT assignment.user_id
    FROM public.team_client_assignments AS assignment
    WHERE assignment.client_id = _publication.client_id
  ) AS recipient
  JOIN public.profiles AS profile
    ON profile.id = recipient.user_id
  WHERE recipient.user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_roles AS role_row
      WHERE role_row.user_id = recipient.user_id
        AND role_row.role IN (
          'admin'::public.app_role,
          'manager'::public.app_role,
          'design'::public.app_role,
          'traffic'::public.app_role
        )
    );

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.editorial_record_published_receipt()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS editorial_publication_published_receipt_trg
  ON public.editorial_publication_internal;
CREATE TRIGGER editorial_publication_published_receipt_trg
AFTER UPDATE OF published_by
ON public.editorial_publication_internal
FOR EACH ROW
WHEN (
  NEW.published_by IS NOT NULL
  AND NEW.published_by IS DISTINCT FROM OLD.published_by
)
EXECUTE FUNCTION public.editorial_record_published_receipt();

COMMIT;