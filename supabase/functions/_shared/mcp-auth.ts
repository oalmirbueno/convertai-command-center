// Bearer-token authentication for the MCP server.
// Reuses public.api_keys through the audience-aware validator, which filters
// revoked_at + expires_at and prevents API-gateway keys from crossing into MCP.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  dataScopeAllowsClient,
  oauthScopesForStaff,
  validateOAuthJwtClaims,
} from './mcp-security.ts';
import { getMcpRuntimeConfig } from './mcp-runtime.ts';

export interface AuthContext {
  keyId: string;
  keyName: string;
  scopes: string[];
  origin: string | null;
  // The legacy MCP uses service_role-backed handlers, so every data query
  // must also apply this explicit client boundary. `unrestricted` is granted
  // only to admins (role or scope). Empty clientIds means fail closed.
  dataScope: ClientDataScope;
  // Optional per-call fields, populated by the dispatcher for write tools.
  correlationId?: string;
  resultRefHolder?: { value?: string };
}

export interface ClientDataScope {
  unrestricted: boolean;
  clientIds: string[];
  principalUserId: string | null;
  source: 'oauth' | 'api_key' | 'public';
}

export type AuthError =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'expired_or_revoked' };

export type AuthResult =
  | { ok: true; ctx: AuthContext }
  | { ok: false; error: AuthError };

export class DataScopeError extends Error {
  readonly code = 'data_scope_denied';
}

let cached: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (cached) return cached;
  const url = getMcpRuntimeConfig().supabaseUrl;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
  cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return cached;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function extractBearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// Distinguish "wrong token" from "known token but revoked/expired" by probing
// the raw row when validate_api_key returns nothing.
async function classifyMissing(hash: string): Promise<AuthError> {
  const { data } = await admin()
    .from('api_keys')
    .select('is_active, revoked_at, expires_at')
    .eq('key_hash', hash)
    .maybeSingle();
  if (!data) return { kind: 'invalid' };
  const now = Date.now();
  if (data.revoked_at) return { kind: 'expired_or_revoked' };
  if (data.expires_at && new Date(data.expires_at).getTime() <= now) {
    return { kind: 'expired_or_revoked' };
  }
  if (data.is_active === false) return { kind: 'expired_or_revoked' };
  return { kind: 'invalid' };
}

// ─── Supabase OAuth JWT validation via JWKS ─────────────────────
// `MCP_AUTH_ISSUER` can pin the canonical OAuth issuer when `SUPABASE_URL`
// points at a proxy/custom domain. Without the override it is derived from the
// same Supabase base URL used by the function.
export type SupportedSigningJwk = JsonWebKey & {
  kid: string;
  alg: 'RS256' | 'ES256';
  kty: 'RSA' | 'EC';
  use?: 'sig';
};

let jwksCache: { url: string; keys: SupportedSigningJwk[]; fetchedAt: number } | null = null;
export const MAX_JWKS_BODY_BYTES = 256 * 1024;
const MAX_JWKS_KEYS = 16;
const JWKS_TIMEOUT_MS = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSupportedSigningJwk(value: unknown): value is SupportedSigningJwk {
  if (!isRecord(value)) return false;
  if (typeof value.kid !== 'string' || value.kid.trim().length === 0) return false;
  if (value.use !== undefined && value.use !== 'sig') return false;
  return (value.kty === 'RSA' && value.alg === 'RS256')
    || (value.kty === 'EC' && value.alg === 'ES256' && value.crv === 'P-256');
}

export function validateJwksDocument(value: unknown): SupportedSigningJwk[] {
  if (!isRecord(value) || !Array.isArray(value.keys)) {
    throw new Error('jwks response must contain a keys array');
  }
  if (value.keys.length === 0 || value.keys.length > MAX_JWKS_KEYS) {
    throw new Error('jwks response contains an invalid number of keys');
  }
  if (!value.keys.every(isSupportedSigningJwk)) {
    throw new Error('jwks response contains an unsupported signing key');
  }
  return value.keys;
}

async function readBoundedJsonResponse(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const declaredHeader = response.headers.get('content-length');
  if (declaredHeader !== null) {
    const normalized = declaredHeader.trim();
    const declared = Number(normalized);
    if (!/^\d+$/.test(normalized) || !Number.isSafeInteger(declared)) {
      throw new Error('jwks response has an invalid Content-Length');
    }
    if (declared > maxBytes) throw new Error('jwks response exceeds the allowed limit');
  }

  if (!response.body) throw new Error('jwks response body is missing');
  const reader = response.body.getReader();
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
          // The document is already rejected; cancellation failure must not
          // change the security classification.
        }
        throw new Error('jwks response exceeds the allowed limit');
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

