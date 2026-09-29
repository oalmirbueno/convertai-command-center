-- Frente MCK (29/09/2026): estúdio de mockups da Mesa Identidade Visual.
--
-- O catálogo nasce na máquina da agência (tools/mockups/: PSD -> base, ganho, vazio, uv e mapa)
-- e sobe para o bucket privado `mockups` pelo script tools/mockups/subir_catalogo.mjs, com a
-- chave de serviço. O painel só lê o catálogo e compõe no navegador. O que a equipe escolhe para
-- um cliente fica em mockup_aplicacoes, gravado só pelas RPCs abaixo (conferem equipe, acesso ao
-- cliente, marca do mesmo cliente e arquivo do mesmo cliente).
--
-- Só amplia, idempotente. Nada é apagado: arquivar é marcar arquivado_em.

-- ─── 1) Bucket privado `mockups`: a equipe lê; só a chave de serviço escreve ─────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('mockups', 'mockups', false, 26214400, ARRAY['image/png', 'image/jpeg', 'application/json'])
ON CONFLICT (id) DO UPDATE
SET public = false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'mockups: equipe le'
  ) THEN
    CREATE POLICY "mockups: equipe le"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (storage.objects.bucket_id = 'mockups' AND COALESCE(public.is_staff((select auth.uid())), false));
  END IF;
END $$;

-- ─── 2) Catálogo de mockups (um por PSD pré-processado) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mockup_catalogo (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  nome text NOT NULL CHECK (btrim(nome) <> '' AND char_length(nome) <= 120),
  categoria text NOT NULL CHECK (categoria IN (
    'papelaria', 'cartao', 'sacola', 'caneca', 'vestuario', 'embalagem', 'outdoor', 'dispositivo',
    'poster', 'veiculo', 'logo-efeito', 'folder', 'livro'
  )),
  tags text[] NOT NULL DEFAULT '{}',
  slots jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(slots) = 'array'),
  largura integer NOT NULL CHECK (largura > 0 AND largura <= 6000),
  altura integer NOT NULL CHECK (altura > 0 AND altura <= 6000),
  largura_trabalho integer NOT NULL CHECK (largura_trabalho > 0 AND largura_trabalho <= 2048),
  altura_trabalho integer NOT NULL CHECK (altura_trabalho > 0 AND altura_trabalho <= 2048),
  caminhos jsonb NOT NULL CHECK (jsonb_typeof(caminhos) = 'object'),
  qualidade jsonb NOT NULL DEFAULT '{}'::jsonb,
  luminancia_media numeric CHECK (luminancia_media IS NULL OR (luminancia_media >= 0 AND luminancia_media <= 1)),
  origem text,
  versao_pipeline integer NOT NULL DEFAULT 1,
  bytes bigint NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mockup_catalogo_categoria_idx ON public.mockup_catalogo (categoria) WHERE ativo;

ALTER TABLE public.mockup_catalogo ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'mockup_catalogo' AND policyname = 'mockup_catalogo: equipe le') THEN
    CREATE POLICY "mockup_catalogo: equipe le" ON public.mockup_catalogo
      FOR SELECT TO authenticated USING (COALESCE(public.is_staff((select auth.uid())), false));
  END IF;
END $$;

REVOKE INSERT, UPDATE, DELETE ON public.mockup_catalogo FROM anon, authenticated;
GRANT SELECT ON public.mockup_catalogo TO authenticated;
GRANT ALL ON public.mockup_catalogo TO service_role;

COMMENT ON TABLE public.mockup_catalogo IS 'Mockups pré-processados (tools/mockups). Arquivos no bucket mockups: catalogo/<id>/{alta,trabalho}/{base.jpg,vazio.jpg,ganho.png,uv.png,mapa.png} e thumb.jpg. Só a chave de serviço escreve.';
COMMENT ON COLUMN public.mockup_catalogo.slots IS 'Lista de slots: indice (1..n, valor no mapa.png), papel (arte|logo|cor|verso), so_px, area_segura [x0,y0,x1,y1] em 0..1, luminancia_superficie 0..1.';

-- ─── 3) Texturas e carimbos (pontas dos brushes, já como PNG) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.textura_catalogo (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{1,119}$'),
  nome text NOT NULL CHECK (btrim(nome) <> '' AND char_length(nome) <= 120),
  categoria text NOT NULL CHECK (categoria IN ('grunge', 'papel', 'concreto', 'fumaca', 'carimbo', 'outro')),
  largura integer NOT NULL CHECK (largura > 0 AND largura <= 4096),
  altura integer NOT NULL CHECK (altura > 0 AND altura <= 4096),
  caminho text NOT NULL,
  caminho_mini text NOT NULL,
  cobertura numeric,
  origem text,
  bytes bigint NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.textura_catalogo ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'textura_catalogo' AND policyname = 'textura_catalogo: equipe le') THEN
    CREATE POLICY "textura_catalogo: equipe le" ON public.textura_catalogo
      FOR SELECT TO authenticated USING (COALESCE(public.is_staff((select auth.uid())), false));
  END IF;
