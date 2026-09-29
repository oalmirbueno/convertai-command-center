-- 28/09: reagendar (e o envio automático) não pode travar depois do primeiro
-- agendamento. Ver o comentário dentro do ramo 'schedule'.

CREATE OR REPLACE FUNCTION public.transition_editorial_publication_unlocked(p_publication_id uuid, p_action text, p_expected_version integer, p_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_timezone text DEFAULT NULL::text, p_permalink text DEFAULT NULL::text, p_external_post_id text DEFAULT NULL::text, p_failure_code text DEFAULT NULL::text, p_failure_reason text DEFAULT NULL::text, p_published_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _actor uuid := auth.uid();
  _publication public.editorial_publications%ROWTYPE; _post public.editorial_posts%ROWTYPE;
  _post_internal public.editorial_post_internal%ROWTYPE; _internal public.editorial_publication_internal%ROWTYPE;
  _account public.external_accounts%ROWTYPE; _project public.projects%ROWTYPE;
  _lookup_post_id uuid; _lookup_client_id uuid; _effective_file_id uuid;
  _next_scheduled_at timestamptz; _next_timezone text; _next_published_at timestamptz;
  _event_type text; _from_status text; _to_status text;
  _requested_file_ids uuid[] := ARRAY[]::uuid[]; _locked_file public.files%ROWTYPE; _locked_file_count integer := 0;
  _reason text := NULLIF(btrim(p_failure_reason), ''); _recovered boolean := false; _snapshot_extended boolean := false;
BEGIN
  IF _actor IS NULL OR p_action IS NULL OR p_action NOT IN ('schedule','publish','fail','cancel','reopen') THEN RAISE EXCEPTION 'invalid or unauthenticated publication transition'; END IF;
  SELECT publication.post_id, publication.client_id INTO _lookup_post_id, _lookup_client_id FROM public.editorial_publications AS publication WHERE id = p_publication_id;
  IF NOT FOUND OR NOT public.editorial_can_publish_client(_lookup_client_id) THEN RAISE EXCEPTION 'publication not found or transition access denied'; END IF;
  SELECT * INTO _post FROM public.editorial_posts WHERE id = _lookup_post_id FOR UPDATE;
  IF NOT FOUND OR _post.client_id IS DISTINCT FROM _lookup_client_id OR _post.archived_at IS NOT NULL THEN RAISE EXCEPTION 'editorial post is unavailable'; END IF;
  SELECT * INTO _publication FROM public.editorial_publications WHERE id = p_publication_id AND post_id = _post.id AND client_id = _post.client_id FOR UPDATE;
  IF NOT FOUND OR NOT public.editorial_can_publish_client(_publication.client_id) THEN RAISE EXCEPTION 'publication not found or transition access denied'; END IF;
  IF p_expected_version IS NULL THEN RAISE EXCEPTION 'publication expected version is required'; END IF;
  _from_status := _publication.status;
  SELECT * INTO _internal FROM public.editorial_publication_internal WHERE publication_id = _publication.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'publication internal state is missing'; END IF;
  SELECT * INTO _post_internal FROM public.editorial_post_internal WHERE post_id = _post.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'editorial post internal state is missing'; END IF;
  _next_scheduled_at := COALESCE(p_scheduled_at, _publication.scheduled_at);
  _next_timezone := COALESCE(NULLIF(p_timezone, ''), _publication.scheduled_timezone);
  _next_published_at := COALESCE(p_published_at, now());
  _effective_file_id := COALESCE(_publication.file_id, _post.primary_file_id);
  IF p_action = 'schedule' AND _publication.status = 'scheduled' AND _publication.scheduled_at IS NOT DISTINCT FROM _next_scheduled_at AND _publication.scheduled_timezone = _next_timezone THEN _recovered := true;
  ELSIF p_action = 'publish' AND _publication.status = 'published' AND _publication.permalink IS NOT DISTINCT FROM NULLIF(btrim(p_permalink), '') AND _publication.external_post_id IS NOT DISTINCT FROM NULLIF(btrim(p_external_post_id), '') AND (p_published_at IS NULL OR _publication.published_at IS NOT DISTINCT FROM p_published_at) THEN _recovered := true;
  ELSIF p_action = 'fail' AND _publication.status = 'failed' AND _internal.failure_code IS NOT DISTINCT FROM NULLIF(btrim(p_failure_code), '') AND _internal.failure_reason IS NOT DISTINCT FROM _reason THEN _recovered := true;
  ELSIF p_action = 'cancel' AND _publication.status = 'cancelled' THEN _recovered := true;
  ELSIF p_action = 'reopen' AND _publication.status = 'planned' THEN _recovered := true;
  ELSIF _publication.version <> p_expected_version THEN RAISE EXCEPTION 'publication changed; refresh before transitioning' USING ERRCODE = '40001';
  END IF;
  IF _recovered THEN RETURN jsonb_build_object('publication_id', _publication.id, 'status', _publication.status, 'version', _publication.version, 'recovered', true); END IF;
  IF p_action IN ('schedule', 'publish', 'reopen') THEN
    SELECT * INTO _project FROM public.projects WHERE id = _publication.project_id AND client_id = _publication.client_id AND deleted_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'publication project is inactive or unavailable'; END IF;
    SELECT * INTO _account FROM public.external_accounts WHERE id = _publication.external_account_id AND client_id = _publication.client_id AND status = 'active' FOR SHARE;
    IF NOT FOUND OR _account.platform <> _publication.platform THEN RAISE EXCEPTION 'publication account is inactive, changed or unlinked'; END IF;
    PERFORM 1 FROM public.project_external_accounts AS link WHERE link.project_id = _publication.project_id AND link.external_account_id = _publication.external_account_id AND link.client_id = _publication.client_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'publication account is inactive, changed or unlinked'; END IF;
  END IF;
  IF p_action IN ('schedule', 'publish') OR (p_action = 'reopen' AND NOT _internal.included_in_approval_snapshot) OR (p_action = 'cancel' AND _internal.included_in_approval_snapshot) THEN
    SELECT COALESCE(array_agg(requested.file_id ORDER BY requested.file_id), ARRAY[]::uuid[]) INTO _requested_file_ids
    FROM (SELECT DISTINCT file_id FROM unnest(ARRAY[_post.primary_file_id, _effective_file_id]) AS file_ids(file_id) WHERE file_id IS NOT NULL) AS requested;
    _locked_file_count := 0;
    FOR _locked_file IN SELECT file_row.* FROM public.files AS file_row WHERE file_row.id = ANY(_requested_file_ids) ORDER BY file_row.id FOR SHARE LOOP
      _locked_file_count := _locked_file_count + 1;
    END LOOP;
    IF _locked_file_count <> cardinality(_requested_file_ids) THEN RAISE EXCEPTION 'one or more publication files are unavailable'; END IF;
  END IF;
  IF p_action IN ('schedule', 'publish') AND (_post.production_status <> 'ready' OR _post_internal.approval_fingerprint IS NULL OR _post_internal.approval_fingerprint IS DISTINCT FROM public.editorial_compute_approval_fingerprint(_post.id) OR NOT _internal.included_in_approval_snapshot OR NOT public.editorial_file_is_publishable_media(_post.primary_file_id, _publication.client_id, _publication.project_id) OR NOT public.editorial_file_is_publishable_media(_effective_file_id, _publication.client_id, _publication.project_id)) THEN
    RAISE EXCEPTION 'publication requires ready content and approved immutable files';
  END IF;
  IF p_action IN ('schedule', 'publish') AND NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = _next_timezone) THEN RAISE EXCEPTION 'invalid publication timezone'; END IF;
  IF p_action = 'reopen' AND NOT _internal.included_in_approval_snapshot AND (cardinality(_requested_file_ids) = 0 OR EXISTS (SELECT 1 FROM unnest(_requested_file_ids) AS requested(file_id) WHERE NOT COALESCE(public.file_is_editable(requested.file_id), false))) THEN
    RAISE EXCEPTION 'this cancelled plan was not approved; create a revision';
  END IF;
  IF p_action = 'cancel' AND _internal.included_in_approval_snapshot THEN
    IF _post_internal.approval_fingerprint IS NULL OR _post_internal.approval_fingerprint IS DISTINCT FROM public.editorial_compute_approval_fingerprint(_post.id) THEN RAISE EXCEPTION 'editorial approval snapshot changed; refresh before cancelling'; END IF;
    IF EXISTS (SELECT 1 FROM unnest(_requested_file_ids) AS requested(file_id) WHERE NOT COALESCE(public.file_is_editable(requested.file_id), false) AND NOT public.editorial_file_is_publishable(requested.file_id, _publication.client_id, _publication.project_id)) THEN
      RAISE EXCEPTION 'cannot cancel a plan while its approval is in progress; create a revision';
    END IF;
  END IF;
  IF p_action = 'schedule' THEN
    IF _publication.status NOT IN ('planned','scheduled','failed') OR _next_scheduled_at IS NULL THEN RAISE EXCEPTION 'publication cannot be scheduled from its current state'; END IF;
    IF _next_scheduled_at < now() - interval '5 minutes' THEN RAISE EXCEPTION 'scheduled time cannot be in the past'; END IF;
    _event_type := CASE WHEN _publication.status = 'scheduled' THEN 'publication_rescheduled' ELSE 'publication_scheduled' END;
    _to_status := 'scheduled';
    UPDATE public.editorial_publications SET file_id = _effective_file_id, scheduled_at = _next_scheduled_at, scheduled_timezone = _next_timezone, status = 'scheduled', published_at = NULL, permalink = NULL, external_post_id = NULL WHERE id = _publication.id RETURNING * INTO _publication;
    UPDATE public.editorial_publication_internal SET failure_code = NULL, failure_reason = NULL, scheduled_by = _actor, updated_by = _actor WHERE publication_id = _publication.id;
    -- 28/09: agendar grava file_id (o arquivo efetivo, já conferido como
    -- aprovado e travado logo acima) DEPOIS da checagem. Sem refazer a
    -- impressão digital, o próximo reagendar e o envio automático caíam em
    -- 'publication requires ready content and approved immutable files'.
    IF _internal.included_in_approval_snapshot THEN
      UPDATE public.editorial_post_internal SET approval_fingerprint = public.editorial_compute_approval_fingerprint(_post.id), updated_by = _actor WHERE post_id = _post.id;
    END IF;
  ELSIF p_action = 'publish' THEN
    IF _publication.status NOT IN ('planned', 'scheduled', 'failed') OR COALESCE(length(btrim(p_permalink)), 0) = 0 OR btrim(p_permalink) !~* '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION 'published confirmation requires a valid public URL'; END IF;
    IF _next_scheduled_at IS NULL THEN _next_scheduled_at := _next_published_at; END IF;
    _event_type := 'publication_published'; _to_status := 'published';
    UPDATE public.editorial_publications SET file_id = _effective_file_id, scheduled_at = _next_scheduled_at, scheduled_timezone = _next_timezone, status = 'published', published_at = _next_published_at, permalink = btrim(p_permalink), external_post_id = NULLIF(btrim(p_external_post_id), '') WHERE id = _publication.id RETURNING * INTO _publication;
    UPDATE public.editorial_publication_internal SET failure_code = NULL, failure_reason = NULL, attempt_count = attempt_count + 1, last_attempt_at = now(), published_by = _actor, updated_by = _actor WHERE publication_id = _publication.id;
  ELSIF p_action = 'fail' THEN
    IF _publication.status NOT IN ('scheduled', 'failed') OR COALESCE(length(_reason), 0) < 5 THEN RAISE EXCEPTION 'failed publication requires a reason'; END IF;
    _event_type := 'publication_failed'; _to_status := 'failed';
    UPDATE public.editorial_publications SET status = 'failed' WHERE id = _publication.id RETURNING * INTO _publication;
    UPDATE public.editorial_publication_internal SET failure_code = NULLIF(btrim(p_failure_code), ''), failure_reason = _reason, attempt_count = attempt_count + 1, last_attempt_at = now(), updated_by = _actor WHERE publication_id = _publication.id;
  ELSIF p_action = 'cancel' THEN
    IF _publication.status = 'published' THEN RAISE EXCEPTION 'published records cannot be cancelled'; END IF;
    _event_type := 'publication_cancelled'; _to_status := 'cancelled';
    UPDATE public.editorial_publications SET status = 'cancelled' WHERE id = _publication.id RETURNING * INTO _publication;
    UPDATE public.editorial_publication_internal SET included_in_approval_snapshot = false, failure_code = NULL, failure_reason = _reason, updated_by = _actor WHERE publication_id = _publication.id;
    UPDATE public.editorial_post_internal SET approval_fingerprint = public.editorial_compute_approval_fingerprint(_post.id), updated_by = _actor WHERE post_id = _post.id;
  ELSE
    IF _publication.status NOT IN ('failed', 'cancelled') THEN RAISE EXCEPTION 'only failed or cancelled publications can be reopened'; END IF;
    _event_type := 'publication_reopened'; _to_status := 'planned';
    _snapshot_extended := NOT _internal.included_in_approval_snapshot;
    UPDATE public.editorial_publications SET status = 'planned', published_at = NULL, permalink = NULL, external_post_id = NULL WHERE id = _publication.id RETURNING * INTO _publication;
    UPDATE public.editorial_publication_internal SET included_in_approval_snapshot = true, failure_code = NULL, failure_reason = NULL, updated_by = _actor WHERE publication_id = _publication.id;
    IF _snapshot_extended THEN
      UPDATE public.editorial_post_internal SET approval_fingerprint = public.editorial_compute_approval_fingerprint(_post.id), updated_by = _actor WHERE post_id = _post.id;
    END IF;
  END IF;
  UPDATE public.editorial_posts SET updated_at = now() WHERE id = _post.id RETURNING * INTO _post;
  INSERT INTO public.editorial_events (client_id, post_id, publication_id, actor_id, event_type, from_status, to_status, metadata)
  VALUES (_publication.client_id, _publication.post_id, _publication.id, _actor, _event_type, _from_status, _to_status,
    jsonb_strip_nulls(jsonb_build_object('scheduled_at', _publication.scheduled_at, 'published_at', _publication.published_at, 'permalink', _publication.permalink, 'failure_code', NULLIF(btrim(p_failure_code), ''), 'failure_reason', _reason, 'approval_snapshot_extended', _snapshot_extended, 'post_version', _post.version, 'version', _publication.version)));
  RETURN jsonb_build_object('publication_id', _publication.id, 'status', _publication.status, 'version', _publication.version, 'post_version', _post.version, 'recovered', false);
