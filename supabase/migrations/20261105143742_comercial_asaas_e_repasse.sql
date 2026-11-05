-- Fechamento direto do Mercúrio: Pix no Asaas e repasse no WhatsApp da Aceleriq (05/11/2026).
ALTER TABLE public.chaves_cofre DROP CONSTRAINT IF EXISTS chaves_cofre_nome_check;
ALTER TABLE public.chaves_cofre ADD CONSTRAINT chaves_cofre_nome_check CHECK (nome IN (
    'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY',
    'ELEVENLABS_API_KEY', 'FAL_KEY', 'TYPESAFE_API_KEY', 'RESEND_API_KEY',
    'VERCEL_TOKEN', 'RUNWAYML_API_SECRET', 'HEYGEN_API_KEY', 'HIGGSFIELD_API_KEY',
    'HIGGSFIELD_API_SECRET', 'SECOND_BRAIN_GITHUB_TOKEN', 'OPENART_API_KEY',
    'REMOTION_AWS_ACCESS_KEY_ID', 'REMOTION_AWS_SECRET_ACCESS_KEY', 'APIFY_TOKEN',
    'AISA_API_KEY', 'ASAAS_API_KEY', 'ASAAS_WEBHOOK_TOKEN'
));

CREATE TABLE IF NOT EXISTS public.comercial_cobrancas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.commercial_leads(id) ON DELETE CASCADE,
  plano text NOT NULL,
  plano_nome text NOT NULL,
  valor numeric(12,2) NOT NULL CHECK (valor > 0),
  nome text NOT NULL,
  documento_final text,
  email text,
  gateway text NOT NULL DEFAULT 'asaas',
  asaas_cliente_id text,
  asaas_pagamento_id text UNIQUE,
  link text,
  pix_copia_e_cola text,
  vencimento date,
  situacao text NOT NULL DEFAULT 'aguardando' CHECK (situacao IN ('aguardando', 'paga', 'cancelada')),
  paga_em timestamptz,
  observacao text,
  operador_slug text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comercial_cobrancas_lead ON public.comercial_cobrancas (lead_id, situacao);
ALTER TABLE public.comercial_cobrancas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.comercial_cobrancas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.comercial_cobrancas TO authenticated;
DROP POLICY IF EXISTS comercial_cobrancas_equipe_le ON public.comercial_cobrancas;
CREATE POLICY comercial_cobrancas_equipe_le ON public.comercial_cobrancas FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

ALTER TABLE public.commercial_handoffs ADD COLUMN IF NOT EXISTS repassado_em timestamptz;
ALTER TABLE public.commercial_handoffs ADD COLUMN IF NOT EXISTS repasse_wamid text;
CREATE INDEX IF NOT EXISTS commercial_handoffs_sem_repasse ON public.commercial_handoffs (created_at) WHERE repassado_em IS NULL;
