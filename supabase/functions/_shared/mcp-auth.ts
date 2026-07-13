// Bearer-token authentication for the MCP server.
// Reuses the existing public.api_keys table via validate_api_key(_key_hash),
// which already filters revoked_at + expires_at. Does NOT touch api-gateway.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

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
  if (!payload || payload.iss !== AUTH_ISSUER) return null;
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

async function verifySupabaseJwtViaAuth(token: string): Promise<Record<string, any> | null> {
  const claims = readJwtClaimsUnsafe(token);
  if (!claims || claims.iss !== AUTH_ISSUER) return null;
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp && claims.exp < now) return null;

  // Keep the OAuth boundary strict: copied browser/app-session JWTs do not carry
  // an OAuth client identity, while tokens issued through /oauth/token do.
  if (!claims.client_id && !claims.azp) return null;

  try {
    const { data, error } = await admin().auth.getUser(token);
    if (error || !data?.user) return null;
    return claims;
  } catch {
    return null;
  }
}

const OAUTH_DEFAULT_SCOPES = ['aceleriq:read', 'memory:read', 'memory:propose'];

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

  // 2) Supabase OAuth JWT path (issued via /oauth/token). Grants a fixed,
  //    conservative scope set; api_keys ainda governa acessos privilegiados.
  const claims = (await verifySupabaseJwt(token)) ?? (await verifySupabaseJwtViaAuth(token));
  if (claims) {
    const sub = String(claims.sub ?? '');
    const clientId = String(claims.client_id ?? claims.azp ?? '');
    return {
      ok: true,
      ctx: {
        keyId: `oauth:${sub || clientId || 'anon'}`,
        keyName: `oauth:${clientId || 'user'}`,
        scopes: OAUTH_DEFAULT_SCOPES,
        origin: clientId ? `oauth:${clientId}` : 'oauth',
      },
    };
  }

  // 3) Known-but-revoked/expired api key?
  const cls = await classifyMissing(hash);
  return { ok: false, error: cls };
}


export function hasScope(ctx: AuthContext, required: readonly string[]): boolean {
  if (required.length === 0) return true;
  if (ctx.scopes.includes('admin')) return true;
  return required.some(s => ctx.scopes.includes(s));
}
