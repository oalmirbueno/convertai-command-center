// Shared HTTP / JSON-RPC response helpers for the MCP server.
// Keeps CORS + Streamable HTTP framing in one place so tool code stays clean.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, mcp-protocol-version, Mcp-Protocol-Version, mcp-session-id, Mcp-Session-Id, accept',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id, Link',
};

export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = new Set([
  MCP_PROTOCOL_VERSION,
  '2025-03-26',
]);

export const DEFAULT_MCP_ALLOWED_ORIGINS = [
  'https://chatgpt.com',
  'https://chat.openai.com',
] as const;

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

export interface InvalidJsonRpcRequest {
  ok: false;
  id: JsonRpcId;
  code: typeof RpcErrors.invalidRequest | typeof RpcErrors.invalidParams;
  message: string;
}

export type JsonRpcRequestValidation =
  | { ok: true; request: JsonRpcRequest }
  | InvalidJsonRpcRequest;

// Inline MCP file tools accept up to 10 MiB before base64 encoding. A 16 MiB
// transport ceiling preserves that contract while bounding unauthenticated
// parsing and leaving room for the JSON-RPC envelope.
export const MAX_MCP_REQUEST_BODY_BYTES = 16 * 1024 * 1024;

export class McpRequestBodyTooLargeError extends Error {
  constructor() {
    super('MCP request body exceeds the allowed limit');
    this.name = 'McpRequestBodyTooLargeError';
  }
}

export async function readMcpJsonBody(
  req: Request,
  maxBytes = MAX_MCP_REQUEST_BODY_BYTES,
): Promise<unknown> {
  const declaredHeader = req.headers.get('content-length');
  if (declaredHeader !== null) {
    const normalized = declaredHeader.trim();
    const declared = Number(normalized);
    if (!/^\d+$/.test(normalized) || !Number.isSafeInteger(declared)) {
      throw new SyntaxError('Invalid Content-Length');
    }
    if (declared > maxBytes) throw new McpRequestBodyTooLargeError();
  }

  if (!req.body) throw new SyntaxError('Missing request body');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the size classification even when the transport cannot
          // be cancelled cleanly after the limit has already been exceeded.
        }
        throw new McpRequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function normalizeHttpOrigin(value: string): string | null {
  const candidate = value.trim();
  if (!candidate || candidate === 'null' || candidate.includes(',')) return null;

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Builds an exact origin allowlist. Environment entries extend the safe
 * defaults; wildcard and malformed origins are ignored rather than weakening
 * the transport boundary.
 */
export function resolveMcpAllowedOrigins(
  configured: string | undefined,
  canonicalUrls: readonly string[] = [],
): ReadonlySet<string> {
  const allowed = new Set<string>(DEFAULT_MCP_ALLOWED_ORIGINS);
  for (const candidate of (configured ?? '').split(',')) {
    const origin = normalizeHttpOrigin(candidate);
    if (origin) allowed.add(origin);
  }

  for (const candidate of canonicalUrls) {
    try {
      const url = new URL(candidate);
      if (url.protocol === 'https:' || url.protocol === 'http:') allowed.add(url.origin);
    } catch {
      // Runtime configuration validates canonical URLs separately. Keep this
      // helper fail-closed when used directly in tests or other transports.
    }
  }
  return allowed;
}

/**
 * Native/server-to-server MCP clients commonly omit Origin and remain valid.
 * Browser requests must be same-origin or match the explicit exact allowlist.
 */
export function isMcpOriginAllowed(
  req: Request,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  const header = req.headers.get('origin');
  if (header === null) return true;

  const origin = normalizeHttpOrigin(header);
  if (!origin) return false;

  try {
    return origin === new URL(req.url).origin || allowedOrigins.has(origin);
  } catch {
    return false;
  }
}

function acceptedResponseTypes(req: Request): { json: boolean; sse: boolean } {
  const ranges = (req.headers.get('accept') ?? '')
    .toLowerCase()
    .split(',')
    .map(part => part.split(';', 1)[0].trim())
    .filter(Boolean);

  const wildcard = ranges.includes('*/*');
  return {
    json: wildcard || ranges.includes('application/*') || ranges.includes('application/json'),
    sse: wildcard || ranges.includes('text/*') || ranges.includes('text/event-stream'),
  };
}

export function acceptsMcpResponse(req: Request): boolean {
  const accepted = acceptedResponseTypes(req);
  return accepted.json || accepted.sse;
}

/** Missing means the Streamable HTTP compatibility baseline (2025-03-26). */
export function isMcpProtocolVersionSupported(req: Request): boolean {
  const version = req.headers.get('mcp-protocol-version');
  return version === null || MCP_SUPPORTED_PROTOCOL_VERSIONS.has(version.trim());
}

function requestIdForError(value: Record<string, unknown>): JsonRpcId {
  if (!Object.prototype.hasOwnProperty.call(value, 'id')) return null;
  const id = value.id;
  if (id === null) return null;
  if (typeof id === 'string') return id;
  if (typeof id === 'number' && Number.isFinite(id)) return id;
  return null;
}

/** Validates the single MCP request/notification envelope accepted by POST. */
export function validateJsonRpcRequest(body: unknown): JsonRpcRequestValidation {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      id: null,
      code: RpcErrors.invalidRequest,
      message: Array.isArray(body)
        ? 'JSON-RPC batch requests are not supported'
        : 'Invalid JSON-RPC request envelope',
    };
  }

  const value = body as Record<string, unknown>;
  const id = requestIdForError(value);
  if (value.jsonrpc !== '2.0') {
    return { ok: false, id, code: RpcErrors.invalidRequest, message: 'jsonrpc must be "2.0"' };
  }
  if (typeof value.method !== 'string' || value.method.trim().length === 0) {
    return { ok: false, id, code: RpcErrors.invalidRequest, message: 'method must be a non-empty string' };
  }
  if (Object.prototype.hasOwnProperty.call(value, 'id')) {
    const validId = value.id === null
      || typeof value.id === 'string'
      || (typeof value.id === 'number' && Number.isFinite(value.id));
    if (!validId) {
      return { ok: false, id: null, code: RpcErrors.invalidRequest, message: 'id must be a string, number, or null' };
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, 'params')) {
    if (value.params === null || typeof value.params !== 'object' || Array.isArray(value.params)) {
      return { ok: false, id, code: RpcErrors.invalidParams, message: 'params must be an object when provided' };
    }
  }

  return { ok: true, request: value as unknown as JsonRpcRequest };
}

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
  const items = Array.isArray(payload) ? payload : [payload];
  const body = items.map(item => `event: message\ndata: ${JSON.stringify(item)}\n\n`).join('');
  return new Response(body, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      ...extra,
    },
  });
}

// Decide whether the caller wants SSE or JSON per Streamable HTTP.
export function prefersSse(req: Request): boolean {
  const accepted = acceptedResponseTypes(req);
  // Streamable HTTP clients normally send both media types. Returning JSON for
  // request/response methods keeps strict external scanners (ChatGPT Work) from
  // missing initialize/tools-list payloads while still allowing SSE-only callers.
  return accepted.sse && !accepted.json;
}
