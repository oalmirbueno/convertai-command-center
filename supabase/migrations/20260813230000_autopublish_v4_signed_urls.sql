-- ============================================================================
-- Aceleriq OS - publicação automática v4: mídia com link ASSINADO
-- ============================================================================
--
-- O erro real devolvido pela Meta na primeira publicação de verdade:
--   "Only photo or video can be accepted as media type" / "Falha ao baixar
--    mídia. O URI da mídia não atende aos nossos requisitos:
--    .../storage/v1/object/public/files/..."
--
-- Causa: o motor montava link PÚBLICO para a arte, mas o bucket `files` é
-- PRIVADO desde julho (decisão de segurança correta). A Meta tentava baixar,
-- levava porta na cara, e o job falhava.
--
-- Correção: novo estágio `sign` na máquina. Antes de criar qualquer container,
-- o motor pede ao Storage links ASSINADOS (validade 6 horas, uma chamada em
-- lote para todos os cartões) usando a service key guardada no Vault (a mesma
-- infraestrutura da fila de e-mails). O bucket continua privado; só a Meta,
-- com o link assinado e temporário, consegue baixar.
--
-- Também entra `autopublish_storage_paths`: os CAMINHOS dos arquivos na ordem
-- congelada do agendamento (fallback: leitura por nome), porque a assinatura
-- trabalha com caminhos, não com URLs.
-- ============================================================================

-- ─────────────────────────── Estágio novo na fila ────────────────────────────
ALTER TABLE social_private.autopublish_jobs
  DROP CONSTRAINT IF EXISTS autopublish_jobs_stage_check;
ALTER TABLE social_private.autopublish_jobs
  ADD CONSTRAINT autopublish_jobs_stage_check CHECK (
    stage IN ('queued', 'sign', 'children', 'parent', 'processing', 'publish',
              'verify', 'recover', 'permalink', 'done', 'failed')
  );

-- ──────────────── Service key do Vault (mesma da fila de e-mails) ────────────
CREATE OR REPLACE FUNCTION social_private.autopublish_service_key()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = 'email_queue_service_role_key'
  LIMIT 1;
$function$;

-- ───────── Caminhos dos arquivos na ordem congelada (fallback: nome) ─────────
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

