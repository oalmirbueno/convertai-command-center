-- Frente MOD (30/09/2026): o melhor modelo por papel.
--
-- Revisão de padrao_para depois dos lançamentos de setembro (Claude Opus 5.5 em 22/09, Claude Sonnet 5.5
-- em 28/09, GPT-6.1 Sol em 29/09). A lista de candidatos por papel é a de
-- supabase/functions/_shared/modelo-por-papel.ts (RECOMENDACOES_POR_PAPEL; o teste confere que as duas
-- batem) e a justificativa de qualidade e custo está em docs/motores/MODELOS.md.
--
-- Regra (dados, idempotente):
-- * vale o primeiro candidato que EXISTE no catálogo, é do tipo do papel, está LIGADO e o provedor ainda
--   oferece (disponivel). Nenhum modelo é ligado nem desligado aqui;
-- * papel sem candidato ligado fica como está;
-- * cada papel fica em um modelo só: o papel sai de quem o tinha e entra no escolhido;
-- * rodar de novo não muda nada (o escolhido já tem o papel).
--
-- Depois de ligar um modelo novo (ex.: Sonnet 5.5 ou GPT-6.1 Sol), o dono aplica a mesma recomendação em
-- Modelos de IA › "Aplicar a recomendação", que usa a mesma lista.

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
      ('leitura', 'texto', ARRAY['openrouter:openai/gpt-6-luna', 'openrouter:google/gemini-3.8-flash', 'openrouter:openai/gpt-6.1-sol', 'openai:gpt-6-luna']::text[]),
      ('contexto', 'texto', ARRAY['openrouter:anthropic/claude-sonnet-5.5', 'openrouter:openai/gpt-6.1-sol', 'openrouter:openai/gpt-6-sol', 'openrouter:openai/gpt-6-luna', 'anthropic:claude-sonnet-5-5', 'openai:gpt-6-sol']::text[]),
      ('estrategista_rapido', 'texto', ARRAY['openrouter:openai/gpt-6-luna', 'openrouter:google/gemini-3.8-flash', 'openrouter:deepseek/deepseek-v4.1-flash', 'openai:gpt-6-luna']::text[]),
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
