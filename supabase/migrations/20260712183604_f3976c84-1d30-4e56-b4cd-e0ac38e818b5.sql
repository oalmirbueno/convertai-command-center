
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS scopes text[] NOT NULL DEFAULT ARRAY['aceleriq:read']::text[],
  ADD COLUMN IF NOT EXISTS origin text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

CREATE INDEX IF NOT EXISTS api_keys_active_idx
  ON public.api_keys (is_active, revoked_at)
  WHERE is_active = true AND revoked_at IS NULL;

DROP FUNCTION IF EXISTS public.validate_api_key(text);

CREATE FUNCTION public.validate_api_key(_key_hash text)
RETURNS TABLE(id uuid, name text, scopes text[], origin text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT k.id, k.name, k.scopes, k.origin
  FROM public.api_keys k
  WHERE k.key_hash = _key_hash
    AND k.is_active = true
    AND k.revoked_at IS NULL
    AND (k.expires_at IS NULL OR k.expires_at > now())
  LIMIT 1
$$;

CREATE TABLE IF NOT EXISTS public.mcp_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  tool_name text NOT NULL,
  origin text,
  key_id uuid REFERENCES public.api_keys(id) ON DELETE SET NULL,
  scopes text[],
  sanitized_input jsonb,
  success boolean NOT NULL DEFAULT false,
  status_code int,
  duration_ms int,
  error_code text,
  error_message text
);

GRANT SELECT ON public.mcp_audit_log TO authenticated;
GRANT ALL ON public.mcp_audit_log TO service_role;

ALTER TABLE public.mcp_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mcp_audit_admin_select" ON public.mcp_audit_log;
CREATE POLICY "mcp_audit_admin_select" ON public.mcp_audit_log
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS mcp_audit_log_created_at_idx ON public.mcp_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_audit_log_tool_name_idx ON public.mcp_audit_log (tool_name);
CREATE INDEX IF NOT EXISTS mcp_audit_log_key_id_idx ON public.mcp_audit_log (key_id);
CREATE INDEX IF NOT EXISTS mcp_audit_log_correlation_idx ON public.mcp_audit_log (correlation_id);
