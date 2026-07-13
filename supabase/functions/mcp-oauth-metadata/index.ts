// OAuth 2.0 Protected Resource Metadata (RFC 9728) para o MCP server.
// Servido em edge function porque o Supabase não permite hospedar
// /.well-known/* na raiz do host. O `mcp-server` aponta clientes MCP
// para esta URL via header WWW-Authenticate.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id, Link',
};

const PROJECT_REF = 'gicbrgagstyvbaaumprj';
const AUTH_ISSUER = `https://${PROJECT_REF}.supabase.co/auth/v1`;
const RESOURCE = `https://${PROJECT_REF}.supabase.co/functions/v1/mcp-server`;

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: CORS });
  }
  const body = {
    resource: RESOURCE,
    authorization_servers: [AUTH_ISSUER],
    bearer_methods_supported: ['header'],
    // Only advertise scopes supported by the Supabase authorization server
    // (see /.well-known/oauth-authorization-server). Custom scopes like
    // `aceleriq:read` cause the authorize step to fail with invalid_scope
    // in strict clients such as ChatGPT Work.
    scopes_supported: ['openid', 'email', 'profile'],
    resource_documentation: 'https://aceleriq.online/conectar-mcp',
    resource_name: 'Aceleriq OS MCP',
  };
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    },
  });
});
