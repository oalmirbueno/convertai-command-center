-- Frente BASE (29/09/2026): a conversa dos agentes das mesas novas precisa caber em agente_conversas.
-- Só amplia a CHECK (mantém os 4 agentes de hoje) com os 9 papéis das mesas novas; idempotente.
ALTER TABLE public.agente_conversas DROP CONSTRAINT IF EXISTS agente_conversas_agente_check;
ALTER TABLE public.agente_conversas
  ADD CONSTRAINT agente_conversas_agente_check CHECK (agente = ANY (ARRAY[
    'estrategista', 'diretor_arte', 'contexto', 'estrategista_ads',
    'proposta', 'contrato', 'briefing', 'conselho', 'identidade', 'naming', 'site', 'motion', 'documento'
  ]::text[]));
