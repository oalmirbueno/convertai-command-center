-- Frente MOD (30/09/2026): modelos novos e recursos no catálogo.
--
-- Pedido do dono (30/09): atualizar o painel com os lançamentos da Anthropic e da OpenAI pelo OpenRouter,
-- com as capacidades de cada modelo e os modelos diretos novos. Pesquisa: docs/motores/MODELOS.md.
--
-- Só amplia e é idempotente. Nada é apagado nem desligado; NENHUM modelo é ligado aqui.
--
-- 1. ia_modelos.recursos (jsonb, só modelos de texto): ferramentas, json, esquema_estrito, visao, arquivos,
--    audio_entrada, video_entrada, raciocinio_obrigatorio, raciocinio_padrao, verbosidade, busca_web_usd,
--    cache_escrita_1m, cache_escrita_1h_1m, saida_max, lancado_em, expira_em, indice_inteligencia, fonte.
--    Vem de https://openrouter.ai/api/v1/models (supported_parameters, architecture, reasoning, pricing,
--    top_provider, created, expiration_date, benchmarks). Leitor: supabase/functions/_shared/recursos-dos-modelos.ts.
-- 2. ia_modelos_sincronizar grava recursos (COALESCE: linha sem recursos não apaga o que existe). O resto da
--    função é o de 20260924193310_mesa_foto_modelos_canvas.sql, sem mudança: ativo, novo e padrao_para
--    continuam como o dono deixou.
-- 3. Modelos diretos novos (Anthropic e OpenAI sem OpenRouter), DESLIGADOS: servem de equivalente na rota de
--    reserva do ia-motor ("openrouter:anthropic/claude-sonnet-5.5" cai em "anthropic:claude-sonnet-5-5") e o
--    dono liga em Modelos de IA quando quiser. Preços e ids conferidos em 29/09/2026:
--    https://platform.claude.com/docs/en/about-claude/models/overview, .../about-claude/pricing,
--    https://developers.openai.com/api/docs/models e https://developers.openai.com/api/docs/pricing.
--    Linhas diretas que já existiam só ganham recursos (preço, ativo e padrão ficam).

-- ---------------------------------------------------------------------------
-- 1. recursos
-- ---------------------------------------------------------------------------
ALTER TABLE public.ia_modelos ADD COLUMN IF NOT EXISTS recursos jsonb;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ia_modelos_recursos_objeto') THEN
    ALTER TABLE public.ia_modelos
      ADD CONSTRAINT ia_modelos_recursos_objeto CHECK (recursos IS NULL OR jsonb_typeof(recursos) = 'object');
  END IF;
END $$;
COMMENT ON COLUMN public.ia_modelos.recursos IS
  'Modelos de texto: { ferramentas, json, esquema_estrito, visao, arquivos, audio_entrada, video_entrada, raciocinio_obrigatorio, raciocinio_padrao, verbosidade, busca_web_usd, cache_escrita_1m, cache_escrita_1h_1m, saida_max, lancado_em, expira_em, indice_inteligencia, fonte }. Sincronizado de https://openrouter.ai/api/v1/models (recursos-dos-modelos.ts); diretos, à mão (fonte manual).';

-- ---------------------------------------------------------------------------
-- 2. Sincronização grava recursos
-- ---------------------------------------------------------------------------
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
        modalidades jsonb, fonte_preco text, capacidades jsonb, recursos jsonb
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
        contexto_tokens, modalidades, fonte_preco, conferido_em, sincronizado_em, capacidades, recursos
      )
      SELECT
        e.id, 'openrouter', e.modelo_api, e.tipo, COALESCE(NULLIF(btrim(e.rotulo), ''), e.modelo_api),
        e.preco_entrada_1m, e.preco_saida_1m, e.preco_cache_1m, e.preco_imagem,
        COALESCE(e.raciocinio, '{}'::text[]), '{}'::text[], false, true, true,
        e.contexto_tokens, e.modalidades, e.fonte_preco, now(), now(),
        CASE WHEN jsonb_typeof(e.capacidades) = 'object' THEN e.capacidades ELSE NULL END,
        CASE WHEN jsonb_typeof(e.recursos) = 'object' THEN e.recursos ELSE NULL END
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
        recursos = COALESCE(EXCLUDED.recursos, m.recursos),
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

