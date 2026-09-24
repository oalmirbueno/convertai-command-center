-- Mesa do cliente: GPT Image 2.5 pelo OpenRouter (dono, 23/09 noite).
-- A agência paga as imagens pelo OpenRouter. O GPT Image 2.5 (Sunburst e Flare)
-- está no OpenRouter pela API dedicada de imagens (POST /api/v1/images), que não
-- aparece na lista pública /api/v1/models usada pela sincronização diária; por
-- isso ele entra aqui à mão, a sincronização não o marca como indisponível, e o
-- Sunburst pelo OpenRouter vira o gerador padrão de imagem.

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
        modalidades jsonb, fonte_preco text
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
        contexto_tokens, modalidades, fonte_preco, conferido_em, sincronizado_em
      )
      SELECT
        e.id, 'openrouter', e.modelo_api, e.tipo, COALESCE(NULLIF(btrim(e.rotulo), ''), e.modelo_api),
        e.preco_entrada_1m, e.preco_saida_1m, e.preco_cache_1m, e.preco_imagem,
        COALESCE(e.raciocinio, '{}'::text[]), '{}'::text[], false, true, true,
        e.contexto_tokens, e.modalidades, e.fonte_preco, now(), now()
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
        conferido_em = now(),
        sincronizado_em = now(),
        disponivel = true
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
      -- GPT Image pelo OpenRouter fica na API de imagens, fora da lista pública: não some.
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

INSERT INTO public.ia_modelos (
  id, provedor, modelo_api, tipo, rotulo,
  preco_entrada_1m, preco_saida_1m, preco_cache_1m, preco_imagem,
  raciocinio, padrao_para, ativo, novo, disponivel, fonte_preco, conferido_em, sincronizado_em
)
SELECT v.id, 'openrouter', v.modelo_api, 'imagem', v.rotulo,
  5, 30, 1.25, d.preco_imagem,
  '{}'::text[], '{}'::text[], true, false, true,
  'https://openrouter.ai/' || v.modelo_api || ' (API de imagens, POST /api/v1/images; preco igual ao da OpenAI direta; o custo real vem em usage.cost)',
  now(), now()
FROM (VALUES
  ('openrouter:openai/gpt-image-2.5-sunburst', 'openai/gpt-image-2.5-sunburst', 'OpenAI: GPT Image 2.5 Sunburst (OpenRouter)', 'openai:gpt-image-2.5-sunburst'),
  ('openrouter:openai/gpt-image-2.5-flare', 'openai/gpt-image-2.5-flare', 'OpenAI: GPT Image 2.5 Flare (OpenRouter)', 'openai:gpt-image-2.5-flare')
) AS v(id, modelo_api, rotulo, direto)
JOIN public.ia_modelos d ON d.id = v.direto
ON CONFLICT (id) DO UPDATE SET ativo = true, disponivel = true, preco_imagem = EXCLUDED.preco_imagem, rotulo = EXCLUDED.rotulo;

-- O Sunburst pelo OpenRouter vira o padrão de imagem; a OpenAI direta deixa de ser.
UPDATE public.ia_modelos SET padrao_para = array_remove(padrao_para, 'imagem') WHERE 'imagem' = ANY(padrao_para) AND id <> 'openrouter:openai/gpt-image-2.5-sunburst';
UPDATE public.ia_modelos SET padrao_para = array_append(array_remove(padrao_para, 'imagem'), 'imagem') WHERE id = 'openrouter:openai/gpt-image-2.5-sunburst';

-- Trabalhos ainda não entregues com o Sunburst direto passam para o mesmo modelo pelo OpenRouter.
UPDATE public.estudio_trabalhos SET modelo_imagem_id = 'openrouter:openai/gpt-image-2.5-sunburst'
WHERE modelo_imagem_id = 'openai:gpt-image-2.5-sunburst' AND status <> 'entregue';
UPDATE public.estudio_trabalhos SET modelo_imagem_id = 'openrouter:openai/gpt-image-2.5-flare'
WHERE modelo_imagem_id = 'openai:gpt-image-2.5-flare' AND status <> 'entregue';
