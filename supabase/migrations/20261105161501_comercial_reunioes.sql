-- Reuniões marcadas pelo executivo: uma por dia, garantida pelo banco (05/11/2026).
CREATE TABLE IF NOT EXISTS public.comercial_reunioes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.commercial_leads(id) ON DELETE CASCADE,
  inicio timestamptz NOT NULL,
  dia date NOT NULL,
  resumo text,
  situacao text NOT NULL DEFAULT 'marcada' CHECK (situacao IN ('marcada', 'cancelada', 'feita')),
  google_evento_id text,
  operador_slug text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS comercial_reunioes_uma_por_dia ON public.comercial_reunioes (dia) WHERE situacao = 'marcada';
ALTER TABLE public.comercial_reunioes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.comercial_reunioes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.comercial_reunioes TO authenticated;
DROP POLICY IF EXISTS comercial_reunioes_equipe_le ON public.comercial_reunioes;
CREATE POLICY comercial_reunioes_equipe_le ON public.comercial_reunioes FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
