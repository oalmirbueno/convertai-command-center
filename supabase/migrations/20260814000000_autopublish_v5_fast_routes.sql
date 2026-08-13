-- ============================================================================
-- Aceleriq OS - publicação automática v5: rota rápida
-- ============================================================================
--
-- O problema: o motor andava UM passo por minuto. Um carrossel de 7 cartões
-- fazia ~11 idas à Meta = 20 e poucos minutos com a equipe olhando. Dois
-- gargalos:
--   1. Os cartões eram criados UM POR VEZ (um por minuto).
--   2. Depois de ler uma resposta, o próximo passo só saía no minuto seguinte.
--
-- A v5 corta os dois:
--   1. CARTÕES EM PARALELO: todos os containers do carrossel são disparados de
--      uma vez (nova coluna child_request_ids acompanha cada um na ordem).
--   2. PASSO EMENDADO: na mesma rodada em que uma resposta chega, o próximo
--      passo já é disparado (laço interno de até 3 passadas por job).
--
-- Resultado: carrossel de qualquer tamanho em ~5 a 6 minutos; post simples em
-- ~3. Todas as garantias anteriores continuam: link assinado (v4), verify sem
-- duplicar post, tentativas por passo, falha visível e baixa oficial.
-- ============================================================================

ALTER TABLE social_private.autopublish_jobs
  ADD COLUMN IF NOT EXISTS child_request_ids bigint[] NOT NULL DEFAULT ARRAY[]::bigint[];

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
        EXIT WHEN _job.stage IN ('done', 'failed');

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
              SELECT net.http_post(url := _payload, headers := '{}'::jsonb, timeout_milliseconds := 20000)
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
          EXIT WHEN _job.stage IN ('done', 'failed');

          IF _all_ready AND NOT EXISTS (
            SELECT 1 FROM unnest(_job.child_container_ids) AS c(id) WHERE c.id IS NULL
          ) AND COALESCE(array_length(_job.child_container_ids, 1), 0) > 0 THEN
            -- Todos os cartoes prontos: monta o pai JA NESTA rodada.
            _payload := _graph || '/' || _token.resource_id || '/media'
              || '?media_type=CAROUSEL'
              || '&children=' || array_to_string(_job.child_container_ids, ',')
              || '&caption=' || social_private.autopublish_urlencode(_pub.caption)
              || '&access_token=' || _token.access_token;
            SELECT net.http_post(url := _payload, headers := '{}'::jsonb, timeout_milliseconds := 20000)
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
              UPDATE social_private.autopublish_jobs
              SET stage = 'recover', step_attempts = 0, net_request_id = NULL, updated_at = now()
              WHERE publication_id = _job.publication_id;
              _advanced := _advanced + 1;
              CONTINUE;
            ELSIF _status_code = 'FINISHED' THEN
              UPDATE social_private.autopublish_jobs
              SET stage = 'publish', net_request_id = NULL, updated_at = now()
              WHERE publication_id = _job.publication_id;
              _advanced := _advanced + 1;
              CONTINUE;
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
            IF jsonb_array_length(COALESCE(_body->'data', '[]'::jsonb)) > 0 THEN
              UPDATE social_private.autopublish_jobs
              SET media_id = _body->'data'->0->>'id',
                  permalink = _body->'data'->0->>'permalink',
                  stage = 'permalink', step_attempts = 0,
                  net_request_id = NULL, updated_at = now()
              WHERE publication_id = _job.publication_id;
              _advanced := _advanced + 1;
              CONTINUE;
            ELSE
              UPDATE social_private.autopublish_jobs
              SET stage = 'done', net_request_id = NULL,
                  last_error = 'Post publicado, mas nao foi possivel recuperar o link. Confirme no perfil.',
                  updated_at = now()
              WHERE publication_id = _job.publication_id;
              EXIT;
            END IF;

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
        EXIT WHEN _job.stage IN ('done', 'failed');
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
              SELECT net.http_post(
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
              SELECT net.http_post(url := _payload, headers := '{}'::jsonb, timeout_milliseconds := 20000)
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
          SELECT net.http_post(url := _payload, headers := '{}'::jsonb, timeout_milliseconds := 20000)
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
          SELECT net.http_get(url := _payload, timeout_milliseconds := 10000) INTO _request_id;
          UPDATE social_private.autopublish_jobs
          SET net_request_id = _request_id, updated_at = now()
          WHERE publication_id = _job.publication_id;
          EXIT;
        END IF;

        IF _job.stage = 'publish' AND _job.container_id IS NOT NULL THEN
          _payload := _graph || '/' || _token.resource_id || '/media_publish'
            || '?creation_id=' || _job.container_id
            || '&access_token=' || _token.access_token;
          SELECT net.http_post(url := _payload, headers := '{}'::jsonb, timeout_milliseconds := 20000)
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
          SELECT net.http_get(url := _payload, timeout_milliseconds := 10000) INTO _request_id;
          UPDATE social_private.autopublish_jobs
          SET net_request_id = _request_id, step_attempts = step_attempts + 1, updated_at = now()
          WHERE publication_id = _job.publication_id;
          EXIT;
        END IF;

        IF _job.stage = 'recover' THEN
          _payload := _graph || '/' || _token.resource_id || '/media'
            || '?fields=id,permalink&limit=1'
            || '&access_token=' || _token.access_token;
          SELECT net.http_get(url := _payload, timeout_milliseconds := 10000) INTO _request_id;
          UPDATE social_private.autopublish_jobs
          SET net_request_id = _request_id, step_attempts = step_attempts + 1, updated_at = now()
          WHERE publication_id = _job.publication_id;
          EXIT;
        END IF;

        IF _job.stage = 'permalink' AND _job.media_id IS NOT NULL THEN
          _payload := _graph || '/' || _job.media_id
            || '?fields=permalink&access_token=' || _token.access_token;
          SELECT net.http_get(url := _payload, timeout_milliseconds := 10000) INTO _request_id;
          UPDATE social_private.autopublish_jobs
          SET net_request_id = _request_id, step_attempts = step_attempts + 1, updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          EXIT;
        END IF;

        EXIT; -- nenhum dispatch aplicavel nesta passada
      END LOOP;

    EXCEPTION WHEN OTHERS THEN
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

-- Retry tambem limpa o rastro dos cartoes paralelos.
CREATE OR REPLACE FUNCTION public.retry_autopublish(p_publication_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _job social_private.autopublish_jobs%ROWTYPE;
  _actor uuid := auth.uid();
  _next_stage text;
BEGIN
  SELECT * INTO _job
  FROM social_private.autopublish_jobs
  WHERE publication_id = p_publication_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'nenhuma tentativa de publicacao automatica para reprocessar';
  END IF;

  IF _actor IS NULL
    OR NOT public.is_staff(_actor)
    OR NOT public.can_access_client(_job.client_id) THEN
    RAISE EXCEPTION 'retry access denied';
  END IF;

  IF _job.stage <> 'failed' THEN
    RAISE EXCEPTION 'a publicacao nao esta em falha (estagio atual: %)', _job.stage;
  END IF;

  _next_stage := CASE
    WHEN _job.publish_dispatched AND _job.container_id IS NOT NULL THEN 'verify'
    ELSE 'queued'
  END;

  UPDATE social_private.autopublish_jobs
  SET stage = _next_stage,
      step_attempts = 0,
      poll_count = 0,
      net_request_id = NULL,
      last_error = NULL,
      child_index = CASE WHEN _next_stage = 'queued' THEN 0 ELSE child_index END,
      child_urls = CASE WHEN _next_stage = 'queued' THEN ARRAY[]::text[] ELSE child_urls END,
      child_container_ids = CASE WHEN _next_stage = 'queued' THEN ARRAY[]::text[] ELSE child_container_ids END,
      child_request_ids = ARRAY[]::bigint[],
      container_id = CASE WHEN _next_stage = 'queued' THEN NULL ELSE container_id END,
      updated_at = now()
  WHERE publication_id = p_publication_id;

  RETURN jsonb_build_object('publication_id', p_publication_id, 'stage', _next_stage);
END;
$$;

REVOKE ALL ON FUNCTION public.retry_autopublish(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_autopublish(uuid) TO authenticated;
