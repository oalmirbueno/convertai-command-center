-- Publicacao automatica v2: post unico, CARROSSEL e VIDEO/REEL.
--
-- Evolucao do worker criado em 20260812140000. O que muda:
--   - Carrossel: cria um container por card (na ordem do painel: capa +
--     cards numerados pelo nome do arquivo, "card 1", "1_...", etc.),
--     depois o container pai (media_type=CAROUSEL) com a legenda, e publica.
--   - Video/Reel: cria container media_type=REELS com a URL do video e
--     ESPERA o processamento do Instagram terminar (status FINISHED) antes
--     de publicar. Processamento demora minutos; o poll nao conta como erro.
--   - Correcao: a baixa oficial no painel usa a assinatura nomeada de
--     transition_editorial_publication (a chamada posicional do v1 falharia).
--
-- Aplicar por inteiro. Idempotente: pode rodar de novo sem efeito colateral.

-- ── Fila ganha os estagios novos e o cursor do carrossel ──
ALTER TABLE social_private.autopublish_jobs
  ADD COLUMN IF NOT EXISTS child_index smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS poll_count smallint NOT NULL DEFAULT 0;

ALTER TABLE social_private.autopublish_jobs
  DROP CONSTRAINT IF EXISTS autopublish_jobs_stage_check;
ALTER TABLE social_private.autopublish_jobs
  ADD CONSTRAINT autopublish_jobs_stage_check CHECK (
    stage IN ('queued', 'children', 'parent', 'processing', 'publish', 'permalink', 'done', 'failed')
  );

