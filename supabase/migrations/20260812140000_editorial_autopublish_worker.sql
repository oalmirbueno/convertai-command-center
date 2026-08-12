-- Publicacao automatica no Instagram para publicacoes agendadas.
--
-- O schema ja previa entrega automatica (editorial_publications.delivery_mode
-- = 'automatic'), mas nunca existiu quem executasse. Este lote cria o executor
-- inteiro dentro do banco, usando pg_net (ja instalado) para falar com a Graph
-- API e pg_cron para acordar de minuto em minuto. Nao depende de deploy de
-- Edge Function.
--
-- Como funciona, em etapas curtas (cada tick avanca um passo por publicacao):
--   queued   -> cria o container de midia na Graph API
--   children -> (carrossel) cria o container pai com os filhos prontos
--   publish  -> chama media_publish
--   permalink-> busca o link do post publicado
--   done     -> marca a publicacao como publicada pelo fluxo oficial
--
-- Seguranca e reversibilidade:
--   - So publica o que ja esta 'scheduled' com delivery_mode 'automatic',
--     hora chegada e conta Instagram conectada e ativa.
--   - Token lido do Vault no momento do uso; nunca fica em tabela.
--   - Toda falha vira registro legivel no job, com tentativa limitada.
--   - Interruptor geral: social_private.autopublish_settings.enabled.
--   - Forward-only e aditivo: nenhuma tabela existente e alterada.

CREATE SCHEMA IF NOT EXISTS social_private;

-- ───────────────────────── Configuracao e interruptor ─────────────────────────
CREATE TABLE IF NOT EXISTS social_private.autopublish_settings (
  id boolean PRIMARY KEY DEFAULT true,
  enabled boolean NOT NULL DEFAULT false,
  graph_version text NOT NULL DEFAULT 'v21.0',
  storage_base_url text NOT NULL DEFAULT 'https://gicbrgagstyvbaaumprj.supabase.co',
  max_attempts smallint NOT NULL DEFAULT 3,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT autopublish_settings_singleton CHECK (id)
);

INSERT INTO social_private.autopublish_settings (id, enabled)
VALUES (true, false)
ON CONFLICT (id) DO NOTHING;

-- ───────────────────────────── Fila de execucao ──────────────────────────────
CREATE TABLE IF NOT EXISTS social_private.autopublish_jobs (
  publication_id uuid PRIMARY KEY,
  client_id uuid NOT NULL,
  stage text NOT NULL DEFAULT 'queued',
  attempts smallint NOT NULL DEFAULT 0,
  net_request_id bigint,
  child_urls text[] NOT NULL DEFAULT ARRAY[]::text[],
  child_container_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  container_id text,
  media_id text,
  permalink text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT autopublish_jobs_stage_check CHECK (
    stage IN ('queued', 'children', 'parent', 'publish', 'permalink', 'done', 'failed')
  )
);

ALTER TABLE social_private.autopublish_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_private.autopublish_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON social_private.autopublish_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON social_private.autopublish_jobs FROM PUBLIC, anon, authenticated;

