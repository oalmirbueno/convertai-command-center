
CREATE TABLE public.api_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  ip_address text,
  status_code integer,
  error_message text,
  params jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- No RLS needed - only accessed via service role in edge function
ALTER TABLE public.api_audit_log ENABLE ROW LEVEL SECURITY;

-- Admin-only read access
CREATE POLICY "audit_log_admin_select" ON public.api_audit_log
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
