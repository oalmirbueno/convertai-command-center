// Aceleriq OS — MCP Server (Streamable HTTP / JSON-RPC 2.0)
// Round 2: foundation only (aceleriq_health, aceleriq_capabilities).
// Bearer auth via public.api_keys. Audit via public.mcp_audit_log.
// Does NOT modify api-gateway or any existing function.

import {
  authenticate,
  hasScope,
  type AuthContext,
  type AuthResult,
} from '../_shared/mcp-auth.ts';
import { auditLog } from '../_shared/mcp-audit.ts';
import {
  canInvoke,
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
import { bridgeStatus } from '../_shared/second-brain-github.ts';

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

  // `initialize` is always public — it advertises the server.
  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
    });
  }

  if (method === 'notifications/initialized' || method === 'initialized') {
    return null; // no response per spec
  }

  if (method === 'ping') {
    return rpcResult(id, {});
  }

  // Everything else requires auth.
  if (!auth.ok) {
    if (isNotification) return null;
    const map: Record<string, string> = {
      missing: 'Missing bearer token',
      invalid: 'Invalid bearer token',
      expired_or_revoked: 'Bearer token expired or revoked',
    };
    return rpcError(id, RpcErrors.unauthorized, map[auth.error.kind] ?? 'Unauthorized');
  }
  const ctx: AuthContext = auth.ctx;

  if (method === 'tools/list') {
    const visible = TOOLS.filter(t => canInvoke(ctx, t)).map(describeTool);
    return rpcResult(id, { tools: visible });
  }

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

    if (!hasScope(ctx, tool.scopes)) {
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
      await auditLog({
        correlationId, toolName: name, origin: ctx.origin, keyId: ctx.keyId,
        scopes: ctx.scopes, input: args,
        success: false, statusCode: 500, durationMs: Date.now() - started,
        errorCode: 'handler_error', errorMessage: message,
      });
      return rpcError(id, RpcErrors.internalError, message);
    }
  }

  if (isNotification) return null;
  return rpcError(id, RpcErrors.methodNotFound, `Method not found: ${method}`);
}

// ─── HTTP entry — Streamable HTTP transport ────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return optionsResponse();

  // GET → discovery document (no auth needed to describe the server).
  if (req.method === 'GET') {
    return jsonResponse({
      ...SERVER_INFO,
      protocolVersion: MCP_PROTOCOL_VERSION,
      transport: 'streamable-http',
      auth: { type: 'bearer', header: 'Authorization', scheme: 'Bearer' },
      endpoints: { rpc: 'POST /' },
      toolCount: TOOLS.length,
      tools: TOOLS.map(t => ({ name: t.name, title: t.title, description: t.description, scopes: t.scopes })),
      secondBrain: bridgeStatus(),
      round: 6,
      serverTime: new Date().toISOString(),
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

  const auth = await authenticate(req);

  const isBatch = Array.isArray(body);
  const messages: JsonRpcRequest[] = (isBatch ? body : [body]) as JsonRpcRequest[];

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
