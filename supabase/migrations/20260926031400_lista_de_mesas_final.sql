-- Coordenador (26/09): lista final das mesas no seletor de clientes.
-- P-01, V2-01 e R2 mexem no mesmo CHECK; quem roda por último pode apagar o
-- valor das outras. Este fecha a lista completa depois dos três (idempotente).
-- A RPC mesa_escolher_cliente (versão da R2) valida pela própria constraint.
ALTER TABLE public.mesa_cliente_escolhas DROP CONSTRAINT IF EXISTS mesa_cliente_escolhas_mesa_check;
ALTER TABLE public.mesa_cliente_escolhas
  ADD CONSTRAINT mesa_cliente_escolhas_mesa_check
  CHECK (mesa IN ('organica', 'ads', 'foto', 'publicidade', 'videos', 'roteiros'));
