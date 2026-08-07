// Aceleriq OS — MCP Server (Streamable HTTP / JSON-RPC 2.0)
// Round 2: foundation only (aceleriq_health, aceleriq_capabilities).
// Bearer auth via public.api_keys. Audit via public.mcp_audit_log.
// Does NOT modify api-gateway or any existing function.

import {
  authenticate,
  DataScopeError,
  hasScope,
  type AuthContext,
  type AuthResult,
} from '../_shared/mcp-auth.ts';
import { auditLog } from '../_shared/mcp-audit.ts';
import { shouldUseOAuthToolChallenge } from '../_shared/mcp-security.ts';
import {
  canInvoke,
  canUseToolWithDataScope,
  describeTool,
  SERVER_INFO,
  TOOL_MAP,
  TOOLS,
} from '../_shared/mcp-tools.ts';
import {
  corsHeaders,
  jsonResponse,
  MCP_PROTOCOL_VERSION,
  optionsResponse,
  prefersSse,
  rpcError,
  RpcErrors,
  rpcResult,
  sseResponse,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from '../_shared/mcp-response.ts';
import { bridgeStatusPublic } from '../_shared/second-brain-github.ts';

// ─── OAuth / Protected Resource metadata ──────────────────────
const PROJECT_REF = 'gicbrgagstyvbaaumprj';
const RESOURCE_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/mcp-server`;
const PRM_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/mcp-oauth-metadata`;
const AUTH_ISSUER = `https://${PROJECT_REF}.supabase.co/auth/v1`;
const AUTHORIZATION_SERVER_METADATA = `${AUTH_ISSUER}/.well-known/oauth-authorization-server`;
const WWW_AUTH_HEADER = `Bearer resource_metadata="${PRM_URL}"`;
const WWW_AUTH_TOOL_HEADER = `${WWW_AUTH_HEADER}, error="invalid_token", error_description="OAuth authorization required"`;

// Supabase OAuth currently issues only standard OIDC scopes. Application
// permissions are derived server-side after the user and tenant scope are
// verified, so they must not be advertised as OAuth scopes to ChatGPT.
const OAUTH_SCOPES = ['openid', 'email', 'profile'];
const INTERNAL_MCP_SCOPES = [
  'aceleriq:read','aceleriq:write','aceleriq:finance',
  'clients:read','projects:read','projects:write','tasks:read','tasks:write',
  'editorial:read','editorial:write',
  'reports:read','reports:write','briefings:read',
  'files:read','files:write','files:sensitive:read','files:archive',
  'workspace:read','contracts:read','contracts:write',
  'memory:read','memory:propose','admin',
];

function protectedResourceMetadata() {
  return {
    resource: RESOURCE_URL,
    authorization_servers: [AUTH_ISSUER],
    bearer_methods_supported: ['header'],
    scopes_supported: OAUTH_SCOPES,
    mcp_internal_scopes_supported: INTERNAL_MCP_SCOPES,
    resource_name: 'Aceleriq OS MCP',
    resource_documentation: 'https://aceleriq.online/conectar-mcp',
    mcp: {
      transport: 'streamable-http',
      protocol_version: MCP_PROTOCOL_VERSION,
      server_info: SERVER_INFO,
      endpoint: RESOURCE_URL,
    },
  };
}

function oauthChallengeBody() {
  return {
    error: 'unauthorized',
    error_description: 'OAuth bearer token required for protected MCP tool execution.',
    resource_metadata: PRM_URL,
    authorization_servers: [AUTH_ISSUER],
    authorization_server_metadata: AUTHORIZATION_SERVER_METADATA,
  };
}

function oauthChallengeResponse(body: unknown, status = 401) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'WWW-Authenticate': WWW_AUTH_HEADER,
      'Link': `<${PRM_URL}>; rel="oauth-protected-resource", <${AUTHORIZATION_SERVER_METADATA}>; rel="oauth-authorization-server"`,
      'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id, Link',
    },
  });
}

function oauthToolChallenge(id: JsonRpcId): JsonRpcResponse {
  return rpcResult(id, {
    content: [{
      type: 'text',
      text: 'Authentication required: connect the Aceleriq OS account to continue.',
    }],
    _meta: {
      'mcp/www_authenticate': [WWW_AUTH_TOOL_HEADER],
    },
    isError: true,
  });
}

function publicAuthContext(): AuthContext {
  return {
    keyId: 'public:discovery',
    keyName: 'MCP discovery',
    scopes: [],
    origin: 'public-discovery',
    dataScope: {
      unrestricted: false,
      clientIds: [],
      principalUserId: null,
      source: 'public',
    },
  };
}

function isPublicRpc(msg: JsonRpcRequest): boolean {
  const method = String(msg?.method ?? '');
  if (method === 'initialize' || method === 'notifications/initialized' || method === 'initialized' || method === 'ping') {
    return true;
  }
  if (method === 'tools/list') return true;
  if (method === 'tools/call') {
    const params = (msg?.params ?? {}) as Record<string, unknown>;
    const name = String((params?.name as string) ?? '');
    const tool = TOOL_MAP.get(name);
    return Boolean(tool && tool.scopes.length === 0);
  }
  return false;
}

