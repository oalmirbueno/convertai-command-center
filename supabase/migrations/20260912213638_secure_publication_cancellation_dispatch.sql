-- SEC-06: cancel and dispatch share the existing editorial transaction lock.
-- No rows are removed. Existing jobs, counters and provider request ids survive.
-- pg_net starts requests only after COMMIT: queuing media_publish is the point
-- after which cancellation cannot be promised. Reconcile; never blindly resend.
BEGIN;

-- Apply the existing root document denylist to every carousel child as well.
-- A child labelled application/pdf cannot become an image through a .png
-- filename fallback. Keep inherited approval flags and client_shared support.
DO $media_frames$
DECLARE _definition text; _document_guard text;
  _anchor text := '            OR child.approval_status <> ''none''';
BEGIN
  SELECT replace(pg_get_functiondef('public.editorial_file_is_publishable_media(uuid,uuid,uuid)'::regprocedure),E'\r\n',E'\n')
    INTO _definition;
  _document_guard := split_part(split_part(_definition,'      AND NOT (',2),E'\n      )\n      AND (',1);
  IF (length(_definition)-length(replace(_definition,_anchor,'')))/length(_anchor) <> 1
    OR position('root.mime_type' IN _document_guard)=0
    OR position('root.storage_path' IN _document_guard)=0
    OR position('root.file_type' IN _document_guard)=0
    OR position('child.' IN _document_guard)>0
    OR position('application/pdf' IN _document_guard)=0 THEN
    RAISE EXCEPTION 'PUBLICATION_MEDIA_DOCUMENT_GUARD_ANCHOR_MISMATCH';
  END IF;
  EXECUTE replace(_definition,_anchor,_anchor || E'\n            OR (' || replace(_document_guard,'root.','child.') || ')');
END $media_frames$;

-- Approval alone does not make a PDF/document social media. Keep generic
-- attachments available for editorial review, but require the canonical media
-- predicate before schedule/publish. Replace only the two final media gates;
-- the existing scope, version, snapshot and retry checks remain intact.
DO $media_gate$
DECLARE _definition text; _old text := 'OR NOT public.editorial_file_is_publishable(';
BEGIN
  SELECT pg_get_functiondef('public.transition_editorial_publication_unlocked(uuid,text,integer,timestamptz,text,text,text,text,text,timestamptz)'::regprocedure)
    INTO _definition;
  IF (length(_definition)-length(replace(_definition,_old,'')))/length(_old) <> 2 THEN
    RAISE EXCEPTION 'PUBLICATION_MEDIA_GATE_ANCHOR_MISMATCH';
  END IF;
  EXECUTE replace(_definition,_old,'OR NOT public.editorial_file_is_publishable_media(');
END $media_gate$;

ALTER TABLE social_private.autopublish_jobs
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS dispatch_fingerprint text;

ALTER TABLE social_private.autopublish_jobs DROP CONSTRAINT IF EXISTS autopublish_jobs_stage_check;
ALTER TABLE social_private.autopublish_jobs ADD CONSTRAINT autopublish_jobs_stage_check CHECK (
  stage IN ('queued','sign','children','parent','processing','publish','verify','recover','permalink','done','failed','cancelled')
);

CREATE TABLE social_private.autopublish_job_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  publication_id uuid NOT NULL,
  client_id uuid NOT NULL,
  generation integer NOT NULL,
  event text NOT NULL,
  stage text NOT NULL,
  request_id bigint,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX autopublish_one_publish_dispatch_per_generation
  ON social_private.autopublish_job_events(publication_id, generation)
  WHERE event = 'publish_dispatched';
ALTER TABLE social_private.autopublish_job_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON social_private.autopublish_job_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE social_private.autopublish_job_events_id_seq FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION social_private.autopublish_history_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'publication dispatch history is append-only' USING ERRCODE = '55000';
END $$;
CREATE TRIGGER autopublish_history_immutable_trg
BEFORE UPDATE OR DELETE ON social_private.autopublish_job_events
FOR EACH ROW EXECUTE FUNCTION social_private.autopublish_history_immutable();
REVOKE ALL ON FUNCTION social_private.autopublish_history_immutable() FROM PUBLIC, anon, authenticated, service_role;

