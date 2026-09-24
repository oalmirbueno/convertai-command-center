-- ═══════════════════════════════════════════════════════════════════════
-- MESA FOTO: áreas "Modelos" (personas sintéticas) e "Canvas"
-- (docs/mesa-foto/MODELOS-E-CANVAS.md, seções 6 e 8).
--
-- 1) ia_modelos ganha capacidades (referências máximas, resoluções,
--    proporções, qualidade, semente, fundo, API do OpenRouter e preços do
--    endpoint); a RPC de sincronização passa a gravar a coluna. Entram,
--    ativos, os dois geradores novos da rodada padrão (Seedream 5.0 Pro e
--    MAI-Image-2.6) e o Seedream 4.5 (detalhe 4K de produto); GPT Image e
--    Gemini ganham as capacidades conferidas e o preço por resolução.
-- 2) cliente_imagens.modo aceita também 'canvas' e 'detalhe'.
-- 3) foto_modelos (personas) e foto_modelo_imagens (candidatas, folha e
--    detalhes 4K). A rodada lado a lado é agrupada por rodada_id na própria
--    imagem (desenho mais simples que uma tabela de rodadas).
-- 4) foto_canvas (nós e ligações em jsonb, versao para trava otimista) e
--    foto_canvas_geracoes (o pedido montado, o custo e a imagem no acervo).
--
-- Escrita só pela função mesa-foto (chave de serviço); leitura pela equipe
-- (persona da agência, client_id nulo, é lida por toda a equipe). Idempotente.
-- A função já funciona sem esta migration para tudo que existia; Modelos e
-- Canvas respondem "a migration 03 foi aplicada?" até ela entrar.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1) Catálogo de modelos: capacidades ───────────────────────────────

ALTER TABLE public.ia_modelos ADD COLUMN IF NOT EXISTS capacidades jsonb;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ia_modelos_capacidades_objeto') THEN
    ALTER TABLE public.ia_modelos
      ADD CONSTRAINT ia_modelos_capacidades_objeto CHECK (capacidades IS NULL OR jsonb_typeof(capacidades) = 'object');
  END IF;
END $$;
COMMENT ON COLUMN public.ia_modelos.capacidades IS
  'Modelos de imagem: { api: imagens|chat, refs_max, resolucoes[], proporcoes[], qualidades[], fundo_transparente, seed, formatos_saida[], precos[{cobra, unidade, variante, usd}], fonte }. Sincronizado de https://openrouter.ai/api/v1/images/models e .../endpoints.';

