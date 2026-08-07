-- Bind MCP OAuth tokens to registered clients whose redirect origins are
-- explicitly trusted. This closes the gap where any dynamically registered
-- OAuth client UUID could otherwise obtain a project-wide Supabase token.

CREATE TABLE IF NOT EXISTS public.mcp_oauth_allowed_redirect_origins (
  origin text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mcp_oauth_allowed_origin_https
    CHECK (origin ~ '^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?$')
);

COMMENT ON TABLE public.mcp_oauth_allowed_redirect_origins IS
  'Exact OAuth redirect origins allowed to obtain Aceleriq MCP access.';

INSERT INTO public.mcp_oauth_allowed_redirect_origins (origin, description)
VALUES
  ('https://chatgpt.com', 'ChatGPT connectors'),
  ('https://chat.openai.com', 'Legacy ChatGPT connector callback')
ON CONFLICT (origin) DO NOTHING;

ALTER TABLE public.mcp_oauth_allowed_redirect_origins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mcp_oauth_allowed_redirect_origins
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.mcp_oauth_allowed_redirect_origins TO service_role;

CREATE OR REPLACE FUNCTION public.is_allowed_mcp_oauth_client(_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM auth.oauth_clients AS client
    WHERE client.id = _client_id
      AND client.deleted_at IS NULL
      AND client.client_type::text = 'public'
      AND client.token_endpoint_auth_method = 'none'
      AND client.redirect_uris <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM regexp_split_to_table(client.redirect_uris, '\s*,\s*') AS redirect(uri)
        WHERE trim(redirect.uri) = ''
           OR NOT EXISTS (
             SELECT 1
             FROM public.mcp_oauth_allowed_redirect_origins AS allowed
             WHERE allowed.enabled
               AND lower(allowed.origin) = lower(
                 (regexp_match(trim(redirect.uri), '^(https://[^/?#]+)'))[1]
               )
           )
      )
  );
$function$;

COMMENT ON FUNCTION public.is_allowed_mcp_oauth_client(uuid) IS
  'Checks that an active public OAuth client uses only explicitly trusted redirect origins.';

REVOKE ALL ON FUNCTION public.is_allowed_mcp_oauth_client(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_allowed_mcp_oauth_client(uuid) TO service_role;
