-- CRM: como o ganho foi de verdade (05/11/2026).
--
-- Dono: "tem um cliente que entrou mas deu metade de entrada e ali soma tudo; e a mensalidade, contar se começa nesse
-- mês ou no próximo". Tudo nulo em quem já fechou: sem dado, vale o que valia (entrada inteira, mensalidade no mês do
-- fechamento). Não escreve no Financeiro: cobrança continua nascendo lá.

ALTER TABLE public.commercial_leads
  ADD COLUMN IF NOT EXISTS entrada_recebida numeric(12,2),
  ADD COLUMN IF NOT EXISTS entrada_parcelas smallint,
  ADD COLUMN IF NOT EXISTS mensalidade_inicio date;

ALTER TABLE public.commercial_leads DROP CONSTRAINT IF EXISTS commercial_leads_entrada_recebida_chk;
ALTER TABLE public.commercial_leads
  ADD CONSTRAINT commercial_leads_entrada_recebida_chk CHECK (entrada_recebida IS NULL OR entrada_recebida >= 0);

ALTER TABLE public.commercial_leads DROP CONSTRAINT IF EXISTS commercial_leads_entrada_parcelas_chk;
ALTER TABLE public.commercial_leads
  ADD CONSTRAINT commercial_leads_entrada_parcelas_chk CHECK (entrada_parcelas IS NULL OR entrada_parcelas BETWEEN 1 AND 36);

ALTER TABLE public.commercial_leads DROP CONSTRAINT IF EXISTS commercial_leads_mensalidade_inicio_chk;
ALTER TABLE public.commercial_leads
  ADD CONSTRAINT commercial_leads_mensalidade_inicio_chk CHECK (mensalidade_inicio IS NULL OR EXTRACT(DAY FROM mensalidade_inicio) = 1);