-- A sincronização grava capacidades (sem apagar a que existe quando a lista não traz).
CREATE OR REPLACE FUNCTION public.ia_modelos_sincronizar(_provedor text, _modelos jsonb, _completo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _novos integer := 0;
  _atualizados integer := 0;
  _indisponiveis integer := 0;
  _disponiveis integer := 0;
  _ids text[];
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'IA_SINCRONIA_SO_BACKEND';
  END IF;
  IF _provedor IS NULL OR _provedor NOT IN ('openai', 'anthropic', 'openrouter') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'IA_SINCRONIA_PROVEDOR_INVALIDO';
  END IF;
  IF _modelos IS NULL OR jsonb_typeof(_modelos) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'IA_SINCRONIA_LISTA_INVALIDA';
  END IF;

  IF _provedor = 'openrouter' THEN
    WITH entrada AS (
      SELECT *
      FROM jsonb_to_recordset(_modelos) AS x(
        id text, modelo_api text, tipo text, rotulo text,
        preco_entrada_1m numeric, preco_saida_1m numeric, preco_cache_1m numeric,
        preco_imagem jsonb, raciocinio text[], contexto_tokens integer,
        modalidades jsonb, fonte_preco text, capacidades jsonb
      )
      WHERE x.id LIKE 'openrouter:%'
        AND x.modelo_api IS NOT NULL
        AND x.tipo IN ('texto', 'imagem')
    ),
    gravados AS (
      INSERT INTO public.ia_modelos AS m (
        id, provedor, modelo_api, tipo, rotulo,
        preco_entrada_1m, preco_saida_1m, preco_cache_1m, preco_imagem,
        raciocinio, padrao_para, ativo, novo, disponivel,
        contexto_tokens, modalidades, fonte_preco, conferido_em, sincronizado_em, capacidades
      )
      SELECT
        e.id, 'openrouter', e.modelo_api, e.tipo, COALESCE(NULLIF(btrim(e.rotulo), ''), e.modelo_api),
        e.preco_entrada_1m, e.preco_saida_1m, e.preco_cache_1m, e.preco_imagem,
        COALESCE(e.raciocinio, '{}'::text[]), '{}'::text[], false, true, true,
        e.contexto_tokens, e.modalidades, e.fonte_preco, now(), now(),
        CASE WHEN jsonb_typeof(e.capacidades) = 'object' THEN e.capacidades ELSE NULL END
      FROM entrada e
      ON CONFLICT (id) DO UPDATE SET
        modelo_api = EXCLUDED.modelo_api,
        tipo = EXCLUDED.tipo,
        rotulo = EXCLUDED.rotulo,
        preco_entrada_1m = EXCLUDED.preco_entrada_1m,
        preco_saida_1m = EXCLUDED.preco_saida_1m,
        preco_cache_1m = EXCLUDED.preco_cache_1m,
        preco_imagem = EXCLUDED.preco_imagem,
        raciocinio = EXCLUDED.raciocinio,
        contexto_tokens = EXCLUDED.contexto_tokens,
        modalidades = EXCLUDED.modalidades,
        fonte_preco = EXCLUDED.fonte_preco,
        capacidades = COALESCE(EXCLUDED.capacidades, m.capacidades),
        conferido_em = now(),
        sincronizado_em = now(),
        disponivel = true
        -- ativo, novo e padrao_para ficam como o dono deixou.
      WHERE m.provedor = 'openrouter'
      RETURNING (xmax = 0) AS inserido
    )
    SELECT count(*) FILTER (WHERE inserido), count(*) FILTER (WHERE NOT inserido)
    INTO _novos, _atualizados
    FROM gravados;

    SELECT array_agg(x.id) INTO _ids
    FROM jsonb_to_recordset(_modelos) AS x(id text)
    WHERE x.id LIKE 'openrouter:%';
  ELSE
    SELECT array_agg(v) INTO _ids FROM jsonb_array_elements_text(_modelos) AS t(v);

    UPDATE public.ia_modelos
    SET disponivel = true, sincronizado_em = now()
    WHERE provedor = _provedor AND modelo_api = ANY(COALESCE(_ids, '{}'::text[]));
    GET DIAGNOSTICS _disponiveis = ROW_COUNT;
  END IF;

  IF _completo AND COALESCE(cardinality(_ids), 0) > 0 THEN
    UPDATE public.ia_modelos
    SET disponivel = false, sincronizado_em = now()
    WHERE provedor = _provedor
      AND disponivel
      AND CASE WHEN _provedor = 'openrouter' THEN id <> ALL(_ids) ELSE modelo_api <> ALL(_ids) END
      -- GPT Image pelo OpenRouter tem linha mantida à mão (preço por qualidade): não some.
      AND NOT (_provedor = 'openrouter' AND modelo_api LIKE 'openai/gpt-image%');
    GET DIAGNOSTICS _indisponiveis = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'provedor', _provedor,
    'recebidos', jsonb_array_length(_modelos),
    'novos', _novos,
    'atualizados', _atualizados,
    'disponiveis', _disponiveis,
    'indisponiveis', _indisponiveis
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ia_modelos_sincronizar(text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ia_modelos_sincronizar(text, jsonb, boolean) TO service_role;

-- Capacidades conferidas em 2026-09-24 (lista pública de imagens do OpenRouter).
UPDATE public.ia_modelos SET capacidades = '{"api": "imagens", "refs_max": 16, "resolucoes": [], "proporcoes": ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"], "qualidades": ["low", "medium", "high"], "fundo_transparente": true, "seed": false, "fonte": "https://openrouter.ai/api/v1/images/models/openai/gpt-image-2.5-sunburst/endpoints"}'::jsonb
WHERE provedor = 'openrouter' AND modelo_api LIKE 'openai/gpt-image-2.5%';

UPDATE public.ia_modelos SET
  capacidades = '{"api": "chat", "refs_max": 14, "resolucoes": ["1K", "2K", "4K"], "proporcoes": ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"], "fundo_transparente": false, "seed": false, "fonte": "https://openrouter.ai/api/v1/images/models/google/gemini-3-pro-image/endpoints"}'::jsonb,
  -- Oficial: US$ 0,134 em 1K e 2K, US$ 0,24 em 4K (1.120 e 2.000 tokens a US$ 120 por 1M).
  preco_imagem = COALESCE(preco_imagem, '{}'::jsonb) || '{"res_1K": 0.1344, "res_2K": 0.1344, "res_4K": 0.24}'::jsonb
WHERE id = 'openrouter:google/gemini-3-pro-image';

UPDATE public.ia_modelos SET
  capacidades = '{"api": "chat", "refs_max": 14, "resolucoes": ["512", "1K", "2K", "4K"], "proporcoes": ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"], "fundo_transparente": false, "seed": false, "fonte": "https://openrouter.ai/api/v1/images/models/google/gemini-3.1-flash-image/endpoints"}'::jsonb,
  -- Oficial: US$ 0,045 (512), 0,067 (1K), 0,101 (2K), 0,151 (4K).
  preco_imagem = COALESCE(preco_imagem, '{}'::jsonb) || '{"res_512": 0.045, "res_1K": 0.0672, "res_2K": 0.1008, "res_4K": 0.1512}'::jsonb
WHERE id = 'openrouter:google/gemini-3.1-flash-image';

-- Geradores novos da rodada padrão e do detalhe 4K de produto (ativos; a
-- sincronização diária atualiza preço e capacidades sem mexer em ativo).
INSERT INTO public.ia_modelos (
  id, provedor, modelo_api, tipo, rotulo,
  preco_entrada_1m, preco_saida_1m, preco_cache_1m, preco_imagem,
  raciocinio, padrao_para, ativo, novo, disponivel, modalidades, fonte_preco, conferido_em, sincronizado_em, capacidades
)
VALUES
  (
    'openrouter:bytedance-seed/seedream-5-0-pro', 'openrouter', 'bytedance-seed/seedream-5-0-pro', 'imagem', 'ByteDance: Seedream 5.0 Pro',
    0, 0, NULL,
    '{"res_1K": 0.045, "res_2K": 0.09, "baixa": 0.045, "media": 0.045, "alta": 0.045, "entrada_por_imagem": 0.003}'::jsonb,
    '{}'::text[], '{}'::text[], true, false, true,
    '{"entrada": ["text", "image"], "saida": ["image"]}'::jsonb,
    'https://openrouter.ai/api/v1/images/models/bytedance-seed/seedream-5-0-pro/endpoints (conferido 2026-09-24: US$ 0,045 por imagem; 0,09 em alta resolução; + 0,003 por imagem de entrada)',
    now(), now(),
    '{"api": "imagens", "refs_max": 14, "resolucoes": ["1K", "2K"], "proporcoes": ["1:1", "1:2", "2:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"], "qualidades": [], "fundo_transparente": false, "seed": true, "formatos_saida": []}'::jsonb
  ),
  (
    'openrouter:microsoft/mai-image-2.6', 'openrouter', 'microsoft/mai-image-2.6', 'imagem', 'Microsoft: MAI-Image-2.6',
    5, 38, NULL,
    '{"saida_imagem_1m": 38, "entrada_imagem_1m": 8, "baixa": 0.0418, "media": 0.0418, "alta": 0.0418}'::jsonb,
    '{}'::text[], '{}'::text[], true, false, true,
    '{"entrada": ["text", "image"], "saida": ["image"]}'::jsonb,
    'https://openrouter.ai/api/v1/images/models/microsoft/mai-image-2.6/endpoints (conferido 2026-09-24: US$ 38 por 1M tokens de saída de imagem, cerca de US$ 0,04 por imagem)',
    now(), now(),
    '{"api": "imagens", "refs_max": 5, "resolucoes": [], "proporcoes": ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"], "qualidades": [], "fundo_transparente": false, "seed": false, "formatos_saida": []}'::jsonb
  ),
  (
    'openrouter:bytedance-seed/seedream-4.5', 'openrouter', 'bytedance-seed/seedream-4.5', 'imagem', 'ByteDance: Seedream 4.5',
    0, 0, NULL,
    '{"res_1K": 0.04, "res_2K": 0.04, "res_4K": 0.04, "baixa": 0.04, "media": 0.04, "alta": 0.04, "entrada_por_imagem": 0}'::jsonb,
    '{}'::text[], '{}'::text[], true, false, true,
    '{"entrada": ["text", "image"], "saida": ["image"]}'::jsonb,
    'https://openrouter.ai/api/v1/images/models/bytedance-seed/seedream-4.5/endpoints (conferido 2026-09-24: US$ 0,04 por imagem, também em 4K)',
    now(), now(),
    '{"api": "imagens", "refs_max": 14, "resolucoes": ["1K", "2K", "4K"], "proporcoes": ["1:1", "1:2", "2:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"], "qualidades": [], "fundo_transparente": false, "seed": true, "formatos_saida": []}'::jsonb
  )
ON CONFLICT (id) DO UPDATE SET
  ativo = true,
  disponivel = true,
  preco_imagem = EXCLUDED.preco_imagem,
  modalidades = EXCLUDED.modalidades,
  capacidades = EXCLUDED.capacidades,
  fonte_preco = EXCLUDED.fonte_preco,
  conferido_em = now();

-- ─── 2) Acervo: modos novos ─────────────────────────────────────────────

ALTER TABLE public.cliente_imagens DROP CONSTRAINT IF EXISTS cliente_imagens_modo_check;
ALTER TABLE public.cliente_imagens
  ADD CONSTRAINT cliente_imagens_modo_check
  CHECK (modo IS NULL OR modo IN ('preservar', 'luz_cor', 'cenario', 'angulo', 'ensaio', 'canvas', 'detalhe'));

-- ─── 3) Personas sintéticas ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.foto_modelos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- null = persona da biblioteca da agência (qualquer cliente usa); uuid = persona do cliente.
  client_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Cliente onde a persona nasceu (paga as gerações da persona da agência quando a chamada não diz outro).
  client_origem_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  descricao text,
  -- { idade_aparente (>= 21), genero_apresentado, tom_de_pele, rosto, olhos, sobrancelhas, nariz, labios,
  --   cabelo { cor, comprimento, textura }, marcas[], corpo, altura, estilo, notas }
  ficha jsonb NOT NULL CHECK (
    jsonb_typeof(ficha) = 'object'
    AND jsonb_typeof(ficha -> 'idade_aparente') = 'number'
    AND (ficha ->> 'idade_aparente')::numeric >= 21
  ),
  invariantes text[] NOT NULL DEFAULT '{}',
  -- Referências do dono, só como estilo, pose, luz ou roupa (nunca identidade):
  -- [{ imagem_id (cliente_imagens), client_id, uso }]
  referencias jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(referencias) = 'array'),
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'candidatos', 'ancora', 'folha', 'pronta', 'arquivada')),
  ancora_imagem_id uuid,
  -- Gerador da âncora: a folha e as próximas fotos ficam presas a ele.
  motor_preferido_id text,
  versao integer NOT NULL DEFAULT 1 CHECK (versao > 0),
  -- Declaração ética obrigatória: sintética, adulta e sem semelhança com pessoa real, com quem marcou e quando.
  etica jsonb NOT NULL CHECK (
    jsonb_typeof(etica) = 'object'
    AND (etica ->> 'sintetica') = 'true'
    AND (etica ->> 'adulta') = 'true'
    AND (etica ->> 'sem_semelhanca') = 'true'
  ),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS foto_modelos_cliente_idx ON public.foto_modelos (client_id, atualizado_em DESC);
