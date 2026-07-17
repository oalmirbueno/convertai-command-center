// Pure security helpers shared by the legacy MCP auth/audit layers.
// Keep this module free of Deno/Supabase imports so the rules can be covered
// by the regular Vitest suite without requiring a live backend.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET_KEY_RE = /token|secret|password|api[_-]?key|authorization|bearer/i;
const BINARY_KEY_RE = /base64|binary|attachment|file[_-]?data/i;
const DATA_URL_RE = /^data:[^;,]+;base64,/i;
const BEARER_VALUE_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const QUERY_SECRET_RE = /([?&](?:access[_-]?)?(?:token|secret|password|api[_-]?key|authorization|signature|credential)=)[^&#\s]+/gi;
const ASSIGNED_SECRET_RE = /(\b(?:access[_-]?)?(?:token|secret|password|api[_-]?key|authorization)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi;

export const OAUTH_STAFF_SCOPES = [
  'aceleriq:read',
  'aceleriq:write',
  'contracts:read',
  'contracts:write',
  'memory:read',
  'memory:propose',
] as const;

/**
 * The legacy MCP runs service-role-backed handlers. OAuth therefore remains
 * available only to internal staff. Existing staff capabilities are preserved
 * so the current GPT Work connector is not broken by this hardening step.
 */
export function oauthScopesForStaff(isStaff: boolean): string[] | null {
  return isStaff ? [...OAUTH_STAFF_SCOPES] : null;
}

/** `mcp_audit_log.key_id` is a UUID FK to `api_keys`; OAuth principals are not. */
export function persistedAuditKeyId(principalId: string | null | undefined): string | null {
  return principalId && UUID_RE.test(principalId) ? principalId : null;
}

export function auditPrincipalSelector(principalId: string): {
  keyId: string | null;
  principal: string | null;
} {
  const keyId = persistedAuditKeyId(principalId);
  return keyId
    ? { keyId, principal: null }
    : { keyId: null, principal: principalId };
}

export function sanitizeAuditInput(input: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]';
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    if (DATA_URL_RE.test(input)) return '[redacted:base64]';
    const scrubbed = input
      .replace(BEARER_VALUE_RE, 'Bearer [redacted]')
      .replace(QUERY_SECRET_RE, '$1[redacted]')
      .replace(ASSIGNED_SECRET_RE, '$1[redacted]');
    return scrubbed.length > 2000 ? scrubbed.slice(0, 2000) + '…' : scrubbed;
  }
  if (typeof input !== 'object') return input;
  if (Array.isArray(input)) return input.map(value => sanitizeAuditInput(value, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(key)) out[key] = '[redacted]';
    else if (BINARY_KEY_RE.test(key)) out[key] = '[redacted:binary]';
    else out[key] = sanitizeAuditInput(value, depth + 1);
  }
  return out;
}

export function sanitizeAuditError(message: unknown): string | null {
  if (message === null || message === undefined) return null;
  const sanitized = sanitizeAuditInput(String(message));
  const text = typeof sanitized === 'string' ? sanitized : 'Audit error';
  return text.length > 1000 ? text.slice(0, 1000) + '…' : text;
}

export function buildAuditInput(
  input: unknown,
  principalId: string | null | undefined,
  resultRef?: string | null,
): unknown {
  const sanitized = sanitizeAuditInput(input);
  const selector = principalId ? auditPrincipalSelector(principalId) : null;
  const metadata: Record<string, unknown> = {};

  if (selector?.principal) metadata.__principal = selector.principal;
  if (resultRef) metadata.__result_ref = resultRef;
  if (Object.keys(metadata).length === 0) return sanitized;

  const value = sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized as Record<string, unknown>
    : { value: sanitized };
  return { ...value, ...metadata };
}
