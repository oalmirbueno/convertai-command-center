-- Cofre de senhas e links úteis por cliente
CREATE TABLE public.client_vault (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  category text NOT NULL DEFAULT 'password', -- 'password' | 'link' | 'system'
  title text NOT NULL,
  url text,
  username text,
  password text,
  notes text,
  icon_url text,
  item_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_client_vault_client ON public.client_vault(client_id);

ALTER TABLE public.client_vault ENABLE ROW LEVEL SECURITY;

-- Cliente vê apenas as suas; admin/equipe vê todas
CREATE POLICY client_vault_select ON public.client_vault
FOR SELECT TO authenticated
USING (
  client_id = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'design'::app_role)
  OR has_role(auth.uid(), 'traffic'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
);

-- Apenas admin e equipe podem inserir/editar/excluir (cliente é view-only)
CREATE POLICY client_vault_insert ON public.client_vault
FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'design'::app_role)
  OR has_role(auth.uid(), 'traffic'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
);

CREATE POLICY client_vault_update ON public.client_vault
FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'design'::app_role)
  OR has_role(auth.uid(), 'traffic'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
);

CREATE POLICY client_vault_delete ON public.client_vault
FOR DELETE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'design'::app_role)
  OR has_role(auth.uid(), 'traffic'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
);

CREATE TRIGGER update_client_vault_updated_at
BEFORE UPDATE ON public.client_vault
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();