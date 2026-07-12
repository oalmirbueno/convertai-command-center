
CREATE TABLE public.mcp_connection_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text UNIQUE NOT NULL,
  name text NOT NULL,
  agent_type text NOT NULL,
  origin text NOT NULL,
  auth_mode text NOT NULL DEFAULT 'oauth' CHECK (auth_mode IN ('oauth','bearer')),
  scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  allow_operational_write boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_connected_at timestamptz,
  last_used_at timestamptz,
  connection_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','revoked','expired')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_mcp_connection_profiles_created_by ON public.mcp_connection_profiles(created_by);
CREATE INDEX idx_mcp_connection_profiles_status ON public.mcp_connection_profiles(status);
CREATE INDEX idx_mcp_connection_profiles_agent_type ON public.mcp_connection_profiles(agent_type);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mcp_connection_profiles TO authenticated;
GRANT ALL ON public.mcp_connection_profiles TO service_role;

ALTER TABLE public.mcp_connection_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all connection profiles"
  ON public.mcp_connection_profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can create connection profiles"
  ON public.mcp_connection_profiles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND created_by = auth.uid());

CREATE POLICY "Admins can update connection profiles"
  ON public.mcp_connection_profiles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete connection profiles"
  ON public.mcp_connection_profiles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_mcp_connection_profiles_updated_at
  BEFORE UPDATE ON public.mcp_connection_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
