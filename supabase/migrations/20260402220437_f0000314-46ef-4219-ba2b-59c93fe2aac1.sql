
CREATE TABLE public.payment_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  old_status text,
  new_status text,
  old_amount numeric,
  new_amount numeric,
  notes text,
  performed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_log_admin_select" ON public.payment_audit_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "audit_log_insert" ON public.payment_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (true);
