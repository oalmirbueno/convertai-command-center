-- Catalogo de modelos que se atualiza sozinho (decisao do dono, 2026-09-22).
--
-- O dono quer variedade (GPT-6, Claude Opus 5.5, Nano Banana e o que sair),
-- escolhendo e pagando pelo OpenRouter. A funcao ia-gateway, acao
-- sincronizar_catalogo, le a lista publica do OpenRouter e a lista de ids da
-- OpenAI direta e grava aqui pela RPC ia_modelos_sincronizar.
--
-- Regras da sincronizacao:
-- - modelo novo entra com ativo = false e novo = true (o painel destaca e o
--   dono ativa pela tela);
-- - a sincronizacao nunca mexe em ativo nem em padrao_para: o que o dono
--   ligou continua ligado;
-- - modelo que sumiu do provedor vira disponivel = false, sem apagar;
-- - preco do OpenRouter e atualizado a cada rodada (o provedor informa);
--   preco das linhas openai:* fica como esta na tabela (a OpenAI nao publica
--   preco pela API), so a disponibilidade e conferida.
--
-- Cron diario as 06:17 de Brasilia (09:17 GMT, fuso do pg_cron).

-- ---------------------------------------------------------------------------
-- 1. Colunas novas
-- ---------------------------------------------------------------------------
ALTER TABLE public.ia_modelos
  ADD COLUMN IF NOT EXISTS novo boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS disponivel boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS contexto_tokens integer CHECK (contexto_tokens IS NULL OR contexto_tokens > 0),
  ADD COLUMN IF NOT EXISTS modalidades jsonb CHECK (modalidades IS NULL OR jsonb_typeof(modalidades) = 'object'),
  ADD COLUMN IF NOT EXISTS criado_em timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS sincronizado_em timestamptz;

COMMENT ON COLUMN public.ia_modelos.novo IS
  'Entrou pela sincronizacao e o dono ainda nao revisou. O painel destaca; vira false quando o dono ativa ou dispensa.';
COMMENT ON COLUMN public.ia_modelos.disponivel IS
  'O provedor ainda oferece o modelo. A sincronizacao marca false quando some; nunca apaga.';

-- O que ja estava na tabela foi escolhido a mao: nao e novidade.
UPDATE public.ia_modelos SET novo = false WHERE novo;

CREATE INDEX IF NOT EXISTS ia_modelos_provedor_idx ON public.ia_modelos (provedor, disponivel);

-- Quando o dono ativa um modelo pela tela, ele deixa de ser novidade.
CREATE OR REPLACE FUNCTION app_private.ia_modelos_ativou_deixa_de_ser_novo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $body$
BEGIN
  IF NEW.ativo AND NOT OLD.ativo THEN
    NEW.novo := false;
  END IF;
  RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS ia_modelos_ativou_deixa_de_ser_novo ON public.ia_modelos;
CREATE TRIGGER ia_modelos_ativou_deixa_de_ser_novo
BEFORE UPDATE OF ativo ON public.ia_modelos
FOR EACH ROW EXECUTE FUNCTION app_private.ia_modelos_ativou_deixa_de_ser_novo();

-- ---------------------------------------------------------------------------
-- 2. RPC de sincronizacao (so backend)
-- ---------------------------------------------------------------------------
-- _provedor 'openrouter': _modelos e a lista completa convertida pela funcao
--   de borda ([{id, modelo_api, tipo, rotulo, preco_*_1m, preco_imagem,
--   raciocinio, contexto_tokens, modalidades, fonte_preco}]). Insere o que e
--   novo (ativo false, novo true) e atualiza preco e dados do que ja existe.
-- _provedor 'openai' ou 'anthropic': _modelos e a lista de ids reais
--   (["gpt-6-sol", ...]); so marca disponivel nas linhas que ja existem.
-- _completo: a lista veio inteira; so assim o que faltar vira indisponivel.
CREATE OR REPLACE FUNCTION public.ia_modelos_sincronizar(
  _provedor text,
  _modelos jsonb,
  _completo boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
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

    -- Aqui _ids guarda modelo_api; a comparacao abaixo usa a mesma chave.
  END IF;

  IF _completo AND COALESCE(cardinality(_ids), 0) > 0 THEN
    UPDATE public.ia_modelos
    SET disponivel = false, sincronizado_em = now()
    WHERE provedor = _provedor
      AND disponivel
      AND CASE WHEN _provedor = 'openrouter' THEN id <> ALL(_ids) ELSE modelo_api <> ALL(_ids) END;
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
$body$;

REVOKE ALL ON FUNCTION public.ia_modelos_sincronizar(text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ia_modelos_sincronizar(text, jsonb, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Cron diario (06:17 de Brasilia = 09:17 GMT)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ia-catalogo-sincronizar-diario';
    PERFORM cron.schedule('ia-catalogo-sincronizar-diario', '17 9 * * *', $cron$
      select net.http_post(
        url := 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/ia-gateway',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := jsonb_build_object('acao', 'sincronizar_catalogo'),
        timeout_milliseconds := 60000
      );
    $cron$);
  END IF;
END $$;
