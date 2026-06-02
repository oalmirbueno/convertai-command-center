CREATE TABLE public.contracts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL,
  project_id uuid,
  title text NOT NULL,
  description text,
  original_file_url text NOT NULL,
  original_file_name text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  admin_signature_name text,
  admin_signed_at timestamptz,
  admin_signature_ip text,
  client_signature_name text,
  client_signed_at timestamptz,
  client_signature_ip text,
  sign_token text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', '') UNIQUE,
  sent_at timestamptz,
  file_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contracts TO authenticated;
GRANT ALL ON public.contracts TO service_role;

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY contracts_select ON public.contracts
  FOR SELECT TO authenticated
  USING (client_id = auth.uid() OR is_staff(auth.uid()));

CREATE POLICY contracts_insert ON public.contracts
  FOR INSERT TO authenticated
  WITH CHECK (is_staff(auth.uid()));

CREATE POLICY contracts_update ON public.contracts
  FOR UPDATE TO authenticated
  USING (is_staff(auth.uid()) OR client_id = auth.uid());

CREATE POLICY contracts_delete ON public.contracts
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER contracts_updated_at
  BEFORE UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_contracts_client ON public.contracts(client_id);
CREATE INDEX idx_contracts_token ON public.contracts(sign_token);