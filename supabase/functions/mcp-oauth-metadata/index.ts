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

const MCP_VERSION = '1.7.0';
const MCP_PROTOCOL = '2025-06-18';

const ALL_SUPPORTED_SCOPES = [
  // OIDC identity
  'openid', 'email', 'profile',
  // Aceleriq aggregate
  'aceleriq:read', 'aceleriq:write', 'aceleriq:finance',
  // Granular
  'clients:read',
  'projects:read', 'projects:write',
  'tasks:read', 'tasks:write',
  'reports:read', 'reports:write',
  'briefings:read',
  'files:read', 'files:write', 'files:sensitive:read', 'files:archive',
  'workspace:read',
  'contracts:read', 'contracts:write',
  'memory:read', 'memory:propose',
  'admin',
];

async function proxyAuthorizationServerMetadata() {
  const upstream = await fetch(AUTH_SERVER_METADATA, {
    headers: { Accept: 'application/json' },
  });
  const metadata = await upstream.json();
  return {
    ...metadata,
    issuer: AUTH_ISSUER,
    scopes_supported: ALL_SUPPORTED_SCOPES,
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
    scopes_supported: ALL_SUPPORTED_SCOPES,
    resource_documentation: 'https://aceleriq.online/conectar-mcp',
    resource_name: 'Aceleriq OS MCP',
    mcp: {
      transport: 'streamable-http',
      protocol_version: MCP_PROTOCOL,
      endpoint: RESOURCE,
      server_info: {
        name: 'aceleriq-mcp',
        title: 'Aceleriq OS MCP',
        version: MCP_VERSION,
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
      'Cache-Control': 'no-store',
      'Link': `<${AUTH_SERVER_METADATA}>; rel="oauth-authorization-server"`,
    },
  });
});