CREATE INDEX IF NOT EXISTS foto_modelos_agencia_idx ON public.foto_modelos (atualizado_em DESC) WHERE client_id IS NULL;

CREATE TABLE IF NOT EXISTS public.foto_modelo_imagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_id uuid NOT NULL REFERENCES public.foto_modelos(id) ON DELETE CASCADE,
  -- Agrupa as candidatas da mesma rodada lado a lado (uuid da tela; sem tabela própria).
  rodada_id uuid,
  papel text NOT NULL CHECK (papel IN ('candidata', 'vista', 'detalhe')),
  vista text CHECK (vista IS NULL OR vista IN ('frente', 'tres_quartos_esq', 'tres_quartos_dir', 'perfil_esq', 'perfil_dir', 'meio_corpo', 'corpo_inteiro', 'maos')),
  storage_bucket text NOT NULL DEFAULT 'mesa',
  storage_path text NOT NULL,
  mime text,
  largura integer CHECK (largura IS NULL OR largura > 0),
  altura integer CHECK (altura IS NULL OR altura > 0),
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  motor_id text,
  qualidade text,
  resolucao text CHECK (resolucao IS NULL OR resolucao IN ('512', '1K', '2K', '4K')),
  seed bigint,
  prompt text,
  -- Imagens que foram ao gerador, em ordem: [{ tipo, id }].
  fontes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(fontes) = 'array'),
  -- Detalhe 4K aponta para a imagem de origem (antes e depois).
  derivada_de uuid REFERENCES public.foto_modelo_imagens(id) ON DELETE SET NULL,
  alvo text CHECK (alvo IS NULL OR alvo IN ('pessoa', 'produto')),
  -- Leitura por visão + notas do Jev (só aviso).
  conferencia jsonb CHECK (conferencia IS NULL OR jsonb_typeof(conferencia) = 'object'),
  aprovada boolean,
  motivo text,
  versao_modelo integer NOT NULL DEFAULT 1,
  -- Toda imagem de persona é gerada (regra do dono).
  gerada boolean NOT NULL DEFAULT true CHECK (gerada),
  custo_usd numeric NOT NULL DEFAULT 0 CHECK (custo_usd >= 0),
  uso_id text,
  reserva_usada text,
  avisos text[] NOT NULL DEFAULT '{}',
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS foto_modelo_imagens_modelo_idx ON public.foto_modelo_imagens (modelo_id, criado_em);
CREATE INDEX IF NOT EXISTS foto_modelo_imagens_rodada_idx ON public.foto_modelo_imagens (rodada_id) WHERE rodada_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'foto_modelos_ancora_fk') THEN
    ALTER TABLE public.foto_modelos
      ADD CONSTRAINT foto_modelos_ancora_fk FOREIGN KEY (ancora_imagem_id) REFERENCES public.foto_modelo_imagens(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─── 4) Canvas ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.foto_canvas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  -- [{ id, tipo: produto|modelo|ambiente|estilo|prompt|saida, x, y, dados }]
  nos jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(nos) = 'array' AND jsonb_array_length(nos) <= 60),
  -- [{ id, de, para (sempre um nó saida), ordem }]
  ligacoes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(ligacoes) = 'array' AND jsonb_array_length(ligacoes) <= 120),
  viewport jsonb NOT NULL DEFAULT '{"x": 0, "y": 0, "zoom": 1}'::jsonb CHECK (jsonb_typeof(viewport) = 'object'),
  -- Trava otimista: salvar manda versao_esperada; diferente = 409 canvas_mudou.
  versao integer NOT NULL DEFAULT 1 CHECK (versao > 0),
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'arquivado')),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT foto_canvas_id_cliente_unico UNIQUE (id, client_id)
);
CREATE INDEX IF NOT EXISTS foto_canvas_cliente_idx ON public.foto_canvas (client_id, atualizado_em DESC);