export async function fetchJwksDocument(
  jwksUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SupportedSigningJwk[]> {
  const response = await fetchImpl(jwksUrl, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(JWKS_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`jwks fetch ${response.status}`);
  const body = await readBoundedJsonResponse(response, MAX_JWKS_BODY_BYTES);
  return validateJwksDocument(body);
}

async function getJwks(jwksUrl: string): Promise<SupportedSigningJwk[]> {
  const now = Date.now();
  if (jwksCache?.url === jwksUrl && now - jwksCache.fetchedAt < 10 * 60_000) {
    return jwksCache.keys;
  }
  const keys = await fetchJwksDocument(jwksUrl);
  jwksCache = { url: jwksUrl, keys, fetchedAt: now };
  return jwksCache.keys;
}

function b64urlDecode(input: string): Uint8Array {
  const pad = 4 - (input.length % 4 || 4);
  const b64 = (input + '='.repeat(pad === 4 ? 0 : pad)).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function verifySupabaseJwt(token: string): Promise<Record<string, any> | null> {
  const { authIssuer, jwksUrl } = getMcpRuntimeConfig();
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  let header: any, payload: any;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlDecode(h)));
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  } catch { return null; }
  if (!validateOAuthJwtClaims(payload, authIssuer)) return null;

  const alg = header.alg;
  const kid = header.kid;
  if (!['RS256', 'ES256'].includes(alg) || typeof kid !== 'string' || !kid.trim()) {
    return null;
  }
  const keys = await getJwks(jwksUrl);
  const jwk = keys.find(k => k.kid === kid && k.alg === alg);
  if (!jwk) return null;

  let algo: any;
  if (alg === 'RS256') algo = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  else if (alg === 'ES256') algo = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };
  else return null; // HS256 not supported in this path

  try {
    const key = await crypto.subtle.importKey('jwk', jwk, algo, false, ['verify']);
    const data = exactBuffer(new TextEncoder().encode(`${h}.${p}`));
    const sig = exactBuffer(b64urlDecode(s));
    const ok = await crypto.subtle.verify(
      alg === 'ES256' ? { name: 'ECDSA', hash: 'SHA-256' } : algo,
      key, sig, data
    );
    return ok ? payload : null;
  } catch { return null; }
}

function readJwtClaimsUnsafe(token: string): Record<string, any> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  } catch {
    return null;
  }
}

function readUnexpiredJwtClaims(token: string): Record<string, any> | null {
  // This fallback only parses claims. `authenticate` always validates the same
  // token with Supabase Auth before trusting the subject or checking roles.
  const claims = readJwtClaimsUnsafe(token);
  return validateOAuthJwtClaims(claims, getMcpRuntimeConfig().authIssuer) ? claims : null;
}

async function hasVerifiedSubject(token: string, expectedSubject: string): Promise<boolean> {
  if (!expectedSubject) return false;
  try {
    const { data, error } = await admin().auth.getUser(token);
    if (error || !data?.user) return false;
    return String(data.user.id) === expectedSubject;
  } catch {
    return false;
  }
}

async function isStaffUser(userId: string): Promise<boolean> {
  if (!userId) return false;
  try {
    const { data, error } = await admin().rpc('is_staff', { _user_id: userId });
    return !error && data === true;
  } catch {
    return false;
  }
}