-- Called only by the private HTTP boundary. Row locks cover the kill switch,
-- client/project/account/connection, approval and ordered asset snapshot until
-- the transaction containing the pg_net request commits. Lock post before pub,
-- matching transition_editorial_publication_unlocked's row order.
CREATE OR REPLACE FUNCTION social_private.autopublish_assert_dispatch(
  _publication_id uuid, _reconcile boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _pub public.editorial_publications%ROWTYPE;
  _post public.editorial_posts%ROWTYPE;
  _job social_private.autopublish_jobs%ROWTYPE;
  _delivery social_private.editorial_publication_delivery_requests%ROWTYPE;
  _post_id uuid;
  _root uuid;
  _approval text;
  _fingerprint text;
  _file_snapshot jsonb;
  _assets integer;
BEGIN
  PERFORM public.editorial_lock_task_sync();
  SELECT post_id INTO _post_id FROM public.editorial_publications WHERE id = _publication_id;
  SELECT * INTO _post FROM public.editorial_posts WHERE id = _post_id FOR UPDATE;
  SELECT * INTO _pub FROM public.editorial_publications WHERE id = _publication_id FOR UPDATE;
  SELECT * INTO _job FROM social_private.autopublish_jobs WHERE publication_id = _publication_id FOR UPDATE;
  IF _pub.id IS NULL OR _post.id IS NULL OR _job.publication_id IS NULL
    OR _job.client_id IS DISTINCT FROM _pub.client_id
    OR _post.client_id IS DISTINCT FROM _pub.client_id
    OR _post.project_id IS DISTINCT FROM _pub.project_id THEN
    RAISE EXCEPTION 'publication dispatch tenant or post mismatch' USING ERRCODE = '55000';
  END IF;
  IF _job.cancelled_at IS NOT NULL OR _job.stage = 'cancelled' OR _pub.status = 'cancelled' THEN
    RAISE EXCEPTION 'publication cancelled; no HTTP request permitted' USING ERRCODE = '55000';
  END IF;
  PERFORM 1 FROM social_private.autopublish_settings WHERE id AND enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'publication kill switch is off' USING ERRCODE = '55000'; END IF;
  IF _pub.platform <> 'instagram' OR _pub.delivery_mode NOT IN ('manual','automatic')
    OR (_pub.status <> 'scheduled' AND NOT (_reconcile AND _job.publish_dispatched AND _pub.status = 'failed')) THEN
    RAISE EXCEPTION 'publication is not scheduled or reconcilable' USING ERRCODE = '55000';
  END IF;
  PERFORM 1 FROM public.profiles WHERE id = _pub.client_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'publication client unavailable' USING ERRCODE = '55000'; END IF;
  PERFORM 1 FROM public.projects WHERE id = _pub.project_id AND client_id = _pub.client_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'publication project unavailable' USING ERRCODE = '55000'; END IF;
  PERFORM 1 FROM public.external_accounts WHERE id = _pub.external_account_id AND client_id = _pub.client_id AND status = 'active' AND platform = _pub.platform FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'publication account unavailable' USING ERRCODE = '55000'; END IF;
  PERFORM 1 FROM public.project_external_accounts WHERE project_id = _pub.project_id AND external_account_id = _pub.external_account_id AND client_id = _pub.client_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'publication account is unlinked' USING ERRCODE = '55000'; END IF;
  -- Manual scheduled posts intentionally remain supported by the v5 publisher.
  -- The per-connection automation flag is required for explicit automatic mode.
  PERFORM 1 FROM public.external_account_connections
    WHERE external_account_id = _pub.external_account_id AND client_id = _pub.client_id
      AND provider = 'meta' AND connection_status = 'connected'
      AND (_pub.delivery_mode = 'manual' OR automation_enabled)
      AND (expires_at IS NULL OR expires_at > clock_timestamp())
      AND (data_access_expires_at IS NULL OR data_access_expires_at > clock_timestamp()) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'publication connection disabled or expired' USING ERRCODE = '55000'; END IF;

  -- Once the final POST was queued, only GET reconciliation is legal. Changes
  -- to approvals must not erase the ability to learn whether a post went live.
  IF _reconcile AND _job.publish_dispatched THEN RETURN; END IF;
  IF _post.archived_at IS NOT NULL OR _post.production_status <> 'ready'
    OR _pub.scheduled_at IS NULL OR _pub.scheduled_at > clock_timestamp() THEN
    RAISE EXCEPTION 'publication is archived, unready or scheduled in the future' USING ERRCODE = '55000';
  END IF;
  _root := COALESCE(_pub.file_id, _post.primary_file_id);
  PERFORM 1 FROM public.editorial_publication_internal
    WHERE publication_id = _pub.id AND client_id = _pub.client_id AND included_in_approval_snapshot FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'publication missing approved snapshot' USING ERRCODE = '55000'; END IF;
  SELECT approval_fingerprint INTO _approval FROM public.editorial_post_internal WHERE post_id = _post.id FOR SHARE;
  IF _approval IS NULL OR _approval IS DISTINCT FROM public.editorial_compute_approval_fingerprint(_post.id) THEN
    RAISE EXCEPTION 'publication approval snapshot changed' USING ERRCODE = '55000';
  END IF;
  PERFORM 1 FROM social_private.editorial_publication_assets WHERE publication_id = _pub.id ORDER BY position FOR SHARE;
  PERFORM 1 FROM public.files
    WHERE id IN (_root, _post.primary_file_id) OR parent_file_id = _root
      OR id IN (SELECT file_id FROM social_private.editorial_publication_assets WHERE publication_id = _pub.id)
    ORDER BY id FOR SHARE;
  IF NOT COALESCE(public.editorial_file_is_publishable_media(_root, _pub.client_id, _pub.project_id), false)
    OR NOT COALESCE(public.editorial_file_is_publishable_media(_post.primary_file_id, _pub.client_id, _pub.project_id), false) THEN
    RAISE EXCEPTION 'publication files require approved image or video media' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO _delivery FROM social_private.editorial_publication_delivery_requests WHERE publication_id = _pub.id FOR SHARE;
  SELECT count(*) INTO _assets FROM social_private.editorial_publication_assets WHERE publication_id = _pub.id;
  -- Existing approved manual plans can have no delivery extension row. The
  -- official transition still schedules them, and v5 supports their media URL
  -- fallback. Automatic plans always require the ordered delivery snapshot.
  IF (_delivery.publication_id IS NULL AND (_pub.delivery_mode <> 'manual' OR _assets <> 0))
    OR (_delivery.publication_id IS NOT NULL AND (_delivery.client_id IS DISTINCT FROM _pub.client_id
      OR _delivery.delivery_mode IS DISTINCT FROM _pub.delivery_mode OR _delivery.asset_count <> _assets))
    OR (_pub.delivery_mode = 'automatic' AND _assets = 0) THEN
    RAISE EXCEPTION 'publication delivery snapshot missing or changed' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM social_private.editorial_publication_assets a LEFT JOIN public.files f ON f.id = a.file_id
    WHERE a.publication_id = _pub.id AND (a.client_id IS DISTINCT FROM _pub.client_id OR a.root_file_id IS DISTINCT FROM _root
      OR f.id IS NULL OR f.client_id IS DISTINCT FROM _pub.client_id OR f.project_id IS DISTINCT FROM _pub.project_id
      OR COALESCE(f.parent_file_id, f.id) IS DISTINCT FROM _root OR f.archived_at IS NOT NULL
      OR COALESCE(f.status,'ready') <> 'ready' OR a.sha256 IS DISTINCT FROM f.sha256
      OR a.mime_type IS DISTINCT FROM f.mime_type OR a.size_bytes IS DISTINCT FROM f.size_bytes)) THEN
    RAISE EXCEPTION 'publication asset bytes or ownership changed' USING ERRCODE = '55000';
  END IF;
  -- Bind prepared containers to the approved content. Scheduling time can move
  -- without changing media, but caption/account/file/snapshot cannot.
  -- A legacy in-flight preparation predates this fingerprint. Its container
  -- cannot safely be attributed to the current approved bytes. Preserve it in
  -- history and require an authorized retry to prepare the current snapshot.
  IF _job.dispatch_fingerprint IS NULL AND (_job.stage <> 'queued'
    OR _job.net_request_id IS NOT NULL OR _job.container_id IS NOT NULL
    OR cardinality(_job.child_request_ids) > 0 OR cardinality(_job.child_container_ids) > 0
    OR cardinality(_job.child_urls) > 0) THEN
    RAISE EXCEPTION 'publication legacy preparation has no approved fingerprint; review and retry' USING ERRCODE = 'P6001';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('id',f.id,'parent',f.parent_file_id,'sha256',f.sha256,
    'mime',f.mime_type,'size',f.size_bytes,'path',f.storage_path,'url',f.file_url) ORDER BY f.id)
    INTO _file_snapshot FROM public.files f WHERE f.id = _root OR f.parent_file_id = _root;
  _fingerprint := encode(sha256(convert_to(jsonb_build_object('approval',_approval,
    'account',_pub.external_account_id,'root',_root,'caption',_pub.caption,'kind',_post.content_type,
    'files',_file_snapshot)::text,'UTF8')),'hex');
  IF _job.dispatch_fingerprint IS NOT NULL AND _job.dispatch_fingerprint IS DISTINCT FROM _fingerprint THEN
    RAISE EXCEPTION 'publication prepared media snapshot changed; review and retry' USING ERRCODE = 'P6001';
  END IF;
  UPDATE social_private.autopublish_jobs SET dispatch_fingerprint = _fingerprint
    WHERE publication_id = _pub.id AND dispatch_fingerprint IS NULL;
