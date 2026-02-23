
-- Ads wallet table
CREATE TABLE IF NOT EXISTS public.ads_wallet (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  platform text NOT NULL DEFAULT 'meta',
  balance numeric(10,2) DEFAULT 0,
  last_recharge_date timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.ads_wallet ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ads_wallet_select" ON public.ads_wallet FOR SELECT TO authenticated
  USING (client_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'traffic'::app_role));

CREATE POLICY "ads_wallet_insert" ON public.ads_wallet FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'traffic'::app_role));

CREATE POLICY "ads_wallet_update" ON public.ads_wallet FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'traffic'::app_role));

-- Recharge requests table
CREATE TABLE IF NOT EXISTS public.recharge_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id),
  platform text NOT NULL DEFAULT 'meta',
  amount numeric(10,2) NOT NULL,
  reason text,
  status text DEFAULT 'pending',
  requested_by uuid REFERENCES public.profiles(id),
  approved_by uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.recharge_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recharge_requests_select" ON public.recharge_requests FOR SELECT TO authenticated
  USING (client_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'traffic'::app_role));

CREATE POLICY "recharge_requests_insert" ON public.recharge_requests FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "recharge_requests_update" ON public.recharge_requests FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
