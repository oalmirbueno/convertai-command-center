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

export type OAuthAuthErrorKind = 'missing' | 'invalid' | 'expired_or_revoked';

export function shouldUseOAuthToolChallenge(
  errorKind: OAuthAuthErrorKind,
  methods: readonly string[],
): boolean {
  return errorKind === 'missing'
    && methods.length > 0
    && methods.every(method => method === 'tools/call');
}

export function validateOAuthJwtClaims(
  claims: Record<string, unknown> | null | undefined,
  issuer: string,
  acceptedAudience = 'authenticated',
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!claims || claims.iss !== issuer) return false;

  const clientId = typeof claims.client_id === 'string' ? claims.client_id : '';
  if (!UUID_RE.test(clientId)) return false;

  const expiresAt = typeof claims.exp === 'number' ? claims.exp : Number.NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= nowSeconds) return false;

  const notBefore = typeof claims.nbf === 'number' ? claims.nbf : null;
  if (notBefore !== null && notBefore > nowSeconds + 30) return false;

  const issuedAt = typeof claims.iat === 'number' ? claims.iat : null;
  if (issuedAt !== null && issuedAt > nowSeconds + 60) return false;

  const audiences = Array.isArray(claims.aud)
    ? claims.aud.filter((value): value is string => typeof value === 'string')
    : typeof claims.aud === 'string'
      ? [claims.aud]
      : [];
  return audiences.includes(acceptedAudience);
}

export const OAUTH_STAFF_SCOPES = [
  'aceleriq:read',
  'aceleriq:write',
  'clients:read',
  'projects:read',
  'projects:write',
  'tasks:read',
  'tasks:write',
  'editorial:read',
  'editorial:write',
  'reports:read',
  'reports:write',
  'briefings:read',
  'files:read',
  'files:write',
  'workspace:read',
  'contracts:read',
  'contracts:write',
  'memory:read',
  'memory:propose',
] as const;

// The legacy MCP executes with service_role. A restricted principal may only
// call a private tool after that handler has an explicit client boundary. New
// private tools are denied by default until they are added here and covered by
// a scope test. This prevents a future service from silently reintroducing a
// cross-client access path.
export const CLIENT_SCOPED_LEGACY_TOOLS = [
  'aceleriq_list_clients',
  'aceleriq_get_client_context',
  'aceleriq_list_projects',
  'aceleriq_get_project',
  'aceleriq_list_tasks',
  'aceleriq_list_editorial_calendar',
  'aceleriq_create_task',
  'aceleriq_create_editorial_item',
  'aceleriq_update_task',
  'aceleriq_complete_task',
  'aceleriq_create_report_draft',
  'aceleriq_update_project',
] as const;

const CLIENT_SCOPED_LEGACY_TOOL_SET = new Set<string>(CLIENT_SCOPED_LEGACY_TOOLS);

// These handlers never query service_role-backed tenant tables. Their own
// GitHub bridge scopes and path allowlists remain the authorization boundary,
// so client assignments must not hide them from existing Work connectors.
export const GLOBAL_SAFE_LEGACY_TOOLS = [
  'memory_get_context',
  'memory_search',
  'memory_fetch',
  'memory_list_pending_proposals',
  'memory_get_pulse',
  'memory_recent_commits',
  'memory_propose_update',
] as const;

const GLOBAL_SAFE_LEGACY_TOOL_SET = new Set<string>(GLOBAL_SAFE_LEGACY_TOOLS);

export function dataScopeAllowsTool(
  scope: { unrestricted: boolean },
  toolName: string,
  isPublic = false,
): boolean {
  return isPublic
    || scope.unrestricted
    || CLIENT_SCOPED_LEGACY_TOOL_SET.has(toolName)
    || GLOBAL_SAFE_LEGACY_TOOL_SET.has(toolName);
}

/**
 * The legacy MCP runs service-role-backed handlers. OAuth therefore remains
 * available only to internal staff. Existing staff capabilities are preserved
 * so the current GPT Work connector is not broken by this hardening step.
 */
function flattenClaimedScopes(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/[\s,]+/).filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value.flatMap(flattenClaimedScopes);
}

/**
 * Supabase OAuth JWTs normally carry only OIDC scopes unless the project adds
 * application scopes through a Custom Access Token Hook. OIDC-only claims
 * preserve the existing staff grant. As soon as at least one MCP application
 * scope is present, intersect with the server allowlist so read-only consent
 * cannot become a write grant inside this service-role-backed legacy server.
 */
export function oauthScopesForStaff(
  isStaff: boolean,
  claimedScopes?: unknown,
  isAdmin = false,
): string[] | null {
  if (!isStaff) return null;
  if (claimedScopes === undefined) return [...OAUTH_STAFF_SCOPES];
  const claimed = new Set(flattenClaimedScopes(claimedScopes));
  const hasApplicationScope = [...claimed].some(scope =>
    /^(?:aceleriq|clients|projects|tasks|editorial|reports|briefings|files|workspace|contracts|memory):/.test(scope)
    || scope === 'admin'
  );
  if (!hasApplicationScope) return [...OAUTH_STAFF_SCOPES];
  const allowed: readonly string[] = isAdmin
    ? [...OAUTH_STAFF_SCOPES, 'admin']
    : OAUTH_STAFF_SCOPES;
  return allowed.filter(scope => claimed.has(scope));
}

export function dataScopeAllowsClient(
  scope: { unrestricted: boolean; clientIds: readonly string[] },
  clientId: string,
): boolean {
  return scope.unrestricted || scope.clientIds.includes(clientId);
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
