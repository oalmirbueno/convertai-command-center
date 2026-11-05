-- Rodada do "Atualizar todos" guardada no servidor (05/11/2026).
--
-- Dono: "a central de atualizar todos no mobile não está sincronizada com o desktop". A rodada morava só no
-- localStorage de cada aparelho. Agora cada pessoa tem uma linha, e todo aparelho dela lê e grava a mesma.

CREATE TABLE IF NOT EXISTS public.agente_central_rodadas (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  rodada jsonb,
  atualizada_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agente_central_rodadas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agente_central_rodadas_da_pessoa ON public.agente_central_rodadas;
CREATE POLICY agente_central_rodadas_da_pessoa ON public.agente_central_rodadas
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_staff(auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.is_staff(auth.uid()));

REVOKE ALL ON public.agente_central_rodadas FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agente_central_rodadas TO authenticated;
