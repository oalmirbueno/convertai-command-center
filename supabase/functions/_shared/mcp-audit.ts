// Audit logging for MCP tool invocations.
// Writes to public.mcp_audit_log via service role. Never persists secrets.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  buildAuditInput,
  persistedAuditKeyId,
  sanitizeAuditError,
  sanitizeAuditInput,
} from './mcp-security.ts';

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

// Backward-compatible export used by the Deno unit suite.
export const sanitize = sanitizeAuditInput;

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
  resultRef?: string | null;
}

export async function auditLog(entry: AuditEntry): Promise<void> {
  try {
    // OAuth principals are strings such as `oauth:<user-id>`, while key_id is
    // a UUID FK to api_keys. Store OAuth identity inside sanitized_input and
    // leave key_id NULL so the audit insert is valid and remains queryable.
    const inputPayload = buildAuditInput(entry.input, entry.keyId, entry.resultRef);
    const { error } = await admin().from('mcp_audit_log').insert({
      correlation_id: entry.correlationId,
      tool_name: entry.toolName,
      origin: entry.origin,
      key_id: persistedAuditKeyId(entry.keyId),
      scopes: entry.scopes,
      sanitized_input: inputPayload as any,
      success: entry.success,
      status_code: entry.statusCode,
      duration_ms: entry.durationMs,
      error_code: entry.errorCode ?? null,
      error_message: sanitizeAuditError(entry.errorMessage),
    });
    if (error) {
      console.error('[mcp-audit] insert failed', {
        correlation_id: entry.correlationId,
        tool_name: entry.toolName,
        code: error.code ?? 'unknown',
        message: sanitizeAuditError(error.message),
      });
    }
  } catch (e) {
    // Never let audit failures break the tool response.
    console.error('[mcp-audit] insert exception', {
      correlation_id: entry.correlationId,
      tool_name: entry.toolName,
      message: sanitizeAuditError((e as Error).message),
    });
  }
}
