// Audit logging for MCP tool invocations.
// Writes to public.mcp_audit_log via service role. Never persists secrets.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

let cached: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return cached;
}

const SECRET_KEY_RE = /token|secret|password|api[_-]?key|authorization|bearer/i;

export function sanitize(input: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]';
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') return input.length > 2000 ? input.slice(0, 2000) + '…' : input;
  if (typeof input !== 'object') return input;
  if (Array.isArray(input)) return input.map(v => sanitize(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(k)) out[k] = '[redacted]';
    else out[k] = sanitize(v, depth + 1);
  }
  return out;
}

export interface AuditEntry {
  correlationId: string;
  toolName: string;
  origin: string | null;
  keyId: string | null;
  scopes: string[] | null;
  input: unknown;
  success: boolean;
  statusCode: number;
  durationMs: number;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export async function auditLog(entry: AuditEntry): Promise<void> {
  try {
    await admin().from('mcp_audit_log').insert({
      correlation_id: entry.correlationId,
      tool_name: entry.toolName,
      origin: entry.origin,
      key_id: entry.keyId,
      scopes: entry.scopes,
      sanitized_input: sanitize(entry.input) as any,
      success: entry.success,
      status_code: entry.statusCode,
      duration_ms: entry.durationMs,
      error_code: entry.errorCode ?? null,
      error_message: entry.errorMessage ?? null,
    });
  } catch (e) {
    // Never let audit failures break the tool response.
    console.error('[mcp-audit] insert failed:', (e as Error).message);
  }
}