-- ---------------------------------------------------------------------------
-- 3. Modelos diretos novos (desligados) e recursos dos diretos que já existiam
-- ---------------------------------------------------------------------------
INSERT INTO public.ia_modelos (
  id, provedor, modelo_api, tipo, rotulo,
  preco_entrada_1m, preco_saida_1m, preco_cache_1m, preco_imagem,
  raciocinio, padrao_para,
  ativo, novo, disponivel, contexto_tokens, modalidades,
  fonte_preco, conferido_em,
  recursos
)
VALUES
  (
    'anthropic:claude-sonnet-5-5', 'anthropic', 'claude-sonnet-5-5', 'texto', 'Claude Sonnet 5.5 (Anthropic direta)',
    2.00, 10.00, 0.20, NULL,
    ARRAY['low', 'medium', 'high', 'xhigh', 'max'], ARRAY[]::text[],
    false, true, true, 1000000, '{"entrada": ["text", "image", "file"], "saida": ["text"]}'::jsonb,
    'https://platform.claude.com/docs/en/about-claude/pricing e https://platform.claude.com/docs/en/about-claude/models/overview (conferido 2026-09-29)', now(),
    '{"ferramentas": true, "json": true, "esquema_estrito": true, "visao": true, "arquivos": true, "audio_entrada": false, "video_entrada": false, "raciocinio_obrigatorio": true, "raciocinio_padrao": "high", "verbosidade": false, "busca_web_usd": 0.01, "cache_escrita_1m": 2.5, "cache_escrita_1h_1m": 4, "saida_max": 128000, "lancado_em": "2026-09-28", "expira_em": null, "indice_inteligencia": null, "fonte": "manual"}'::jsonb
  ),
  (
    'anthropic:claude-fable-5-1', 'anthropic', 'claude-fable-5-1', 'texto', 'Claude Fable 5.1 (Anthropic direta)',
    10.00, 50.00, 0.25, NULL,
    ARRAY['low', 'medium', 'high', 'xhigh', 'max'], ARRAY[]::text[],
    false, true, true, 1000000, '{"entrada": ["text", "image", "file"], "saida": ["text"]}'::jsonb,
    'https://platform.claude.com/docs/en/about-claude/pricing e https://platform.claude.com/docs/en/about-claude/models/overview (conferido 2026-09-29)', now(),
    '{"ferramentas": true, "json": true, "esquema_estrito": true, "visao": true, "arquivos": true, "audio_entrada": false, "video_entrada": false, "raciocinio_obrigatorio": true, "raciocinio_padrao": "high", "verbosidade": false, "busca_web_usd": 0.01, "cache_escrita_1m": 12.5, "cache_escrita_1h_1m": 20, "saida_max": 128000, "lancado_em": "2026-09-01", "expira_em": null, "indice_inteligencia": null, "fonte": "manual"}'::jsonb
  ),
  (
    'openai:gpt-6.1-sol', 'openai', 'gpt-6.1-sol', 'texto', 'GPT-6.1 Sol (OpenAI direta)',
    2.00, 10.00, 0.10, NULL,
    ARRAY['low', 'medium', 'high', 'xhigh', 'max'], ARRAY[]::text[],
    false, true, true, 1050000, '{"entrada": ["file", "image", "text"], "saida": ["text"]}'::jsonb,
    'https://developers.openai.com/api/docs/pricing e https://developers.openai.com/api/docs/models/gpt-6.1-sol (conferido 2026-09-29)', now(),
    '{"ferramentas": true, "json": true, "esquema_estrito": true, "visao": true, "arquivos": true, "audio_entrada": false, "video_entrada": false, "raciocinio_obrigatorio": true, "raciocinio_padrao": "medium", "verbosidade": true, "busca_web_usd": 0.01, "cache_escrita_1m": 2.5, "cache_escrita_1h_1m": null, "saida_max": 128000, "lancado_em": "2026-09-29", "expira_em": null, "indice_inteligencia": null, "fonte": "manual"}'::jsonb
  ),
  (
    'openai:gpt-6-astra', 'openai', 'gpt-6-astra', 'texto', 'GPT-6 Astra (OpenAI direta)',
    10.00, 50.00, 1.00, NULL,
    ARRAY['low', 'medium', 'high', 'xhigh', 'max'], ARRAY[]::text[],
    false, true, true, 1050000, '{"entrada": ["file", "image", "text"], "saida": ["text"]}'::jsonb,
    'https://developers.openai.com/api/docs/pricing e https://developers.openai.com/api/docs/models/gpt-6-astra (conferido 2026-09-29)', now(),
    '{"ferramentas": true, "json": true, "esquema_estrito": true, "visao": true, "arquivos": true, "audio_entrada": false, "video_entrada": false, "raciocinio_obrigatorio": true, "raciocinio_padrao": "medium", "verbosidade": true, "busca_web_usd": 0.01, "cache_escrita_1m": 12.5, "cache_escrita_1h_1m": null, "saida_max": 128000, "lancado_em": "2026-09-03", "expira_em": null, "indice_inteligencia": null, "fonte": "manual"}'::jsonb
  )
