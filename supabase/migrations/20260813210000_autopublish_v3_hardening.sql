-- ============================================================================
-- Aceleriq OS - publicação automática v3: robustez de verdade
-- ============================================================================
--
-- A v2 funcionava no caminho feliz e quebrava de formas silenciosas ou
-- perigosas fora dele. O que esta versão corrige, ponto a ponto:
--
--   1. ORDEM DO CARROSSEL: a v2 deduzia a ordem dos cartões pelo NOME do
--      arquivo (regex "card 1", "1_..."), ignorando a ordem congelada que o
--      painel grava ao agendar (editorial_publication_assets.position). Um
--      carrossel podia sair no Instagram em ordem diferente da aprovada.
--      Agora a ordem congelada manda; o nome do arquivo é só reserva para
--      agendamentos antigos que não têm a lista.
--
--   2. POST DUPLICADO: se a chamada de publicação excedesse o tempo (5s de
--      padrão do pg_net), a v2 reenviava o mesmo media_publish às cegas,
--      podendo publicar DUAS vezes. Agora o passo de publicação nunca é
--      reenviado às cegas: em qualquer dúvida o motor primeiro PERGUNTA ao
--      Instagram se o container já foi publicado (estágio verify) e, se foi,
--      recupera o post real (estágio recover) em vez de duplicar.
--
--   3. TENTATIVAS POR PASSO: o contador era do trabalho inteiro; um carrossel
--      gastava uma "tentativa" por cartão e morria no meio sem retry real.
--      Agora cada passo tem o próprio contador (limite 4 por passo).
--
--   4. REQUISIÇÃO PERDIDA: o pg_net expurga respostas antigas; a v2 esperava
--      uma resposta que nunca chegaria, para sempre, sem erro. Agora depois
--      de 10 minutos sem resposta o passo é retomado com segurança.
--
--   5. FALHA VISÍVEL NO PAINEL: a v2 nunca marcava a publicação como
--      "failed"; a agenda mostrava "Programado" eternamente. Agora toda falha
--      definitiva também baixa a publicação oficial (transition 'fail'),
--      acendendo o vermelho na agenda e o motivo no detalhe.
--
--   6. BAIXA QUE DESFAZIA O PASSO: a exceção da baixa oficial revertia o
--      estágio "done" e o job refazia o permalink até morrer, com o post já
--      no ar. Agora a baixa roda em bloco próprio: se ela falhar, o job fica
--      "done" com o erro anotado, e nada é desfeito.
--
--   7. TIMEOUT EXPLÍCITO: 20s para escrever, 10s para ler (era o padrão de
--      5s, curto demais para carrossel).
--
--   8. STORY DE VERDADE: story era postado como foto de FEED. Agora usa
--      media_type=STORIES.
--
--   9. TENTAR DE NOVO: job que falhou ficava morto para sempre (a fila nunca
--      re-enfileira). Novo RPC retry_autopublish(p_publication_id) permite à
--      equipe reprocessar com um clique, sem risco de duplicar (se a
--      publicação já foi despachada uma vez, o retry começa pelo verify).
-- ============================================================================

-- ───────────────────────── Colunas novas da fila ─────────────────────────────
ALTER TABLE social_private.autopublish_jobs
  ADD COLUMN IF NOT EXISTS step_attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS publish_dispatched boolean NOT NULL DEFAULT false;

ALTER TABLE social_private.autopublish_jobs
  DROP CONSTRAINT IF EXISTS autopublish_jobs_stage_check;
ALTER TABLE social_private.autopublish_jobs
  ADD CONSTRAINT autopublish_jobs_stage_check CHECK (
    stage IN ('queued', 'children', 'parent', 'processing', 'publish',
              'verify', 'recover', 'permalink', 'done', 'failed')
  );