-- ───────────────────────────── Executor v4 ───────────────────────────────────
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
  _signed jsonb;
  _entry jsonb;
  _signed_url text;
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

      -- ───────────── 2a. Ha requisicao em voo: le a resposta ─────────────
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
          CONTINUE;
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
          CONTINUE;
        END IF;

        _body := _response.content::jsonb;

        IF _job.stage = 'sign' THEN
          -- Links assinados prontos: monta as URLs completas na MESMA ordem.
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
            IF _signed_url IS NULL OR COALESCE(_entry->>'error', '') <> '' THEN
              CONTINUE;
            END IF;
            _urls := _urls || (_settings.storage_base_url || '/storage/v1' || _signed_url);
          END LOOP;
          IF array_length(_urls, 1) IS NULL THEN
            PERFORM social_private.autopublish_mark_failed(
              _job.publication_id,
              'Nao foi possivel assinar os arquivos da publicacao.',
              _admin
            );
            _failed := _failed + 1;
            CONTINUE;
          END IF;
          UPDATE social_private.autopublish_jobs
          SET child_urls = _urls, child_index = 0,
              child_container_ids = ARRAY[]::text[],
              stage = 'queued', step_attempts = 0,
              net_request_id = NULL, updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          CONTINUE;
        END IF;

        IF _job.stage = 'queued' THEN
          IF _kind = 'video' THEN
            UPDATE social_private.autopublish_jobs
            SET container_id = _body->>'id', stage = 'processing', poll_count = 0,
                step_attempts = 0, net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
          ELSIF _kind = 'carousel' THEN
            UPDATE social_private.autopublish_jobs
            SET child_container_ids = child_container_ids || (_body->>'id'),
                child_index = child_index + 1,
                stage = 'children', step_attempts = 0,
                net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
          ELSE
            UPDATE social_private.autopublish_jobs
            SET container_id = _body->>'id', stage = 'publish',
                step_attempts = 0, net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
          END IF;
          _advanced := _advanced + 1;
          CONTINUE;
        END IF;

        IF _job.stage = 'children' THEN
          UPDATE social_private.autopublish_jobs
          SET child_container_ids = child_container_ids || (_body->>'id'),
              child_index = child_index + 1,
              step_attempts = 0,
              net_request_id = NULL, updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          CONTINUE;
        END IF;

        IF _job.stage = 'parent' THEN
          UPDATE social_private.autopublish_jobs
          SET container_id = _body->>'id', stage = 'publish',
              step_attempts = 0, net_request_id = NULL, updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          CONTINUE;
        END IF;

        IF _job.stage = 'processing' THEN
          _status_code := COALESCE(_body->>'status_code', '');
          IF _status_code = 'FINISHED' THEN
            UPDATE social_private.autopublish_jobs
            SET stage = 'publish', step_attempts = 0, net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
          ELSIF _status_code = 'ERROR' THEN
            PERFORM social_private.autopublish_mark_failed(
              _job.publication_id,
              'Instagram nao conseguiu processar o video: ' || COALESCE(_body::text, ''),
              _admin
            );
            _failed := _failed + 1;
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
          END IF;
          CONTINUE;
        END IF;

        IF _job.stage = 'publish' THEN
          UPDATE social_private.autopublish_jobs
          SET media_id = _body->>'id', stage = 'permalink',
              step_attempts = 0, net_request_id = NULL, updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          CONTINUE;
        END IF;

        IF _job.stage = 'verify' THEN
          _status_code := COALESCE(_body->>'status_code', '');
          IF _status_code = 'PUBLISHED' THEN
            UPDATE social_private.autopublish_jobs
            SET stage = 'recover', step_attempts = 0, net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
          ELSIF _status_code = 'FINISHED' THEN
            UPDATE social_private.autopublish_jobs
            SET stage = 'publish', net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
          ELSIF _status_code IN ('ERROR', 'EXPIRED') THEN
            PERFORM social_private.autopublish_mark_failed(
              _job.publication_id,
              'Container invalido na verificacao (' || _status_code || '). Use Tentar de novo.',
              _admin
            );
            _failed := _failed + 1;
          ELSE
            UPDATE social_private.autopublish_jobs
            SET net_request_id = NULL, poll_count = poll_count + 1, updated_at = now()
            WHERE publication_id = _job.publication_id;
            IF _job.poll_count >= 40 THEN
              PERFORM social_private.autopublish_mark_failed(
                _job.publication_id,
                'Verificacao do container nao concluiu em 40 minutos.',
                _admin
              );
              _failed := _failed + 1;
            END IF;
          END IF;
          CONTINUE;
        END IF;

        IF _job.stage = 'recover' THEN
          IF jsonb_array_length(COALESCE(_body->'data', '[]'::jsonb)) > 0 THEN
            UPDATE social_private.autopublish_jobs
            SET media_id = _body->'data'->0->>'id',
                permalink = _body->'data'->0->>'permalink',
                stage = 'permalink', step_attempts = 0,
                net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
          ELSE
            UPDATE social_private.autopublish_jobs
            SET stage = 'done', net_request_id = NULL,
                last_error = 'Post publicado, mas nao foi possivel recuperar o link. Confirme no perfil.',
                updated_at = now()
            WHERE publication_id = _job.publication_id;
          END IF;
          CONTINUE;
        END IF;

        IF _job.stage = 'permalink' THEN
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
          CONTINUE;
        END IF;
      END IF;

      -- ─────────── 2b. Sem requisicao em voo: dispara o proximo passo ───────────

      IF _job.step_attempts >= _step_limit THEN
        PERFORM social_private.autopublish_mark_failed(
          _job.publication_id,
          'Passo "' || _job.stage || '" falhou apos ' || _job.step_attempts ||
            ' tentativas. Ultimo erro: ' || COALESCE(_job.last_error, 'sem detalhe'),
          _admin
        );
        _failed := _failed + 1;
        CONTINUE;
      END IF;

      IF _job.stage = 'queued' THEN
        -- Primeiro: garantir midia ACESSIVEL pela Meta. Arquivo do Storage
        -- privado precisa de link assinado; a assinatura sai em lote, uma
        -- chamada para todos os cartoes.
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
              CONTINUE;
            END IF;
            SELECT net.http_post(
              url := _settings.storage_base_url || '/storage/v1/object/sign/files',
              body := jsonb_build_object(
                'paths', to_jsonb(_paths),
                'expiresIn', 21600
              ),
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
            CONTINUE;
          END IF;
          -- Sem storage_path (link externo http): segue com a URL legada.
          _urls := ARRAY[social_private.autopublish_file_url(_pub.file_id)];
          IF _urls[1] IS NULL THEN
            PERFORM social_private.autopublish_mark_failed(
              _job.publication_id,
              'Arquivo sem caminho de storage e sem URL externa: nada para publicar.',
              _admin
            );
            _failed := _failed + 1;
            CONTINUE;
          END IF;
          UPDATE social_private.autopublish_jobs
          SET child_urls = _urls, updated_at = now()
          WHERE publication_id = _job.publication_id;
          _job.child_urls := _urls;
        END IF;

        -- Midia pronta (assinada ou externa): dispara o primeiro container.
        _urls := _job.child_urls;
        IF _kind = 'carousel' THEN
          IF array_length(_urls, 1) < 2 THEN
            PERFORM social_private.autopublish_mark_failed(
              _job.publication_id,
              'Carrossel precisa de pelo menos 2 imagens acessiveis.',
              _admin
            );
            _failed := _failed + 1;
            CONTINUE;
          END IF;
          IF array_length(_urls, 1) > 10 THEN
            _urls := _urls[1:10];
            UPDATE social_private.autopublish_jobs
            SET child_urls = _urls, updated_at = now()
            WHERE publication_id = _job.publication_id;
          END IF;
          _payload := _graph || '/' || _token.resource_id || '/media'
            || '?image_url=' || social_private.autopublish_urlencode(_urls[1])
            || '&is_carousel_item=true'
            || '&access_token=' || _token.access_token;
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
        CONTINUE;
      END IF;

      IF _job.stage = 'sign' THEN
        -- Resposta perdida ou erro na assinatura: o dispatch de cima refaz.
        UPDATE social_private.autopublish_jobs
        SET stage = 'queued', child_urls = ARRAY[]::text[], net_request_id = NULL, updated_at = now()
        WHERE publication_id = _job.publication_id;
        CONTINUE;
      END IF;

      IF _job.stage = 'children' THEN
        IF _job.child_index < COALESCE(array_length(_job.child_urls, 1), 0) THEN
          _payload := _graph || '/' || _token.resource_id || '/media'
            || '?image_url=' || social_private.autopublish_urlencode(_job.child_urls[_job.child_index + 1])
            || '&is_carousel_item=true'
            || '&access_token=' || _token.access_token;
          SELECT net.http_post(url := _payload, headers := '{}'::jsonb, timeout_milliseconds := 20000)
          INTO _request_id;
          UPDATE social_private.autopublish_jobs
          SET net_request_id = _request_id, attempts = attempts + 1,
              step_attempts = step_attempts + 1, updated_at = now()
          WHERE publication_id = _job.publication_id;
        ELSE
          _payload := _graph || '/' || _token.resource_id || '/media'
            || '?media_type=CAROUSEL'
            || '&children=' || array_to_string(_job.child_container_ids, ',')
            || '&caption=' || social_private.autopublish_urlencode(_pub.caption)
            || '&access_token=' || _token.access_token;
          SELECT net.http_post(url := _payload, headers := '{}'::jsonb, timeout_milliseconds := 20000)
          INTO _request_id;
          UPDATE social_private.autopublish_jobs
          SET stage = 'parent', net_request_id = _request_id, attempts = attempts + 1,
              step_attempts = 1, updated_at = now()
          WHERE publication_id = _job.publication_id;
        END IF;
        _advanced := _advanced + 1;
        CONTINUE;
      END IF;

      IF _job.stage = 'processing' THEN
        _payload := _graph || '/' || _job.container_id
          || '?fields=status_code&access_token=' || _token.access_token;
        SELECT net.http_get(url := _payload, timeout_milliseconds := 10000) INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, updated_at = now()
        WHERE publication_id = _job.publication_id;
        CONTINUE;
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
        CONTINUE;
      END IF;

      IF _job.stage = 'verify' AND _job.container_id IS NOT NULL THEN
        _payload := _graph || '/' || _job.container_id
          || '?fields=status_code&access_token=' || _token.access_token;
        SELECT net.http_get(url := _payload, timeout_milliseconds := 10000) INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, step_attempts = step_attempts + 1, updated_at = now()
        WHERE publication_id = _job.publication_id;
        CONTINUE;
      END IF;

      IF _job.stage = 'recover' THEN
        _payload := _graph || '/' || _token.resource_id || '/media'
          || '?fields=id,permalink&limit=1'
          || '&access_token=' || _token.access_token;
        SELECT net.http_get(url := _payload, timeout_milliseconds := 10000) INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, step_attempts = step_attempts + 1, updated_at = now()
        WHERE publication_id = _job.publication_id;
        CONTINUE;
      END IF;

      IF _job.stage = 'permalink' AND _job.media_id IS NOT NULL THEN
        _payload := _graph || '/' || _job.media_id
          || '?fields=permalink&access_token=' || _token.access_token;
        SELECT net.http_get(url := _payload, timeout_milliseconds := 10000) INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, step_attempts = step_attempts + 1, updated_at = now()
        WHERE publication_id = _job.publication_id;
        _advanced := _advanced + 1;
        CONTINUE;
      END IF;

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