ON CONFLICT (id) DO UPDATE SET
  -- Linha que já existe (o dono pode ter ligado): preço, fonte e recursos; ativo, novo e padrão ficam.
  rotulo = EXCLUDED.rotulo,
  preco_entrada_1m = EXCLUDED.preco_entrada_1m,
  preco_saida_1m = EXCLUDED.preco_saida_1m,
  preco_cache_1m = EXCLUDED.preco_cache_1m,
  raciocinio = EXCLUDED.raciocinio,
  contexto_tokens = COALESCE(EXCLUDED.contexto_tokens, public.ia_modelos.contexto_tokens),
  modalidades = COALESCE(EXCLUDED.modalidades, public.ia_modelos.modalidades),
  fonte_preco = EXCLUDED.fonte_preco,
  conferido_em = EXCLUDED.conferido_em,
  recursos = EXCLUDED.recursos;

UPDATE public.ia_modelos SET recursos = '{"ferramentas": true, "json": true, "esquema_estrito": true, "visao": true, "arquivos": true, "audio_entrada": false, "video_entrada": false, "raciocinio_obrigatorio": true, "raciocinio_padrao": "medium", "verbosidade": false, "busca_web_usd": 0.01, "cache_escrita_1m": 5, "cache_escrita_1h_1m": 8, "saida_max": 128000, "lancado_em": "2026-09-22", "expira_em": null, "indice_inteligencia": null, "fonte": "manual"}'::jsonb WHERE id = 'anthropic:claude-opus-5-5' AND (recursos IS NULL OR recursos->>'fonte' = 'manual');
UPDATE public.ia_modelos SET recursos = '{"ferramentas": true, "json": true, "esquema_estrito": true, "visao": true, "arquivos": true, "audio_entrada": false, "video_entrada": false, "raciocinio_obrigatorio": false, "raciocinio_padrao": "high", "verbosidade": false, "busca_web_usd": 0.01, "cache_escrita_1m": 6.25, "cache_escrita_1h_1m": 10, "saida_max": 128000, "lancado_em": "2026-07-24", "expira_em": null, "indice_inteligencia": null, "fonte": "manual"}'::jsonb WHERE id = 'anthropic:claude-opus-5' AND (recursos IS NULL OR recursos->>'fonte' = 'manual');
UPDATE public.ia_modelos SET recursos = '{"ferramentas": true, "json": true, "esquema_estrito": true, "visao": true, "arquivos": true, "audio_entrada": false, "video_entrada": false, "raciocinio_obrigatorio": false, "raciocinio_padrao": "high", "verbosidade": false, "busca_web_usd": 0.01, "cache_escrita_1m": 2.5, "cache_escrita_1h_1m": 4, "saida_max": 128000, "lancado_em": "2026-06-30", "expira_em": null, "indice_inteligencia": null, "fonte": "manual"}'::jsonb WHERE id = 'anthropic:claude-sonnet-5' AND (recursos IS NULL OR recursos->>'fonte' = 'manual');
UPDATE public.ia_modelos SET recursos = '{"ferramentas": true, "json": true, "esquema_estrito": true, "visao": true, "arquivos": true, "audio_entrada": false, "video_entrada": false, "raciocinio_obrigatorio": false, "raciocinio_padrao": "medium", "verbosidade": true, "busca_web_usd": 0.01, "cache_escrita_1m": 2.5, "cache_escrita_1h_1m": null, "saida_max": 128000, "lancado_em": "2026-09-22", "expira_em": null, "indice_inteligencia": null, "fonte": "manual"}'::jsonb WHERE id = 'openai:gpt-6-sol' AND (recursos IS NULL OR recursos->>'fonte' = 'manual');
UPDATE public.ia_modelos SET recursos = '{"ferramentas": true, "json": true, "esquema_estrito": true, "visao": true, "arquivos": true, "audio_entrada": false, "video_entrada": false, "raciocinio_obrigatorio": false, "raciocinio_padrao": "medium", "verbosidade": true, "busca_web_usd": 0.01, "cache_escrita_1m": 0.125, "cache_escrita_1h_1m": null, "saida_max": 128000, "lancado_em": "2026-09-22", "expira_em": null, "indice_inteligencia": null, "fonte": "manual"}'::jsonb WHERE id = 'openai:gpt-6-luna' AND (recursos IS NULL OR recursos->>'fonte' = 'manual');

NOTIFY pgrst, 'reload schema';

-- Conferência (só leitura):
-- select id, ativo, recursos->>'lancado_em' as lancado, recursos->>'ferramentas' as ferramentas from public.ia_modelos
--  where tipo = 'texto' and recursos is not null order by recursos->>'lancado_em' desc nulls last limit 30;
