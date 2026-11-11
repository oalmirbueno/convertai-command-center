-- 11/11/2026: publicação cancelada de propósito não volta sozinha.
--
-- O save só reaproveita a linha cancelled quando o plano traz
-- reabrir_cancelada = true E editorial_can_publish_client (admin/gestor).
-- Sem a marca, o erro é explícito. A UNIQUE não muda.
--
-- O reopen limpa scheduled_at (o promotor não agenda a data antiga),
-- não estende a aprovação se o cancelamento não saiu de 'scheduled',
-- guarda o motivo no evento e não apaga failure_reason.
-- A Agenda reagenda numa função só, depois de validar o horário.

DO $mig$
DECLARE
  _def text;
  _novo text;
BEGIN
  -- 1) reopen: arte publicável também passa; data antiga sai; selo só se
  --    já estava agendada; motivo fica.
  _def := replace(
    pg_get_functiondef('public.transition_editorial_publication_unlocked(uuid,text,integer,timestamptz,text,text,text,text,text,timestamptz)'::regprocedure),
    E'\r\n', E'\n'
  );
  _novo := replace(
    _def,
    $a$IF p_action = 'reopen' AND NOT _internal.included_in_approval_snapshot AND (cardinality(_requested_file_ids) = 0 OR EXISTS (SELECT 1 FROM unnest(_requested_file_ids) AS requested(file_id) WHERE NOT COALESCE(public.file_is_editable(requested.file_id), false))) THEN
    RAISE EXCEPTION 'this cancelled plan was not approved; create a revision';$a$,
    $b$IF p_action = 'reopen' AND NOT _internal.included_in_approval_snapshot AND (cardinality(_requested_file_ids) = 0 OR EXISTS (SELECT 1 FROM unnest(_requested_file_ids) AS requested(file_id) WHERE NOT COALESCE(public.file_is_editable(requested.file_id), false) AND NOT COALESCE(public.editorial_file_is_publishable_media(requested.file_id, _publication.client_id, _publication.project_id), false))) THEN
    RAISE EXCEPTION 'this cancelled plan was not approved; create a revision';$b$
  );
  IF _novo = _def THEN
    RAISE EXCEPTION 'reopen publicavel: trecho nao encontrado';
  END IF;
  _def := _novo;
  _novo := replace(
    _def,
    $a$    IF _publication.status NOT IN ('failed', 'cancelled') THEN RAISE EXCEPTION 'only failed or cancelled publications can be reopened'; END IF;
    _event_type := 'publication_reopened'; _to_status := 'planned';
    _snapshot_extended := NOT _internal.included_in_approval_snapshot;
    UPDATE public.editorial_publications SET status = 'planned', published_at = NULL, permalink = NULL, external_post_id = NULL WHERE id = _publication.id RETURNING * INTO _publication;
    UPDATE public.editorial_publication_internal SET included_in_approval_snapshot = true, failure_code = NULL, failure_reason = NULL, updated_by = _actor WHERE publication_id = _publication.id;
    IF _snapshot_extended THEN
      UPDATE public.editorial_post_internal SET approval_fingerprint = public.editorial_compute_approval_fingerprint(_post.id), updated_by = _actor WHERE post_id = _post.id;
    END IF;$a$,
    $b$    IF _publication.status NOT IN ('failed', 'cancelled') THEN RAISE EXCEPTION 'only failed or cancelled publications can be reopened'; END IF;
    _event_type := 'publication_reopened'; _to_status := 'planned';
    -- Não estende a aprovação: o selo só volta se o cancelamento saiu de
    -- uma publicação já agendada. A data antiga sai. O motivo fica na linha
    -- e no evento (failure_reason não é zerado).
    _snapshot_extended := false;
    _reason := COALESCE(_reason, _internal.failure_reason);
    UPDATE public.editorial_publications SET status = 'planned', scheduled_at = NULL, published_at = NULL, permalink = NULL, external_post_id = NULL WHERE id = _publication.id RETURNING * INTO _publication;
    UPDATE public.editorial_publication_internal SET
      included_in_approval_snapshot = CASE
        WHEN EXISTS (
          SELECT 1 FROM public.editorial_events AS ev
          WHERE ev.publication_id = _publication.id
            AND ev.event_type = 'publication_cancelled'
            AND ev.from_status = 'scheduled'
            AND ev.created_at = (
              SELECT max(ev2.created_at) FROM public.editorial_events AS ev2
              WHERE ev2.publication_id = _publication.id
                AND ev2.event_type = 'publication_cancelled'
            )
        ) THEN true
        ELSE included_in_approval_snapshot
      END,
      updated_by = _actor
    WHERE publication_id = _publication.id;
    IF _snapshot_extended THEN
      UPDATE public.editorial_post_internal SET approval_fingerprint = public.editorial_compute_approval_fingerprint(_post.id), updated_by = _actor WHERE post_id = _post.id;
    END IF;$b$
  );
  IF _novo = _def THEN
    RAISE EXCEPTION 'reopen limpa data: trecho nao encontrado';
  END IF;
  EXECUTE _novo;

  -- 2) Save comum: cancelada não volta sem marca e sem admin/gestor.
  _def := replace(pg_get_functiondef('public.save_editorial_post_unlocked(jsonb,integer)'::regprocedure), E'\r\n', E'\n');
  _novo := replace(
    _def,
    $a$      IF NOT FOUND
        OR _existing_publication.post_id IS DISTINCT FROM _post_id
        OR _existing_publication.status <> 'planned' THEN
        RAISE EXCEPTION 'publication plan is unavailable or immutable';$a$,
    $b$      IF NOT FOUND
        OR _existing_publication.post_id IS DISTINCT FROM _post_id
        OR (
          _existing_publication.status <> 'planned'
          AND NOT (
            _existing_publication.status = 'cancelled'
            AND COALESCE(_plan->>'reabrir_cancelada', '') = 'true'
            AND public.editorial_can_publish_client(_client_id)
          )
        ) THEN
        IF _existing_publication.id IS NOT NULL AND _existing_publication.status = 'cancelled' THEN
          RAISE EXCEPTION 'cancelled publication stays cancelled until an admin or manager reopens it';
        END IF;
        RAISE EXCEPTION 'publication plan is unavailable or immutable';$b$
  );
  IF _novo = _def THEN
    RAISE EXCEPTION 'comum id: trecho nao encontrado';
  END IF;
  _def := _novo;
  _novo := replace(
    _def,
    $a$    IF NOT _recovered AND _existing_publication.id IS NULL THEN
      INSERT INTO public.editorial_publications ($a$,
    $b$    IF NOT _recovered AND _existing_publication.id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.editorial_publications AS cancelled_row
        WHERE cancelled_row.post_id = _post_id
          AND cancelled_row.external_account_id = _account.id
          AND cancelled_row.status = 'cancelled'
      ) THEN
      IF COALESCE(_plan->>'reabrir_cancelada', '') IS DISTINCT FROM 'true'
        OR NOT public.editorial_can_publish_client(_client_id) THEN
        RAISE EXCEPTION 'cancelled publication stays cancelled until an admin or manager reopens it';
      END IF;
      SELECT publication.* INTO _existing_publication
      FROM public.editorial_publications AS publication
      WHERE publication.post_id = _post_id
        AND publication.external_account_id = _account.id
        AND publication.status = 'cancelled'
      FOR UPDATE OF publication;
      IF FOUND THEN
        _publication_id := _existing_publication.id;
      END IF;
    END IF;

    IF NOT _recovered AND _existing_publication.id IS NULL THEN
      INSERT INTO public.editorial_publications ($b$
  );
  IF _novo = _def THEN
    RAISE EXCEPTION 'comum insert: trecho nao encontrado';
  END IF;
  _def := _novo;
  _novo := replace(
    _def,
    $a$        failure_code = NULL,
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
      );$a$,
    $b$        failure_code = CASE WHEN _existing_publication.status = 'cancelled' THEN failure_code ELSE NULL END,
        failure_reason = CASE WHEN _existing_publication.status = 'cancelled' THEN failure_reason ELSE NULL END,
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
        CASE WHEN _existing_publication.status = 'cancelled' THEN 'publication_reopened' ELSE 'publication_updated' END,
        _existing_publication.status,
        'planned',
        jsonb_build_object(
          'version', _publication.version,
          'failure_reason', CASE WHEN _existing_publication.status = 'cancelled' THEN (
            SELECT internal.failure_reason
            FROM public.editorial_publication_internal AS internal
            WHERE internal.publication_id = _publication_id
          ) ELSE NULL END,
          'reabrir_cancelada', CASE WHEN _existing_publication.status = 'cancelled' THEN true ELSE NULL END
        )
      );$b$
  );
  IF _novo = _def THEN
    RAISE EXCEPTION 'comum evento: trecho nao encontrado';
  END IF;
  EXECUTE _novo;

  -- 3) Save aprovado: a mesma trava da marca explícita.
  _def := replace(pg_get_functiondef('public.save_approved_editorial_post_unlocked(jsonb,integer)'::regprocedure), E'\r\n', E'\n');
  _novo := replace(
    _def,
    $a$      IF NOT FOUND
        OR _existing_publication.post_id IS DISTINCT FROM _post_id
        OR _existing_publication.status NOT IN ('planned', 'scheduled') THEN
        RAISE EXCEPTION 'publication plan is unavailable or immutable';$a$,
    $b$      IF NOT FOUND
        OR _existing_publication.post_id IS DISTINCT FROM _post_id
        OR (
          _existing_publication.status NOT IN ('planned', 'scheduled')
          AND NOT (
            _existing_publication.status = 'cancelled'
            AND COALESCE(_plan->>'reabrir_cancelada', '') = 'true'
            AND public.editorial_can_publish_client(_client_id)
          )
        ) THEN
        IF _existing_publication.id IS NOT NULL AND _existing_publication.status = 'cancelled' THEN
          RAISE EXCEPTION 'cancelled publication stays cancelled until an admin or manager reopens it';
        END IF;
        RAISE EXCEPTION 'publication plan is unavailable or immutable';$b$
  );
  IF _novo = _def THEN
    RAISE EXCEPTION 'aprovado id: trecho nao encontrado';
  END IF;
  _def := _novo;
  _novo := replace(
    _def,
    $a$    IF NOT _recovered AND _existing_publication.id IS NULL THEN
      INSERT INTO public.editorial_publications ($a$,
    $b$    IF NOT _recovered AND _existing_publication.id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.editorial_publications AS cancelled_row
        WHERE cancelled_row.post_id = _post_id
          AND cancelled_row.external_account_id = _account.id
          AND cancelled_row.status = 'cancelled'
      ) THEN
      IF COALESCE(_plan->>'reabrir_cancelada', '') IS DISTINCT FROM 'true'
        OR NOT public.editorial_can_publish_client(_client_id) THEN
        RAISE EXCEPTION 'cancelled publication stays cancelled until an admin or manager reopens it';
      END IF;
      SELECT publication.* INTO _existing_publication
      FROM public.editorial_publications AS publication
      WHERE publication.post_id = _post_id
        AND publication.external_account_id = _account.id
        AND publication.status = 'cancelled'
      FOR UPDATE OF publication;
      IF FOUND THEN
        _publication_id := _existing_publication.id;
      END IF;
    END IF;

    IF NOT _recovered AND _existing_publication.id IS NULL THEN
      INSERT INTO public.editorial_publications ($b$
  );
  IF _novo = _def THEN
    RAISE EXCEPTION 'aprovado insert: trecho nao encontrado';
  END IF;
  _def := _novo;
  _novo := replace(
    _def,
    $a$        failure_code = NULL,
        failure_reason = NULL,
        updated_by = _actor
      WHERE publication_id = _publication_id;$a$,
    $b$        failure_code = CASE WHEN _existing_publication.status = 'cancelled' THEN failure_code ELSE NULL END,
        failure_reason = CASE WHEN _existing_publication.status = 'cancelled' THEN failure_reason ELSE NULL END,
        updated_by = _actor
      WHERE publication_id = _publication_id;$b$
  );
  IF _novo = _def THEN
    RAISE EXCEPTION 'aprovado motivo: trecho nao encontrado';
  END IF;
  _def := _novo;
  _novo := replace(
    _def,
    $a$        _actor,
        'publication_updated',
        _existing_publication.status,$a$,
    $b$        _actor,
        CASE WHEN _existing_publication.status = 'cancelled' THEN 'publication_reopened' ELSE 'publication_updated' END,
        _existing_publication.status,$b$
  );
  IF _novo = _def THEN
    RAISE EXCEPTION 'aprovado evento: trecho nao encontrado';
  END IF;
  EXECUTE _novo;

  EXECUTE $func$
CREATE OR REPLACE FUNCTION public.reagendar_publicacao_cancelada(
  p_publication_id uuid,
  p_expected_post_version integer,
  p_scheduled_at timestamptz,
  p_timezone text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _actor uuid := auth.uid();
  _pub public.editorial_publications%ROWTYPE;
  _post public.editorial_posts%ROWTYPE;
  _file uuid;
  _agenda jsonb;
  _versao integer;
BEGIN
  IF p_scheduled_at IS NULL OR p_scheduled_at < now() - interval '5 minutes' THEN
    RAISE EXCEPTION 'scheduled time cannot be in the past';
  END IF;
  IF p_timezone IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_timezone) THEN
    RAISE EXCEPTION 'invalid publication timezone';
  END IF;

  SELECT * INTO _pub
  FROM public.editorial_publications
  WHERE id = p_publication_id
  FOR UPDATE;
  IF NOT FOUND OR _pub.status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'only a cancelled publication can be rescheduled here';
  END IF;
  IF _actor IS NULL OR NOT public.editorial_can_publish_client(_pub.client_id) THEN
    RAISE EXCEPTION 'only an assigned manager or admin can reopen a cancelled publication';
  END IF;

  SELECT * INTO _post
  FROM public.editorial_posts
  WHERE id = _pub.post_id
  FOR UPDATE;
  IF NOT FOUND OR _post.archived_at IS NOT NULL OR _post.client_id IS DISTINCT FROM _pub.client_id THEN
    RAISE EXCEPTION 'editorial post is unavailable';
  END IF;
  IF p_expected_post_version IS NULL OR _post.version IS DISTINCT FROM p_expected_post_version THEN
    RAISE EXCEPTION 'editorial post changed; refresh before saving' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.transition_editorial_publication_unlocked(
    _pub.id, 'reopen', _pub.version,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL
  );

  _file := COALESCE(_pub.file_id, _post.primary_file_id);
  IF public.editorial_file_is_publishable_media(_file, _pub.client_id, _pub.project_id)
    AND public.editorial_file_is_publishable_media(_post.primary_file_id, _pub.client_id, _pub.project_id) THEN
    UPDATE public.editorial_publication_internal
    SET included_in_approval_snapshot = true, updated_by = _actor
    WHERE publication_id = _pub.id;
    UPDATE public.editorial_post_internal
    SET approval_fingerprint = public.editorial_compute_approval_fingerprint(_post.id), updated_by = _actor
    WHERE post_id = _post.id;
  END IF;

  SELECT version INTO _versao
  FROM public.editorial_publications
  WHERE id = _pub.id;

  _agenda := public.transition_editorial_publication_unlocked(
    _pub.id, 'schedule', _versao,
    p_scheduled_at, p_timezone,
    NULL, NULL, NULL, NULL, NULL
  );

  SELECT version INTO _post.version
  FROM public.editorial_posts
  WHERE id = _post.id;

  RETURN jsonb_build_object(
    'publication_id', _pub.id,
    'status', _agenda->>'status',
    'version', (_agenda->>'version')::integer,
    'post_version', _post.version
  );
END
$body$
$func$;

  EXECUTE 'REVOKE ALL ON FUNCTION public.reagendar_publicacao_cancelada(uuid, integer, timestamptz, text) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.reagendar_publicacao_cancelada(uuid, integer, timestamptz, text) TO authenticated';
END
$mig$;
