-- ═══════════════════════════════════════════════════════════════════════
-- PROPOSTA NÃO APLICADA. NÃO RODAR SEM AUTORIZAÇÃO EXPLÍCITA DO ALMIR.
-- 2026-11-26 · MCP 2.39.3 · Instagram Audio API (Reels) + música sugerida
-- Banco: jjjtkowvxemvituvywvf (Aceleriq OS). Escrito no box; nada foi executado.
--
-- POR QUE PRECISA DE DDL
--   editorial_posts e editorial_publications não têm coluna JSON; editorial_events
--   é imutável e só abre por RPC. Sem lugar para guardar a escolha do áudio do
--   Reel nem a música sugerida do post.
--
-- O QUE FAZ (uma transação; qualquer falha desfaz tudo)
--   0) Preflight: tabelas, helpers e a função do publicador existem; as tabelas
--      novas ainda não existem.
--   1) public.editorial_publication_audio (1 linha por publicação de Reel) e
--      public.editorial_post_music_suggestions (1 linha por post, qualquer tipo).
--      RLS ligado e sem policy; anon e authenticated sem acesso à tabela;
--      service_role só SELECT. Escrita só pelas RPCs abaixo.
--   2) RPCs SECURITY DEFINER, search_path '':
--        editorial_reel_audio_definir / editorial_reel_audio_remover
--          (editorial_can_publish_client, o mesmo de transition_editorial_publication:
--           admin, ou gestor do cliente; só Reel do Instagram; volumes 1..100;
--           publicação publicada/cancelada ou contêiner já criado recusa)
--        editorial_post_musica_definir / editorial_post_musica_remover
--          (editorial_staff_can_access_client, o mesmo de save_editorial_post;
--           qualquer tipo de post; url só https)
--        editorial_audio_e_musica_ler (can_access_client; service_role lê tudo,
--          o MCP filtra pelo escopo da credencial antes)
--      EXECUTE: escritas só authenticated; leitura authenticated e service_role.
--   3) Publicador: patch em public.editorial_autopublish_tick() só se
--      md5(prosrc) = 'da209ef79460425ab7e36b71d34b349a' (a versão viva lida em
--      26/11 ~12h BRT; difere da migration 20261030100000 do repo). Guarda a
--      definição original em social_private.autopublish_function_backups, troca
--      EXATAMENTE 1 ocorrência do ramo REELS e recria com EXECUTE do próprio
--      pg_get_functiondef (mantém SECURITY DEFINER, search_path, dono e grants;
--      confere tudo depois). Carrossel, imagem e story ficam intactos.
--      Observação: social_private.autopublish_urlencode(NULL) devolve '' (não
--      NULL), então o "|| COALESCE('&audio_configuration=' || urlencode(json), '')"
--      literal mandaria "&audio_configuration=" vazio em todo Reel sem áudio. O
--      patch usa um subselect que devolve NULL quando não há linha.
--
-- PREFLIGHT (só leitura, antes de aplicar)
--   select md5(prosrc), length(prosrc) from pg_proc
--    where oid = 'public.editorial_autopublish_tick()'::regprocedure;   -- da209ef7..., 38268
--   select graph_version, enabled from social_private.autopublish_settings;  -- hoje v21.0
--   -- Atenção: confirmar na doc da Meta se audio_configuration é aceito na
--   -- graph_version do publicador (v21.0). Se exigir versão nova, subir a
--   -- graph_version é decisão separada, fora desta migração.
--
-- CONFERÊNCIA (depois de aplicar)
--   select position('[audio-do-reel]' in prosrc) > 0 from pg_proc
--    where oid = 'public.editorial_autopublish_tick()'::regprocedure;     -- true
--   select count(*) from social_private.autopublish_function_backups;      -- 1
--   select has_function_privilege('anon', 'public.editorial_reel_audio_definir(uuid,text,integer,integer,text,text)', 'execute'); -- false
--
-- ROLLBACK: bloco comentado no fim do arquivo, pronto para colar.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 0) preflight ──────────────────────────────────────────────────────
DO $preflight$
BEGIN
  IF to_regclass('public.editorial_publications') IS NULL
    OR to_regclass('public.editorial_posts') IS NULL
    OR to_regclass('public.profiles') IS NULL
    OR to_regclass('social_private.autopublish_jobs') IS NULL THEN
    RAISE EXCEPTION 'preflight: tabelas editoriais ou do publicador ausentes';
  END IF;
  IF to_regprocedure('public.editorial_can_publish_client(uuid)') IS NULL
    OR to_regprocedure('public.editorial_staff_can_access_client(uuid)') IS NULL
    OR to_regprocedure('public.can_access_client(uuid)') IS NULL
    OR to_regprocedure('public.update_updated_at_column()') IS NULL
    OR to_regprocedure('social_private.autopublish_urlencode(text)') IS NULL
    OR to_regprocedure('public.editorial_autopublish_tick()') IS NULL THEN
    RAISE EXCEPTION 'preflight: helpers editoriais ou função do publicador ausentes';
  END IF;
  IF to_regclass('public.editorial_publication_audio') IS NOT NULL
    OR to_regclass('public.editorial_post_music_suggestions') IS NOT NULL THEN
    RAISE EXCEPTION 'preflight: as tabelas do áudio já existem (migração já aplicada?)';
  END IF;
