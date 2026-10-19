-- Stories na Mesa do cliente (20/10/2026). Contrato: docs/mesa/STORIES.md.
-- Função: supabase/functions/mesa-stories. Só amplia e é idempotente (pode rodar de novo).
--
-- 1) cliente_stories_sequencias e cliente_stories. RLS: a equipe lê (is_staff +
--    can_access_client, no padrão das tabelas da Mesa, ver
--    20260928010000_instagram_do_cliente.sql); só service_role escreve (a função
--    confere o acesso de quem chama antes de qualquer escrita e o agendamento
--    automático passa pelas RPCs da Agenda com o JWT de quem chamou).
--    Regra da plataforma no banco: story com adesivo (enquete, caixinha, quiz,
--    link, contagem, localização, reação, menção) só sai pelo app; sem adesivo,
--    automático (a API do Instagram não publica adesivo).
-- 2) public.stories_avisar_pelo_app() e o cron 'stories-aviso-pelo-app' (a cada
--    minuto): avisa a equipe do cliente no sininho (notifications, tipo
--    'stories_pelo_app') quando chega a hora de postar pelo app (5 minutos
--    antes do horário). Um aviso por story (avisado_em); story com o horário
--    passado há mais de 12 horas não avisa mais (cron parado não vira enxurrada).
-- 3) public.editorial_autopublish_tick: a versão vigente
--    (20260912213638_secure_publication_cancellation_dispatch.sql) byte a byte,
--    mudando SÓ o story em vídeo: o arquivo do story com mime video/* (ou
--    extensão mp4, mov, m4v) cria o container com media_type=STORIES&video_url=
--    e espera o processamento do vídeo (a mesma etapa 'processing' do reel)
--    antes do media_publish. Story em imagem, carrossel, reel e post seguem
--    iguais. Mesma assinatura, SECURITY DEFINER, search_path e privilégios.
-- 4) public.mesa_agendar_aprovados: a versão vigente
--    (20261002110000_avisos_com_cliente.sql) byte a byte, mudando SÓ o tipo do
--    post novo: arte do Estúdio com uma lâmina e formato stories_9x16
--    (estudio_trabalhos.direcao->>'formato') entra como 'story' (antes: static).
--    Mesma assinatura, SECURITY DEFINER, search_path e privilégios.
--
-- Não aplicar direto: o dono aplica na integração (SQL Editor) e registra no manifesto.

-- ---------------------------------------------------------------------------
-- 1. Sequências (a "novela do dia") e stories
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cliente_stories_sequencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- marca aberta na Mesa (Acerbi e CME são marcas do mesmo cliente); null = principal
  marca_id uuid REFERENCES public.cliente_marcas(id) ON DELETE SET NULL,
  data date NOT NULL,
  objetivo text NOT NULL CHECK (objetivo IN ('engajar', 'vender', 'lancar', 'relacionamento', 'bastidor')),
  titulo text NOT NULL DEFAULT '' CHECK (char_length(titulo) <= 200),
  gancho_de_amanha text CHECK (gancho_de_amanha IS NULL OR char_length(gancho_de_amanha) <= 500),
  pedido text CHECK (pedido IS NULL OR char_length(pedido) <= 2000),
  -- {versoes, escolhida, pontos, jev}: como a versão do plano foi escolhida
  escolha jsonb CHECK (escolha IS NULL OR jsonb_typeof(escolha) = 'object'),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  arquivado_em timestamptz
);

CREATE INDEX IF NOT EXISTS cliente_stories_sequencias_cliente_idx
  ON public.cliente_stories_sequencias (client_id, data DESC)
  WHERE arquivado_em IS NULL;

DROP TRIGGER IF EXISTS cliente_stories_sequencias_tocar ON public.cliente_stories_sequencias;
CREATE TRIGGER cliente_stories_sequencias_tocar
BEFORE UPDATE ON public.cliente_stories_sequencias
FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();

CREATE TABLE IF NOT EXISTS public.cliente_stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- null: story solto (molde viral usado fora de uma sequência)
  sequencia_id uuid REFERENCES public.cliente_stories_sequencias(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ordem integer NOT NULL DEFAULT 1 CHECK (ordem BETWEEN 1 AND 20),
  -- chave do molde (moldes-de-stories.ts) ou 'livre'
  molde text NOT NULL DEFAULT 'livre' CHECK (molde ~ '^[a-z_]{2,40}$'),
  titulo text NOT NULL DEFAULT '' CHECK (char_length(titulo) <= 200),
  texto_na_tela text NOT NULL DEFAULT '' CHECK (char_length(texto_na_tela) <= 400),
  -- {tipo, pergunta?, opcoes?, url?, texto_do_link?, quando?}
  adesivo jsonb NOT NULL DEFAULT '{"tipo": "nenhum"}'::jsonb CHECK (
    jsonb_typeof(adesivo) = 'object'
    AND adesivo->>'tipo' IN ('nenhum', 'enquete', 'caixinha', 'quiz', 'link', 'contagem', 'localizacao', 'reacao', 'mencao')
  ),
  -- {tipo: foto|cor, imagem_id?, cor?}
  fundo jsonb NOT NULL DEFAULT '{"tipo": "cor"}'::jsonb CHECK (jsonb_typeof(fundo) = 'object'),
  horario timestamptz,
  caminho text NOT NULL DEFAULT 'automatico' CHECK (caminho IN ('automatico', 'pelo_app')),
  destaque_id uuid REFERENCES public.cliente_instagram_destaques(id) ON DELETE SET NULL,
  file_id uuid REFERENCES public.files(id) ON DELETE SET NULL,
  editorial_post_id uuid REFERENCES public.editorial_posts(id) ON DELETE SET NULL,
  publicacao_id uuid REFERENCES public.editorial_publications(id) ON DELETE SET NULL,
  situacao text NOT NULL DEFAULT 'rascunho'
    CHECK (situacao IN ('rascunho', 'arte_pronta', 'agendado', 'postar_pelo_app', 'publicado', 'falhou')),
  roteiro_do_adesivo text CHECK (roteiro_do_adesivo IS NULL OR char_length(roteiro_do_adesivo) <= 1000),
  motivo text CHECK (motivo IS NULL OR char_length(motivo) <= 1000),
  -- pelo app: quando a equipe é avisada (horário menos 5 minutos) e quando o aviso saiu
  aviso_em timestamptz,
  avisado_em timestamptz,
  postado_em timestamptz,
  postado_por uuid,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  -- tem adesivo = pelo app (a API não publica adesivo)
  CONSTRAINT cliente_stories_caminho_do_adesivo
    CHECK ((adesivo->>'tipo' = 'nenhum') = (caminho = 'automatico'))
);

CREATE INDEX IF NOT EXISTS cliente_stories_cliente_horario_idx
  ON public.cliente_stories (client_id, horario);
CREATE INDEX IF NOT EXISTS cliente_stories_sequencia_idx
  ON public.cliente_stories (sequencia_id, ordem);
CREATE INDEX IF NOT EXISTS cliente_stories_aviso_idx
  ON public.cliente_stories (aviso_em)
  WHERE caminho = 'pelo_app' AND situacao = 'postar_pelo_app' AND avisado_em IS NULL;

DROP TRIGGER IF EXISTS cliente_stories_tocar ON public.cliente_stories;
CREATE TRIGGER cliente_stories_tocar
BEFORE UPDATE ON public.cliente_stories
FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();

ALTER TABLE public.cliente_stories_sequencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cliente_stories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cliente_stories_sequencias_staff_read ON public.cliente_stories_sequencias;
CREATE POLICY cliente_stories_sequencias_staff_read ON public.cliente_stories_sequencias
  FOR SELECT TO authenticated
  USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS cliente_stories_staff_read ON public.cliente_stories;
CREATE POLICY cliente_stories_staff_read ON public.cliente_stories
  FOR SELECT TO authenticated
  USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

REVOKE ALL ON public.cliente_stories_sequencias, public.cliente_stories FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cliente_stories_sequencias, public.cliente_stories TO authenticated;
GRANT ALL ON public.cliente_stories_sequencias, public.cliente_stories TO service_role;

COMMENT ON TABLE public.cliente_stories_sequencias IS
  'Stories da Mesa (20/10): a sequência do dia com arco de novela. Escrita só pela função mesa-stories.';
COMMENT ON TABLE public.cliente_stories IS
  'Stories da Mesa (20/10): cada story da sequência. Com adesivo sai pelo app (aviso no horário); sem adesivo, o motor publica. Escrita só pela função mesa-stories.';

-- ---------------------------------------------------------------------------
-- 2. Aviso "Postar agora pelo app" (cron a cada minuto)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stories_avisar_pelo_app()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _s record;
  _n integer := 0;
  _adesivo text;
BEGIN
  FOR _s IN
    SELECT s.id, s.client_id, s.titulo, s.texto_na_tela, s.adesivo
      FROM public.cliente_stories s
     WHERE s.caminho = 'pelo_app'
       AND s.situacao = 'postar_pelo_app'
       AND s.avisado_em IS NULL
       AND s.horario IS NOT NULL
       AND COALESCE(s.aviso_em, s.horario - interval '5 minutes') <= now()
       AND s.horario >= now() - interval '12 hours'
     ORDER BY s.horario
     LIMIT 50
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.cliente_stories SET avisado_em = now() WHERE id = _s.id;
    _adesivo := CASE _s.adesivo->>'tipo'
      WHEN 'enquete' THEN 'enquete'
      WHEN 'caixinha' THEN 'caixinha de perguntas'
      WHEN 'quiz' THEN 'quiz'
      WHEN 'link' THEN 'link'
      WHEN 'contagem' THEN 'contagem regressiva'
      WHEN 'localizacao' THEN 'localização'
      WHEN 'reacao' THEN 'reação'
      WHEN 'mencao' THEN 'menção'
      ELSE 'adesivo'
    END;
    PERFORM public.avisar_equipe_do_cliente(
      _s.client_id,
      public.mesa_com_cliente(_s.client_id, 'Stories: postar agora pelo app "'
        || left(COALESCE(NULLIF(btrim(_s.titulo), ''), NULLIF(btrim(_s.texto_na_tela), ''), 'story'), 80)
        || '" com ' || _adesivo || '. A arte e o roteiro do adesivo estão na Agenda dos Stories.'),
      'stories_pelo_app',
      '/mesa?client=' || _s.client_id::text || '&aba=stories&bloco=agenda'
    );
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END;
$function$;

REVOKE ALL ON FUNCTION public.stories_avisar_pelo_app() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stories_avisar_pelo_app() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'stories-aviso-pelo-app';
    PERFORM cron.schedule('stories-aviso-pelo-app', '* * * * *', $cron$select public.stories_avisar_pelo_app();$cron$);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Motor do Instagram: story em vídeo (media_type=STORIES&video_url=)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4. Agendador da Mesa: arte stories_9x16 do Estúdio entra como story
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mesa_agendar_aprovados()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _f record;
  _t record;
  _task record;
  _root record;
  _conta record;
  _hora time;
  _fuso text;
  _admin uuid;
  _ator uuid;
  _quando timestamptz;
  _tipo text;
  _modo text;
  _payload jsonb;
  _res jsonb;
  _post uuid;
  _atencao text;
  _pub_id uuid;
  _pub_versao integer;
  _pub_status text;
  _pub_fuso text;
  _pub_modo text;
  _assets jsonb;
  _segurada boolean;
  _pub_conta uuid;
  _agendados integer := 0;
  _precisam integer := 0;
  _falhas jsonb := '[]'::jsonb;
BEGIN
  SELECT user_id INTO _admin
    FROM public.user_roles
   WHERE role = 'admin'::public.app_role
   ORDER BY user_id
   LIMIT 1;
  IF _admin IS NULL THEN
    RETURN jsonb_build_object('agendados', 0, 'erro', 'nenhum admin cadastrado');
  END IF;

  FOR _f IN
    SELECT *
      FROM public.mesa_agendamento_fila
     WHERE processado_em IS NULL
       AND tentativas < 5
     ORDER BY criado_em
     LIMIT 20
     FOR UPDATE SKIP LOCKED
  LOOP
    _atencao := NULL;
    _post := NULL;
    BEGIN
      SELECT * INTO _t FROM public.estudio_trabalhos WHERE id = _f.trabalho_id;
      SELECT id, project_id, due_date, title INTO _task
        FROM public.tasks
       WHERE id = _t.task_id AND deleted_at IS NULL;
      SELECT id, file_name, caption, description INTO _root
        FROM public.files
       WHERE id = _f.file_id;

      IF _task.id IS NULL THEN
        _atencao := 'O item da agenda foi apagado. A arte aprovada está em Arquivos.';
      ELSIF _t.file_ids[1] IS DISTINCT FROM _f.file_id THEN
        _atencao := 'A arte aprovada não é a entrega atual deste trabalho. Confira em Arquivos antes de agendar.';
      END IF;

      IF _atencao IS NULL THEN
        SELECT p.id INTO _post
          FROM public.editorial_posts p
         WHERE p.primary_file_id = _f.file_id AND p.archived_at IS NULL
         LIMIT 1;
      END IF;

      IF _atencao IS NULL AND _post IS NULL THEN
        IF public.editorial_current_post_id_for_task(_task.id) IS NOT NULL THEN
          _atencao := 'O item já tem um post na Agenda. Ligue a arte aprovada por lá.';
        END IF;
      END IF;

      IF _atencao IS NULL AND _post IS NULL THEN
        SELECT ea.id,
               (c.connection_status = 'connected' AND COALESCE(c.automation_enabled, false)) AS automatica
          INTO _conta
          FROM public.project_external_accounts pea
          JOIN public.external_accounts ea ON ea.id = pea.external_account_id
          LEFT JOIN public.external_account_connections c ON c.external_account_id = ea.id
         WHERE pea.project_id = _task.project_id
           AND ea.client_id = _t.client_id
           AND ea.platform = 'instagram'
           AND ea.status = 'active'
         ORDER BY (c.connection_status = 'connected') DESC NULLS LAST, ea.created_at
         LIMIT 1;
        IF _conta.id IS NULL THEN
          _atencao := 'O projeto não tem conta do Instagram ligada. Ligue a conta na Agenda e agende por lá.';
        END IF;
      END IF;

      IF _atencao IS NULL AND _post IS NULL THEN
        SELECT c.hora_publicacao, c.fuso INTO _hora, _fuso
          FROM public.mesa_cliente_config c
         WHERE c.client_id = _t.client_id;
        IF COALESCE((SELECT c.horario_automatico FROM public.mesa_cliente_config c WHERE c.client_id = _t.client_id), true) THEN
          _hora := public.mesa_melhor_hora(_t.client_id, CASE WHEN cardinality(_t.file_ids) > 1 THEN 'carousel' ELSE 'static' END);
        END IF;
        _hora := COALESCE(_hora, '09:00'::time);
        _fuso := COALESCE(_fuso, 'America/Sao_Paulo');
        _quando := public.mesa_proximo_horario_util(_task.due_date, _hora, _fuso);
        -- 20/10 (Stories): arte de uma lâmina no formato stories_9x16 entra como story.
        _tipo := CASE
          WHEN cardinality(_t.file_ids) > 1 THEN 'carousel'
          WHEN _t.direcao->>'formato' = 'stories_9x16' THEN 'story'
          ELSE 'static'
        END;
        _modo := CASE
          WHEN _conta.automatica
            AND cardinality(_t.file_ids) BETWEEN 1 AND 10
            AND NOT EXISTS (
              SELECT 1 FROM public.files fr
               WHERE (fr.id = _f.file_id OR fr.parent_file_id = _f.file_id)
                 AND (fr.sha256 IS NULL OR lower(fr.sha256) !~ '^[0-9a-f]{64}$')
            )
            THEN 'automatic'
          ELSE 'manual'
        END;

        _ator := CASE
          WHEN _t.enviado_por IS NOT NULL AND public.has_role(_t.enviado_por, 'admin'::public.app_role) THEN _t.enviado_por
          ELSE _admin
        END;
        PERFORM set_config('request.jwt.claims',
          json_build_object('sub', _ator::text, 'role', 'authenticated')::text, true);

        _payload := jsonb_build_object(
          'id', NULL,
          'idempotency_key', public.mesa_uuid_estavel('mesa-post:' || _f.file_id::text),
          'mutation_id', public.mesa_uuid_estavel('mesa-mutacao:' || _f.file_id::text || ':' || _f.tentativas::text),
          'client_id', _t.client_id,
          'project_id', _task.project_id,
          'primary_file_id', _f.file_id,
          'title', COALESCE(NULLIF(btrim(_task.title), ''), _root.file_name),
          'content_type', _tipo,
          'objective', NULLIF(btrim(COALESCE(_root.description, '')), ''),
          'default_caption', NULLIF(btrim(COALESCE(_root.caption, '')), ''),
          'production_status', 'ready',
          'task_id', _task.id,
          'responsible_id', NULL,
          'internal_notes', 'Agendado pela Mesa do cliente quando a arte foi aprovada.',
          'revision_of_post_id', NULL,
          'publications', jsonb_build_array(jsonb_build_object(
            'id', NULL,
            'idempotency_key', public.mesa_uuid_estavel('mesa-publicacao:' || _f.file_id::text || ':' || _conta.id::text),
            'external_account_id', _conta.id,
            'file_id', _f.file_id,
            'caption', NULLIF(btrim(COALESCE(_root.caption, '')), ''),
            'first_comment', NULL,
            'alt_text', NULL,
            'asset_file_ids', to_jsonb(_t.file_ids),
            'delivery_mode', _modo,
            'scheduled_at', to_jsonb(_quando),
            'scheduled_timezone', _fuso
          ))
        );

        _res := public.save_editorial_post(_payload, NULL);
        _post := NULLIF(_res->>'post_id', '')::uuid;

        UPDATE public.estudio_trabalhos
           SET post_id = _post,
               agendado_para = _quando,
               entrega_status = 'agendado',
               entrega_aviso = NULL
         WHERE id = _t.id;

        PERFORM public.avisar_equipe(
          public.mesa_com_cliente(_t.client_id, 'Mesa: "' || COALESCE(_task.title, 'post') || '" foi aprovado e entrou na Agenda para '
            || to_char(_quando AT TIME ZONE _fuso, 'DD/MM "às" HH24:MI') || '.'),
          'publication',
          '/calendario?client=' || _t.client_id::text || COALESCE('&content=' || _post::text, '')
        );
        _agendados := _agendados + 1;

      ELSIF _atencao IS NULL AND _post IS NOT NULL THEN
        -- Frente EA: a entrega já pôs o post na Agenda. A data que vale é a
        -- da publicação (o dono confirmou na Entrega ou a equipe na Agenda).
        _pub_id := NULL;
        _quando := NULL;
        SELECT pub.id, pub.version, pub.status, pub.scheduled_at,
               COALESCE(pub.scheduled_timezone, 'America/Sao_Paulo'),
               COALESCE(pub.delivery_mode, 'manual')
          INTO _pub_id, _pub_versao, _pub_status, _quando, _pub_fuso, _pub_modo
          FROM public.editorial_publications pub
         WHERE pub.post_id = _post AND pub.status IN ('planned', 'scheduled', 'published')
         ORDER BY (pub.platform = 'instagram') DESC, pub.scheduled_at NULLS LAST
         LIMIT 1;

        -- Conserto 27/09: a peça entrou na Agenda antes da aprovação, sem as
        -- lâminas (a Agenda só congela arquivo aprovado). Aprovada e com data:
        -- congela as lâminas na ordem do Estúdio e o modo de entrega, pela
        -- mesma regra do caminho antigo, antes de o promotor agendar.
        IF _pub_id IS NOT NULL AND _pub_status = 'planned' AND _quando IS NOT NULL
          AND _t.agenda_sincronizada_em IS NOT NULL
          AND cardinality(_t.file_ids) > 0
          AND NOT EXISTS (
            SELECT 1 FROM social_private.editorial_publication_assets a WHERE a.publication_id = _pub_id
          ) THEN
          BEGIN
            SELECT pub.external_account_id INTO _pub_conta
              FROM public.editorial_publications pub WHERE pub.id = _pub_id;
            _pub_modo := CASE
              WHEN EXISTS (
                SELECT 1 FROM public.external_account_connections c
                 WHERE c.external_account_id = _pub_conta
                   AND c.client_id = _t.client_id
                   AND c.provider = 'meta'
                   AND c.connection_status = 'connected'
                   AND COALESCE(c.automation_enabled, false)
                   AND (c.expires_at IS NULL OR c.expires_at > now())
              )
                AND cardinality(_t.file_ids) BETWEEN 1 AND 10
                AND NOT EXISTS (
                  SELECT 1 FROM public.files fr
                   WHERE (fr.id = _f.file_id OR fr.parent_file_id = _f.file_id)
                     AND (fr.sha256 IS NULL OR lower(fr.sha256) !~ '^[0-9a-f]{64}$')
                )
                THEN 'automatic'
              ELSE 'manual'
            END;
            PERFORM set_config('request.jwt.claims',
              json_build_object('sub', _admin::text, 'role', 'authenticated')::text, true);
            PERFORM social_private.capture_editorial_asset_snapshots(
              _post,
              jsonb_build_object('publications', jsonb_build_array(jsonb_build_object(
                'id', _pub_id,
                'external_account_id', _pub_conta,
                'asset_file_ids', to_jsonb(_t.file_ids),
                'delivery_mode', _pub_modo,
                'scheduled_at', _quando,
                'scheduled_timezone', _pub_fuso
              ))),
              false
            );
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'mesa_agendar_aprovados: lâminas da peça % não congeladas: %', _t.id, SQLERRM;
          END;
        END IF;

        -- "Publicar assim que aprovar" e aprovação além da janela de 6 h do
        -- promotor: agenda para o minuto seguinte, pelo mesmo caminho do
        -- promotor (pedido de entrega, selo de aprovação e transição oficial).
        IF _pub_id IS NOT NULL AND _pub_status = 'planned' AND _quando IS NOT NULL
          AND _t.agenda_sincronizada_em IS NOT NULL
          AND COALESCE(_t.publicar_ao_aprovar, false)
          AND _quando < now() - interval '6 hours' THEN
          _quando := now() + interval '1 minute';
          PERFORM set_config('request.jwt.claims',
            json_build_object('sub', _admin::text, 'role', 'authenticated')::text, true);
          SELECT COALESCE(jsonb_agg(a.file_id::text ORDER BY a.position), '[]'::jsonb)
            INTO _assets
            FROM social_private.editorial_publication_assets a
           WHERE a.publication_id = _pub_id;
          INSERT INTO social_private.editorial_publication_delivery_requests
            (publication_id, client_id, request_fingerprint, delivery_mode, asset_count)
          VALUES (
            _pub_id, _t.client_id,
            encode(sha256(convert_to(jsonb_build_object(
              'delivery_mode', _pub_modo,
              'asset_file_ids', _assets,
              'scheduled_at', _quando,
              'scheduled_timezone', _pub_fuso
            )::text, 'UTF8')), 'hex'),
            _pub_modo, jsonb_array_length(_assets)
          )
          ON CONFLICT (publication_id) DO NOTHING;
          UPDATE public.editorial_post_internal
             SET approval_fingerprint = public.editorial_compute_approval_fingerprint(_post),
                 updated_by = COALESCE(auth.uid(), updated_by)
           WHERE post_id = _post AND approval_fingerprint IS NOT NULL;
          PERFORM public.transition_editorial_publication_unlocked(_pub_id, 'schedule', _pub_versao, _quando, _pub_fuso);
        END IF;

        _segurada := _quando IS NOT NULL AND public.mesa_publicacao_segurada(_post, _quando, _f.file_id);
        UPDATE public.estudio_trabalhos
           SET post_id = _post,
               entrega_status = CASE WHEN _quando IS NOT NULL AND NOT _segurada THEN 'agendado' ELSE 'aprovado' END,
               agendado_para = _quando,
               entrega_aviso = CASE
                 WHEN _t.agenda_sincronizada_em IS NULL AND _quando IS NOT NULL THEN 'Esta arte já estava na Agenda.'
                 WHEN _quando IS NULL THEN 'Aprovado. Confirme a data para agendar.'
                 WHEN _segurada THEN 'Aprovado depois do horário. Escolha uma nova data.'
                 ELSE NULL
               END
         WHERE id = _t.id;


      ELSE
        UPDATE public.estudio_trabalhos
           SET entrega_status = 'precisa_de_atencao', entrega_aviso = _atencao
         WHERE id = _t.id;
        PERFORM public.avisar_equipe(
          public.mesa_com_cliente(_t.client_id, 'Mesa: "' || COALESCE(_task.title, 'arte aprovada') || '" foi aprovado, mas não entrou sozinho na Agenda. ' || _atencao),
          'aprovacao_necessaria',
          '/mesa?client=' || _t.client_id::text || '&aba=entrega'
        );
        _precisam := _precisam + 1;
      END IF;

      UPDATE public.mesa_agendamento_fila
         SET processado_em = now(), erro = NULL
       WHERE trabalho_id = _f.trabalho_id;

    EXCEPTION WHEN OTHERS THEN
      UPDATE public.mesa_agendamento_fila
         SET tentativas = tentativas + 1,
             erro = left(SQLERRM, 500),
             processado_em = CASE WHEN tentativas + 1 >= 5 THEN now() ELSE NULL END
       WHERE trabalho_id = _f.trabalho_id;
      IF _f.tentativas + 1 >= 5 THEN
        UPDATE public.estudio_trabalhos
           SET entrega_status = 'precisa_de_atencao',
               entrega_aviso = left('Não consegui agendar sozinho: ' || SQLERRM, 1000)
         WHERE id = _f.trabalho_id;
        PERFORM public.avisar_equipe(
          public.mesa_com_cliente(_f.client_id, 'Mesa: uma arte aprovada não entrou sozinha na Agenda depois de 5 tentativas. Agende pela Agenda.'),
          'aprovacao_necessaria',
          '/mesa?client=' || _f.client_id::text || '&aba=entrega'
        );
      END IF;
      _falhas := _falhas || jsonb_build_object('trabalho_id', _f.trabalho_id, 'erro', left(SQLERRM, 300));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'agendados', _agendados,
    'precisam_de_atencao', _precisam,
    'falhas', _falhas,
    'em', now()
  );
END;
$function$;

-- Privilégios iguais aos de produção (só o cron e o service_role chamam).
REVOKE ALL ON FUNCTION public.mesa_agendar_aprovados() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_agendar_aprovados() TO service_role;

-- Conferência (só leitura, depois de aplicar):
-- select relname, relrowsecurity from pg_class where relname in ('cliente_stories_sequencias','cliente_stories');
-- select tablename, policyname, cmd, roles from pg_policies where tablename in ('cliente_stories_sequencias','cliente_stories');
-- select jobname, schedule from cron.job where jobname = 'stories-aviso-pelo-app';
-- select position('_story_video' in pg_get_functiondef('public.editorial_autopublish_tick()'::regprocedure)) > 0;
-- select position('stories_9x16' in pg_get_functiondef('public.mesa_agendar_aprovados()'::regprocedure)) > 0;
