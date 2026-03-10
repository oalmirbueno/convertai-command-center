
-- Table for persisting integration configurations
CREATE TABLE public.integration_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  base_url text NOT NULL DEFAULT '',
  auth_type text NOT NULL DEFAULT 'api_key',
  auth_header text NOT NULL DEFAULT 'X-API-Key',
  auth_value_preview text NOT NULL DEFAULT '',
  description text DEFAULT '',
  notes text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.integration_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "integration_configs_admin_select" ON public.integration_configs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "integration_configs_admin_insert" ON public.integration_configs
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "integration_configs_admin_update" ON public.integration_configs
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "integration_configs_admin_delete" ON public.integration_configs
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
