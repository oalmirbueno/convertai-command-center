// Aceleriq OS — Contracts service layer for MCP (Round Bloco B).
// Read + write over public.contracts. Signed contracts (client_signed_at
// present, or status in {signed, completed}) are IMMUTABLE via MCP.
// Never sends emails, never uploads files: send only flips status to `sent`
// and returns the public sign URL.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { z } from 'https://esm.sh/zod@3.23.8';
import { WriteError, type WriteCtx } from './mcp-write-services.ts';

let cached: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (cached) return cached;
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-mcp-contracts': '1' } },
  });
  return cached;
}

const UUID = z.string().uuid();
const IDEMPOTENCY_KEY = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:\-]+$/);

const CONTRACT_SELECT =
  'id, client_id, project_id, title, description, original_file_url, original_file_name, ' +
  'status, admin_signature_name, admin_signed_at, client_signature_name, client_signed_at, ' +
  'sign_token, sent_at, file_id, created_by, created_at, updated_at';

const IMMUTABLE_STATUSES = new Set(['signed', 'completed', 'cancelled']);

function isSigned(row: any): boolean {
  return Boolean(row?.client_signed_at) || IMMUTABLE_STATUSES.has(String(row?.status ?? ''));
}

function publicSignUrl(sign_token: string): string {
  return `https://aceleriq.online/contrato/${sign_token}`;
}

function enrichContract<T extends Record<string, any>>(row: T) {
  const signed = isSigned(row);
  return {
    ...row,
    is_signed: signed,
    is_locked: signed, // MCP writes are blocked when locked
    sign_url: row?.sign_token ? publicSignUrl(row.sign_token) : null,
  };
}

// ─── Idempotency (reuses mcp_audit_log) ───────────────────────
async function findIdempotentResult(
  toolName: string, keyId: string, idempotencyKey: string,
) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data } = await db()
    .from('mcp_audit_log')
    .select('correlation_id, sanitized_input')
    .eq('tool_name', toolName).eq('key_id', keyId).eq('success', true)
    .gte('created_at', since)
    .contains('sanitized_input', { idempotency_key: idempotencyKey } as any)
    .order('created_at', { ascending: false }).limit(1);
  const row: any = data?.[0];
  if (!row) return null;
  const ref = row.sanitized_input?.__result_ref;
  return { correlationId: row.correlation_id, resultRef: typeof ref === 'string' ? ref : null };
}

async function replayContract(
  toolName: string, keyId: string, idempotencyKey: string,
): Promise<{ replayed: true; correlation_id: string; record: any } | null> {
  const prior = await findIdempotentResult(toolName, keyId, idempotencyKey);
  if (!prior?.resultRef) return null;
  const { data } = await db().from('contracts').select(CONTRACT_SELECT).eq('id', prior.resultRef).maybeSingle();
  return { replayed: true, correlation_id: prior.correlationId, record: data ? enrichContract(data) : null };
}

// ─── READ ─────────────────────────────────────────────────────
export const listContractsSchema = z.object({
  client_id: UUID.optional(),
  project_id: UUID.optional(),
  status: z.enum(['draft', 'sent', 'signed', 'completed', 'cancelled']).optional(),
  query: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
}).strict();

export async function listContracts(input: z.infer<typeof listContractsSchema>) {
  const limit = Math.min(500, Math.max(1, input.limit ?? 25));
  const offset = Math.max(0, input.offset ?? 0);
  let qb = db().from('contracts').select(CONTRACT_SELECT, { count: 'exact' });
  if (input.client_id) qb = qb.eq('client_id', input.client_id);
  if (input.project_id) qb = qb.eq('project_id', input.project_id);
  if (input.status) qb = qb.eq('status', input.status);
  if (input.query) qb = qb.ilike('title', `%${input.query}%`);
  const { data, error, count } = await qb
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new Error(`contracts: ${error.message}`);
  const items = (data ?? []).map(enrichContract);
  const total = count ?? 0;
  const has_more = offset + items.length < total;
  return { items, total, limit, offset, has_more, next_offset: has_more ? offset + limit : null };
}

