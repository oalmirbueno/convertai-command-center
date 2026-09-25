-- Cérebro do cliente (MCP 2.3, 25/09/2026). Fonte: docs/cerebro/01_cerebro_memoria.sql.
-- agente_memoria ganha área, categoria, chave de deduplicação, motivo, evidência, fonte,
-- validade, reforços e substituição; agente 'geral'; uma chave ativa por cliente e agente;
-- cron diário desliga o vencido. Nada é apagado.

-- 1) Colunas novas
ALTER TABLE public.agente_memoria
  ADD COLUMN IF NOT EXISTS area text,
  ADD COLUMN IF NOT EXISTS categoria text,
  ADD COLUMN IF NOT EXISTS chave text,
  ADD COLUMN IF NOT EXISTS motivo text,
  ADD COLUMN IF NOT EXISTS evidencia text,
  ADD COLUMN IF NOT EXISTS fonte text,
  ADD COLUMN IF NOT EXISTS criado_por uuid,
  ADD COLUMN IF NOT EXISTS valido_ate timestamptz,
  ADD COLUMN IF NOT EXISTS reforcos integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reforcado_em timestamptz,
  ADD COLUMN IF NOT EXISTS substituida_por uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agente_memoria_area_check') THEN
    ALTER TABLE public.agente_memoria ADD CONSTRAINT agente_memoria_area_check
      CHECK (area IS NULL OR area IN ('geral', 'calendario', 'campanha', 'arte', 'foto', 'ads', 'copy', 'conta'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agente_memoria_categoria_check') THEN
    ALTER TABLE public.agente_memoria ADD CONSTRAINT agente_memoria_categoria_check
      CHECK (categoria IS NULL OR categoria IN ('preferencia', 'evitar', 'ajuste', 'reprovado', 'performou', 'aprendizado'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agente_memoria_reforcos_check') THEN
    ALTER TABLE public.agente_memoria ADD CONSTRAINT agente_memoria_reforcos_check CHECK (reforcos >= 1);
  END IF;
END $$;

-- 2) Agente 'geral'
ALTER TABLE public.agente_memoria DROP CONSTRAINT IF EXISTS agente_memoria_agente_check;
ALTER TABLE public.agente_memoria ADD CONSTRAINT agente_memoria_agente_check
  CHECK (agente = ANY (ARRAY['estrategista', 'diretor_arte', 'estrategista_ads', 'geral']));

-- 3) Uma chave ativa por cliente e agente (linhas antigas têm chave nula e não entram)
CREATE UNIQUE INDEX IF NOT EXISTS agente_memoria_chave_ativa_unica
  ON public.agente_memoria (client_id, agente, chave)
  WHERE ativa AND chave IS NOT NULL;
CREATE INDEX IF NOT EXISTS agente_memoria_cliente_area_idx
  ON public.agente_memoria (client_id, area, criado_em DESC) WHERE ativa;
CREATE INDEX IF NOT EXISTS agente_memoria_validade_idx
  ON public.agente_memoria (valido_ate) WHERE ativa AND valido_ate IS NOT NULL;

-- 4) Validade: desliga o vencido uma vez por dia
CREATE OR REPLACE FUNCTION public.cerebro_desligar_vencidos()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE _n integer;
BEGIN
  UPDATE public.agente_memoria
     SET ativa = false
   WHERE ativa AND valido_ate IS NOT NULL AND valido_ate <= now();
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.cerebro_desligar_vencidos() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cerebro-vencidos-diario';
    PERFORM cron.schedule('cerebro-vencidos-diario', '17 6 * * *', $cron$select public.cerebro_desligar_vencidos();$cron$);
  END IF;
END $$;

COMMENT ON COLUMN public.agente_memoria.chave IS 'Texto normalizado (sem acento, pontuação e caixa) para deduplicar; ver chaveDoAprendizado em _shared/cerebro-do-cliente.ts.';
COMMENT ON COLUMN public.agente_memoria.reforcos IS 'Quantas vezes o mesmo aprendizado foi dito. Repetição vira reforço, não linha nova.';
COMMENT ON COLUMN public.agente_memoria.valido_ate IS 'Depois disso o cron cerebro-vencidos-diario desliga a linha (ativa = false). Nulo = não vence.';
COMMENT ON COLUMN public.agente_memoria.substituida_por IS 'Aprendizado novo que contradisse este (o dono mudou de ideia).';