END
$function$;

-- Posts já afetados: a impressão digital só é refeita onde NADA do conteúdo
-- mudou depois da última aprovação (nenhum post_updated/publication_updated
-- depois do último evento approval_snapshot_*), ou seja, a única diferença é o
-- arquivo gravado pelo próprio agendamento. Conteúdo editado depois da
-- aprovação continua bloqueado, como deve.
WITH ultimo_aceite AS (
  SELECT post_id, max(created_at) AS em
  FROM public.editorial_events
  WHERE event_type LIKE 'approval_snapshot_%'
  GROUP BY post_id
), alvo AS (
  SELECT pi.post_id
  FROM public.editorial_post_internal pi
  JOIN ultimo_aceite ua ON ua.post_id = pi.post_id
  WHERE pi.approval_fingerprint IS NOT NULL
    AND pi.approval_fingerprint IS DISTINCT FROM public.editorial_compute_approval_fingerprint(pi.post_id)
    AND EXISTS (
      SELECT 1 FROM public.editorial_publications pub
      JOIN public.editorial_publication_internal pubi ON pubi.publication_id = pub.id
      WHERE pub.post_id = pi.post_id AND pub.status IN ('scheduled','planned','failed') AND pubi.included_in_approval_snapshot
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.editorial_events ev
      WHERE ev.post_id = pi.post_id AND ev.created_at > ua.em
        AND ev.event_type IN ('post_updated', 'publication_updated')
    )
)
UPDATE public.editorial_post_internal pi
SET approval_fingerprint = public.editorial_compute_approval_fingerprint(pi.post_id)
FROM alvo WHERE alvo.post_id = pi.post_id;
