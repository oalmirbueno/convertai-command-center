-- Frente MOD (30/09/2026), revista pela MOD2 (01/10): liga o lote de modelos novos (texto e imagem) e
-- preenche o padrão só de papel que está SEM padrão ligado.
--
-- Lançamentos conferidos ao vivo em GET https://openrouter.ai/api/v1/models (30/09, 464 modelos) e
-- GET https://openrouter.ai/api/v1/images/models (01/10, 55 modelos). A lista de candidatos por papel e
-- o lote novo são os de src/lib/mesa/modelo-por-papel.ts (RECOMENDACOES_POR_PAPEL e
-- MODELOS_DO_LOTE_NOVO; o teste confere que batem); a justificativa está em docs/motores/MODELOS.md.
--
-- 1. Lote novo LIGADO (pedido do dono: "atualizar com os novos modelos lançados"). O catálogo já tinha
--    todos sincronizados, mas desligados, e o seletor das mesas só mostra modelo ligado. Só liga linha
--    que existe e que o provedor ainda oferece (disponivel); "novo" continua marcado. Nada é desligado.
-- 2. Padrão por papel, SÓ onde falta (dados, idempotente):
--    * papel que já tem um modelo ligado como padrão NÃO muda. Trocar o padrão de um papel em uso muda
--      o custo de todas as mesas (o estrategista no GPT-6 Luna custou US$ 2,05 na semana de 24 a 30/09;
--      no Sonnet 5.5 a mesma semana passaria de US$ 16, fora o raciocínio obrigatório). Essa troca é do
--      dono, em Modelos de IA › "Aplicar a recomendação" (prévia do que muda, custo e Confirmar);
--    * papel sem padrão ligado recebe o primeiro candidato que existe, é do tipo do papel, está ligado e
--      o provedor ainda oferece (em 30/09 só o estrategista_rapido estava assim);
--    * cada papel fica em um modelo só; rodar de novo não muda nada.

-- ---------------------------------------------------------------------------
-- 1. Lote novo ligado
-- ---------------------------------------------------------------------------
UPDATE public.ia_modelos
   SET ativo = true
 WHERE id = ANY (ARRAY['openrouter:anthropic/claude-sonnet-5.5', 'openrouter:openai/gpt-6.1-sol', 'openrouter:anthropic/claude-fable-5.1', 'openrouter:openai/gpt-6-astra', 'openrouter:google/gemini-3.8-flash', 'openrouter:xiaomi/mimo-v2.6-pro', 'openrouter:deepseek/deepseek-v4.1-flash', 'openrouter:x-ai/grok-4.7', 'openrouter:microsoft/mai-image-2.6-flash', 'openrouter:qwen/qwen-image-3', 'openrouter:x-ai/grok-imagine-image-2.0', 'openrouter:black-forest-labs/flux.2-max']::text[])
   AND tipo IN ('texto', 'imagem')
   AND COALESCE(disponivel, true)
   AND NOT ativo;

-- ---------------------------------------------------------------------------
-- 2. Padrão só para papel sem padrão ligado
-- ---------------------------------------------------------------------------
DO $migration$
DECLARE
  _papel record;
  _escolhido text;
