-- Frente BAS (29/09/2026): papéis de modelo das mesas novas (plano "Plano das novas mesas Aceleriq").
--
-- Só amplia e é idempotente. Nada de RLS novo; nada é apagado.
--
-- 1. ia_modelos.padrao_para aceita 9 papéis novos: proposta, contrato, briefing, conselho, identidade,
--    naming, site, motion e documento. Os 6 que já existiam continuam (a CHECK viva em 29/09, lida por
--    SELECT em pg_constraint, é a de 20260925162246_mesa_modelo_rapido.sql).
-- 2. ia_usos (tarefa e agente) aceita os mesmos 9 nomes, para o registrarUso das mesas novas não cair
--    na CHECK (ia-motor.ts: uniões Tarefa e Agente). As listas vivas em 29/09 são as de
--    20260924015930_mesa_ads.sql.
-- 3. Padrão inicial de cada papel novo, só quando o papel ainda não tem padrão e só num modelo que existe,
--    é de texto e está ligado (o ia-motor e a tela só usam modelo ativo). Catálogo lido em 29/09 (SELECT):
--    ligados openrouter:anthropic/claude-opus-5.5 e openrouter:openai/gpt-6-luna; Sonnet 5.5 e os diretos
--    da Anthropic existem, mas desligados. O dono troca na hora em Modelos de IA, e cada mesa troca por
--    pedido no SeletorDeModelo.
--    - Claude (Opus, depois Sonnet): proposta, contrato, site, documento, identidade, naming e motion
--      (texto longo e jurídico, código de site e de motion).
--    - GPT-6 Luna: conselho e briefing (conversa longa e barata; Luna já é o padrão da estratégia).

-- ---------------------------------------------------------------------------
-- 1. padrao_para
-- ---------------------------------------------------------------------------
ALTER TABLE public.ia_modelos DROP CONSTRAINT IF EXISTS ia_modelos_padrao_para_check;
ALTER TABLE public.ia_modelos
  ADD CONSTRAINT ia_modelos_padrao_para_check
  CHECK (padrao_para <@ ARRAY[
    'estrategista', 'diretor_arte', 'imagem', 'leitura', 'contexto', 'estrategista_rapido',
    'proposta', 'contrato', 'briefing', 'conselho', 'identidade', 'naming', 'site', 'motion', 'documento'
  ]::text[]);

-- ---------------------------------------------------------------------------
-- 2. ia_usos: tarefa e agente
-- ---------------------------------------------------------------------------
ALTER TABLE public.ia_usos DROP CONSTRAINT IF EXISTS ia_usos_tarefa_check;
ALTER TABLE public.ia_usos
  ADD CONSTRAINT ia_usos_tarefa_check
  CHECK (tarefa = ANY (ARRAY[
    'calendario', 'estudio', 'conversa', 'leitura_referencia', 'verificacao', 'contexto', 'ads',
    'proposta', 'contrato', 'briefing', 'conselho', 'identidade', 'naming', 'site', 'motion', 'documento'
  ]));

ALTER TABLE public.ia_usos DROP CONSTRAINT IF EXISTS ia_usos_agente_check;
ALTER TABLE public.ia_usos
  ADD CONSTRAINT ia_usos_agente_check
  CHECK (agente = ANY (ARRAY[
    'estrategista', 'diretor_arte', 'gerador_imagem', 'leitor', 'jev', 'contexto', 'estrategista_ads',
    'proposta', 'contrato', 'briefing', 'conselho', 'identidade', 'naming', 'site', 'motion', 'documento'
  ]));

-- ---------------------------------------------------------------------------
-- 3. Padrão inicial por papel (primeiro candidato que existe, é de texto e está ligado)
-- ---------------------------------------------------------------------------
DO $migration$
DECLARE
  _claude constant text[] := ARRAY[
    'openrouter:anthropic/claude-opus-5.5',
    'anthropic:claude-opus-5-5',
    'openrouter:anthropic/claude-sonnet-5.5',
    'anthropic:claude-sonnet-5'
  ];
  _luna constant text[] := ARRAY[
    'openrouter:openai/gpt-6-luna',
    'openai:gpt-6-luna'
  ];
  _papel record;
  _escolhido text;
BEGIN
  FOR _papel IN
    SELECT *
    FROM (VALUES
      ('proposta', _claude),
      ('contrato', _claude),
      ('site', _claude),
      ('documento', _claude),
      ('identidade', _claude),
      ('naming', _claude),
      ('motion', _claude),
      ('conselho', _luna || _claude),
      ('briefing', _luna || _claude)
    ) AS t(papel, candidatos)
  LOOP
    -- O dono já escolheu (ou a migration já rodou): não mexe.
    IF EXISTS (SELECT 1 FROM public.ia_modelos AS m WHERE _papel.papel = ANY (m.padrao_para)) THEN
      CONTINUE;
    END IF;

    SELECT m.id
      INTO _escolhido
      FROM unnest(_papel.candidatos) WITH ORDINALITY AS c(id, ordem)
      JOIN public.ia_modelos AS m ON m.id = c.id
     WHERE m.ativo AND m.tipo = 'texto'
     ORDER BY c.ordem
     LIMIT 1;

    IF _escolhido IS NOT NULL THEN
      UPDATE public.ia_modelos
         SET padrao_para = array_append(padrao_para, _papel.papel)
       WHERE id = _escolhido
         AND NOT (_papel.papel = ANY (padrao_para));
    END IF;
  END LOOP;
END
$migration$;