END $$;

REVOKE INSERT, UPDATE, DELETE ON public.textura_catalogo FROM anon, authenticated;
GRANT SELECT ON public.textura_catalogo TO authenticated;
GRANT ALL ON public.textura_catalogo TO service_role;

-- ─── 4) O que a equipe escolheu para o cliente ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mockup_aplicacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  marca_id uuid REFERENCES public.cliente_marcas(id) ON DELETE SET NULL,
  origem text NOT NULL DEFAULT 'catalogo' CHECK (origem IN ('catalogo', 'cena')),
  mockup_id text REFERENCES public.mockup_catalogo(id) ON DELETE SET NULL,
  cena_caminho text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  status text NOT NULL DEFAULT 'escolhido' CHECK (status IN ('escolhido', 'enviado')),
  file_id uuid REFERENCES public.files(id) ON DELETE SET NULL,
  no_brandbook boolean NOT NULL DEFAULT false,
  entrega jsonb,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  arquivado_em timestamptz,
  CHECK ((origem = 'catalogo' AND mockup_id IS NOT NULL) OR (origem = 'cena' AND cena_caminho IS NOT NULL) OR arquivado_em IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS mockup_aplicacoes_cliente_idx ON public.mockup_aplicacoes (client_id, criado_em DESC) WHERE arquivado_em IS NULL;

ALTER TABLE public.mockup_aplicacoes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'mockup_aplicacoes' AND policyname = 'mockup_aplicacoes: equipe le') THEN
    CREATE POLICY "mockup_aplicacoes: equipe le" ON public.mockup_aplicacoes
      FOR SELECT TO authenticated
      USING (COALESCE(public.is_staff((select auth.uid())), false) AND public.can_access_client(client_id));
  END IF;
END $$;

REVOKE INSERT, UPDATE, DELETE ON public.mockup_aplicacoes FROM anon, authenticated;
GRANT SELECT ON public.mockup_aplicacoes TO authenticated;
GRANT ALL ON public.mockup_aplicacoes TO service_role;

COMMENT ON TABLE public.mockup_aplicacoes IS 'Mockups escolhidos para o cliente (estúdio da Mesa Identidade). Escrita só pelas RPCs mockup_aplicacao_salvar/arquivar. no_brandbook = entra no brandbook; entrega = gancho do documento de entrega (resumo e provas).';

-- ─── 5) RPCs de escrita (security definer com checagem) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.mockup_aplicacao_salvar(
  _client_id uuid,
  _marca_id uuid,
  _origem text,
  _mockup_id text,
  _cena_caminho text,
  _config jsonb,
  _file_id uuid DEFAULT NULL,
  _no_brandbook boolean DEFAULT false,
  _id uuid DEFAULT NULL
)
RETURNS public.mockup_aplicacoes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _uid uuid := auth.uid();
  _linha public.mockup_aplicacoes;
  _status text;
  _entrega jsonb;
