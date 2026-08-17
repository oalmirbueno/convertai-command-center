// OAuth 2.0 Protected Resource Metadata (RFC 9728) para o MCP server.
// Servido em edge function porque o Supabase não permite hospedar
// /.well-known/* na raiz do host. O `mcp-server` aponta clientes MCP
// para esta URL via header WWW-Authenticate.

import { getMcpRuntimeConfig } from '../_shared/mcp-runtime.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, Mcp-Protocol-Version, mcp-session-id, Mcp-Session-Id, accept',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id, Link',
};

const {
  authIssuer: AUTH_ISSUER,
  resourceUrl: RESOURCE,
  appPublicUrl: APP_PUBLIC_URL,
  authorizationServerMetadataUrl: AUTH_SERVER_METADATA,
} = getMcpRuntimeConfig();

const MCP_VERSION = '1.9.0';
const MCP_PROTOCOL = '2025-06-18';

const OAUTH_SCOPES = ['openid', 'email', 'profile'];
const INTERNAL_MCP_SCOPES = [
  'aceleriq:read', 'aceleriq:write', 'aceleriq:finance',
  // Granular
  'clients:read',
  'projects:read', 'projects:write',
  'tasks:read', 'tasks:write',
  'editorial:read', 'editorial:write',
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
    scopes_supported: OAUTH_SCOPES,
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
    scopes_supported: OAUTH_SCOPES,
    mcp_internal_scopes_supported: INTERNAL_MCP_SCOPES,
    resource_documentation: `${APP_PUBLIC_URL}/conectar-mcp`,
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