export const getContractSchema = z.object({ contract_id: UUID }).strict();
export async function getContract(input: z.infer<typeof getContractSchema>) {
  const { data, error } = await db().from('contracts').select(CONTRACT_SELECT)
    .eq('id', input.contract_id).maybeSingle();
  if (error) throw new Error(`contracts: ${error.message}`);
  if (!data) throw new WriteError('not_found', 'contract_id not found');
  return { contract: enrichContract(data) };
}

// ─── CREATE (draft) ───────────────────────────────────────────
export const createContractSchema = z.object({
  client_id: UUID,
  project_id: UUID.optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(8000).optional(),
  original_file_url: z.string().url().max(2000),
  original_file_name: z.string().trim().min(1).max(300),
  idempotency_key: IDEMPOTENCY_KEY,
}).strict();

export async function createContract(input: z.infer<typeof createContractSchema>, ctx: WriteCtx) {
  const replay = await replayContract('aceleriq_create_contract', ctx.keyId, input.idempotency_key);
  if (replay) {
    if (ctx.resultRefHolder && replay.record) ctx.resultRefHolder.value = replay.record.id;
    return { ...replay, correlation_id: ctx.correlationId, idempotency_replay_of: replay.correlation_id };
  }

  const { data: client } = await db().from('profiles').select('id').eq('id', input.client_id).maybeSingle();
  if (!client) throw new WriteError('not_found', 'client_id not found');
  if (input.project_id) {
    const { data: proj } = await db().from('projects').select('id, client_id').eq('id', input.project_id).maybeSingle();
    if (!proj) throw new WriteError('not_found', 'project_id not found');
    if ((proj as any).client_id !== input.client_id) {
      throw new WriteError('validation', 'project_id does not belong to client_id');
    }
  }

  // sign_token: 32-char urlsafe token generated server-side.
  const sign_token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8);

  const row = {
    client_id: input.client_id,
    project_id: input.project_id ?? null,
    title: input.title,
    description: input.description ?? null,
    original_file_url: input.original_file_url,
    original_file_name: input.original_file_name,
    status: 'draft' as const,
    sign_token,
  };
  const { data, error } = await db().from('contracts').insert(row).select(CONTRACT_SELECT).single();
  if (error) throw new WriteError('validation', error.message);
  if (ctx.resultRefHolder) ctx.resultRefHolder.value = data.id;
  return { record: enrichContract(data), replayed: false, correlation_id: ctx.correlationId };
}

// ─── UPDATE (only unsigned) ───────────────────────────────────
export const updateContractSchema = z.object({
  contract_id: UUID,
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(8000).nullable().optional(),
  original_file_url: z.string().url().max(2000).optional(),
  original_file_name: z.string().trim().min(1).max(300).optional(),
  project_id: UUID.nullable().optional(),
  idempotency_key: IDEMPOTENCY_KEY,
}).strict().refine(
  v => Object.keys(v).some(k => k !== 'contract_id' && k !== 'idempotency_key'),
  { message: 'at least one updatable field is required' },
);

export async function updateContract(input: z.infer<typeof updateContractSchema>, ctx: WriteCtx) {
  const replay = await replayContract('aceleriq_update_contract', ctx.keyId, input.idempotency_key);
  if (replay) {
    if (ctx.resultRefHolder && replay.record) ctx.resultRefHolder.value = replay.record.id;
    return { ...replay, correlation_id: ctx.correlationId, idempotency_replay_of: replay.correlation_id };
  }

  const { data: existing, error } = await db().from('contracts').select(CONTRACT_SELECT)
    .eq('id', input.contract_id).maybeSingle();
  if (error) throw new WriteError('validation', error.message);
  if (!existing) throw new WriteError('not_found', 'contract_id not found');
  if (isSigned(existing)) {
    throw new WriteError('forbidden', 'contract is signed/locked and cannot be modified via MCP');
  }

  if (input.project_id) {
    const { data: proj } = await db().from('projects').select('id, client_id')
      .eq('id', input.project_id).maybeSingle();
    if (!proj) throw new WriteError('not_found', 'project_id not found');
    if ((proj as any).client_id !== (existing as any).client_id) {
      throw new WriteError('validation', 'project_id does not belong to contract client');
    }
  }

  const patch: Record<string, unknown> = {};
  for (const k of ['title', 'description', 'original_file_url', 'original_file_name', 'project_id'] as const) {
    if (k in input) (patch as any)[k] = (input as any)[k];
  }

  const { data, error: upErr } = await db().from('contracts').update(patch)
    .eq('id', input.contract_id)
    .is('client_signed_at', null) // race guard: never overwrite a just-signed contract
    .in('status', ['draft', 'sent'])
    .select(CONTRACT_SELECT).single();
  if (upErr) throw new WriteError('conflict', upErr.message);
  if (ctx.resultRefHolder) ctx.resultRefHolder.value = data.id;
  return { record: enrichContract(data), replayed: false, correlation_id: ctx.correlationId };
}

