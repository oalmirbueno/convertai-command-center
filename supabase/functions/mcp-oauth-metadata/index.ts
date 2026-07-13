// OAuth 2.0 Protected Resource Metadata (RFC 9728) para o MCP server.
// Servido em edge function porque o Supabase não permite hospedar
// /.well-known/* na raiz do host. O `mcp-server` aponta clientes MCP
// para esta URL via header WWW-Authenticate.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, Mcp-Protocol-Version, mcp-session-id, Mcp-Session-Id, accept',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id, Link',
};

const PROJECT_REF = 'gicbrgagstyvbaaumprj';
const AUTH_ISSUER = `https://${PROJECT_REF}.supabase.co/auth/v1`;
const RESOURCE = `https://${PROJECT_REF}.supabase.co/functions/v1/mcp-server`;
const AUTH_SERVER_METADATA = `${AUTH_ISSUER}/.well-known/oauth-authorization-server`;

async function proxyAuthorizationServerMetadata() {
  const upstream = await fetch(AUTH_SERVER_METADATA, {
    headers: { Accept: 'application/json' },
  });
  const metadata = await upstream.json();
  return {
    ...metadata,
    issuer: AUTH_ISSUER,
    scopes_supported: ['openid', 'profile', 'email', 'phone'],
    code_challenge_methods_supported: metadata.code_challenge_methods_supported ?? ['S256'],
    token_endpoint_auth_methods_supported: metadata.token_endpoint_auth_methods_supported ?? ['none'],
    mcp_resource: RESOURCE,
  };
}

function protectedResourceMetadata() {
  return {
    resource: RESOURCE,
    authorization_servers: [AUTH_ISSUER],
    bearer_methods_supported: ['header'],
    // Supabase/Lovable Auth OAuth scopes are identity scopes. Aceleriq tool
    // capabilities remain advertised per tool as `requiredScopes` and enforced
    // server-side after token validation.
    scopes_supported: ['openid', 'email', 'profile'],
    resource_documentation: 'https://aceleriq.online/conectar-mcp',
    resource_name: 'Aceleriq OS MCP',
    mcp: {
      transport: 'streamable-http',
      protocol_version: '2025-06-18',
      endpoint: RESOURCE,
      server_info: {
        name: 'aceleriq-mcp',
        title: 'Aceleriq OS MCP',
        version: '1.2.0',
      },
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: CORS });
  }

  const url = new URL(req.url);
  const path = url.pathname;
  const isAuthServerMetadata = path.endsWith('/.well-known/oauth-authorization-server') || url.searchParams.get('type') === 'authorization-server';
  const body = isAuthServerMetadata
    ? await proxyAuthorizationServerMetadata()
    : protectedResourceMetadata();

  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
      'Link': `<${AUTH_SERVER_METADATA}>; rel="oauth-authorization-server"`,
    },
  });
});