BEGIN
  IF _uid IS NULL OR NOT COALESCE(public.is_staff(_uid), false) THEN
    RAISE EXCEPTION 'somente_equipe' USING ERRCODE = '42501';
  END IF;
  IF _client_id IS NULL OR NOT COALESCE(public.can_access_client(_client_id), false) THEN
    RAISE EXCEPTION 'sem_acesso_ao_cliente' USING ERRCODE = '42501';
  END IF;
  IF _marca_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.cliente_marcas m WHERE m.id = _marca_id AND m.client_id = _client_id) THEN
    RAISE EXCEPTION 'marca_de_outro_cliente' USING ERRCODE = '22023';
  END IF;
  -- Origem, mockup e cena só na criação; a atualização (envio) muda config, arquivo e brandbook.
  IF _id IS NULL THEN
    IF _origem IS NULL OR _origem NOT IN ('catalogo', 'cena') THEN
      RAISE EXCEPTION 'origem_invalida' USING ERRCODE = '22023';
    END IF;
    IF _origem = 'catalogo' AND NOT EXISTS (SELECT 1 FROM public.mockup_catalogo c WHERE c.id = _mockup_id AND c.ativo) THEN
      RAISE EXCEPTION 'mockup_inexistente' USING ERRCODE = '22023';
    END IF;
    IF _origem = 'cena' AND (_cena_caminho IS NULL OR split_part(_cena_caminho, '/', 1) <> _client_id::text) THEN
      RAISE EXCEPTION 'cena_de_outro_cliente' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF _file_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.files f WHERE f.id = _file_id AND f.client_id = _client_id) THEN
    RAISE EXCEPTION 'arquivo_de_outro_cliente' USING ERRCODE = '22023';
  END IF;
  IF _config IS NULL OR jsonb_typeof(_config) <> 'object' OR pg_column_size(_config) > 65536 THEN
    RAISE EXCEPTION 'config_invalida' USING ERRCODE = '22023';
  END IF;

  _status := CASE WHEN _file_id IS NULL THEN 'escolhido' ELSE 'enviado' END;
  -- Gancho do documento de entrega (frente DOC): o resumo e as provas do que foi feito.
  _entrega := CASE WHEN _file_id IS NULL THEN NULL ELSE jsonb_build_object(
    'resumo', 'Mockup aplicado na identidade do cliente e enviado para Arquivos e aprovação.',
    'provas', jsonb_build_object('file_id', _file_id, 'mockup_id', _mockup_id, 'cena_caminho', _cena_caminho, 'no_brandbook', COALESCE(_no_brandbook, false)),
    'em', now()
  ) END;

  IF _id IS NOT NULL THEN
    UPDATE public.mockup_aplicacoes a
       SET marca_id = _marca_id,
           config = _config,
           file_id = COALESCE(_file_id, a.file_id),
           status = CASE WHEN COALESCE(_file_id, a.file_id) IS NULL THEN 'escolhido' ELSE 'enviado' END,
           no_brandbook = COALESCE(_no_brandbook, a.no_brandbook),
           entrega = CASE WHEN _file_id IS NULL THEN a.entrega ELSE jsonb_build_object(
             'resumo', 'Mockup aplicado na identidade do cliente e enviado para Arquivos e aprovação.',
             'provas', jsonb_build_object('file_id', _file_id, 'mockup_id', a.mockup_id, 'cena_caminho', a.cena_caminho, 'no_brandbook', COALESCE(_no_brandbook, a.no_brandbook)),
             'em', now()
           ) END,
           atualizado_em = now()
     WHERE a.id = _id AND a.client_id = _client_id AND a.arquivado_em IS NULL
     RETURNING * INTO _linha;
    IF _linha.id IS NULL THEN
      RAISE EXCEPTION 'aplicacao_inexistente' USING ERRCODE = '22023';
    END IF;
    RETURN _linha;
  END IF;

  INSERT INTO public.mockup_aplicacoes (client_id, marca_id, origem, mockup_id, cena_caminho, config, status, file_id, no_brandbook, entrega, criado_por)
  VALUES (_client_id, _marca_id, _origem, CASE WHEN _origem = 'catalogo' THEN _mockup_id END, CASE WHEN _origem = 'cena' THEN _cena_caminho END,
          _config, _status, _file_id, COALESCE(_no_brandbook, false), _entrega, _uid)
  RETURNING * INTO _linha;
  RETURN _linha;
END;
$body$;

CREATE OR REPLACE FUNCTION public.mockup_aplicacao_arquivar(_id uuid, _arquivar boolean DEFAULT true)
RETURNS public.mockup_aplicacoes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _uid uuid := auth.uid();
  _linha public.mockup_aplicacoes;
BEGIN
  IF _uid IS NULL OR NOT COALESCE(public.is_staff(_uid), false) THEN
    RAISE EXCEPTION 'somente_equipe' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _linha FROM public.mockup_aplicacoes WHERE id = _id;
  IF _linha.id IS NULL OR NOT COALESCE(public.can_access_client(_linha.client_id), false) THEN
    RAISE EXCEPTION 'aplicacao_inexistente' USING ERRCODE = '22023';
  END IF;
  UPDATE public.mockup_aplicacoes
     SET arquivado_em = CASE WHEN _arquivar THEN now() ELSE NULL END, atualizado_em = now()
   WHERE id = _id
   RETURNING * INTO _linha;
  RETURN _linha;
END;
$body$;

REVOKE ALL ON FUNCTION public.mockup_aplicacao_salvar(uuid, uuid, text, text, text, jsonb, uuid, boolean, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mockup_aplicacao_arquivar(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mockup_aplicacao_salvar(uuid, uuid, text, text, text, jsonb, uuid, boolean, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mockup_aplicacao_arquivar(uuid, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
