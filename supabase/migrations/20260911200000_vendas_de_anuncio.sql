-- Vendas dos anuncios: o numero que fecha o funil e que API nenhuma entrega.
-- Quem sabe se o lead virou venda e o dono do negocio (WhatsApp, Instagram,
-- balcao). A esteira da o lugar de registrar venda a venda: data, plataforma,
-- campanha, por onde veio, quantas e (quando se sabe) o valor. O dossie e o
-- agente externo leem daqui para otimizar a campanha ("teve uma venda").
--
-- Quando a plataforma rastreia a compra sozinha (pixel da Meta), o valor
-- chega automaticamente: a coleta passa a guardar `action_values`.

-- 1) Venda a venda
CREATE TABLE IF NOT EXISTS public.ads_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  sold_at date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  platform text NOT NULL DEFAULT 'meta_ads'
    CHECK (platform IN ('meta_ads', 'google_ads', 'tiktok_ads', 'organico', 'outro')),
  campaign_id text,
  campaign_name text,
  channel text NOT NULL DEFAULT 'whatsapp'
    CHECK (channel IN ('whatsapp', 'instagram', 'site', 'telefone', 'loja', 'outro')),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  value numeric(12, 2) CHECK (value IS NULL OR value >= 0),
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'agente', 'meta', 'google', 'tiktok')),
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ads_sales_client_day_idx
  ON public.ads_sales (client_id, sold_at DESC);

ALTER TABLE public.ads_sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ads_sales_staff_read ON public.ads_sales;
CREATE POLICY ads_sales_staff_read ON public.ads_sales
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS ads_sales_admin_insert ON public.ads_sales;
CREATE POLICY ads_sales_admin_insert ON public.ads_sales
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'manager'::public.app_role))
    AND public.can_access_client(client_id)
  );

DROP POLICY IF EXISTS ads_sales_admin_update ON public.ads_sales;
CREATE POLICY ads_sales_admin_update ON public.ads_sales
  FOR UPDATE TO authenticated
  USING (
    (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'manager'::public.app_role))
    AND public.can_access_client(client_id)
  )
  WITH CHECK (
    (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'manager'::public.app_role))
    AND public.can_access_client(client_id)
  );

DROP POLICY IF EXISTS ads_sales_admin_delete ON public.ads_sales;
CREATE POLICY ads_sales_admin_delete ON public.ads_sales
  FOR DELETE TO authenticated
  USING (
    (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'manager'::public.app_role))
    AND public.can_access_client(client_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ads_sales TO authenticated;
REVOKE ALL ON public.ads_sales FROM anon;

-- 2) A coleta da Meta passa a guardar o VALOR das acoes (compras rastreadas
--    pelo pixel chegam com valor em `action_values`). Coluna nova + a URL
--    pedindo o campo + o tick guardando. Patch por replace no texto vivo da
--    funcao, protegido para rodar de novo sem duplicar.
ALTER TABLE public.ads_campaign_daily
  ADD COLUMN IF NOT EXISTS action_values jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
DECLARE
  _def text;
BEGIN
  _def := pg_get_functiondef('social_private.ads_url'::regproc);
  IF position('action_values' IN _def) = 0 THEN
    _def := replace(_def, ',cost_per_action_type,date_start', ',cost_per_action_type,action_values,date_start');
    EXECUTE _def;
  END IF;

  _def := pg_get_functiondef('public.ads_metrics_tick'::regproc);
  IF position('action_values' IN _def) = 0 THEN
    _def := replace(_def,
      'actions, cost_per_action, captured_at',
      'actions, cost_per_action, action_values, captured_at');
    _def := replace(_def,
      'COALESCE(_row->''cost_per_action_type'', ''[]''::jsonb),',
      'COALESCE(_row->''cost_per_action_type'', ''[]''::jsonb), COALESCE(_row->''action_values'', ''[]''::jsonb),');
    _def := replace(_def,
      'cost_per_action = EXCLUDED.cost_per_action,',
      'cost_per_action = EXCLUDED.cost_per_action, action_values = EXCLUDED.action_values,');
    EXECUTE _def;
  END IF;
END $$;