// ─── SEND (draft → sent). No email dispatch; returns sign_url. ─
export const sendContractSchema = z.object({
  contract_id: UUID,
  idempotency_key: IDEMPOTENCY_KEY,
}).strict();

export async function sendContract(input: z.infer<typeof sendContractSchema>, ctx: WriteCtx) {
  const replay = await replayContract('aceleriq_send_contract', ctx.keyId, input.idempotency_key);
  if (replay) {
    if (ctx.resultRefHolder && replay.record) ctx.resultRefHolder.value = replay.record.id;
    return { ...replay, correlation_id: ctx.correlationId, idempotency_replay_of: replay.correlation_id };
  }

  const { data: existing } = await db().from('contracts').select(CONTRACT_SELECT)
    .eq('id', input.contract_id).maybeSingle();
  if (!existing) throw new WriteError('not_found', 'contract_id not found');
  if (isSigned(existing)) throw new WriteError('forbidden', 'contract is signed/locked');
  if ((existing as any).status === 'cancelled') throw new WriteError('conflict', 'contract is cancelled');

  const { data, error } = await db().from('contracts')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', input.contract_id)
    .is('client_signed_at', null)
    .in('status', ['draft', 'sent'])
    .select(CONTRACT_SELECT).single();
  if (error) throw new WriteError('conflict', error.message);
  if (ctx.resultRefHolder) ctx.resultRefHolder.value = data.id;
  return { record: enrichContract(data), replayed: false, correlation_id: ctx.correlationId };
}

// ─── CANCEL (only unsigned). Terminal state. ──────────────────
export const cancelContractSchema = z.object({
  contract_id: UUID,
  reason: z.string().trim().max(2000).optional(),
  idempotency_key: IDEMPOTENCY_KEY,
}).strict();

export async function cancelContract(input: z.infer<typeof cancelContractSchema>, ctx: WriteCtx) {
  const replay = await replayContract('aceleriq_cancel_contract', ctx.keyId, input.idempotency_key);
  if (replay) {
    if (ctx.resultRefHolder && replay.record) ctx.resultRefHolder.value = replay.record.id;
    return { ...replay, correlation_id: ctx.correlationId, idempotency_replay_of: replay.correlation_id };
  }

  const { data: existing } = await db().from('contracts').select(CONTRACT_SELECT)
    .eq('id', input.contract_id).maybeSingle();
  if (!existing) throw new WriteError('not_found', 'contract_id not found');
  if (isSigned(existing)) throw new WriteError('forbidden', 'contract is signed/locked');
  if ((existing as any).status === 'cancelled') throw new WriteError('conflict', 'already cancelled');

  const patch: Record<string, unknown> = { status: 'cancelled' };
  if (input.reason) {
    const prev = (existing as any).description ?? '';
    patch.description = (prev ? prev + '\n\n' : '') + `[MCP cancel]: ${input.reason}`;
  }

  const { data, error } = await db().from('contracts').update(patch)
    .eq('id', input.contract_id)
    .is('client_signed_at', null)
    .in('status', ['draft', 'sent'])
    .select(CONTRACT_SELECT).single();
  if (error) throw new WriteError('conflict', error.message);
  if (ctx.resultRefHolder) ctx.resultRefHolder.value = data.id;
  return { record: enrichContract(data), replayed: false, correlation_id: ctx.correlationId };
}