-- ──────────── URLs na ordem congelada pelo painel (fallback: nome) ───────────
CREATE OR REPLACE FUNCTION social_private.autopublish_ordered_urls(
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
  _urls text[];
BEGIN
  -- A fonte oficial: a lista de arquivos congelada no agendamento, na ordem
  -- exata que a equipe viu e o cliente aprovou.
  SELECT ARRAY(
    SELECT url FROM (
      SELECT
        social_private.autopublish_file_url(asset.file_id) AS url,
        asset.position
      FROM social_private.editorial_publication_assets AS asset
      WHERE asset.publication_id = _publication_id
      ORDER BY asset.position
    ) AS ordered
    WHERE ordered.url IS NOT NULL
  )
  INTO _urls;

  IF _urls IS NOT NULL AND array_length(_urls, 1) >= 1 THEN
    RETURN _urls;
  END IF;

  -- Agendamento antigo, sem lista congelada: cai na leitura por nome.
  RETURN social_private.autopublish_carousel_urls(_root_file_id);
END;
$function$;

-- ─────────────────── Falha definitiva: job + baixa oficial ───────────────────
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

-- ───────────────────────────── Executor v3 ───────────────────────────────────
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
  _permalink text;
  _step_limit constant smallint := 4;    -- tentativas por PASSO, nao por job
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

  -- 1. Enfileira o que esta agendado, automatico, aprovado e com a hora chegada.
  FOR _due IN
    SELECT publication.id, publication.client_id
    FROM public.editorial_publications AS publication
    JOIN public.editorial_posts AS post ON post.id = publication.post_id
    WHERE publication.status = 'scheduled'
      AND publication.platform = 'instagram'
      AND publication.delivery_mode = 'automatic'
      AND publication.scheduled_at IS NOT NULL
      AND publication.scheduled_at <= now()
      AND post.content_type IN ('static', 'story', 'carousel', 'reel', 'video', 'short')
      -- O material precisa estar aprovado de verdade (duplo gate do painel).
      AND COALESCE(public.editorial_file_is_publishable(
            COALESCE(publication.file_id, post.primary_file_id),
            publication.client_id, publication.project_id), false)
      -- Aprovou depois da hora marcada? Espera 1h a partir da aprovacao.
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
          -- Resposta ainda em transito OU expurgada pelo pg_net. Depois de um
          -- tempo, retoma com seguranca em vez de esperar para sempre.
          IF _job.updated_at < now() - _lost_after THEN
            UPDATE social_private.autopublish_jobs
            SET net_request_id = NULL,
                -- Publicacao ja despachada nunca e reenviada as cegas.
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
                'sem resposta da Meta'
              ), 500),
              updated_at = now()
          WHERE publication_id = _job.publication_id;
          CONTINUE;
        END IF;

        _body := _response.content::jsonb;

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
          -- Pergunta ao Instagram: este container ja virou post?
          _status_code := COALESCE(_body->>'status_code', '');
          IF _status_code = 'PUBLISHED' THEN
            -- Ja esta no ar: recupera o post real em vez de publicar de novo.
            UPDATE social_private.autopublish_jobs
            SET stage = 'recover', step_attempts = 0, net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
          ELSIF _status_code = 'FINISHED' THEN
            -- Pronto e NAO publicado: seguro reenviar a publicacao.
            UPDATE social_private.autopublish_jobs
            SET stage = 'publish', net_request_id = NULL, updated_at = now()
            WHERE publication_id = _job.publication_id;
            _advanced := _advanced + 1;
          ELSIF _status_code IN ('ERROR', 'EXPIRED') THEN
            PERFORM social_private.autopublish_mark_failed(
              _job.publication_id,
              'Container invalido na verificacao (' || _status_code || '). Use Tentar de novo para reprocessar.',
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
          -- Ultimo post da conta: e o que acabamos de publicar.
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
                last_error = 'Post publicado, mas nao foi possivel recuperar o link. Confirme no perfil e marque como publicado no painel.',
                updated_at = now()
            WHERE publication_id = _job.publication_id;
          END IF;
          CONTINUE;
        END IF;

        IF _job.stage = 'permalink' THEN
          _permalink := NULLIF(btrim(COALESCE(_body->>'permalink', '')), '');
          -- Story pode voltar sem permalink; usa o perfil de stories como link.
          IF _permalink IS NULL AND _kind = 'story' THEN
            _permalink := 'https://www.instagram.com/stories/';
          END IF;

          UPDATE social_private.autopublish_jobs
          SET permalink = _permalink, stage = 'done', net_request_id = NULL, updated_at = now()
          WHERE publication_id = _job.publication_id;

          -- Baixa oficial em bloco proprio: falhar aqui NAO desfaz o done.
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

      -- Limite por passo: esgotou, falha de vez (com baixa oficial).
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
        IF _kind = 'carousel' THEN
          -- Ordem oficial congelada no agendamento; nome de arquivo e reserva.
          _urls := social_private.autopublish_ordered_urls(_pub.id, _pub.file_id);
          IF _urls IS NULL OR array_length(_urls, 1) < 2 THEN
            PERFORM social_private.autopublish_mark_failed(
              _job.publication_id,
              'Carrossel precisa de pelo menos 2 imagens com URL publica.',
              _admin
            );
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
        ELSIF _kind = 'story' THEN
          -- Story vai para stories, nao para o feed. Story nao tem legenda.
          _payload := _graph || '/' || _token.resource_id || '/media'
            || '?media_type=STORIES'
            || '&image_url=' || social_private.autopublish_urlencode(social_private.autopublish_file_url(_pub.file_id))
            || '&access_token=' || _token.access_token;
        ELSE
          _payload := _graph || '/' || _token.resource_id || '/media'
            || '?image_url=' || social_private.autopublish_urlencode(social_private.autopublish_file_url(_pub.file_id))
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

-- ──────────────────── Tentar de novo, com um clique da equipe ─────────────────
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

  -- Se a publicacao chegou a ser despachada, recomeca pela VERIFICACAO para
  -- nunca postar duas vezes. Caso contrario, recomeca do zero.
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
      container_id = CASE WHEN _next_stage = 'queued' THEN NULL ELSE container_id END,
      updated_at = now()
  WHERE publication_id = p_publication_id;

  RETURN jsonb_build_object('publication_id', p_publication_id, 'stage', _next_stage);
END;
$$;

REVOKE ALL ON FUNCTION public.retry_autopublish(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_autopublish(uuid) TO authenticated;
