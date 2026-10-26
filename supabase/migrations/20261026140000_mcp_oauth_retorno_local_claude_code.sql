-- Claude Code conecta no MCP pelo OAuth com retorno local (RFC 8252):
-- http://localhost:3118/callback. A lista de origens só aceitava https, então
-- o login do dono passava no consentimento e o servidor recusava o token
-- (is_allowed_mcp_oauth_client = false) com 401 em toda ferramenta protegida.
--
-- Abre só o retorno local exato: http é aceito apenas para localhost e
-- 127.0.0.1 com porta, e só para as origens cadastradas na tabela. Qualquer
-- outra origem http continua recusada pela checagem e pela função.
-- Autorizado pelo Almir em 26/10/2026.

ALTER TABLE public.mcp_oauth_allowed_redirect_origins
  DROP CONSTRAINT IF EXISTS mcp_oauth_allowed_origin_https;

ALTER TABLE public.mcp_oauth_allowed_redirect_origins
  ADD CONSTRAINT mcp_oauth_allowed_origin_https
    CHECK (
      origin ~ '^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?$'
      OR origin ~ '^http://(localhost|127\.0\.0\.1):[0-9]{1,5}$'
    );

INSERT INTO public.mcp_oauth_allowed_redirect_origins (origin, description)
VALUES
  ('http://localhost:3118', 'Claude Code (retorno local do OAuth), autorizado pelo Almir em 26/10/2026')
ON CONFLICT (origin) DO NOTHING;

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
                 (regexp_match(
                   trim(redirect.uri),
                   '^(https://[^/?#]+|http://(?:localhost|127\.0\.0\.1):[0-9]{1,5})(?:[/?#]|$)'
                 ))[1]
               )
           )
      )
  );
$function$;

COMMENT ON FUNCTION public.is_allowed_mcp_oauth_client(uuid) IS
  'Checks that an active public OAuth client uses only explicitly trusted redirect origins (https, or loopback http listed in the table).';

REVOKE ALL ON FUNCTION public.is_allowed_mcp_oauth_client(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_allowed_mcp_oauth_client(uuid) TO service_role;