END $$;
REVOKE ALL ON FUNCTION social_private.autopublish_assert_dispatch(uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION social_private.autopublish_http(
  _publication_id uuid, _method text, url text,
  body jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds integer DEFAULT 20000
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _job social_private.autopublish_jobs%ROWTYPE; _request_id bigint; _final boolean;
BEGIN
  IF _method NOT IN ('GET','POST') THEN RAISE EXCEPTION 'invalid publication HTTP method'; END IF;
  PERFORM social_private.autopublish_assert_dispatch(_publication_id, _method = 'GET');
  SELECT * INTO _job FROM social_private.autopublish_jobs WHERE publication_id = _publication_id FOR UPDATE;
  _final := _method = 'POST' AND _job.stage = 'publish';
  IF _method = 'POST' AND _job.publish_dispatched THEN
    RAISE EXCEPTION 'publication already dispatched; verify result instead of resending' USING ERRCODE = '55000';
  END IF;
  IF _method = 'POST' THEN
    _request_id := net.http_post(url := url, body := body, headers := headers, timeout_milliseconds := timeout_milliseconds);
  ELSE
    _request_id := net.http_get(url := url, timeout_milliseconds := timeout_milliseconds);
  END IF;
  INSERT INTO social_private.autopublish_job_events(publication_id,client_id,generation,event,stage,request_id)
    VALUES (_job.publication_id,_job.client_id,_job.generation,
      CASE WHEN _final THEN 'publish_dispatched' ELSE 'http_' || lower(_method) END,_job.stage,_request_id);
  IF _final THEN UPDATE social_private.autopublish_jobs SET publish_dispatched = true WHERE publication_id = _publication_id; END IF;
  RETURN _request_id;
END $$;
REVOKE ALL ON FUNCTION social_private.autopublish_http(uuid,text,text,jsonb,jsonb,integer) FROM PUBLIC, anon, authenticated, service_role;

-- The existing BEFORE STATEMENT editorial lock runs before this row trigger,
-- including for callers of the internal transition function. A late cancel is
-- rejected honestly; no fake cancelled status can race a committed final POST.
CREATE OR REPLACE FUNCTION social_private.autopublish_publication_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _job social_private.autopublish_jobs%ROWTYPE;
BEGIN
  PERFORM public.editorial_lock_task_sync();
  SELECT * INTO _job FROM social_private.autopublish_jobs WHERE publication_id = NEW.id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    IF _job.publish_dispatched OR _job.media_id IS NOT NULL THEN
      RAISE EXCEPTION 'O envio a plataforma ja foi iniciado. Confira o resultado antes de cancelar; o painel nao garante interromper esta publicacao.' USING ERRCODE = '55000';
    END IF;
    INSERT INTO social_private.autopublish_job_events(publication_id,client_id,generation,event,stage,request_id,detail)
      VALUES (_job.publication_id,_job.client_id,_job.generation,'cancelled',_job.stage,_job.net_request_id,
        jsonb_build_object('attempts',_job.attempts,'child_request_ids',_job.child_request_ids,'actor',auth.uid()));
    UPDATE social_private.autopublish_jobs SET stage = 'cancelled', cancelled_at = clock_timestamp(), cancelled_by = auth.uid(),
      last_error = 'Cancelada antes do envio final; historico e requisicoes anteriores preservados.', updated_at = clock_timestamp()
      WHERE publication_id = NEW.id;
  ELSIF NEW.status = 'scheduled' AND OLD.status IS DISTINCT FROM 'scheduled' AND _job.cancelled_at IS NOT NULL THEN
    -- Explicit reopen + schedule starts another preparation, retaining counters
    -- and an event containing the former provider ids; no old job is deleted.
    INSERT INTO social_private.autopublish_job_events(publication_id,client_id,generation,event,stage,request_id,detail)
      VALUES (_job.publication_id,_job.client_id,_job.generation,'rescheduled',_job.stage,_job.net_request_id,
        jsonb_build_object('attempts',_job.attempts,'container_id',_job.container_id,'child_container_ids',_job.child_container_ids,'child_request_ids',_job.child_request_ids));
    UPDATE social_private.autopublish_jobs SET stage = 'queued', generation = generation + 1, cancelled_at = NULL, cancelled_by = NULL,
      dispatch_fingerprint = NULL, step_attempts = 0, poll_count = 0, net_request_id = NULL,
      child_index = 0, child_urls = ARRAY[]::text[], child_container_ids = ARRAY[]::text[], child_request_ids = ARRAY[]::bigint[],
      container_id = NULL, last_error = NULL, updated_at = clock_timestamp() WHERE publication_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER autopublish_publication_transition_trg
BEFORE UPDATE OF status ON public.editorial_publications
FOR EACH ROW EXECUTE FUNCTION social_private.autopublish_publication_transition();
REVOKE ALL ON FUNCTION social_private.autopublish_publication_transition() FROM PUBLIC, anon, authenticated, service_role;

-- v5 routes retained; every HTTP request now passes the private dispatch gate.
CREATE OR REPLACE FUNCTION public.editorial_autopublish_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _settings social_private.autopublish_settings%ROWTYPE;
  _graph text;
  _due record;
  _job record;
  _pub record;
  _response record;
  _token record;
  _payload text;
  _request_id bigint;
  _admin uuid;
  _queued int := 0;
  _advanced int := 0;
  _published int := 0;
  _failed int := 0;
  _body jsonb;
  _urls text[];
  _paths text[];
  _kind text;
  _status_code text;
  _permalink text;
  _service_key text;
  _entry jsonb;
  _signed_url text;
  _req_ids bigint[];
  _containers text[];
  _idx int;
  _all_ready boolean;
  _wait boolean;
  _pass int;
  _step_limit constant smallint := 4;
  _lost_after constant interval := interval '10 minutes';
BEGIN
  -- Same first lock as cancellation, approval and editorial transitions. A
  -- concurrent tick cannot reuse the same provider response or final POST.
  PERFORM public.editorial_lock_task_sync();
  SELECT * INTO _settings FROM social_private.autopublish_settings WHERE id FOR SHARE;
  IF _settings IS NULL OR NOT _settings.enabled THEN
    RETURN jsonb_build_object('enabled', false);
  END IF;

  _graph := 'https://graph.facebook.com/' || _settings.graph_version;

  SELECT user_id INTO _admin
  FROM public.user_roles
  WHERE role = 'admin'::public.app_role
  ORDER BY user_id
  LIMIT 1;

  -- 1. Enfileira o que esta agendado, aprovado e com a hora chegada.
  FOR _due IN
    SELECT publication.id, publication.client_id
    FROM public.editorial_publications AS publication
    JOIN public.editorial_posts AS post ON post.id = publication.post_id
    WHERE publication.status = 'scheduled'
      AND publication.platform = 'instagram'
      AND publication.delivery_mode IN ('manual', 'automatic')
      AND publication.scheduled_at IS NOT NULL
      AND publication.scheduled_at <= now()
      AND post.content_type IN ('static', 'story', 'carousel', 'reel', 'video', 'short')
      AND COALESCE(public.editorial_file_is_publishable(
            COALESCE(publication.file_id, post.primary_file_id),
            publication.client_id, publication.project_id), false)
      AND COALESCE((
            SELECT approval_file.client_decided_at <= publication.scheduled_at
                OR now() >= approval_file.client_decided_at + interval '1 hour'
            FROM public.files AS approval_file
            WHERE approval_file.id = COALESCE(publication.file_id, post.primary_file_id)
          ), true)
      AND NOT EXISTS (
        SELECT 1 FROM social_private.autopublish_jobs AS job
        WHERE job.publication_id = publication.id
      )
    LIMIT 5
  LOOP
    INSERT INTO social_private.autopublish_jobs (publication_id, client_id, stage)
    VALUES (_due.id, _due.client_id, 'queued')
    ON CONFLICT (publication_id) DO NOTHING;
    _queued := _queued + 1;
  END LOOP;

  -- 2. Avanca cada job. Ate 3 passadas por tick: resposta lida e proximo passo
  --    disparado na MESMA rodada (rota rapida).
  FOR _job IN
    SELECT * FROM social_private.autopublish_jobs
    WHERE stage NOT IN ('done', 'failed', 'cancelled')
    ORDER BY created_at
    LIMIT 10
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      -- Reconcile an already-dispatched POST without requiring its old approval
      -- again; pre-dispatch work must still pass the complete current gate.
      PERFORM social_private.autopublish_assert_dispatch(_job.publication_id, _job.publish_dispatched);
      SELECT
        publication.id,
        publication.external_account_id,
        publication.version,
        COALESCE(publication.caption, '') AS caption,
        COALESCE(publication.file_id, post.primary_file_id) AS file_id,
        post.content_type
      INTO _pub
      FROM public.editorial_publications AS publication
      JOIN public.editorial_posts AS post ON post.id = publication.post_id
      WHERE publication.id = _job.publication_id;

      SELECT * INTO _token
      FROM social_private.autopublish_account_token(_pub.external_account_id);

      IF _token.access_token IS NULL THEN
        PERFORM social_private.autopublish_mark_failed(
          _job.publication_id,
          'Conta Instagram sem conexao ativa ou token indisponivel. Reconecte a conta na agenda.',
          _admin
        );
        _failed := _failed + 1;
        CONTINUE;
      END IF;

      _kind := CASE
        WHEN _pub.content_type = 'carousel' THEN 'carousel'
        WHEN _pub.content_type = 'story' THEN 'story'
        WHEN _pub.content_type IN ('reel', 'video', 'short') THEN 'video'
        ELSE 'image'
      END;

      FOR _pass IN 1..3 LOOP
        -- Estado fresco a cada passada.
        SELECT * INTO _job FROM social_private.autopublish_jobs
        WHERE publication_id = _job.publication_id;
        EXIT WHEN _job.stage IN ('done', 'failed', 'cancelled');

        -- ───── A. Cartoes do carrossel em paralelo: colhe as respostas ─────
        IF _job.stage = 'children' AND COALESCE(array_length(_job.child_request_ids, 1), 0) > 0 THEN
          _containers := _job.child_container_ids;
          _all_ready := true;
          _wait := false;
          FOR _idx IN 1..array_length(_job.child_request_ids, 1) LOOP
            IF _containers[_idx] IS NOT NULL THEN CONTINUE; END IF;
            IF _job.child_request_ids[_idx] IS NULL THEN _all_ready := false; CONTINUE; END IF;
            SELECT status_code, content, timed_out, error_msg INTO _response
            FROM net._http_response WHERE id = _job.child_request_ids[_idx];
            IF NOT FOUND THEN
              _all_ready := false;
              IF _job.updated_at >= now() - _lost_after THEN _wait := true; END IF;
              CONTINUE;
            END IF;
            IF _response.timed_out OR _response.status_code IS NULL OR _response.status_code >= 300 THEN
              -- Este cartao falhou: redispara so ele.
              _all_ready := false;
              IF _job.step_attempts >= _step_limit THEN
                PERFORM social_private.autopublish_mark_failed(
                  _job.publication_id,
                  'Cartao ' || _idx || ' do carrossel falhou: ' ||
                    left(COALESCE(_response.content::text, _response.error_msg, 'sem resposta'), 300),
                  _admin
                );
                _failed := _failed + 1;
                EXIT;
              END IF;
              _payload := _graph || '/' || _token.resource_id || '/media'
                || '?image_url=' || social_private.autopublish_urlencode(_job.child_urls[_idx])
                || '&is_carousel_item=true'
                || '&access_token=' || _token.access_token;
              SELECT social_private.autopublish_http(_job.publication_id, 'POST', url := _payload, headers := '{}'::jsonb, timeout_milliseconds := 20000)
              INTO _request_id;
              _req_ids := _job.child_request_ids;
              _req_ids[_idx] := _request_id;
              UPDATE social_private.autopublish_jobs
              SET child_request_ids = _req_ids,
                  attempts = attempts + 1,
                  step_attempts = step_attempts + 1,
                  last_error = left('Cartao ' || _idx || ' refeito: ' ||
                    COALESCE(_response.content::text, _response.error_msg, 'sem resposta'), 500),
                  updated_at = now()
              WHERE publication_id = _job.publication_id;
            ELSE
              _containers[_idx] := (_response.content::jsonb)->>'id';
              UPDATE social_private.autopublish_jobs
              SET child_container_ids = _containers, updated_at = now()
              WHERE publication_id = _job.publication_id;
            END IF;
          END LOOP;

          SELECT * INTO _job FROM social_private.autopublish_jobs
          WHERE publication_id = _job.publication_id;
          EXIT WHEN _job.stage IN ('done', 'failed', 'cancelled');

          IF _all_ready AND NOT EXISTS (
            SELECT 1 FROM unnest(_job.child_container_ids) AS c(id) WHERE c.id IS NULL
          ) AND COALESCE(array_length(_job.child_container_ids, 1), 0) > 0 THEN
            -- Todos os cartoes prontos: monta o pai JA NESTA rodada.
            _payload := _graph || '/' || _token.resource_id || '/media'
              || '?media_type=CAROUSEL'
              || '&children=' || array_to_string(_job.child_container_ids, ',')
              || '&caption=' || social_private.autopublish_urlencode(_pub.caption)
              || '&access_token=' || _token.access_token;
            SELECT social_private.autopublish_http(_job.publication_id, 'POST', url := _payload, headers := '{}'::jsonb, timeout_milliseconds := 20000)
            INTO _request_id;
            UPDATE social_private.autopublish_jobs
            SET stage = 'parent', net_request_id = _request_id,
                child_request_ids = ARRAY[]::bigint[],
                attempts = attempts + 1, step_attempts = 1, updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
          END IF;
          EXIT; -- espera respostas (dos cartoes refeitos ou do pai)
        END IF;

        -- ───── B. Ha requisicao unica em voo: le a resposta ─────
        IF _job.net_request_id IS NOT NULL THEN
          SELECT status_code, content, timed_out, error_msg INTO _response
          FROM net._http_response WHERE id = _job.net_request_id;

          IF NOT FOUND THEN
            IF _job.updated_at < now() - _lost_after THEN
              UPDATE social_private.autopublish_jobs
              SET net_request_id = NULL,
                  stage = CASE WHEN stage = 'publish' AND publish_dispatched THEN 'verify' ELSE stage END,
                  step_attempts = CASE WHEN stage = 'publish' AND publish_dispatched THEN 0 ELSE step_attempts END,
                  last_error = 'Resposta da Meta perdida; retomando o passo.',
                  updated_at = now()
              WHERE publication_id = _job.publication_id;
            END IF;
            EXIT; -- resposta ainda nao chegou
          END IF;

          IF _response.timed_out
            OR _response.status_code IS NULL
            OR _response.status_code >= 300 THEN
            UPDATE social_private.autopublish_jobs
            SET net_request_id = NULL,
                stage = CASE WHEN stage = 'publish' AND publish_dispatched THEN 'verify' ELSE stage END,
                step_attempts = CASE WHEN stage = 'publish' AND publish_dispatched THEN 0 ELSE step_attempts END,
                last_error = left(COALESCE(
                  _response.content::text,
                  _response.error_msg,
                  'sem resposta'
                ), 500),
                updated_at = now()
            WHERE publication_id = _job.publication_id;
            CONTINUE; -- proxima passada tenta o dispatch de novo
          END IF;

          _body := _response.content::jsonb;

          IF _job.stage = 'sign' THEN
            IF jsonb_typeof(_body) <> 'array' THEN
              UPDATE social_private.autopublish_jobs
              SET net_request_id = NULL,
                  last_error = left('Assinatura de midia inesperada: ' || COALESCE(_body::text, ''), 500),
                  updated_at = now()
              WHERE publication_id = _job.publication_id;
              CONTINUE;
            END IF;
            _urls := ARRAY[]::text[];
            FOR _entry IN SELECT * FROM jsonb_array_elements(_body)
            LOOP
              _signed_url := COALESCE(_entry->>'signedURL', _entry->>'signedUrl');
              IF _signed_url IS NULL OR COALESCE(_entry->>'error', '') <> '' THEN CONTINUE; END IF;
              _urls := _urls || (_settings.storage_base_url || '/storage/v1' || _signed_url);
            END LOOP;
            IF array_length(_urls, 1) IS NULL THEN
              PERFORM social_private.autopublish_mark_failed(
                _job.publication_id,
                'Nao foi possivel assinar os arquivos da publicacao.',
                _admin
              );
              _failed := _failed + 1;
              EXIT;
            END IF;
            UPDATE social_private.autopublish_jobs
            SET child_urls = _urls, child_index = 0,
                child_container_ids = ARRAY[]::text[],
                child_request_ids = ARRAY[]::bigint[],
                stage = 'queued', step_attempts = 0,
                net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
            CONTINUE; -- proxima passada dispara os containers JA

          ELSIF _job.stage = 'queued' THEN
            IF _kind = 'video' THEN
              UPDATE social_private.autopublish_jobs
              SET container_id = _body->>'id', stage = 'processing', poll_count = 0,
                  step_attempts = 0, net_request_id = NULL, updated_at = now()
              WHERE publication_id = _job.publication_id;
            ELSE
              UPDATE social_private.autopublish_jobs
              SET container_id = _body->>'id', stage = 'publish',
                  step_attempts = 0, net_request_id = NULL, updated_at = now()
              WHERE publication_id = _job.publication_id;
            END IF;
            _advanced := _advanced + 1;
            CONTINUE;

          ELSIF _job.stage = 'parent' THEN
            UPDATE social_private.autopublish_jobs
            SET container_id = _body->>'id', stage = 'publish',
                step_attempts = 0, net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
            CONTINUE;

          ELSIF _job.stage = 'processing' THEN
            _status_code := COALESCE(_body->>'status_code', '');
            IF _status_code = 'FINISHED' THEN
              UPDATE social_private.autopublish_jobs
              SET stage = 'publish', step_attempts = 0, net_request_id = NULL, updated_at = now()
              WHERE publication_id = _job.publication_id;
              _advanced := _advanced + 1;
              CONTINUE;
            ELSIF _status_code = 'ERROR' THEN
              PERFORM social_private.autopublish_mark_failed(
                _job.publication_id,
                'Instagram nao conseguiu processar o video: ' || COALESCE(_body::text, ''),
                _admin
              );
              _failed := _failed + 1;
              EXIT;
            ELSE
              UPDATE social_private.autopublish_jobs
              SET net_request_id = NULL, poll_count = poll_count + 1, updated_at = now()
              WHERE publication_id = _job.publication_id;
              IF _job.poll_count >= 40 THEN
                PERFORM social_private.autopublish_mark_failed(
                  _job.publication_id,
                  'Video passou de 40 minutos em processamento no Instagram.',
                  _admin
                );
                _failed := _failed + 1;
              END IF;
              EXIT; -- video processando: espera o proximo minuto
            END IF;

          ELSIF _job.stage = 'publish' THEN
            UPDATE social_private.autopublish_jobs
            SET media_id = _body->>'id', stage = 'permalink',
                step_attempts = 0, net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
            CONTINUE;

          ELSIF _job.stage = 'verify' THEN
            _status_code := COALESCE(_body->>'status_code', '');
            IF _status_code = 'PUBLISHED' THEN
              -- The account's latest media is not proof of THIS container. Do
              -- not attribute an unrelated concurrent post to this publication.
              PERFORM social_private.autopublish_mark_failed(_job.publication_id,
                'A Meta confirmou que o container foi publicado. Confirme o link no perfil e registre a baixa; nao reenviar esta publicacao.', _admin);
              EXIT;
            ELSIF _status_code = 'FINISHED' THEN
              -- A timeout does not prove that media_publish was not accepted.
              -- Never issue a second final POST for this generation/container.
              PERFORM social_private.autopublish_mark_failed(_job.publication_id,
                'Envio anterior sem resultado confirmado. Confira a plataforma; Tentar de novo apenas verifica, sem duplicar a publicacao.', _admin);
              EXIT;
            ELSIF _status_code IN ('ERROR', 'EXPIRED') THEN
              PERFORM social_private.autopublish_mark_failed(
                _job.publication_id,
                'Container invalido na verificacao (' || _status_code || '). Use Tentar de novo.',
                _admin
              );
              _failed := _failed + 1;
              EXIT;
            ELSE
              UPDATE social_private.autopublish_jobs
              SET net_request_id = NULL, poll_count = poll_count + 1, updated_at = now()
              WHERE publication_id = _job.publication_id;
              EXIT;
            END IF;

          ELSIF _job.stage = 'recover' THEN
            -- A legacy query for the account's latest post is not evidence of
            -- this publication. Retain the job and request history for review.
            PERFORM social_private.autopublish_mark_failed(_job.publication_id,
              'Recuperacao antiga sem identificador exato da midia. Confirme o link no perfil; nao reenviar.', _admin);
            EXIT;

          ELSIF _job.stage = 'permalink' THEN
            _permalink := NULLIF(btrim(COALESCE(_body->>'permalink', '')), '');
            IF _permalink IS NULL AND _kind = 'story' THEN
              _permalink := 'https://www.instagram.com/stories/';
            END IF;

            UPDATE social_private.autopublish_jobs
            SET permalink = _permalink, stage = 'done', net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;

            IF _admin IS NULL THEN
              UPDATE social_private.autopublish_jobs
              SET last_error = 'Post no ar, mas nenhum admin cadastrado para registrar a baixa no painel.',
                  updated_at = now()
              WHERE publication_id = _job.publication_id;
            ELSIF _permalink IS NULL THEN
              UPDATE social_private.autopublish_jobs
              SET last_error = 'Post no ar, mas o Instagram nao devolveu o link. Marque como publicado no painel.',
                  updated_at = now()
              WHERE publication_id = _job.publication_id;
            ELSE
              BEGIN
                PERFORM set_config(
                  'request.jwt.claims',
                  json_build_object('sub', _admin::text, 'role', 'authenticated')::text,
                  true
                );
                PERFORM public.transition_editorial_publication(
                  p_publication_id => _job.publication_id,
                  p_action => 'publish',
                  p_expected_version => _pub.version,
                  p_permalink => _permalink,
                  p_external_post_id => COALESCE(_job.media_id, _body->>'id'),
                  p_published_at => now()
                );
              EXCEPTION WHEN OTHERS THEN
                UPDATE social_private.autopublish_jobs
                SET last_error = left('Post no ar; baixa oficial falhou: ' || SQLERRM, 500),
                    updated_at = now()
                WHERE publication_id = _job.publication_id;
              END;
            END IF;
            _published := _published + 1;
            EXIT;
          END IF;
          -- fim do bloco de resposta
        END IF;

        -- ───── C. Nada em voo: despacha o proximo passo ─────
        SELECT * INTO _job FROM social_private.autopublish_jobs
        WHERE publication_id = _job.publication_id;
        EXIT WHEN _job.stage IN ('done', 'failed', 'cancelled');
        EXIT WHEN _job.net_request_id IS NOT NULL
          OR (_job.stage = 'children' AND COALESCE(array_length(_job.child_request_ids, 1), 0) > 0);

        IF _job.step_attempts >= _step_limit THEN
          PERFORM social_private.autopublish_mark_failed(
            _job.publication_id,
            'Passo "' || _job.stage || '" falhou apos ' || _job.step_attempts ||
              ' tentativas. Ultimo erro: ' || COALESCE(_job.last_error, 'sem detalhe'),
            _admin
          );
          _failed := _failed + 1;
          EXIT;
        END IF;

        IF _job.stage = 'sign' THEN
          UPDATE social_private.autopublish_jobs
          SET stage = 'queued', child_urls = ARRAY[]::text[], net_request_id = NULL, updated_at = now()
          WHERE publication_id = _job.publication_id;
          CONTINUE;
        END IF;

        IF _job.stage = 'queued' THEN
          IF COALESCE(array_length(_job.child_urls, 1), 0) = 0 THEN
            _paths := social_private.autopublish_storage_paths(_pub.id, _pub.file_id);
            IF COALESCE(array_length(_paths, 1), 0) > 0 THEN
              _service_key := social_private.autopublish_service_key();
              IF _service_key IS NULL THEN
                PERFORM social_private.autopublish_mark_failed(
                  _job.publication_id,
                  'Service key ausente no Vault; nao da para assinar a midia.',
                  _admin
                );
                _failed := _failed + 1;
                EXIT;
              END IF;
              SELECT social_private.autopublish_http(_job.publication_id, 'POST',
                url := _settings.storage_base_url || '/storage/v1/object/sign/files',
                body := jsonb_build_object('paths', to_jsonb(_paths), 'expiresIn', 21600),
                headers := jsonb_build_object(
                  'Content-Type', 'application/json',
                  'Authorization', 'Bearer ' || _service_key,
                  'apikey', _service_key
                ),
                timeout_milliseconds := 15000
              ) INTO _request_id;
              UPDATE social_private.autopublish_jobs
              SET stage = 'sign', net_request_id = _request_id,
                  attempts = attempts + 1, step_attempts = step_attempts + 1,
                  updated_at = now()
              WHERE publication_id = _job.publication_id;
              _advanced := _advanced + 1;
              EXIT;
            END IF;
            _urls := ARRAY[social_private.autopublish_file_url(_pub.file_id)];
            IF _urls[1] IS NULL THEN
              PERFORM social_private.autopublish_mark_failed(
                _job.publication_id,
                'Arquivo sem caminho de storage e sem URL externa: nada para publicar.',
                _admin
              );
              _failed := _failed + 1;
              EXIT;
            END IF;
            UPDATE social_private.autopublish_jobs
            SET child_urls = _urls, updated_at = now()
            WHERE publication_id = _job.publication_id;
            _job.child_urls := _urls;
          END IF;

          _urls := _job.child_urls;
          IF _kind = 'carousel' THEN
            IF array_length(_urls, 1) < 2 THEN
              PERFORM social_private.autopublish_mark_failed(
                _job.publication_id,
                'Carrossel precisa de pelo menos 2 imagens acessiveis.',
                _admin
              );
              _failed := _failed + 1;
              EXIT;
            END IF;
            IF array_length(_urls, 1) > 10 THEN
              _urls := _urls[1:10];
              UPDATE social_private.autopublish_jobs
              SET child_urls = _urls, updated_at = now()
              WHERE publication_id = _job.publication_id;
            END IF;
            -- TODOS os cartoes de uma vez: e aqui que a v5 corta o tempo.
            _req_ids := ARRAY[]::bigint[];
            FOR _idx IN 1..array_length(_urls, 1) LOOP
              _payload := _graph || '/' || _token.resource_id || '/media'
                || '?image_url=' || social_private.autopublish_urlencode(_urls[_idx])
                || '&is_carousel_item=true'
                || '&access_token=' || _token.access_token;
              SELECT social_private.autopublish_http(_job.publication_id, 'POST', url := _payload, headers := '{}'::jsonb, timeout_milliseconds := 20000)
              INTO _request_id;
              _req_ids := _req_ids || _request_id;
            END LOOP;
            UPDATE social_private.autopublish_jobs
            SET stage = 'children',
                child_request_ids = _req_ids,
                child_container_ids = array_fill(NULL::text, ARRAY[array_length(_urls, 1)]),
                attempts = attempts + array_length(_urls, 1),
                step_attempts = 1,
                net_request_id = NULL,
                updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
            EXIT;
          ELSIF _kind = 'video' THEN
            _payload := _graph || '/' || _token.resource_id || '/media'
              || '?media_type=REELS'
              || '&video_url=' || social_private.autopublish_urlencode(_urls[1])
              || '&caption=' || social_private.autopublish_urlencode(_pub.caption)
              || '&access_token=' || _token.access_token;
          ELSIF _kind = 'story' THEN
            _payload := _graph || '/' || _token.resource_id || '/media'
              || '?media_type=STORIES'
              || '&image_url=' || social_private.autopublish_urlencode(_urls[1])
              || '&access_token=' || _token.access_token;
          ELSE
            _payload := _graph || '/' || _token.resource_id || '/media'
              || '?image_url=' || social_private.autopublish_urlencode(_urls[1])
              || '&caption=' || social_private.autopublish_urlencode(_pub.caption)
              || '&access_token=' || _token.access_token;
          END IF;
          SELECT social_private.autopublish_http(_job.publication_id, 'POST', url := _payload, headers := '{}'::jsonb, timeout_milliseconds := 20000)
          INTO _request_id;
          UPDATE social_private.autopublish_jobs
          SET net_request_id = _request_id, attempts = attempts + 1,
              step_attempts = step_attempts + 1, updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          EXIT;
        END IF;

        IF _job.stage = 'processing' THEN
          _payload := _graph || '/' || _job.container_id
            || '?fields=status_code&access_token=' || _token.access_token;
          SELECT social_private.autopublish_http(_job.publication_id, 'GET', url := _payload, timeout_milliseconds := 10000) INTO _request_id;
          UPDATE social_private.autopublish_jobs
          SET net_request_id = _request_id, updated_at = now()
          WHERE publication_id = _job.publication_id;
          EXIT;
        END IF;

        IF _job.stage = 'publish' AND _job.container_id IS NOT NULL THEN
          _payload := _graph || '/' || _token.resource_id || '/media_publish'
            || '?creation_id=' || _job.container_id
            || '&access_token=' || _token.access_token;
          SELECT social_private.autopublish_http(_job.publication_id, 'POST', url := _payload, headers := '{}'::jsonb, timeout_milliseconds := 20000)
          INTO _request_id;
          UPDATE social_private.autopublish_jobs
          SET net_request_id = _request_id, attempts = attempts + 1,
              step_attempts = step_attempts + 1,
              publish_dispatched = true, updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          EXIT;
        END IF;

        IF _job.stage = 'verify' AND _job.container_id IS NOT NULL THEN
          _payload := _graph || '/' || _job.container_id
            || '?fields=status_code&access_token=' || _token.access_token;
          SELECT social_private.autopublish_http(_job.publication_id, 'GET', url := _payload, timeout_milliseconds := 10000) INTO _request_id;
          UPDATE social_private.autopublish_jobs
          SET net_request_id = _request_id, step_attempts = step_attempts + 1, updated_at = now()
          WHERE publication_id = _job.publication_id;
          EXIT;
        END IF;

        IF _job.stage = 'recover' THEN
          PERFORM social_private.autopublish_mark_failed(_job.publication_id,
            'Recuperacao antiga sem identificador exato da midia. Confirme o link no perfil; nao reenviar.', _admin);
          EXIT;
        END IF;

        IF _job.stage = 'permalink' AND _job.media_id IS NOT NULL THEN
          _payload := _graph || '/' || _job.media_id
            || '?fields=permalink&access_token=' || _token.access_token;
          SELECT social_private.autopublish_http(_job.publication_id, 'GET', url := _payload, timeout_milliseconds := 10000) INTO _request_id;
          UPDATE social_private.autopublish_jobs
          SET net_request_id = _request_id, step_attempts = step_attempts + 1, updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          EXIT;
        END IF;

        EXIT; -- nenhum dispatch aplicavel nesta passada
      END LOOP;

    EXCEPTION WHEN SQLSTATE 'P6001' THEN
      INSERT INTO social_private.autopublish_job_events(publication_id,client_id,generation,event,stage,request_id,detail)
        SELECT publication_id,client_id,generation,'preparation_invalidated',stage,net_request_id,
          jsonb_build_object('attempts',attempts,'container_id',container_id,'child_container_ids',child_container_ids,'child_request_ids',child_request_ids)
        FROM social_private.autopublish_jobs WHERE publication_id = _job.publication_id;
      PERFORM social_private.autopublish_mark_failed(_job.publication_id,SQLERRM,_admin);
    WHEN SQLSTATE '55000' THEN
      -- Paused, rescheduled, revoked, stale or cancelled is not an HTTP failure.
      -- Preserve in-flight ids and attempts, so a kill switch cannot consume a
      -- retry budget or manufacture another request when re-enabled.
      UPDATE social_private.autopublish_jobs
      SET last_error = left(SQLERRM, 500), updated_at = clock_timestamp()
      WHERE publication_id = _job.publication_id;
    WHEN OTHERS THEN
      UPDATE social_private.autopublish_jobs
      SET last_error = left(SQLERRM, 500),
          step_attempts = step_attempts + 1,
          net_request_id = NULL,
          updated_at = now()
      WHERE publication_id = _job.publication_id;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'enabled', true, 'queued', _queued, 'advanced', _advanced,
    'published', _published, 'failed', _failed
  );
END
$function$;

REVOKE ALL ON FUNCTION public.editorial_autopublish_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.editorial_autopublish_tick() TO service_role;


CREATE OR REPLACE FUNCTION public.retry_autopublish(p_publication_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _job social_private.autopublish_jobs%ROWTYPE;
  _pub public.editorial_publications%ROWTYPE;
  _actor uuid := auth.uid();
  _next_stage text;
BEGIN
  PERFORM public.editorial_lock_task_sync();
  SELECT * INTO _job FROM social_private.autopublish_jobs WHERE publication_id = p_publication_id FOR UPDATE;
  IF NOT FOUND OR _actor IS NULL OR NOT public.is_staff(_actor) OR NOT public.can_access_client(_job.client_id) THEN
    RAISE EXCEPTION 'retry access denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _pub FROM public.editorial_publications WHERE id = p_publication_id FOR UPDATE;
  IF _pub.id IS NULL OR _pub.client_id IS DISTINCT FROM _job.client_id OR _pub.status IN ('cancelled','published') OR _job.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'cancelled or completed publication cannot be retried; reopen and schedule explicitly' USING ERRCODE = '55000';
  END IF;
  IF _job.stage <> 'failed' THEN
    IF _job.stage NOT IN ('done','cancelled') THEN
      RETURN jsonb_build_object('publication_id',p_publication_id,'stage',_job.stage,'recovered',true);
    END IF;
    RAISE EXCEPTION 'publication attempt is terminal' USING ERRCODE = '55000';
  END IF;
  IF _job.publish_dispatched AND _job.container_id IS NULL THEN
    RAISE EXCEPTION 'dispatch result requires manual reconciliation; no replacement container may be published' USING ERRCODE = '55000';
  END IF;
  _next_stage := CASE WHEN _job.publish_dispatched THEN 'verify' ELSE 'queued' END;
  IF _pub.status = 'failed' AND NOT _job.publish_dispatched THEN
    PERFORM public.transition_editorial_publication(p_publication_id,'schedule',_pub.version,
      greatest(_pub.scheduled_at,clock_timestamp() + interval '1 minute'));
  END IF;
  INSERT INTO social_private.autopublish_job_events(publication_id,client_id,generation,event,stage,request_id,detail)
    VALUES (_job.publication_id,_job.client_id,_job.generation,'retry',_job.stage,_job.net_request_id,
      jsonb_build_object('attempts',_job.attempts,'container_id',_job.container_id,'child_container_ids',_job.child_container_ids,'child_request_ids',_job.child_request_ids,'next_stage',_next_stage));
  UPDATE social_private.autopublish_jobs SET stage = _next_stage, step_attempts = 0, poll_count = 0,
    net_request_id = NULL, last_error = NULL,
    dispatch_fingerprint = CASE WHEN _next_stage = 'queued' THEN NULL ELSE dispatch_fingerprint END,
    child_index = CASE WHEN _next_stage = 'queued' THEN 0 ELSE child_index END,
    child_urls = CASE WHEN _next_stage = 'queued' THEN ARRAY[]::text[] ELSE child_urls END,
    child_container_ids = CASE WHEN _next_stage = 'queued' THEN ARRAY[]::text[] ELSE child_container_ids END,
    child_request_ids = CASE WHEN _next_stage = 'queued' THEN ARRAY[]::bigint[] ELSE child_request_ids END,
    container_id = CASE WHEN _next_stage = 'queued' THEN NULL ELSE container_id END,
    updated_at = clock_timestamp() WHERE publication_id = p_publication_id;
  RETURN jsonb_build_object('publication_id',p_publication_id,'stage',_next_stage,'recovered',false);
END $$;
REVOKE ALL ON FUNCTION public.retry_autopublish(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_autopublish(uuid) TO authenticated;
COMMIT;
