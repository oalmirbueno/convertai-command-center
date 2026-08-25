-- PARA RODAR NO SQL EDITOR DO LOVABLE CLOUD (Backend -> SQL).
-- Cole o arquivo inteiro e execute uma vez. Rodar de novo nao faz mal.
--
-- 1) Aplica a classe e a qualificacao do lead comercial (duas colunas
--    novas em commercial_leads; nenhuma linha existente muda).
-- 2) Anota a migration no diario de bordo do Supabase.

BEGIN;

-- ═══ 1) Migration: comercial_classe_qualificacao ═══
-- A classe e a qualificação da oportunidade comercial.
--
-- O funil tinha estágio, dono e valor, mas não dizia QUE TIPO de conversa
-- era cada uma: negócio novo com quem já é cliente, upsell ou prospect que
-- nunca comprou. Para a meta de clientes recorrentes, essa é a primeira
-- pergunta — e ela não podia ser respondida.
--
-- Duas colunas, nada mais:
--
--   classe        'cliente_atual' | 'upsell' | 'novo_prospect' | NULL.
--                 NULL significa "não confirmado" — nunca é inventado um
--                 valor no backfill, porque classe chutada em massa é pior
--                 que classe em branco: a errada parece resposta.
--
--   qualificacao  jsonb com os campos de qualificação (aderência ao ICP,
--                 problema, orçamento, autoridade, urgência, potencial de
--                 recorrência, aprovação necessária). Campo ausente = não
--                 confirmado. Uma coluna por campo criaria sete colunas
--                 quase sempre vazias e uma migration a cada pergunta nova.
--
-- Nenhuma linha existente é alterada: o DEFAULT '{}' vale para as novas e o
-- backfill do jsonb é vazio de propósito.

ALTER TABLE public.commercial_leads
  ADD COLUMN IF NOT EXISTS classe text,
  ADD COLUMN IF NOT EXISTS qualificacao jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'commercial_leads_classe_check'
      AND conrelid = 'public.commercial_leads'::regclass
  ) THEN
    ALTER TABLE public.commercial_leads
      ADD CONSTRAINT commercial_leads_classe_check
      CHECK (classe IS NULL OR classe IN ('cliente_atual', 'upsell', 'novo_prospect'));
  END IF;
END $$;

-- ═══ 2) Registro no diario de bordo ═══
INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES
  ('20260825120000', 'comercial_classe_qualificacao', ARRAY[
    '-- A classe e a qualificação da oportunidade comercial.
--
-- O funil tinha estágio, dono e valor, mas não dizia QUE TIPO de conversa
-- era cada uma: negócio novo com quem já é cliente, upsell ou prospect que
-- nunca comprou. Para a meta de clientes recorrentes, essa é a primeira
-- pergunta — e ela não podia ser respondida.
--
-- Duas colunas, nada mais:
--
--   classe        ''cliente_atual'' | ''upsell'' | ''novo_prospect'' | NULL.
--                 NULL significa "não confirmado" — nunca é inventado um
--                 valor no backfill, porque classe chutada em massa é pior
--                 que classe em branco: a errada parece resposta.
--
--   qualificacao  jsonb com os campos de qualificação (aderência ao ICP,
--                 problema, orçamento, autoridade, urgência, potencial de
--                 recorrência, aprovação necessária). Campo ausente = não
--                 confirmado. Uma coluna por campo criaria sete colunas
--                 quase sempre vazias e uma migration a cada pergunta nova.
--
-- Nenhuma linha existente é alterada: o DEFAULT ''{}'' vale para as novas e o
-- backfill do jsonb é vazio de propósito.

ALTER TABLE public.commercial_leads
  ADD COLUMN IF NOT EXISTS classe text,
  ADD COLUMN IF NOT EXISTS qualificacao jsonb NOT NULL DEFAULT ''{}''::jsonb',
    'DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = ''commercial_leads_classe_check''
      AND conrelid = ''public.commercial_leads''::regclass
  ) THEN
    ALTER TABLE public.commercial_leads
      ADD CONSTRAINT commercial_leads_classe_check
      CHECK (classe IS NULL OR classe IN (''cliente_atual'', ''upsell'', ''novo_prospect''));
  END IF;
END $$'
  ]::text[])
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- Conferencia: as duas colunas e a linha do diario, numa tabela so.
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'commercial_leads'
      AND column_name IN ('classe', 'qualificacao')) AS colunas_criadas_deve_ser_2,
  (SELECT count(*) FROM supabase_migrations.schema_migrations
    WHERE version = '20260825120000') AS registro_no_diario_deve_ser_1,
  (SELECT count(*) FROM public.commercial_leads WHERE classe IS NOT NULL) AS leads_com_classe_deve_ser_0;
