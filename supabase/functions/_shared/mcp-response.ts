// Shared HTTP / JSON-RPC response helpers for the MCP server.
// Keeps CORS + Streamable HTTP framing in one place so tool code stays clean.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, mcp-protocol-version, mcp-session-id, accept',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id, Link',
};

export const MCP_PROTOCOL_VERSION = '2025-06-18';

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// JSON-RPC error codes (spec + MCP extensions)
export const RpcErrors = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  // MCP-domain
  unauthorized: -32001,
  forbidden: -32003,
  toolNotFound: -32004,
} as const;

export function rpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

export function rpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } };
}

export function jsonResponse(body: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extra },
  });
}

export function optionsResponse(): Response {
  return new Response(null, { headers: corsHeaders });
}

// Streamable HTTP: build an SSE payload for a single JSON-RPC response.
// Spec: each event is `event: message` + `data: <json>\n\n`.
export function sseResponse(payload: unknown, extra: HeadersInit = {}): Response {
  const body = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
  return new Response(body, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      ...extra,
    },
  });
}

// Decide whether the caller wants SSE or JSON per Streamable HTTP.
export function prefersSse(req: Request): boolean {
  const accept = (req.headers.get('accept') ?? '').toLowerCase();
  if (!accept) return false;
  // If both are listed, prefer SSE only when explicitly asked for.
  return accept.includes('text/event-stream');
}