BEGIN
  FOR _papel IN
    SELECT *
    FROM (VALUES
      ('estrategista', 'texto', ARRAY['openrouter:anthropic/claude-sonnet-5.5', 'openrouter:openai/gpt-6.1-sol', 'openrouter:anthropic/claude-opus-5.5', 'openrouter:openai/gpt-6-sol', 'anthropic:claude-sonnet-5-5', 'openai:gpt-6.1-sol', 'openai:gpt-6-sol']::text[]),
      ('diretor_arte', 'texto', ARRAY['openrouter:anthropic/claude-sonnet-5.5', 'openrouter:anthropic/claude-opus-5.5', 'openrouter:openai/gpt-6.1-sol', 'openrouter:openai/gpt-6-sol', 'anthropic:claude-sonnet-5-5', 'openai:gpt-6-sol']::text[]),
      ('imagem', 'imagem', ARRAY['openrouter:openai/gpt-image-2.5-sunburst', 'openai:gpt-image-2.5-sunburst']::text[]),
      ('leitura', 'texto', ARRAY['openrouter:openai/gpt-6-luna', 'openrouter:google/gemini-3.8-flash', 'openrouter:xiaomi/mimo-v2.6-pro', 'openrouter:openai/gpt-6.1-sol', 'openai:gpt-6-luna']::text[]),
      ('contexto', 'texto', ARRAY['openrouter:anthropic/claude-sonnet-5.5', 'openrouter:openai/gpt-6.1-sol', 'openrouter:openai/gpt-6-sol', 'openrouter:openai/gpt-6-luna', 'anthropic:claude-sonnet-5-5', 'openai:gpt-6-sol']::text[]),
      ('estrategista_rapido', 'texto', ARRAY['openrouter:openai/gpt-6-luna', 'openrouter:deepseek/deepseek-v4.1-flash', 'openrouter:google/gemini-3.8-flash', 'openai:gpt-6-luna']::text[]),
      ('proposta', 'texto', ARRAY['openrouter:anthropic/claude-opus-5.5', 'openrouter:anthropic/claude-sonnet-5.5', 'openrouter:openai/gpt-6.1-sol', 'anthropic:claude-opus-5-5', 'anthropic:claude-sonnet-5-5']::text[]),
      ('contrato', 'texto', ARRAY['openrouter:anthropic/claude-opus-5.5', 'openrouter:anthropic/claude-sonnet-5.5', 'openrouter:openai/gpt-6.1-sol', 'anthropic:claude-opus-5-5', 'anthropic:claude-sonnet-5-5']::text[]),
      ('briefing', 'texto', ARRAY['openrouter:anthropic/claude-sonnet-5.5', 'openrouter:openai/gpt-6.1-sol', 'openrouter:openai/gpt-6-luna', 'anthropic:claude-sonnet-5-5', 'openai:gpt-6-luna']::text[]),
      ('conselho', 'texto', ARRAY['openrouter:openai/gpt-6.1-sol', 'openrouter:anthropic/claude-sonnet-5.5', 'openrouter:openai/gpt-6-sol', 'openrouter:openai/gpt-6-luna', 'openai:gpt-6.1-sol', 'openai:gpt-6-sol']::text[]),
      ('identidade', 'texto', ARRAY['openrouter:anthropic/claude-opus-5.5', 'openrouter:anthropic/claude-sonnet-5.5', 'openrouter:openai/gpt-6.1-sol', 'anthropic:claude-opus-5-5']::text[]),
      ('naming', 'texto', ARRAY['openrouter:anthropic/claude-opus-5.5', 'openrouter:anthropic/claude-sonnet-5.5', 'openrouter:openai/gpt-6.1-sol', 'anthropic:claude-opus-5-5']::text[]),
      ('site', 'texto', ARRAY['openrouter:anthropic/claude-opus-5.5', 'openrouter:anthropic/claude-sonnet-5.5', 'openrouter:openai/gpt-6.1-sol', 'anthropic:claude-opus-5-5', 'anthropic:claude-sonnet-5-5']::text[]),
      ('motion', 'texto', ARRAY['openrouter:anthropic/claude-opus-5.5', 'openrouter:anthropic/claude-sonnet-5.5', 'openrouter:openai/gpt-6.1-sol', 'anthropic:claude-opus-5-5', 'anthropic:claude-sonnet-5-5']::text[]),
      ('documento', 'texto', ARRAY['openrouter:anthropic/claude-sonnet-5.5', 'openrouter:anthropic/claude-opus-5.5', 'openrouter:openai/gpt-6.1-sol', 'anthropic:claude-sonnet-5-5', 'anthropic:claude-opus-5-5']::text[])
    ) AS t(papel, tipo, candidatos)
  LOOP
    -- A CHECK de padrao_para precisa aceitar o papel (as mesas novas entraram em 20260930000000).
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'ia_modelos_padrao_para_check'
         AND pg_get_constraintdef(oid) LIKE '%''' || _papel.papel || '''%'
    ) THEN
      CONTINUE;
    END IF;

    -- Papel que já tem padrão ligado e disponível: a troca é do dono (prévia e Confirmar na tela).
    IF EXISTS (
      SELECT 1 FROM public.ia_modelos
       WHERE _papel.papel = ANY (padrao_para)
         AND ativo
         AND COALESCE(disponivel, true)
    ) THEN
      CONTINUE;
    END IF;

    SELECT m.id
      INTO _escolhido
      FROM unnest(_papel.candidatos) WITH ORDINALITY AS c(id, ordem)
      JOIN public.ia_modelos AS m ON m.id = c.id
     WHERE m.ativo
       AND COALESCE(m.disponivel, true)
       AND m.tipo = _papel.tipo
     ORDER BY c.ordem
     LIMIT 1;

    IF _escolhido IS NULL THEN
      CONTINUE;
    END IF;

    UPDATE public.ia_modelos
       SET padrao_para = array_remove(padrao_para, _papel.papel)
     WHERE _papel.papel = ANY (padrao_para)
       AND id <> _escolhido;

    UPDATE public.ia_modelos
       SET padrao_para = array_append(padrao_para, _papel.papel)
     WHERE id = _escolhido
       AND NOT (_papel.papel = ANY (padrao_para));
  END LOOP;
END
$migration$;

-- Conferência (só leitura):
-- select unnest(padrao_para) as papel, id from public.ia_modelos where cardinality(padrao_para) > 0 order by 1;
-- select id, ativo, novo from public.ia_modelos where id like 'openrouter:%' and ativo and tipo = 'texto' order by 1;