CREATE TABLE IF NOT EXISTS public.foto_canvas_geracoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id uuid NOT NULL,
  client_id uuid NOT NULL,
  no_saida_id text NOT NULL,
  motor_id text NOT NULL,
  qualidade text,
  resolucao text CHECK (resolucao IS NULL OR resolucao IN ('512', '1K', '2K', '4K')),
  formato text,
  -- O pedido montado: { referencias: [{ ordem, papel, origem { tipo, id, no_id }, imagem_id, titulo, legenda }], prompt, avisos[] }
  montado jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(montado) = 'object'),
  status text NOT NULL DEFAULT 'gerando' CHECK (status IN ('gerando', 'gerada', 'falhou')),
  ultimo_erro text,
  imagem_id uuid,
  conferencia jsonb CHECK (conferencia IS NULL OR jsonb_typeof(conferencia) = 'object'),
  custo_usd numeric NOT NULL DEFAULT 0 CHECK (custo_usd >= 0),
  uso_id text,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT foto_canvas_geracoes_canvas_fk FOREIGN KEY (canvas_id, client_id) REFERENCES public.foto_canvas (id, client_id) ON DELETE CASCADE,
  -- A imagem do resultado é do MESMO cliente do canvas.
  CONSTRAINT foto_canvas_geracoes_imagem_fk FOREIGN KEY (imagem_id, client_id) REFERENCES public.cliente_imagens (id, client_id) ON DELETE NO ACTION
);
CREATE INDEX IF NOT EXISTS foto_canvas_geracoes_canvas_idx ON public.foto_canvas_geracoes (canvas_id, criado_em DESC);

