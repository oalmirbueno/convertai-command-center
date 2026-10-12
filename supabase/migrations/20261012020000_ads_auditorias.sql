-- Auditoria da conta de anúncios (12/10/2026, checklist do claude-ads adaptado à Meta).
--
-- Só amplia e é idempotente. Cada rodada da auditoria fica guardada (histórico para comparar a nota
-- de uma semana para a outra). A rodada é calculada em código pela função mesa-ads: sem IA, sem custo.
-- nota é null quando a cobertura não chega a 60% (dado insuficiente para dar nota).
-- Leitura: equipe. Escrita: só a função (service_role).

CREATE TABLE IF NOT EXISTS public.ads_auditorias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plataforma text NOT NULL DEFAULT 'meta' CHECK (plataforma IN ('meta', 'google')),
  nota integer CHECK (nota IS NULL OR (nota >= 0 AND nota <= 100)),
  cobertura integer NOT NULL CHECK (cobertura >= 0 AND cobertura <= 100),
  faixa text NOT NULL CHECK (faixa IN ('valendo', 'provisoria', 'dado_insuficiente')),
  categorias jsonb NOT NULL DEFAULT '[]'::jsonb,
  controles jsonb NOT NULL DEFAULT '[]'::jsonb,
  periodo jsonb,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ads_auditorias_cliente_idx ON public.ads_auditorias (client_id, criado_em DESC);

ALTER TABLE public.ads_auditorias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ads_auditorias_equipe_le ON public.ads_auditorias;
CREATE POLICY ads_auditorias_equipe_le ON public.ads_auditorias FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'traffic'::public.app_role)
  );

DROP POLICY IF EXISTS ads_auditorias_servico ON public.ads_auditorias;
CREATE POLICY ads_auditorias_servico ON public.ads_auditorias FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE INSERT, UPDATE, DELETE ON public.ads_auditorias FROM authenticated, anon;
