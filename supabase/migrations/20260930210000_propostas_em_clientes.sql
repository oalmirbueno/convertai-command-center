-- Frente PRO3 (30/09/2026): a proposta mora em Clientes (pedido do dono) e ganha o tipo upsell.
-- Só amplia e é idempotente (pode rodar mais de uma vez). Não mexe em dado existente.
--
-- 1) propostas.tipo: 'upsell' (cliente da casa) ou 'nova'. Gravado na linha e
--    derivado do retrato que a função mesa-proposta guarda em contexto.upsell ao
--    criar a proposta de upsell (o que o cliente já tem e os resultados reais).
--    Coluna gerada: nunca diverge do retrato, ninguém grava à mão e a função
--    funciona com ou sem esta migration (a tela lê o tipo do próprio contexto).
-- 2) Índice da lista de propostas em Clientes (todas as vivas, mais recentes antes).
--
-- RLS: nada muda. A leitura continua só para admin e gestor com acesso ao
-- cliente (propostas_gestao_le, can_access_client); ninguém escreve pela API.

ALTER TABLE public.propostas
  ADD COLUMN IF NOT EXISTS tipo text
  GENERATED ALWAYS AS (CASE WHEN contexto ? 'upsell' THEN 'upsell' ELSE 'nova' END) STORED;

COMMENT ON COLUMN public.propostas.tipo IS 'nova | upsell. Upsell = proposta para cliente da casa, com o retrato (serviços, plano e resultados reais) em contexto.upsell. Gerada; frente PRO3.';

CREATE INDEX IF NOT EXISTS propostas_vivas_recentes_idx
  ON public.propostas (atualizado_em DESC)
  WHERE arquivada_em IS NULL;

CREATE INDEX IF NOT EXISTS propostas_tipo_idx
  ON public.propostas (client_id, tipo)
  WHERE arquivada_em IS NULL;