END
$preflight$;

-- ─── 1) tabelas ────────────────────────────────────────────────────────
CREATE TABLE public.editorial_publication_audio (
  publication_id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  audio_id text NOT NULL,
  audio_volume smallint,
  video_volume smallint,
  audio_title text,
  audio_artist text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT editorial_publication_audio_publication_fkey
    FOREIGN KEY (publication_id, client_id)
    REFERENCES public.editorial_publications(id, client_id) ON DELETE CASCADE,
  CONSTRAINT editorial_publication_audio_audio_id_check CHECK (audio_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT editorial_publication_audio_audio_volume_check CHECK (audio_volume IS NULL OR audio_volume BETWEEN 1 AND 100),
  CONSTRAINT editorial_publication_audio_video_volume_check CHECK (video_volume IS NULL OR video_volume BETWEEN 1 AND 100),
  CONSTRAINT editorial_publication_audio_title_check CHECK (audio_title IS NULL OR char_length(audio_title) <= 200),
  CONSTRAINT editorial_publication_audio_artist_check CHECK (audio_artist IS NULL OR char_length(audio_artist) <= 200)
);
CREATE INDEX editorial_publication_audio_client_idx ON public.editorial_publication_audio (client_id);
COMMENT ON TABLE public.editorial_publication_audio IS
  'MCP 2.39.3: áudio da Meta (Instagram Audio API) escolhido para a publicação de um Reel do Instagram. O publicador manda audio_configuration no contêiner REELS. Escrita só pelas RPCs editorial_reel_audio_*.';

CREATE TABLE public.editorial_post_music_suggestions (
  post_id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  titulo text NOT NULL,
  artista text,
  url text,
  nota text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT editorial_post_music_suggestions_post_fkey
    FOREIGN KEY (post_id, client_id)
    REFERENCES public.editorial_posts(id, client_id) ON DELETE CASCADE,
  CONSTRAINT editorial_post_music_suggestions_titulo_check CHECK (char_length(btrim(titulo)) BETWEEN 1 AND 200),
  CONSTRAINT editorial_post_music_suggestions_artista_check CHECK (artista IS NULL OR char_length(artista) <= 200),
  CONSTRAINT editorial_post_music_suggestions_url_check CHECK (url IS NULL OR (url ~ '^https://' AND char_length(url) <= 2000)),
  CONSTRAINT editorial_post_music_suggestions_nota_check CHECK (nota IS NULL OR char_length(nota) <= 500)
);
CREATE INDEX editorial_post_music_suggestions_client_idx ON public.editorial_post_music_suggestions (client_id);
COMMENT ON TABLE public.editorial_post_music_suggestions IS
  'MCP 2.39.3: música sugerida pela agência para o post (qualquer tipo). Só referência para quem publica ou edita; não vai para a Meta. Escrita só pelas RPCs editorial_post_musica_*.';

CREATE TRIGGER editorial_publication_audio_updated_at
  BEFORE UPDATE ON public.editorial_publication_audio
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER editorial_post_music_suggestions_updated_at
  BEFORE UPDATE ON public.editorial_post_music_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.editorial_publication_audio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.editorial_post_music_suggestions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.editorial_publication_audio FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.editorial_post_music_suggestions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.editorial_publication_audio TO service_role;
GRANT SELECT ON TABLE public.editorial_post_music_suggestions TO service_role;

-- ─── 2) RPCs ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.editorial_reel_audio_definir(
  p_publication_id uuid,
  p_audio_id text,
  p_audio_volume integer DEFAULT NULL,
  p_video_volume integer DEFAULT NULL,
  p_audio_title text DEFAULT NULL,
  p_audio_artist text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _actor uuid := auth.uid();
  _pub public.editorial_publications%ROWTYPE;
  _post public.editorial_posts%ROWTYPE;
  _audio_id text := btrim(COALESCE(p_audio_id, ''));
  _title text := NULLIF(btrim(COALESCE(p_audio_title, '')), '');
  _artist text := NULLIF(btrim(COALESCE(p_audio_artist, '')), '');
  _row public.editorial_publication_audio%ROWTYPE;
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'editorial reel audio requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  IF _audio_id !~ '^[A-Za-z0-9_-]{1,64}$' THEN
    RAISE EXCEPTION 'audio_id inválido: use o id devolvido pela busca de áudios' USING ERRCODE = '22023';
  END IF;
  IF p_audio_volume IS NOT NULL AND (p_audio_volume < 1 OR p_audio_volume > 100) THEN
    RAISE EXCEPTION 'audio_volume precisa ser inteiro de 1 a 100' USING ERRCODE = '22023';
  END IF;
  IF p_video_volume IS NOT NULL AND (p_video_volume < 1 OR p_video_volume > 100) THEN
    RAISE EXCEPTION 'video_volume precisa ser inteiro de 1 a 100' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(_title, '')) > 200 OR char_length(COALESCE(_artist, '')) > 200 THEN
    RAISE EXCEPTION 'audio_title e audio_artist até 200 caracteres' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _pub FROM public.editorial_publications WHERE id = p_publication_id FOR UPDATE;
  IF NOT FOUND OR NOT public.editorial_can_publish_client(_pub.client_id) THEN
    RAISE EXCEPTION 'publication not found or audio access denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _post FROM public.editorial_posts WHERE id = _pub.post_id AND client_id = _pub.client_id;
  IF NOT FOUND OR _post.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'editorial post is unavailable';
  END IF;
  -- Mesma regra do publicador: REELS só quando content_type em ('reel','video','short').
  IF _pub.platform IS DISTINCT FROM 'instagram' OR _post.content_type NOT IN ('reel', 'video', 'short') THEN
    RAISE EXCEPTION 'a Meta só aceita audio_configuration em Reels; use musica_sugerida' USING ERRCODE = '22023';
  END IF;
  IF _pub.status IN ('published', 'cancelled') THEN
    RAISE EXCEPTION 'publicação % não recebe áudio', _pub.status USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM social_private.autopublish_jobs AS job
     WHERE job.publication_id = _pub.id
       AND job.container_id IS NOT NULL
       AND job.stage NOT IN ('done', 'failed')
  ) THEN
    RAISE EXCEPTION 'o contêiner do Reel já foi criado na Meta: o áudio não muda nesta tentativa' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.editorial_publication_audio AS a
    (publication_id, client_id, audio_id, audio_volume, video_volume, audio_title, audio_artist, updated_by)
  VALUES
    (_pub.id, _pub.client_id, _audio_id, p_audio_volume::smallint, p_video_volume::smallint, _title, _artist, _actor)
  ON CONFLICT (publication_id) DO UPDATE
    SET audio_id = EXCLUDED.audio_id,
        audio_volume = EXCLUDED.audio_volume,
        video_volume = EXCLUDED.video_volume,
        audio_title = EXCLUDED.audio_title,
        audio_artist = EXCLUDED.audio_artist,
        updated_by = EXCLUDED.updated_by
    WHERE a.client_id = EXCLUDED.client_id
  RETURNING * INTO _row;
  IF _row.publication_id IS NULL THEN
    RAISE EXCEPTION 'publication audio belongs to another client' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'publication_id', _row.publication_id,
    'post_id', _post.id,
    'client_id', _row.client_id,
    'audio_id', _row.audio_id,
    'audio_volume', _row.audio_volume,
    'video_volume', _row.video_volume,
    'audio_title', _row.audio_title,
    'audio_artist', _row.audio_artist,
    'updated_at', _row.updated_at
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.editorial_reel_audio_remover(p_publication_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _actor uuid := auth.uid();
  _pub public.editorial_publications%ROWTYPE;
  _removido integer := 0;
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'editorial reel audio requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _pub FROM public.editorial_publications WHERE id = p_publication_id FOR UPDATE;
  IF NOT FOUND OR NOT public.editorial_can_publish_client(_pub.client_id) THEN
    RAISE EXCEPTION 'publication not found or audio access denied' USING ERRCODE = '42501';
  END IF;
  IF _pub.status = 'published' THEN
    RAISE EXCEPTION 'publicação já publicada: o áudio não muda mais' USING ERRCODE = '55000';
  END IF;
  DELETE FROM public.editorial_publication_audio
   WHERE publication_id = _pub.id AND client_id = _pub.client_id;
  GET DIAGNOSTICS _removido = ROW_COUNT;
  RETURN jsonb_build_object('publication_id', _pub.id, 'client_id', _pub.client_id, 'removido', _removido > 0);
END
$function$;

CREATE OR REPLACE FUNCTION public.editorial_post_musica_definir(
  p_post_id uuid,
  p_titulo text,
  p_artista text DEFAULT NULL,
  p_url text DEFAULT NULL,
  p_nota text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _actor uuid := auth.uid();
  _post public.editorial_posts%ROWTYPE;
  _titulo text := btrim(COALESCE(p_titulo, ''));
  _artista text := NULLIF(btrim(COALESCE(p_artista, '')), '');
  _url text := NULLIF(btrim(COALESCE(p_url, '')), '');
  _nota text := NULLIF(btrim(COALESCE(p_nota, '')), '');
  _row public.editorial_post_music_suggestions%ROWTYPE;
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'editorial music suggestion requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  IF char_length(_titulo) < 1 OR char_length(_titulo) > 200 THEN
    RAISE EXCEPTION 'titulo é obrigatório (1 a 200 caracteres)' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(_artista, '')) > 200 THEN
    RAISE EXCEPTION 'artista até 200 caracteres' USING ERRCODE = '22023';
  END IF;
  IF _url IS NOT NULL AND (_url !~ '^https://' OR char_length(_url) > 2000) THEN
    RAISE EXCEPTION 'url precisa começar com https://' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(_nota, '')) > 500 THEN
    RAISE EXCEPTION 'nota até 500 caracteres' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _post FROM public.editorial_posts WHERE id = p_post_id FOR UPDATE;
  IF NOT FOUND OR NOT public.editorial_staff_can_access_client(_post.client_id) THEN
    RAISE EXCEPTION 'editorial client access denied' USING ERRCODE = '42501';
  END IF;
  IF _post.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'editorial post is unavailable';
  END IF;

  INSERT INTO public.editorial_post_music_suggestions AS m
    (post_id, client_id, titulo, artista, url, nota, updated_by)
  VALUES
    (_post.id, _post.client_id, _titulo, _artista, _url, _nota, _actor)
  ON CONFLICT (post_id) DO UPDATE
    SET titulo = EXCLUDED.titulo,
        artista = EXCLUDED.artista,
        url = EXCLUDED.url,
        nota = EXCLUDED.nota,
        updated_by = EXCLUDED.updated_by
    WHERE m.client_id = EXCLUDED.client_id
  RETURNING * INTO _row;
  IF _row.post_id IS NULL THEN
    RAISE EXCEPTION 'music suggestion belongs to another client' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'post_id', _row.post_id,
    'client_id', _row.client_id,
    'content_type', _post.content_type,
    'titulo', _row.titulo,
    'artista', _row.artista,
    'url', _row.url,
    'nota', _row.nota,
    'updated_at', _row.updated_at
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.editorial_post_musica_remover(p_post_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _actor uuid := auth.uid();
  _post public.editorial_posts%ROWTYPE;
  _removido integer := 0;
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'editorial music suggestion requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _post FROM public.editorial_posts WHERE id = p_post_id;
  IF NOT FOUND OR NOT public.editorial_staff_can_access_client(_post.client_id) THEN
    RAISE EXCEPTION 'editorial client access denied' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.editorial_post_music_suggestions
   WHERE post_id = _post.id AND client_id = _post.client_id;
  GET DIAGNOSTICS _removido = ROW_COUNT;
  RETURN jsonb_build_object('post_id', _post.id, 'client_id', _post.client_id, 'removido', _removido > 0);
END
$function$;

-- Leitura em lote para a Agenda (até 500 posts). service_role (o MCP, que já
-- filtrou pelo escopo da credencial) lê tudo; quem está logado só o que
-- can_access_client libera.
CREATE OR REPLACE FUNCTION public.editorial_audio_e_musica_ler(p_post_ids uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH pedidos AS (
    SELECT DISTINCT pedido.post_id
      FROM unnest(COALESCE(p_post_ids, ARRAY[]::uuid[])) WITH ORDINALITY AS pedido(post_id, ordem)
     WHERE pedido.ordem <= 500
  ),
  liberado AS (
    SELECT auth.role() = 'service_role' AS servico
  )
  SELECT jsonb_build_object(
    'musicas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'post_id', musica.post_id,
        'client_id', musica.client_id,
        'titulo', musica.titulo,
        'artista', musica.artista,
        'url', musica.url,
        'nota', musica.nota,
        'updated_at', musica.updated_at
      ) ORDER BY musica.post_id)
        FROM public.editorial_post_music_suggestions AS musica
        JOIN pedidos ON pedidos.post_id = musica.post_id
       WHERE (SELECT servico FROM liberado) OR public.can_access_client(musica.client_id)
    ), '[]'::jsonb),
    'audios', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'publication_id', audio.publication_id,
        'post_id', publicacao.post_id,
        'client_id', audio.client_id,
        'audio_id', audio.audio_id,
        'audio_volume', audio.audio_volume,
        'video_volume', audio.video_volume,
        'audio_title', audio.audio_title,
        'audio_artist', audio.audio_artist,
        'updated_at', audio.updated_at
      ) ORDER BY audio.publication_id)
        FROM public.editorial_publication_audio AS audio
        JOIN public.editorial_publications AS publicacao
          ON publicacao.id = audio.publication_id AND publicacao.client_id = audio.client_id
        JOIN pedidos ON pedidos.post_id = publicacao.post_id
       WHERE (SELECT servico FROM liberado) OR public.can_access_client(audio.client_id)
    ), '[]'::jsonb)
  )