// ─── JSON-RPC dispatch ────────────────────────────────────────
async function dispatch(
  msg: JsonRpcRequest,
  auth: AuthResult,
): Promise<JsonRpcResponse | null> {
  const id: JsonRpcId = (msg?.id ?? null) as JsonRpcId;
  const method = String(msg?.method ?? '');
  const params = (msg?.params ?? {}) as Record<string, unknown>;

  // Notifications carry no id and expect no response body.
  const isNotification = msg?.id === undefined || msg?.id === null;

  // `initialize` and `tools/list` are intentionally discoverable without a
  // bearer token. Protected tool execution still receives a real HTTP 401
  // challenge before any private data is touched.
  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: true } },
      serverInfo: SERVER_INFO,
      instructions:
        'Use tools/list to inspect Aceleriq tools. Tools with required scopes need OAuth Bearer authorization before tools/call.',
    });
  }

  if (method === 'notifications/initialized' || method === 'initialized') {
    return null; // no response per spec
  }

  if (method === 'ping') {
    return rpcResult(id, {});
  }

  if (method === 'tools/list') {
    const visible = auth.ok
      ? TOOLS.filter(t => canInvoke(auth.ctx, t) && canUseToolWithDataScope(auth.ctx, t))
      : TOOLS;
    return rpcResult(id, { tools: visible.map(describeTool) });
  }

  // Everything else requires auth, except explicit public foundation tools.
  if (!auth.ok) {
    if (method === 'tools/call') {
      const name = String((params?.name as string) ?? '');
      const publicTool = TOOL_MAP.get(name);
      if (publicTool && publicTool.scopes.length === 0) {
        const publicCtx = publicAuthContext();
        try {
          const result = await publicTool.handler((params?.arguments as unknown) ?? {}, publicCtx);
          return rpcResult(id, {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent: result,
          });
        } catch (e) {
          return rpcError(id, RpcErrors.internalError, (e as Error)?.message ?? String(e));
        }
      }
    }
    if (isNotification) return null;
    return rpcError(id, RpcErrors.unauthorized, 'OAuth authorization required');
  }
  const ctx: AuthContext = auth.ctx;

  if (method === 'tools/call') {
    const name = String((params?.name as string) ?? '');
    const args = (params?.arguments as unknown) ?? {};
    const tool = TOOL_MAP.get(name);
    const correlationId = crypto.randomUUID();
    const started = Date.now();

    if (!tool) {
      await auditLog({
        correlationId, toolName: name || '(unknown)', origin: ctx.origin,
        keyId: ctx.keyId, scopes: ctx.scopes, input: args,
        success: false, statusCode: 404, durationMs: Date.now() - started,
        errorCode: 'tool_not_found', errorMessage: `Unknown tool: ${name}`,
      });
      return rpcError(id, RpcErrors.toolNotFound, `Unknown tool: ${name}`);
    }

    if (!canInvoke(ctx, tool)) {
      await auditLog({
        correlationId, toolName: name, origin: ctx.origin, keyId: ctx.keyId,
        scopes: ctx.scopes, input: args,
        success: false, statusCode: 403, durationMs: Date.now() - started,
        errorCode: 'scope_denied',
        errorMessage: `Requires one of: ${tool.scopes.join(', ')}`,
      });
      return rpcError(
        id,
        RpcErrors.forbidden,
        `Insufficient scope. Required: ${tool.scopes.join(' | ')}`,
      );
    }

    // service_role bypasses database RLS in the legacy server. Restricted
    // principals may therefore execute only handlers that explicitly resolve
    // and enforce their client assignment. Unhardened private tools fail
    // closed; admin/unrestricted principals preserve the existing surface.
    if (!canUseToolWithDataScope(ctx, tool)) {
      await auditLog({
        correlationId, toolName: name, origin: ctx.origin, keyId: ctx.keyId,
        scopes: ctx.scopes, input: args,
        success: false, statusCode: 403, durationMs: Date.now() - started,
        errorCode: 'data_scope_denied',
        errorMessage: 'Tool is unavailable for restricted client scope',
      });
      return rpcError(
        id,
        RpcErrors.forbidden,
        'Tool is unavailable for this restricted client scope',
      );
    }

    try {
      const resultRefHolder: { value?: string } = {};
      const callCtx: AuthContext = { ...ctx, correlationId, resultRefHolder };
      const result = await tool.handler(args, callCtx);
      await auditLog({
        correlationId, toolName: name, origin: ctx.origin, keyId: ctx.keyId,
        scopes: ctx.scopes, input: args,
        success: true, statusCode: 200, durationMs: Date.now() - started,
        resultRef: resultRefHolder.value ?? null,
      });
      return rpcResult(id, {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      });
    } catch (e) {
      const message = (e as Error)?.message ?? String(e);
      const dataScopeDenied = e instanceof DataScopeError
        || message.startsWith('write:forbidden')
        || message.includes('outside this MCP principal data scope');
      await auditLog({
        correlationId, toolName: name, origin: ctx.origin, keyId: ctx.keyId,
        scopes: ctx.scopes, input: args,
        success: false, statusCode: dataScopeDenied ? 403 : 500,
        durationMs: Date.now() - started,
        errorCode: dataScopeDenied ? 'data_scope_denied' : 'handler_error',
        errorMessage: message,
      });
      return rpcError(
        id,
        dataScopeDenied ? RpcErrors.forbidden : RpcErrors.internalError,
        dataScopeDenied ? 'Resource is outside this restricted client scope' : message,
      );
    }
  }

  if (isNotification) return null;
  return rpcError(id, RpcErrors.methodNotFound, `Method not found: ${method}`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return optionsResponse();

  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === 'GET' && path.endsWith('/.well-known/oauth-protected-resource')) {
    return jsonResponse(protectedResourceMetadata(), 200, {
      'Cache-Control': 'no-store',
      'Link': `<${AUTHORIZATION_SERVER_METADATA}>; rel="oauth-authorization-server"`,
    });
  }

  // GET → OAuth challenge (RFC 9728). Um GET sem Authorization precisa
  // responder 401 com WWW-Authenticate para que clientes como ChatGPT Work
  // descubram o Protected Resource Metadata. Um 200 com o mesmo header é
  // ignorado pelo cliente e leva ao erro "MCP server does not implement OAuth".
  if (req.method === 'GET') {
    const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization');
    if (!authHeader) {
      return oauthChallengeResponse(oauthChallengeBody());
    }
    return jsonResponse({
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
      status: 'ok',
      protocolVersion: MCP_PROTOCOL_VERSION,
      transport: 'streamable-http',
      auth: {
        type: 'oauth2',
        scheme: 'Bearer',
        resource_metadata: PRM_URL,
        authorization_servers: [AUTH_ISSUER],
        authorization_server_metadata: AUTHORIZATION_SERVER_METADATA,
      },
      toolCount: TOOLS.length,
      tools: TOOLS.map(t => ({ name: t.name, title: t.title, requiredScopes: t.scopes })),
      secondBrain: bridgeStatusPublic(),
      serverTime: new Date().toISOString(),
    }, 200, {
      'Link': `<${PRM_URL}>; rel="oauth-protected-resource", <${AUTHORIZATION_SERVER_METADATA}>; rel="oauth-authorization-server"`,
      'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id, Link',
    });
  }


  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(rpcError(null, RpcErrors.parseError, 'Parse error'), 400);
  }

  const isBatch = Array.isArray(body);
  const messages: JsonRpcRequest[] = (isBatch ? body : [body]) as JsonRpcRequest[];
  const auth = await authenticate(req);

  // Discovery methods are public. A missing bearer on tools/call returns the
  // MCP result-level challenge ChatGPT needs to open OAuth. Invalid, expired
  // or revoked credentials remain real HTTP 401 responses.
  if (!auth.ok) {
    const allPublic = messages.every(isPublicRpc);
    if (!allPublic) {
      const toolChallengeOnly = shouldUseOAuthToolChallenge(
        auth.error.kind,
        messages.map(m => String(m?.method ?? '')),
      );
      const payload = isBatch
        ? messages.map(m => toolChallengeOnly && m?.method === 'tools/call'
          ? oauthToolChallenge(m?.id ?? null)
          : rpcError(m?.id ?? null, RpcErrors.unauthorized, 'OAuth authorization required'))
        : toolChallengeOnly && messages[0]?.method === 'tools/call'
          ? oauthToolChallenge(messages[0]?.id ?? null)
          : rpcError(messages[0]?.id ?? null, RpcErrors.unauthorized, 'OAuth authorization required');
      return new Response(JSON.stringify(payload), {
        // MCP tool errors are successful JSON-RPC transport responses so the
        // host reads result._meta and launches OAuth. Non-tool requests retain
        // the RFC 9728 HTTP challenge status.
        status: toolChallengeOnly ? 200 : 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'WWW-Authenticate': WWW_AUTH_TOOL_HEADER,
          'Link': `<${PRM_URL}>; rel="oauth-protected-resource", <${AUTHORIZATION_SERVER_METADATA}>; rel="oauth-authorization-server"`,
          'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id, Link',
        },
      });
    }
  }

  const responses: JsonRpcResponse[] = [];
  for (const msg of messages) {
    const r = await dispatch(msg, auth);
    if (r) responses.push(r);
  }

  // All-notifications batch → 202 Accepted, no body (spec).
  if (responses.length === 0) {
    return new Response(null, { status: 202, headers: corsHeaders });
  }

  const payload = isBatch ? responses : responses[0];

  if (prefersSse(req)) {
    return sseResponse(payload);
  }
  return jsonResponse(payload);
});
