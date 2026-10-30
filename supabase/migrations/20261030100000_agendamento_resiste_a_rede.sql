-- ═══════════════════════════════════════════════════════════════════════
-- Agendamento que não falha por tropeço de rede (30/10/2026).
--
-- Dono: "está muito agendamento falhando; não pode ficar falhando toda hora".
-- Medido: as falhas de 29/10 16:00 e 30/10 09:30 (AcelerIQ) foram "Cartao N do
-- carrossel falhou: Timeout of 20000 ms reached ... TCP/SSL handshake time:
-- 19998 ms": a conexão com a Meta travou no aperto de mão, antes de qualquer
-- resposta. O motor refazia o cartão, mas com 4 tentativas no total
-- (compartilhadas entre todos os cartões) e logo no tick seguinte: um minuto
-- ruim de rede esgotava tudo e o post virava "falhou".
--
-- O que muda em public.editorial_autopublish_tick (a definição de produção, lida
-- com pg_get_functiondef, com só estas mudanças):
--   1. Erro de rede passageiro (tempo esgotado, sem resposta, 5xx, 429): até 12
--      tentativas (nos cartões do carrossel, 12 por cartão) com espera crescente
--      entre elas (30 s, 60 s... até 5 min), uns 40 minutos de folga.
--   2. Recusa de verdade da Meta (4xx): o limite de 4 de antes.
--   3. Tempo de espera das chamadas de criação e publicação: 20 s -> 40 s.
-- Nada mais muda (ordem dos passos, travas, avisos, cancelamento).
-- Reverter: reaplicar a função de 20261023160000_carrossel_com_video.sql.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.editorial_autopublish_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
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
  _story_video boolean := false;
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
  -- [carrossel-video]
  _video_wait boolean;
  _video_failed boolean;
  _status_round boolean;
  -- [/carrossel-video]
  _step_limit constant smallint := 4;
  _lost_after constant interval := interval '10 minutes';
  -- 30/10/2026: erro de rede passageiro (tempo esgotado, sem resposta, 5xx, 429) tem mais tentativas e espera crescente.
  _limite_transitorio constant smallint := 12;
  _transitorio boolean;
  _cartoes int;
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

      -- 20/10 (Stories): story em video vai como STORIES com video_url e espera o
      -- processamento do video, como o reel. Story em imagem segue igual.
      _story_video := false;
      IF _kind = 'story' THEN
        SELECT COALESCE(lower(file_row.mime_type) LIKE 'video/%', false)
            OR lower(COALESCE(file_row.extension, '')) IN ('mp4', 'mov', 'm4v')
          INTO _story_video
          FROM public.files AS file_row
         WHERE file_row.id = _pub.file_id;
        _story_video := COALESCE(_story_video, false);
      END IF;

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
              -- 30/10/2026: rede (tempo esgotado, sem resposta, 5xx, 429) tem mais tentativas, por cartao, com espera
              -- crescente (30 s, 60 s... ate 5 min). Recusa de verdade da Meta (4xx) segue com o limite de antes.
              _transitorio := _response.timed_out OR _response.status_code IS NULL OR _response.status_code >= 500 OR _response.status_code = 429;
              _cartoes := greatest(1, COALESCE(array_length(_job.child_urls, 1), 1));
              IF _transitorio AND _job.step_attempts < _limite_transitorio * _cartoes
                AND _job.updated_at > now() - make_interval(secs => least(300, 30 * greatest(1, _job.step_attempts / _cartoes))) THEN
                CONTINUE;
              END IF;
              IF _job.step_attempts >= (CASE WHEN _transitorio THEN _limite_transitorio * _cartoes ELSE _step_limit END) THEN
                PERFORM social_private.autopublish_mark_failed(
                  _job.publication_id,
                  'Cartao ' || _idx || ' do carrossel falhou: ' ||
                    left(COALESCE(_response.content::text, _response.error_msg, 'sem resposta'), 300),
                  _admin
                );
                _failed := _failed + 1;
                EXIT;
              END IF;
              -- [carrossel-video] 23/10: cartao em video vai como VIDEO (video_url); imagem segue com image_url.
              IF COALESCE(_job.child_urls[_idx], '') ~* '\.(mp4|mov|m4v)(\?|$)' THEN
                _payload := _graph || '/' || _token.resource_id || '/media'
                  || '?media_type=VIDEO'
                  || '&video_url=' || social_private.autopublish_urlencode(_job.child_urls[_idx])
                  || '&is_carousel_item=true'
                  || '&access_token=' || _token.access_token;
              ELSE
                _payload := _graph || '/' || _token.resource_id || '/media'
                  || '?image_url=' || social_private.autopublish_urlencode(_job.child_urls[_idx])
                  || '&is_carousel_item=true'
                  || '&access_token=' || _token.access_token;
              END IF;
              -- [/carrossel-video]
              SELECT social_private.autopublish_http(_job.publication_id, 'POST', url := _payload, headers := '{}'::jsonb, timeout_milliseconds := 40000)
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

          -- [carrossel-video] 23/10: com todos os containers criados, cada cartao em video precisa
          -- terminar o processamento (status_code FINISHED) antes do pai CAROUSEL. Uma rodada de
          -- consulta por tick (o pg_net responde depois do COMMIT), no maximo 40, como o reel.
          -- O id da consulta fica em child_request_ids[i] (o do container ja foi lido).
          _video_wait := false;
          _video_failed := false;
          _status_round := false;
          IF _all_ready AND NOT EXISTS (
            SELECT 1 FROM unnest(_job.child_container_ids) AS c(id) WHERE c.id IS NULL
          ) AND COALESCE(array_length(_job.child_container_ids, 1), 0) > 0 THEN
            _req_ids := _job.child_request_ids;
            FOR _idx IN 1..array_length(_job.child_container_ids, 1) LOOP
              CONTINUE WHEN NOT (COALESCE(_job.child_urls[_idx], '') ~* '\.(mp4|mov|m4v)(\?|$)');
              _status_code := '';
              IF _req_ids[_idx] IS NOT NULL THEN
                SELECT status_code, content, timed_out, error_msg INTO _response
                FROM net._http_response WHERE id = _req_ids[_idx];
                IF NOT FOUND THEN
                  IF _job.updated_at >= now() - _lost_after THEN
                    -- Consulta em voo: espera o proximo minuto.
                    _video_wait := true;
                    CONTINUE;
                  END IF;
                ELSIF NOT COALESCE(_response.timed_out, false)
                  AND _response.status_code IS NOT NULL
                  AND _response.status_code < 300 THEN
                  BEGIN
                    _status_code := COALESCE((_response.content::jsonb)->>'status_code', '');
                  EXCEPTION WHEN OTHERS THEN
                    _status_code := '';
                  END;
                END IF;
              END IF;
              CONTINUE WHEN _status_code = 'FINISHED';
              IF _status_code IN ('ERROR', 'EXPIRED') THEN
                PERFORM social_private.autopublish_mark_failed(
                  _job.publication_id,
                  'Cartao ' || _idx || ' do carrossel (video): o Instagram nao conseguiu processar o video: ' ||
                    left(COALESCE(_response.content::text, ''), 300),
                  _admin
                );
                _failed := _failed + 1;
                _video_failed := true;
                EXIT;
              END IF;
              -- Sem status ainda (resposta do container, IN_PROGRESS ou leitura falha): consulta de novo.
              _video_wait := true;
              _payload := _graph || '/' || _job.child_container_ids[_idx]
                || '?fields=status_code&access_token=' || _token.access_token;
              SELECT social_private.autopublish_http(_job.publication_id, 'GET', url := _payload, timeout_milliseconds := 10000)
              INTO _request_id;
              _req_ids[_idx] := _request_id;
              _status_round := true;
            END LOOP;
            EXIT WHEN _video_failed;
            IF _status_round THEN
              UPDATE social_private.autopublish_jobs
              SET child_request_ids = _req_ids, poll_count = poll_count + 1, updated_at = now()
              WHERE publication_id = _job.publication_id;
              IF _job.poll_count >= 40 THEN
                PERFORM social_private.autopublish_mark_failed(
                  _job.publication_id,
                  'Video do carrossel passou de 40 minutos em processamento no Instagram.',
                  _admin
                );
                _failed := _failed + 1;
                EXIT;
              END IF;
            END IF;
          END IF;
          IF _all_ready AND NOT _video_wait AND NOT EXISTS (
          -- [/carrossel-video]
            SELECT 1 FROM unnest(_job.child_container_ids) AS c(id) WHERE c.id IS NULL
          ) AND COALESCE(array_length(_job.child_container_ids, 1), 0) > 0 THEN
            -- Todos os cartoes prontos: monta o pai JA NESTA rodada.
            _payload := _graph || '/' || _token.resource_id || '/media'
              || '?media_type=CAROUSEL'
              || '&children=' || array_to_string(_job.child_container_ids, ',')
              || '&caption=' || social_private.autopublish_urlencode(_pub.caption)
              || '&access_token=' || _token.access_token;
            SELECT social_private.autopublish_http(_job.publication_id, 'POST', url := _payload, headers := '{}'::jsonb, timeout_milliseconds := 40000)
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
                -- 30/10/2026: o erro de rede fica marcado para a espera crescente e o limite maior (bloco C).
                last_error = left((CASE WHEN _response.timed_out OR _response.status_code IS NULL OR _response.status_code >= 500 OR _response.status_code = 429 THEN '[rede] ' ELSE '' END) || COALESCE(
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
            IF _kind = 'video' OR (_kind = 'story' AND _story_video) THEN
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

        -- 30/10/2026: depois de erro de rede, espera crescente antes de tentar de novo, e mais tentativas.
        IF COALESCE(_job.last_error, '') LIKE '[rede]%' AND _job.step_attempts < _limite_transitorio
          AND _job.updated_at > now() - make_interval(secs => least(300, 30 * greatest(1, _job.step_attempts))) THEN
          EXIT;
        END IF;
        IF _job.step_attempts >= (CASE WHEN COALESCE(_job.last_error, '') LIKE '[rede]%' THEN _limite_transitorio ELSE _step_limit END) THEN
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
                url := _settings.storage_base_url || '/storage/v1/object/sign/' || social_private.autopublish_storage_bucket(_pub.id, _pub.file_id),
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
              -- [carrossel-video] 23/10: cartao em video vai como VIDEO (video_url); imagem segue com image_url.
              IF COALESCE(_urls[_idx], '') ~* '\.(mp4|mov|m4v)(\?|$)' THEN
                _payload := _graph || '/' || _token.resource_id || '/media'
                  || '?media_type=VIDEO'
                  || '&video_url=' || social_private.autopublish_urlencode(_urls[_idx])
                  || '&is_carousel_item=true'
                  || '&access_token=' || _token.access_token;
              ELSE
                _payload := _graph || '/' || _token.resource_id || '/media'
                  || '?image_url=' || social_private.autopublish_urlencode(_urls[_idx])
                  || '&is_carousel_item=true'
                  || '&access_token=' || _token.access_token;
              END IF;
              -- [/carrossel-video]
              SELECT social_private.autopublish_http(_job.publication_id, 'POST', url := _payload, headers := '{}'::jsonb, timeout_milliseconds := 40000)
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
          ELSIF _kind = 'story' AND _story_video THEN
            _payload := _graph || '/' || _token.resource_id || '/media'
              || '?media_type=STORIES'
              || '&video_url=' || social_private.autopublish_urlencode(_urls[1])
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
          SELECT social_private.autopublish_http(_job.publication_id, 'POST', url := _payload, headers := '{}'::jsonb, timeout_milliseconds := 40000)
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
          SELECT social_private.autopublish_http(_job.publication_id, 'POST', url := _payload, headers := '{}'::jsonb, timeout_milliseconds := 40000)
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
$$;