async function isAllowedOAuthClient(clientId: string): Promise<boolean> {
  if (!clientId) return false;

  try {
    const { data, error } = await admin().rpc('is_allowed_mcp_oauth_client', {
      _client_id: clientId,
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

const INTERNAL_ROLES = new Set(['admin', 'manager', 'design', 'traffic']);

async function assignedClientIds(userId: string): Promise<string[] | null> {
  const pageSize = 500;
  const maxAssignments = 10_000;
  const ids: string[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin()
      .from('team_client_assignments')
      .select('client_id')
      .eq('user_id', userId)
      .order('client_id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) return null;
    const page = data ?? [];
    ids.push(...page.map((row: any) => String(row.client_id ?? '')).filter(Boolean));
    if (ids.length > maxAssignments) return null;
    if (page.length < pageSize) break;
  }
  return [...new Set(ids)];
}

async function dataScopeForUser(
  userId: string | null,
  source: ClientDataScope['source'],
): Promise<ClientDataScope> {
  const failClosed: ClientDataScope = {
    unrestricted: false,
    clientIds: [],
    principalUserId: userId,
    source,
  };
  if (!userId) return failClosed;

  const { data: roleRows, error: rolesError } = await admin()
    .from('user_roles')
    .select('role')
    .eq('user_id', userId);
  if (rolesError) return failClosed;

  const roles = new Set((roleRows ?? []).map((row: any) => String(row.role)));
  if (roles.has('admin')) {
    return { ...failClosed, unrestricted: true };
  }
  if (![...roles].some(role => INTERNAL_ROLES.has(role))) return failClosed;

  const clientIds = await assignedClientIds(userId);
  if (!clientIds) return failClosed;

  return {
    ...failClosed,
    clientIds,
  };
}

export function canAccessClient(ctx: AuthContext, clientId: string): boolean {
  return dataScopeAllowsClient(ctx.dataScope, clientId);
}

export function assertClientAccess(ctx: AuthContext, clientId: string): void {
  if (!canAccessClient(ctx, clientId)) {
    throw new DataScopeError('resource is outside this MCP principal data scope');
  }
}

export async function authenticate(req: Request): Promise<AuthResult> {
  const token = extractBearer(req);
  if (!token) return { ok: false, error: { kind: 'missing' } };

  // 1) API key path (mcp_live_*, sha256 hash in api_keys)
  const hash = await sha256Hex(token);
  const { data, error } = await admin().rpc('validate_api_key_for_audience', {
    _key_hash: hash,
    _audience: 'mcp',
  });
  if (!error) {
    const row = Array.isArray(data) ? data[0] : data;
    if (row) {
      const scopes = Array.isArray(row.scopes) ? row.scopes : [];
      let dataScope: ClientDataScope;
      if (scopes.includes('admin')) {
        dataScope = {
          unrestricted: true,
          clientIds: [],
          principalUserId: null,
          source: 'api_key',
        };
      } else {
        // API keys are owned by the user who created them. A legacy key with
        // no owner is authenticated but receives an empty, fail-closed data
        // scope instead of inheriting service_role visibility.
        const { data: keyOwner } = await admin()
          .from('api_keys')
          .select('created_by')
          .eq('id', row.id)
          .maybeSingle();
        dataScope = await dataScopeForUser(
          keyOwner?.created_by ? String(keyOwner.created_by) : null,
          'api_key',
        );
      }
      return {
        ok: true,
        ctx: {
          keyId: row.id,
          keyName: row.name,
          scopes,
          origin: row.origin ?? null,
          dataScope,
        },
      };
    }
  }

  // 2) Supabase OAuth JWT path (issued via /oauth/token). Handlers below use
  //    service_role, so a valid JWT authenticates the user but does not by
  //    itself authorize broad MCP access. Only canonical internal staff may
  //    continue; client users fail closed before any tool handler runs.
  let claims: Record<string, any> | null = null;
  try {
    claims = await verifySupabaseJwt(token);
  } catch {
    // JWKS can be temporarily unavailable. Supabase Auth remains the source of
    // truth below and verifies the token before any claim is trusted.
  }
  claims ??= readUnexpiredJwtClaims(token);
  if (claims) {
    const sub = String(claims.sub ?? '');
    const clientId = String(claims.client_id ?? claims.azp ?? '');
    if (!(await isAllowedOAuthClient(clientId))) {
      return { ok: false, error: { kind: 'invalid' } };
    }
    if (!(await hasVerifiedSubject(token, sub))) {
      return { ok: false, error: { kind: 'invalid' } };
    }
    const hasScopeClaim = Object.prototype.hasOwnProperty.call(claims, 'scope');
    const hasScopesClaim = Object.prototype.hasOwnProperty.call(claims, 'scopes');
    const claimedScopes = hasScopeClaim || hasScopesClaim
      ? [claims.scope, claims.scopes]
      : undefined;
    const dataScope = await dataScopeForUser(sub, 'oauth');
    const scopes = oauthScopesForStaff(
      await isStaffUser(sub),
      claimedScopes,
      dataScope.unrestricted,
    );
    if (!scopes) return { ok: false, error: { kind: 'invalid' } };
    return {
      ok: true,
      ctx: {
        keyId: `oauth:${sub}`,
        keyName: `oauth:${clientId || 'user'}`,
        scopes,
        origin: `oauth:${clientId || 'user'}:${sub}`,
        dataScope,
      },
    };
  }

  // 3) Known-but-revoked/expired api key?
  const cls = await classifyMissing(hash);
  return { ok: false, error: cls };
}


// Kept for backward compat. Expands aggregate scopes so this matches
// canInvoke() in mcp-tools.ts. Inlined to avoid a circular import.
const SCOPE_EXPANSIONS_LOCAL: Record<string, string[]> = {
  'aceleriq:read': ['clients:read','projects:read','tasks:read','reports:read','briefings:read','files:read','workspace:read','contracts:read','editorial:read'],
  'aceleriq:write': ['projects:write','tasks:write','reports:write','files:write','editorial:write'],
};
export function expandScopesLocal(granted: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const s of granted) {
    out.add(s);
    const exp = SCOPE_EXPANSIONS_LOCAL[s];
    if (exp) for (const e of exp) out.add(e);
  }
  return out;
}
export function hasScope(ctx: AuthContext, required: readonly string[]): boolean {
  if (required.length === 0) return true;
  const expanded = expandScopesLocal(ctx.scopes);
  if (expanded.has('admin')) return true;
  return required.some(s => expanded.has(s));
}
