// Bearer-token authentication for the MCP server.
// Reuses the existing public.api_keys table via validate_api_key(_key_hash),
// which already filters revoked_at + expires_at. Does NOT touch api-gateway.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { oauthScopesForStaff } from './mcp-security.ts';

export interface AuthContext {
  keyId: string;
  keyName: string;
  scopes: string[];
  origin: string | null;
  // Optional per-call fields, populated by the dispatcher for write tools.
  correlationId?: string;
  resultRefHolder?: { value?: string };
}

export type AuthError =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'expired_or_revoked' };

export type AuthResult =
  | { ok: true; ctx: AuthContext }
  | { ok: false; error: AuthError };

let cached: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (cached) return cached;
  const url = Deno.env.get('SUPABASE_URL');
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
// Use the canonical Supabase issuer, not the runtime/backend URL. OAuth
// discovery advertises the direct `supabase.co` issuer and strict clients issue
// tokens with that `iss`; using a proxy/runtime URL here makes valid ChatGPT
// OAuth tokens fail verification.
const PROJECT_REF = Deno.env.get('SUPABASE_PROJECT_ID') ?? 'gicbrgagstyvbaaumprj';
const AUTH_ISSUER = `https://${PROJECT_REF}.supabase.co/auth/v1`;
const JWKS_URL = `${AUTH_ISSUER}/.well-known/jwks.json`;

let jwksCache: { keys: any[]; fetchedAt: number } | null = null;
async function getJwks(): Promise<any[]> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < 10 * 60_000) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`jwks fetch ${res.status}`);
  const body = await res.json();
  jwksCache = { keys: body.keys ?? [], fetchedAt: now };
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
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  let header: any, payload: any;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlDecode(h)));
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  } catch { return null; }
  if (!payload) return null;
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return null;

  const alg = header.alg;
  const kid = header.kid;
  const keys = await getJwks();
  const jwk = keys.find(k => k.kid === kid) ?? keys[0];
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
  if (!claims) return null;
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp && claims.exp < now) return null;
  return claims;
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

export async function authenticate(req: Request): Promise<AuthResult> {
  const token = extractBearer(req);
  if (!token) return { ok: false, error: { kind: 'missing' } };

  // 1) API key path (mcp_live_*, sha256 hash in api_keys)
  const hash = await sha256Hex(token);
  const { data, error } = await admin().rpc('validate_api_key', { _key_hash: hash });
  if (!error) {
    const row = Array.isArray(data) ? data[0] : data;
    if (row) {
      return {
        ok: true,
        ctx: {
          keyId: row.id,
          keyName: row.name,
          scopes: Array.isArray(row.scopes) ? row.scopes : [],
          origin: row.origin ?? null,
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
    if (!(await hasVerifiedSubject(token, sub))) {
      return { ok: false, error: { kind: 'invalid' } };
    }
    const scopes = oauthScopesForStaff(await isStaffUser(sub));
    if (!scopes) return { ok: false, error: { kind: 'invalid' } };
    return {
      ok: true,
      ctx: {
        keyId: `oauth:${sub}`,
        keyName: `oauth:${clientId || 'user'}`,
        scopes,
        origin: `oauth:${clientId || 'user'}:${sub}`,
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
  'aceleriq:read': ['clients:read','projects:read','tasks:read','reports:read','briefings:read','files:read','workspace:read','contracts:read'],
  'aceleriq:write': ['projects:write','tasks:write','reports:write','files:write'],
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