$function$;

REVOKE ALL ON FUNCTION public.editorial_reel_audio_definir(uuid, text, integer, integer, text, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.editorial_reel_audio_remover(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.editorial_post_musica_definir(uuid, text, text, text, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.editorial_post_musica_remover(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.editorial_audio_e_musica_ler(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.editorial_reel_audio_definir(uuid, text, integer, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.editorial_reel_audio_remover(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.editorial_post_musica_definir(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.editorial_post_musica_remover(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.editorial_audio_e_musica_ler(uuid[]) TO authenticated, service_role;

-- ─── 3) publicador: audio_configuration só no ramo REELS ──────────────
CREATE TABLE IF NOT EXISTS social_private.autopublish_function_backups (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  function_signature text NOT NULL,
  prosrc_md5 text NOT NULL,
  functiondef text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE social_private.autopublish_function_backups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE social_private.autopublish_function_backups FROM PUBLIC, anon, authenticated, service_role;

DO $patch$
DECLARE
  _proc regprocedure := 'public.editorial_autopublish_tick()'::regprocedure;
  _src text;
  _def text;
  _owner oid;
  _acl aclitem[];
  _secdef boolean;
  _config text[];
  _esperado text;
  _ancora constant text := $ancora$          ELSIF _kind = 'video' THEN
            _payload := _graph || '/' || _token.resource_id || '/media'
              || '?media_type=REELS'
              || '&video_url=' || social_private.autopublish_urlencode(_urls[1])
              || '&caption=' || social_private.autopublish_urlencode(_pub.caption)
              || '&access_token=' || _token.access_token;$ancora$;
  _novo constant text := $novo$          ELSIF _kind = 'video' THEN
            _payload := _graph || '/' || _token.resource_id || '/media'
              || '?media_type=REELS'
              || '&video_url=' || social_private.autopublish_urlencode(_urls[1])
              || '&caption=' || social_private.autopublish_urlencode(_pub.caption)
              -- [audio-do-reel] 26/11/2026 (MCP 2.39.3): audio da Meta escolhido para esta publicacao, so no REELS.
              -- Sem linha em editorial_publication_audio o subselect da NULL e o COALESCE nao acrescenta nada.
              || COALESCE((
                SELECT '&audio_configuration=' || social_private.autopublish_urlencode(
                  jsonb_strip_nulls(jsonb_build_object(
                    'audio_id', audio_row.audio_id,
                    'audio_volume', audio_row.audio_volume,
                    'video_volume', audio_row.video_volume
                  ))::text)
                FROM public.editorial_publication_audio AS audio_row
                WHERE audio_row.publication_id = _job.publication_id
                  AND audio_row.client_id = _job.client_id
                LIMIT 1
              ), '')
              -- [/audio-do-reel]
              || '&access_token=' || _token.access_token;$novo$;
BEGIN
  SELECT p.prosrc, pg_catalog.pg_get_functiondef(p.oid), p.proowner, p.proacl, p.prosecdef, p.proconfig
    INTO _src, _def, _owner, _acl, _secdef, _config
    FROM pg_catalog.pg_proc AS p
   WHERE p.oid = _proc;

  IF md5(_src) <> 'da209ef79460425ab7e36b71d34b349a' THEN
    RAISE EXCEPTION 'editorial_autopublish_tick mudou (md5 % em vez de da209ef79460425ab7e36b71d34b349a): patch do áudio NÃO aplicado', md5(_src);
  END IF;
  IF (length(_src) - length(replace(_src, _ancora, ''))) / length(_ancora) <> 1 THEN
    RAISE EXCEPTION 'âncora do ramo REELS não aparece exatamente 1 vez no prosrc: patch NÃO aplicado';
  END IF;
  IF (length(_def) - length(replace(_def, _ancora, ''))) / length(_ancora) <> 1 THEN
    RAISE EXCEPTION 'âncora do ramo REELS não aparece exatamente 1 vez na definição: patch NÃO aplicado';
  END IF;
  IF NOT _secdef OR NOT EXISTS (SELECT 1 FROM unnest(_config) AS c(v) WHERE c.v LIKE 'search_path=%') THEN
    RAISE EXCEPTION 'editorial_autopublish_tick sem SECURITY DEFINER ou sem search_path: patch NÃO aplicado';
  END IF;

  INSERT INTO social_private.autopublish_function_backups (function_signature, prosrc_md5, functiondef, reason)
  VALUES (_proc::text, md5(_src), _def, '20261126150000 áudio do Reel: definição antes do patch');

  _esperado := replace(_src, _ancora, _novo);
  EXECUTE replace(_def, _ancora, _novo);

  PERFORM 1
     FROM pg_catalog.pg_proc AS p
    WHERE p.oid = _proc
      AND p.prosrc = _esperado
      AND p.prosecdef = _secdef
      AND p.proowner = _owner
      AND p.proconfig IS NOT DISTINCT FROM _config
      AND p.proacl IS NOT DISTINCT FROM _acl;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'conferência depois do patch falhou (corpo, SECURITY DEFINER, dono, search_path ou grants): desfeito';
  END IF;
  RAISE NOTICE 'editorial_autopublish_tick com áudio do Reel: md5 novo %', md5(_esperado);
END
$patch$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK COMPLETO (copiar, tirar o "-- " do começo de cada linha e rodar)
-- Ordem: 1) tira o áudio do publicador (replace reverso, com checagem), 2) RPCs,
-- 3) tabelas. Apaga SÓ as escolhas de áudio dos Reels e as músicas sugeridas
-- gravadas por estas tools; nenhum post, publicação, arquivo ou dado de cliente
-- existente é tocado. O backup da definição antiga fica em
-- social_private.autopublish_function_backups (restauração manual, se precisar:
-- EXECUTE do functiondef com prosrc_md5 = 'da209ef79460425ab7e36b71d34b349a').
-- ═══════════════════════════════════════════════════════════════════════
-- BEGIN;
--
-- DO $rollback$
-- DECLARE
--   _proc regprocedure := 'public.editorial_autopublish_tick()'::regprocedure;
--   _src text;
--   _def text;
--   _owner oid;
--   _acl aclitem[];
--   _secdef boolean;
--   _config text[];
--   _esperado text;
--   _ancora constant text := $ancora$          ELSIF _kind = 'video' THEN
--             _payload := _graph || '/' || _token.resource_id || '/media'
--               || '?media_type=REELS'
--               || '&video_url=' || social_private.autopublish_urlencode(_urls[1])
--               || '&caption=' || social_private.autopublish_urlencode(_pub.caption)
--               || '&access_token=' || _token.access_token;$ancora$;
--   _novo constant text := $novo$          ELSIF _kind = 'video' THEN
--             _payload := _graph || '/' || _token.resource_id || '/media'
--               || '?media_type=REELS'
--               || '&video_url=' || social_private.autopublish_urlencode(_urls[1])
--               || '&caption=' || social_private.autopublish_urlencode(_pub.caption)
--               -- [audio-do-reel] 26/11/2026 (MCP 2.39.3): audio da Meta escolhido para esta publicacao, so no REELS.
--               -- Sem linha em editorial_publication_audio o subselect da NULL e o COALESCE nao acrescenta nada.
--               || COALESCE((
--                 SELECT '&audio_configuration=' || social_private.autopublish_urlencode(
--                   jsonb_strip_nulls(jsonb_build_object(
--                     'audio_id', audio_row.audio_id,
--                     'audio_volume', audio_row.audio_volume,
--                     'video_volume', audio_row.video_volume
--                   ))::text)
--                 FROM public.editorial_publication_audio AS audio_row
--                 WHERE audio_row.publication_id = _job.publication_id
--                   AND audio_row.client_id = _job.client_id
--                 LIMIT 1
--               ), '')
--               -- [/audio-do-reel]
--               || '&access_token=' || _token.access_token;$novo$;
-- BEGIN
--   SELECT p.prosrc, pg_catalog.pg_get_functiondef(p.oid), p.proowner, p.proacl, p.prosecdef, p.proconfig
--     INTO _src, _def, _owner, _acl, _secdef, _config
--     FROM pg_catalog.pg_proc AS p
--    WHERE p.oid = _proc;
--
--   IF md5(_src) = 'da209ef79460425ab7e36b71d34b349a' THEN
--     RAISE NOTICE 'editorial_autopublish_tick já está na versão de antes do patch: nada a restaurar';
--   ELSE
--     IF (length(_src) - length(replace(_src, _novo, ''))) / length(_novo) <> 1
--       OR (length(_def) - length(replace(_def, _novo, ''))) / length(_novo) <> 1 THEN
--       RAISE EXCEPTION 'o trecho do áudio não aparece exatamente 1 vez: a função mudou depois do patch. Restaure à mão a partir de social_private.autopublish_function_backups';
--     END IF;
--     _esperado := replace(_src, _novo, _ancora);
--     EXECUTE replace(_def, _novo, _ancora);
--     PERFORM 1
--        FROM pg_catalog.pg_proc AS p
--       WHERE p.oid = _proc
--         AND p.prosrc = _esperado
--         AND position('[audio-do-reel]' in p.prosrc) = 0
--         AND p.prosecdef = _secdef
--         AND p.proowner = _owner
--         AND p.proconfig IS NOT DISTINCT FROM _config
--         AND p.proacl IS NOT DISTINCT FROM _acl;
--     IF NOT FOUND THEN
--       RAISE EXCEPTION 'conferência do rollback falhou: nada foi mudado';
--     END IF;
--     IF md5(_esperado) = 'da209ef79460425ab7e36b71d34b349a' THEN
--       RAISE NOTICE 'editorial_autopublish_tick restaurada byte a byte (md5 da209ef79460425ab7e36b71d34b349a)';
--     ELSE
--       RAISE NOTICE 'áudio tirado do publicador; a função tinha outras mudanças depois do patch e elas foram mantidas (md5 %)', md5(_esperado);
--     END IF;
--   END IF;
-- END
-- $rollback$;
--
-- DROP FUNCTION IF EXISTS public.editorial_audio_e_musica_ler(uuid[]);
-- DROP FUNCTION IF EXISTS public.editorial_post_musica_remover(uuid);
-- DROP FUNCTION IF EXISTS public.editorial_post_musica_definir(uuid, text, text, text, text);
-- DROP FUNCTION IF EXISTS public.editorial_reel_audio_remover(uuid);
-- DROP FUNCTION IF EXISTS public.editorial_reel_audio_definir(uuid, text, integer, integer, text, text);
--
-- -- Apaga só as escolhas de áudio dos Reels e as músicas sugeridas (nenhum dado de cliente existente).
-- DROP TABLE IF EXISTS public.editorial_publication_audio;
-- DROP TABLE IF EXISTS public.editorial_post_music_suggestions;
--
-- -- Opcional: a trilha do backup pode ficar (recomendado). Para tirar também:
-- -- DROP TABLE IF EXISTS social_private.autopublish_function_backups;
--
-- COMMIT;