-- ─── 5) atualizado_em automático ───────────────────────────────────────

DROP TRIGGER IF EXISTS foto_modelos_tocar ON public.foto_modelos;
CREATE TRIGGER foto_modelos_tocar BEFORE UPDATE ON public.foto_modelos FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();
DROP TRIGGER IF EXISTS foto_canvas_tocar ON public.foto_canvas;
CREATE TRIGGER foto_canvas_tocar BEFORE UPDATE ON public.foto_canvas FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();
DROP TRIGGER IF EXISTS foto_canvas_geracoes_tocar ON public.foto_canvas_geracoes;
CREATE TRIGGER foto_canvas_geracoes_tocar BEFORE UPDATE ON public.foto_canvas_geracoes FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();

-- ─── 6) RLS: equipe lê; escrita só pela função ─────────────────────────

ALTER TABLE public.foto_modelos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.foto_modelo_imagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.foto_canvas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.foto_canvas_geracoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.foto_modelos, public.foto_modelo_imagens, public.foto_canvas, public.foto_canvas_geracoes FROM PUBLIC, anon, authenticated, service_role;

DROP POLICY IF EXISTS foto_modelos_equipe_le ON public.foto_modelos;
CREATE POLICY foto_modelos_equipe_le ON public.foto_modelos FOR SELECT TO authenticated
USING (public.is_staff((select auth.uid())) AND (client_id IS NULL OR public.can_access_client(client_id)));