-- ─────────────────── URL publica do arquivo (bucket files e publico) ──────────
CREATE OR REPLACE FUNCTION social_private.autopublish_file_url(_file_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN file_row.file_url IS NOT NULL AND file_row.file_url LIKE 'http%'
      THEN file_row.file_url
    WHEN file_row.storage_path IS NOT NULL
      THEN (SELECT settings.storage_base_url FROM social_private.autopublish_settings AS settings WHERE settings.id)
        || '/storage/v1/object/public/'
        || COALESCE(file_row.storage_bucket, 'files')
        || '/' || file_row.storage_path
    ELSE NULL
  END
  FROM public.files AS file_row
  WHERE file_row.id = _file_id;
$function$;

-- ─────────────────────────── Token da conta no Vault ─────────────────────────
CREATE OR REPLACE FUNCTION social_private.autopublish_account_token(
  _external_account_id uuid
)
RETURNS TABLE (resource_id text, access_token text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    grant_row.provider_resource_id,
    secret_row.decrypted_secret
  FROM social_private.external_account_grants AS grant_row
  JOIN vault.decrypted_secrets AS secret_row
    ON secret_row.id = grant_row.resource_access_token_secret_id
  WHERE grant_row.external_account_id = _external_account_id
    AND grant_row.revoked_at IS NULL
    AND grant_row.platform = 'instagram'
  LIMIT 1;
$function$;

-- ─────────────────── Codificacao de parametros para a Graph API ──────────────
CREATE OR REPLACE FUNCTION social_private.autopublish_urlencode(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT COALESCE(
    string_agg(
      CASE
        WHEN piece ~ '^[A-Za-z0-9_.~-]$' THEN piece
        ELSE upper('%' || encode(convert_to(piece, 'UTF8'), 'hex'))
      END,
      ''
    ),
    ''
  )
  FROM regexp_split_to_table(COALESCE(_value, ''), '') AS piece;
$function$;

-- ───────────────────────────────── Executor ──────────────────────────────────
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
  _response record;
  _token record;
  _url text;
  _payload text;
  _request_id bigint;
  _admin uuid;
  _queued integer := 0;
  _advanced integer := 0;
  _published integer := 0;
  _failed integer := 0;
  _children text[];
  _caption text;
  _body jsonb;
BEGIN
  SELECT * INTO _settings FROM social_private.autopublish_settings WHERE id;
  IF _settings IS NULL OR NOT _settings.enabled THEN
    RETURN jsonb_build_object('enabled', false);
  END IF;

  _graph := 'https://graph.facebook.com/' || _settings.graph_version;
  SELECT id INTO _admin
  FROM auth.users
  WHERE id IN (SELECT user_id FROM public.user_roles WHERE role = 'admin'::public.app_role)
  ORDER BY created_at
  LIMIT 1;

  -- 1. Enfileira publicacoes agendadas cuja hora chegou.
  FOR _due IN
    SELECT
      publication.id,
      publication.client_id,
      publication.external_account_id,
      publication.caption,
      COALESCE(publication.file_id, post.primary_file_id) AS file_id,
      post.content_type
    FROM public.editorial_publications AS publication
    JOIN public.editorial_posts AS post ON post.id = publication.post_id
    WHERE publication.status = 'scheduled'
      AND publication.platform = 'instagram'
      AND publication.delivery_mode = 'automatic'
      AND publication.scheduled_at IS NOT NULL
      AND publication.scheduled_at <= now()
      -- v1 publica imagem unica. Carrossel, reel e video seguem manuais: e
      -- melhor a equipe publicar do que o robo postar so a capa.
      AND post.content_type IN ('static', 'design')
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

  -- 2. Avanca cada job em andamento, um passo por tick.
  FOR _job IN
    SELECT * FROM social_private.autopublish_jobs
    WHERE stage NOT IN ('done', 'failed')
    ORDER BY created_at
    LIMIT 10
  LOOP
    BEGIN
      SELECT * INTO _token
      FROM social_private.autopublish_account_token(
        (SELECT external_account_id FROM public.editorial_publications WHERE id = _job.publication_id)
      );

      IF _token.access_token IS NULL THEN
        UPDATE social_private.autopublish_jobs
        SET stage = 'failed',
            last_error = 'Conta Instagram sem conexao ativa ou token indisponivel.',
            updated_at = now()
        WHERE publication_id = _job.publication_id;
        _failed := _failed + 1;
        CONTINUE;
      END IF;

      -- 2a. Passo inicial: monta o(s) container(es) de midia.
      IF _job.stage = 'queued' AND _job.net_request_id IS NULL THEN
        SELECT
          COALESCE(publication.caption, ''),
          social_private.autopublish_file_url(
            COALESCE(publication.file_id, post.primary_file_id)
          )
        INTO _caption, _url
        FROM public.editorial_publications AS publication
        JOIN public.editorial_posts AS post ON post.id = publication.post_id
        WHERE publication.id = _job.publication_id;

        IF _url IS NULL THEN
          UPDATE social_private.autopublish_jobs
          SET stage = 'failed',
              last_error = 'Arquivo da publicacao sem URL publica.',
              updated_at = now()
          WHERE publication_id = _job.publication_id;
          _failed := _failed + 1;
          CONTINUE;
        END IF;

        _payload := _graph || '/' || _token.resource_id || '/media'
          || '?image_url=' || social_private.autopublish_urlencode(_url)
          || '&caption=' || social_private.autopublish_urlencode(_caption)
          || '&access_token=' || _token.access_token;

        SELECT net.http_post(url := _payload, headers := '{}'::jsonb) INTO _request_id;

        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id,
            attempts = attempts + 1,
            updated_at = now()
        WHERE publication_id = _job.publication_id;
        _advanced := _advanced + 1;
        CONTINUE;
      END IF;

      -- 2b. Le a resposta pendente, se ja chegou.
      IF _job.net_request_id IS NOT NULL THEN
        SELECT status_code, content INTO _response
        FROM net._http_response
        WHERE id = _job.net_request_id;

        IF NOT FOUND THEN
          CONTINUE; -- resposta ainda em transito
        END IF;

        IF _response.status_code IS NULL OR _response.status_code >= 300 THEN
          UPDATE social_private.autopublish_jobs
          SET stage = CASE WHEN attempts >= _settings.max_attempts THEN 'failed' ELSE stage END,
              net_request_id = NULL,
              last_error = left(COALESCE(_response.content, 'sem resposta'), 500),
              updated_at = now()
          WHERE publication_id = _job.publication_id;
          _failed := _failed + 1;
          CONTINUE;
        END IF;

        _body := _response.content::jsonb;

        IF _job.stage = 'queued' THEN
          UPDATE social_private.autopublish_jobs
          SET container_id = _body->>'id',
              stage = 'publish',
              net_request_id = NULL,
              updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          CONTINUE;
        END IF;

        IF _job.stage = 'publish' THEN
          UPDATE social_private.autopublish_jobs
          SET media_id = _body->>'id',
              stage = 'permalink',
              net_request_id = NULL,
              updated_at = now()
          WHERE publication_id = _job.publication_id;
          _advanced := _advanced + 1;
          CONTINUE;
        END IF;

        IF _job.stage = 'permalink' THEN
          UPDATE social_private.autopublish_jobs
          SET permalink = _body->>'permalink',
              stage = 'done',
              net_request_id = NULL,
              updated_at = now()
          WHERE publication_id = _job.publication_id;

          -- Marca como publicada pelo fluxo oficial, assumindo o papel de admin.
          IF _admin IS NOT NULL THEN
            PERFORM set_config(
              'request.jwt.claims',
              json_build_object('sub', _admin::text, 'role', 'authenticated')::text,
              true
            );
            PERFORM public.transition_editorial_publication(
              _job.publication_id,
              'publish',
              (SELECT version FROM public.editorial_publications WHERE id = _job.publication_id),
              NULL,
              NULL,
              _body->>'permalink',
              _job.media_id,
              NULL,
              NULL,
              now()
            );
          END IF;
          _published := _published + 1;
          CONTINUE;
        END IF;
      END IF;

      -- 2c. Dispara o passo seguinte quando nao ha requisicao em voo.
      IF _job.stage = 'publish' AND _job.net_request_id IS NULL AND _job.container_id IS NOT NULL THEN
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

      IF _job.stage = 'permalink' AND _job.net_request_id IS NULL AND _job.media_id IS NOT NULL THEN
        _payload := _graph || '/' || _job.media_id
          || '?fields=permalink&access_token=' || _token.access_token;
        SELECT net.http_get(url := _payload) INTO _request_id;
        UPDATE social_private.autopublish_jobs
        SET net_request_id = _request_id, attempts = attempts + 1, updated_at = now()
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
    'enabled', true,
    'queued', _queued,
    'advanced', _advanced,
    'published', _published,
    'failed', _failed
  );
END
$function$;

REVOKE ALL ON FUNCTION public.editorial_autopublish_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.editorial_autopublish_tick() TO service_role;

-- ─────────────────────────── Agendador de minuto ────────────────────────────
-- O tick e uma funcao SQL: o cron chama direto, sem HTTP e sem chave de
-- servico. Reexecutar o lote apenas reagenda o mesmo job.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('editorial-autopublish')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'editorial-autopublish');

    PERFORM cron.schedule(
      'editorial-autopublish',
      '* * * * *',
      'SELECT public.editorial_autopublish_tick();'
    );
    RAISE NOTICE 'publicacao automatica agendada de minuto em minuto';
  ELSE
    RAISE NOTICE 'pg_cron indisponivel: chame public.editorial_autopublish_tick() por outro agendador';
  END IF;
END
$cron$;
