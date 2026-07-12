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

export async function authenticate(req: Request): Promise<AuthResult> {
  const token = extractBearer(req);
  if (!token) return { ok: false, error: { kind: 'missing' } };
  const hash = await sha256Hex(token);
  const { data, error } = await admin().rpc('validate_api_key', { _key_hash: hash });
  if (error) return { ok: false, error: { kind: 'invalid' } };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    const cls = await classifyMissing(hash);
    return { ok: false, error: cls };
  }
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

export function hasScope(ctx: AuthContext, required: readonly string[]): boolean {
  if (required.length === 0) return true;
  if (ctx.scopes.includes('admin')) return true;
  return required.some(s => ctx.scopes.includes(s));
}