DROP POLICY IF EXISTS foto_modelo_imagens_equipe_le ON public.foto_modelo_imagens;
CREATE POLICY foto_modelo_imagens_equipe_le ON public.foto_modelo_imagens FOR SELECT TO authenticated
USING (
  public.is_staff((select auth.uid()))
  AND EXISTS (
    SELECT 1 FROM public.foto_modelos m
    WHERE m.id = foto_modelo_imagens.modelo_id
      AND (m.client_id IS NULL OR public.can_access_client(m.client_id))
  )
);

DROP POLICY IF EXISTS foto_canvas_equipe_le ON public.foto_canvas;
CREATE POLICY foto_canvas_equipe_le ON public.foto_canvas FOR SELECT TO authenticated
USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS foto_canvas_geracoes_equipe_le ON public.foto_canvas_geracoes;
CREATE POLICY foto_canvas_geracoes_equipe_le ON public.foto_canvas_geracoes FOR SELECT TO authenticated
USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

GRANT SELECT ON public.foto_modelos, public.foto_modelo_imagens, public.foto_canvas, public.foto_canvas_geracoes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.foto_modelos, public.foto_modelo_imagens, public.foto_canvas, public.foto_canvas_geracoes TO service_role;

-- Conferência (rodar depois de aplicar):
-- select id, ativo, capacidades->>'api' as api, capacidades->>'refs_max' as refs, preco_imagem from public.ia_modelos where tipo = 'imagem' order by id;
-- select conname from pg_constraint where conname in ('cliente_imagens_modo_check', 'foto_modelos_ancora_fk', 'foto_canvas_geracoes_imagem_fk');
-- select tablename, policyname, cmd from pg_policies where tablename in ('foto_modelos', 'foto_modelo_imagens', 'foto_canvas', 'foto_canvas_geracoes');