-- ── URLs ordenadas do carrossel: capa + cards na ordem do painel ──
CREATE OR REPLACE FUNCTION social_private.autopublish_carousel_urls(_root_file_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH ordered_children AS (
    SELECT
      social_private.autopublish_file_url(child.id) AS url,
      COALESCE(
        NULLIF(substring(child.file_name FROM '(?i)(?:card|slide|p[aá]gina|page)[ ._-]*(\d+)'), '')::int,
        NULLIF(substring(child.file_name FROM '^(\d+)[ ._-]'), '')::int,
        32000
      ) AS order_index,
      child.created_at
    FROM public.files AS child
    WHERE child.parent_file_id = _root_file_id
      AND child.archived_at IS NULL
      AND COALESCE(child.status, 'ready') NOT IN ('deleted', 'failed')
  )
  SELECT ARRAY(
    SELECT url FROM (
      SELECT social_private.autopublish_file_url(_root_file_id) AS url, -1 AS order_index, NULL::timestamptz AS created_at
      UNION ALL
      SELECT url, order_index, created_at FROM ordered_children
    ) AS all_items
    WHERE url IS NOT NULL
    ORDER BY order_index, created_at NULLS LAST
  );
$function$;

-- ── Executor v2 ──
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
  _kind text;
  _status_code text;
BEGIN
  SELECT * INTO _settings FROM social_private.autopublish_settings WHERE id;
  IF _settings IS NULL OR NOT _settings.enabled THEN
    RETURN jsonb_build_object('enabled', false);
  END IF;

  _graph := 'https://graph.facebook.com/' || _settings.graph_version;

  SELECT user_id INTO _admin
  FROM public.user_roles
  WHERE role = 'admin'::public.app_role
  ORDER BY user_id
  LIMIT 1;

  -- 1. Enfileira o que esta agendado, automatico e com a hora chegada.
  FOR _due IN
    SELECT publication.id, publication.client_id
    FROM public.editorial_publications AS publication
    JOIN public.editorial_posts AS post ON post.id = publication.post_id
    WHERE publication.status = 'scheduled'
      AND publication.platform = 'instagram'
      AND publication.delivery_mode = 'automatic'
      AND publication.scheduled_at IS NOT NULL
      AND publication.scheduled_at <= now()
      AND post.content_type IN ('static', 'design', 'story', 'carousel', 'reel', 'video', 'short')
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

  -- 2. Avanca cada job, um passo por tick.
  FOR _job IN
    SELECT * FROM social_private.autopublish_jobs
    WHERE stage NOT IN ('done', 'failed')
    ORDER BY created_at
    LIMIT 10
  LOOP
    BEGIN
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
        UPDATE social_private.autopublish_jobs
        SET stage = 'failed', last_error = 'Conta Instagram sem conexao ativa ou token indisponivel.', updated_at = now()
        WHERE publication_id = _job.publication_id;
        _failed := _failed + 1;
        CONTINUE;
      END IF;

      _kind := CASE
        WHEN _pub.content_type = 'carousel' THEN 'carousel'
        WHEN _pub.content_type IN ('reel', 'video', 'short') THEN 'video'
        ELSE 'image'
      END;

      -- 2a. Le resposta pendente, se houver.
      IF _job.net_request_id IS NOT NULL THEN
        SELECT status_code, content INTO _response
        FROM net._http_response WHERE id = _job.net_request_id;
        IF NOT FOUND THEN CONTINUE; END IF;

        IF _response.status_code IS NULL OR _response.status_code >= 300 THEN
          UPDATE social_private.autopublish_jobs
          SET stage = CASE WHEN attempts >= _settings.max_attempts THEN 'failed' ELSE stage END,
              net_request_id = NULL,
              last_error = left(COALESCE(_response.content::text, 'sem resposta'), 500),
              updated_at = now()
          WHERE publication_id = _job.publication_id;
          _failed := _failed + 1;
          CONTINUE;
        END IF;

        _body := _response.content::jsonb;

        IF _job.stage = 'queued' THEN
          -- resposta do primeiro container
          IF _kind = 'video' THEN
            UPDATE social_private.autopublish_jobs
            SET container_id = _body->>'id', stage = 'processing', poll_count = 0, net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
          ELSIF _kind = 'carousel' THEN
            UPDATE social_private.autopublish_jobs
            SET child_container_ids = child_container_ids || (_body->>'id'),
                child_index = child_index + 1,
                net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
            UPDATE social_private.autopublish_jobs
            SET stage = 'children'
            WHERE publication_id = _job.publication_id;
          ELSE
            UPDATE social_private.autopublish_jobs
            SET container_id = _body->>'id', stage = 'publish', net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
          END IF;
          _advanced := _advanced + 1;
          CONTINUE;
        END IF;

        IF _job.stage = 'children' THEN
          UPDATE social_private.autopublish_jobs
          SET child_container_ids = child_container_ids || (_body->>'id'),
              child_index = child_index + 1,
              net_request_id = NULL, updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          CONTINUE;
        END IF;

        IF _job.stage = 'parent' THEN
          UPDATE social_private.autopublish_jobs
          SET container_id = _body->>'id', stage = 'publish', net_request_id = NULL, updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          CONTINUE;
        END IF;

        IF _job.stage = 'processing' THEN
          _status_code := COALESCE(_body->>'status_code', '');
          IF _status_code = 'FINISHED' THEN
            UPDATE social_private.autopublish_jobs
            SET stage = 'publish', net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
          ELSIF _status_code = 'ERROR' THEN
            UPDATE social_private.autopublish_jobs
            SET stage = 'failed', net_request_id = NULL,
                last_error = left('Instagram nao conseguiu processar o video: ' || COALESCE(_body::text, ''), 500),
                updated_at = now()
            WHERE publication_id = _job.publication_id;
            _failed := _failed + 1;
          ELSE
            -- ainda processando: espera o proximo tick
            UPDATE social_private.autopublish_jobs
            SET net_request_id = NULL, poll_count = poll_count + 1, updated_at = now()
            WHERE publication_id = _job.publication_id;
            IF _job.poll_count >= 40 THEN
              UPDATE social_private.autopublish_jobs
              SET stage = 'failed', last_error = 'Video passou de 40 minutos em processamento.', updated_at = now()
              WHERE publication_id = _job.publication_id;
              _failed := _failed + 1;
            END IF;
          END IF;
          CONTINUE;
        END IF;

        IF _job.stage = 'publish' THEN
          UPDATE social_private.autopublish_jobs
          SET media_id = _body->>'id', stage = 'permalink', net_request_id = NULL, updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          CONTINUE;
        END IF;

        IF _job.stage = 'permalink' THEN
          UPDATE social_private.autopublish_jobs
          SET permalink = _body->>'permalink', stage = 'done', net_request_id = NULL, updated_at = now()
          WHERE publication_id = _job.publication_id;

          IF _admin IS NOT NULL THEN
            PERFORM set_config(
              'request.jwt.claims',
              json_build_object('sub', _admin::text, 'role', 'authenticated')::text,
              true
            );
            PERFORM public.transition_editorial_publication(
              p_publication_id => _job.publication_id,
              p_action => 'publish',
              p_expected_version => _pub.version,
              p_permalink => _body->>'permalink',
              p_external_post_id => _job.media_id,
              p_published_at => now()
            );
          END IF;
          _published := _published + 1;
          CONTINUE;
        END IF;
      END IF;

      -- 2b. Sem requisicao em voo: dispara o proximo passo.
      IF _job.stage = 'queued' THEN
        IF _kind = 'carousel' THEN
          _urls := social_private.autopublish_carousel_urls(_pub.file_id);
          IF _urls IS NULL OR array_length(_urls, 1) < 2 THEN
            UPDATE social_private.autopublish_jobs
            SET stage = 'failed', last_error = 'Carrossel precisa de pelo menos 2 imagens com URL publica.', updated_at = now()
            WHERE publication_id = _job.publication_id;
            _failed := _failed + 1;
            CONTINUE;
          END IF;
          IF array_length(_urls, 1) > 10 THEN
            _urls := _urls[1:10];
          END IF;
          UPDATE social_private.autopublish_jobs
          SET child_urls = _urls, child_index = 0, child_container_ids = ARRAY[]::text[], updated_at = now()
          WHERE publication_id = _job.publication_id;
          _payload := _graph || '/' || _token.resource_id || '/media'
            || '?image_url=' || social_private.autopublish_urlencode(_urls[1])
            || '&is_carousel_item=true'
            || '&access_token=' || _token.access_token;
        ELSIF _kind = 'video' THEN
          _payload := _graph || '/' || _token.resource_id || '/media'
            || '?media_type=REELS'
            || '&video_url=' || social_private.autopublish_urlencode(social_private.autopublish_file_url(_pub.file_id))
            || '&caption=' || social_private.autopublish_urlencode(_pub.caption)
            || '&access_token=' || _token.access_token;
        ELSE
          _payload := _graph || '/' || _token.resource_id || '/media'
            || '?image_url=' || social_private.autopublish_urlencode(social_private.autopublish_file_url(_pub.file_id))
            || '&caption=' || social_private.autopublish_urlencode(_pub.caption)
            || '&access_token=' || _token.access_token;
        END IF;
        SELECT net.http_post(url := _payload, headers := '{}'::jsonb) INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, attempts = attempts + 1, updated_at = now()
        WHERE publication_id = _job.publication_id;
        _advanced := _advanced + 1;
        CONTINUE;
      END IF;

      IF _job.stage = 'children' THEN
        IF _job.child_index < COALESCE(array_length(_job.child_urls, 1), 0) THEN
          _payload := _graph || '/' || _token.resource_id || '/media'
            || '?image_url=' || social_private.autopublish_urlencode(_job.child_urls[_job.child_index + 1])
            || '&is_carousel_item=true'
            || '&access_token=' || _token.access_token;
          SELECT net.http_post(url := _payload, headers := '{}'::jsonb) INTO _request_id;
          UPDATE social_private.autopublish_jobs
          SET net_request_id = _request_id, attempts = attempts + 1, updated_at = now()
          WHERE publication_id = _job.publication_id;
        ELSE
          _payload := _graph || '/' || _token.resource_id || '/media'
            || '?media_type=CAROUSEL'
            || '&children=' || array_to_string(_job.child_container_ids, ',')
            || '&caption=' || social_private.autopublish_urlencode(_pub.caption)
            || '&access_token=' || _token.access_token;
          SELECT net.http_post(url := _payload, headers := '{}'::jsonb) INTO _request_id;
          UPDATE social_private.autopublish_jobs
          SET stage = 'parent', net_request_id = _request_id, attempts = attempts + 1, updated_at = now()
          WHERE publication_id = _job.publication_id;
        END IF;
        _advanced := _advanced + 1;
        CONTINUE;
      END IF;

      IF _job.stage = 'processing' THEN
        _payload := _graph || '/' || _job.container_id
          || '?fields=status_code&access_token=' || _token.access_token;
        SELECT net.http_get(url := _payload) INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, updated_at = now()
        WHERE publication_id = _job.publication_id;
        CONTINUE;
      END IF;

      IF _job.stage = 'publish' AND _job.container_id IS NOT NULL THEN
        _payload := _graph || '/' || _token.resource_id || '/media_publish'
          || '?creation_id=' || _job.container_id
          || '&access_token=' || _token.access_token;
        SELECT net.http_post(url := _payload, headers := '{}'::jsonb) INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, attempts = attempts + 1, updated_at = now()
        WHERE publication_id = _job.publication_id;
        _advanced := _advanced + 1;
        CONTINUE;
      END IF;

      IF _job.stage = 'permalink' AND _job.media_id IS NOT NULL THEN
        _payload := _graph || '/' || _job.media_id
          || '?fields=permalink&access_token=' || _token.access_token;
        SELECT net.http_get(url := _payload) INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, updated_at = now()
        WHERE publication_id = _job.publication_id;
        _advanced := _advanced + 1;
        CONTINUE;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      UPDATE social_private.autopublish_jobs
      SET last_error = left(SQLERRM, 500),
          stage = CASE WHEN attempts >= _settings.max_attempts THEN 'failed' ELSE stage END,
          net_request_id = NULL,
          updated_at = now()
      WHERE publication_id = _job.publication_id;
      _failed := _failed + 1;
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
