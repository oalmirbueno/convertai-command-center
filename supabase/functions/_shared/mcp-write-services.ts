// Aceleriq OS — Write service layer for MCP (Round 5).
// Exposes allowlisted task, editorial-task, report-draft and project writes.
// Reuses existing tables (public.tasks, public.reports, public.projects). No
// new structures.
// Never touches: clients, billing, wallet, users, permissions, emails,
// publication, auto-approval or client delivery.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { z } from 'https://esm.sh/zod@3.23.8';
import { auditPrincipalSelector, dataScopeAllowsClient } from './mcp-security.ts';
import type { ClientDataScope } from './mcp-auth.ts';

// ─── Config ───────────────────────────────────────────────────
const IDEMPOTENCY_TTL_HOURS = 24;

// ─── Supabase client (service role, restricted usage) ─────────
let cached: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (cached) return cached;
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-mcp-write': '1' } },
  });
  return cached;
}

// ─── Types ────────────────────────────────────────────────────
export interface WriteCtx {
  keyId: string;
  origin: string | null;
  correlationId: string;
  dataScope: ClientDataScope;
  // Optional holder: dispatcher passes an object; handler writes result id here
  // so the audit row can persist it and later idempotency lookups can recover.
  resultRefHolder?: { value?: string };
}

export class WriteError extends Error {
  constructor(public code: 'not_found' | 'conflict' | 'validation' | 'forbidden', message: string) {
    super(message);
  }
}

function assertWriteClientScope(ctx: WriteCtx, clientId: string): void {
  if (!dataScopeAllowsClient(ctx.dataScope, clientId)) {
    throw new WriteError('forbidden', 'resource is outside this MCP principal data scope');
  }
}

async function getWritableProject(projectId: string, ctx: WriteCtx) {
  const { data: project, error } = await db()
    .from('projects')
    .select('id, client_id, deleted_at')
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw new WriteError('validation', error.message);
  if (!project || (project as any).deleted_at) {
    throw new WriteError('not_found', 'project_id not found or unavailable');
  }
  assertWriteClientScope(ctx, String((project as any).client_id));
  return project as any;
}

// ─── Idempotency ──────────────────────────────────────────────
// Uses public.mcp_audit_log (already present) — no new tables.
// We only match successful prior calls with the same tool + principal +
// idempotency_key, within the TTL window, and recover __result_ref. API keys
// use key_id; OAuth uses the sanitized __principal metadata.
async function findIdempotentResult(
  toolName: string,
  keyId: string,
  idempotencyKey: string,
): Promise<{
  correlationId: string;
  resultRef: string | null;
  sanitizedInput: Record<string, unknown> | null;
} | null> {
  const since = new Date(Date.now() - IDEMPOTENCY_TTL_HOURS * 3600 * 1000).toISOString();
  let query = db()
    .from('mcp_audit_log')
    .select('correlation_id, sanitized_input')
    .eq('tool_name', toolName)
    .eq('success', true)
    .gte('created_at', since);
  const principal = auditPrincipalSelector(keyId);
  query = principal.keyId
    ? query.eq('key_id', principal.keyId)
    : query.is('key_id', null);
  const auditMatch = principal.principal
    ? { __principal: principal.principal, idempotency_key: idempotencyKey }
    : { idempotency_key: idempotencyKey };
  const { data, error } = await query
    .contains('sanitized_input', auditMatch as any)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const row: any = data[0];
  const meta = row.sanitized_input?.__result_ref ?? null;
  return {
    correlationId: row.correlation_id,
    resultRef: typeof meta === 'string' ? meta : null,
    sanitizedInput: row.sanitized_input && typeof row.sanitized_input === 'object'
      ? row.sanitized_input as Record<string, unknown>
      : null,
  };
}

async function replayIdempotent<T>(
  toolName: string,
  keyId: string,
  idempotencyKey: string,
  fetchRecord: (id: string) => Promise<T | null>,
  validatePriorInput?: (input: Record<string, unknown> | null) => void,
): Promise<{ replayed: true; correlation_id: string; record: T | null } | null> {
  const prior = await findIdempotentResult(toolName, keyId, idempotencyKey);
  if (!prior || !prior.resultRef) return null;
  validatePriorInput?.(prior.sanitizedInput);
  const record = await fetchRecord(prior.resultRef);
  return { replayed: true, correlation_id: prior.correlationId, record };
}

function requirePriorResource(
  priorInput: Record<string, unknown> | null,
  field: string,
  expected: string,
): void {
  if (!priorInput || priorInput[field] !== expected) {
    throw new WriteError(
      'conflict',
      `idempotency_key was already used for a different ${field}`,
    );
  }
}

// ─── Shared schemas ───────────────────────────────────────────
const UUID = z.string().uuid();
const IDEMPOTENCY_KEY = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:\-]+$/, {
  message: 'idempotency_key must be 8-128 chars, [A-Za-z0-9._:-]',
});

const TASK_STATUS = z.enum(['backlog', 'todo', 'doing', 'review', 'done']);
const TASK_PRIORITY = z.enum(['low', 'medium', 'high', 'urgent']);
export const TASK_DELIVERY_TYPE_VALUES = [
  'unspecified',
  'design',
  'branding',
  'static',
  'carousel',
  'reel',
  'story',
  'video',
  'short',
  'article',
  'google_post',
  'planning',
  'copywriting',
  'website',
  'landing_page',
  'automation',
  'traffic',
  'seo',
  'document',
  'report',
  'other',
] as const;
const TASK_DELIVERY_TYPE = z.enum(TASK_DELIVERY_TYPE_VALUES);

// ─── create_task ──────────────────────────────────────────────
export const createTaskSchema = z.object({
  project_id: UUID,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  status: TASK_STATUS.optional(),
  priority: TASK_PRIORITY.optional(),
  delivery_type: TASK_DELIVERY_TYPE.optional(),
  assigned_to: UUID.optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'due_date must be YYYY-MM-DD' }).optional(),
  milestone_id: UUID.optional(),
  idempotency_key: IDEMPOTENCY_KEY,
}).strict();

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export async function createTask(input: CreateTaskInput, ctx: WriteCtx) {
  await getWritableProject(input.project_id, ctx);
  const replay = await replayIdempotent(
    'aceleriq_create_task', ctx.keyId, input.idempotency_key,
    async (id) => (await db().from('tasks').select('id, project_id, milestone_id, title, description, status, priority, delivery_type, assigned_to, due_date, created_at, updated_at').eq('id', id).maybeSingle()).data,
    priorInput => requirePriorResource(priorInput, 'project_id', input.project_id),
  );
  if (replay) {
    if (ctx.resultRefHolder && replay.record) ctx.resultRefHolder.value = (replay.record as any).id;
    return { ...replay, correlation_id: ctx.correlationId, idempotency_replay_of: replay.correlation_id };
  }

  // Validate milestone belongs to the project, if provided.
  if (input.milestone_id) {
    const { data: ms } = await db()
      .from('milestones').select('id, project_id').eq('id', input.milestone_id).maybeSingle();
    if (!ms || (ms as any).project_id !== input.project_id) {
      throw new WriteError('validation', 'milestone_id does not belong to project_id');
    }
  }

  // Validate assignee is staff, if provided.
  if (input.assigned_to) {
    const { data: roles } = await db()
      .from('user_roles').select('role').eq('user_id', input.assigned_to);
    const isStaff = (roles ?? []).some((r: any) => ['admin', 'design', 'traffic', 'manager'].includes(r.role));
    if (!isStaff) throw new WriteError('validation', 'assigned_to must be a staff member');
  }

  // Allowlist of writable fields — nothing else is passed to the DB.
  const row = {
    project_id: input.project_id,
    title: input.title,
    description: input.description ?? null,
    status: input.status ?? 'backlog',
    priority: input.priority ?? 'medium',
    delivery_type: input.delivery_type ?? 'unspecified',
    assigned_to: input.assigned_to ?? null,
    due_date: input.due_date ?? null,
    milestone_id: input.milestone_id ?? null,
    source: 'mcp',
  };

  const { data, error } = await db()
    .from('tasks')
    .insert(row)
    .select('id, project_id, milestone_id, title, description, status, priority, delivery_type, assigned_to, due_date, source, created_at, updated_at')
    .single();
  if (error) throw new WriteError('validation', error.message);
  if (ctx.resultRefHolder) ctx.resultRefHolder.value = data.id;
  return { record: data, replayed: false, correlation_id: ctx.correlationId };
}

// ─── create_editorial_item ──────────────────────────────────
// Creates only the publishable production task that feeds the editorial
// calendar. It deliberately does not create editorial_posts, publication
// plans, approvals, schedules or external delivery requests.
export const EDITORIAL_DELIVERY_TYPE_VALUES = [
  'design', 'static', 'carousel', 'reel', 'story',
  'video', 'short', 'article', 'google_post',
] as const;
const EDITORIAL_DELIVERY_TYPE = z.enum(EDITORIAL_DELIVERY_TYPE_VALUES);

function isRealDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const createEditorialItemSchema = z.object({
  client_id: UUID,
  project_id: UUID,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(3).max(4000).optional(),
  context: z.string().trim().min(3).max(4000).optional(),
  format: EDITORIAL_DELIVERY_TYPE.optional(),
  delivery_type: EDITORIAL_DELIVERY_TYPE.optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'due_date must be YYYY-MM-DD',
  }).refine(isRealDate, { message: 'due_date must be a real calendar date' }),
  priority: TASK_PRIORITY.optional(),
  assigned_to: UUID.optional(),
  idempotency_key: IDEMPOTENCY_KEY,
}).strict()
  .refine(value => Boolean(value.format || value.delivery_type), {
    message: 'format is required',
  })
  .refine(
    value => !value.format || !value.delivery_type || value.format === value.delivery_type,
    { message: 'format and delivery_type cannot conflict' },
  )
  .refine(value => Boolean(value.description || value.context), {
    message: 'description or context is required',
  })
  .refine(value => {
    const combined = [value.description, value.context].filter(Boolean).join('\n\nContexto editorial:\n');
    return combined.length <= 4000;
  }, { message: 'combined description and context must be at most 4000 characters' });

export type CreateEditorialItemInput = z.infer<typeof createEditorialItemSchema>;

function workstreamForEditorialDelivery(deliveryType: typeof EDITORIAL_DELIVERY_TYPE_VALUES[number]) {
  if (['design', 'static', 'carousel'].includes(deliveryType)) return 'design';
  if (['reel', 'video', 'short'].includes(deliveryType)) return 'video';
  return 'content';
}

export function canonicalizeEditorialIdempotencyInput(value: Record<string, unknown>) {
  const description = typeof value.description === 'string' ? value.description.trim() : '';
  const context = typeof value.context === 'string' ? value.context.trim() : '';
  const format = value.format ?? value.delivery_type ?? null;
  return {
    client_id: value.client_id ?? null,
    project_id: value.project_id ?? null,
    title: typeof value.title === 'string' ? value.title.trim() : null,
    description: [description, context].filter(Boolean).join('\n\nContexto editorial:\n'),
    format,
    due_date: value.due_date ?? null,
    priority: value.priority ?? 'medium',
    assigned_to: value.assigned_to ?? null,
  };
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  ));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * A deterministic UUID closes the concurrent retry window without a new
 * idempotency table. UUIDv8 marks this as an application-defined identifier;
 * the namespace includes the authenticated principal and operation key.
 */
export async function deterministicEditorialTaskId(
  principalId: string,
  idempotencyKey: string,
): Promise<string> {
  const bytes = (await sha256Bytes(
    `aceleriq:mcp:editorial-task:v1:${principalId}:${idempotencyKey}`,
  )).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function editorialPayloadFingerprint(
  canonicalInput: Record<string, unknown>,
): Promise<string> {
  return bytesToHex(await sha256Bytes(JSON.stringify(canonicalInput)));
}

const EDITORIAL_TASK_SELECT = 'id, project_id, title, description, status, priority, workstream, delivery_type, assigned_to, due_date, source, created_at, updated_at';

function isEditorialReplay(
  task: Record<string, unknown>,
  projectId: string,
  source: string,
): boolean {
  // Source carries the immutable request fingerprint. Mutable task state such
  // as status/title may evolve later and must not invalidate the original
  // idempotent replay.
  return task.project_id === projectId && task.source === source;
}

export async function createEditorialItem(input: CreateEditorialItemInput, ctx: WriteCtx) {
  if (!dataScopeAllowsClient(ctx.dataScope, input.client_id)) {
    throw new WriteError('forbidden', 'client_id is outside this MCP principal data scope');
  }

  const project = await getWritableProject(input.project_id, ctx);
  if ((project as any).client_id !== input.client_id) {
    throw new WriteError('not_found', 'project_id does not belong to client_id or is unavailable');
  }

  const description = [input.description, input.context]
    .filter(Boolean)
    .join('\n\nContexto editorial:\n');
  const format = (input.format ?? input.delivery_type)!;
  const canonicalInput = canonicalizeEditorialIdempotencyInput(input);
  const taskId = await deterministicEditorialTaskId(ctx.keyId, input.idempotency_key);
  const fingerprint = await editorialPayloadFingerprint(canonicalInput);
  const source = `mcp:editorial:${fingerprint}`;

  const findExisting = async () => {
    const { data, error } = await db().from('tasks')
      .select(EDITORIAL_TASK_SELECT)
      .eq('id', taskId)
      .maybeSingle();
    if (error) throw new WriteError('validation', error.message);
    return data as Record<string, unknown> | null;
  };
  const replayExisting = (task: Record<string, unknown>) => {
    if (!isEditorialReplay(task, input.project_id, source)) {
      throw new WriteError(
        'conflict',
        'idempotency_key was already used with different editorial input',
      );
    }
    if (ctx.resultRefHolder) ctx.resultRefHolder.value = String(task.id);
    return {
      record: { ...task, client_id: input.client_id },
      replayed: true as const,
      correlation_id: ctx.correlationId,
      effects: {
        task_created: false,
        editorial_post_created: false,
        scheduled: false,
        published: false,
        approved: false,
      },
    };
  };

  const existing = await findExisting();
  if (existing) return replayExisting(existing);

  if (input.assigned_to) {
    const { data: roles, error: rolesError } = await db()
      .from('user_roles').select('role').eq('user_id', input.assigned_to);
    if (rolesError) throw new WriteError('validation', rolesError.message);
    const roleNames = (roles ?? []).map((row: any) => String(row.role));
    const isAdmin = roleNames.includes('admin');
    const isTeam = roleNames.some(role => ['manager', 'design', 'traffic'].includes(role));
    if (!isAdmin && !isTeam) {
      throw new WriteError('validation', 'assigned_to must be an internal team member');
    }
    if (!isAdmin) {
      const { data: assignment, error: assignmentError } = await db()
        .from('team_client_assignments')
        .select('id')
        .eq('user_id', input.assigned_to)
        .eq('client_id', input.client_id)
        .maybeSingle();
      if (assignmentError) throw new WriteError('validation', assignmentError.message);
      if (!assignment) {
        throw new WriteError('validation', 'assigned_to is not assigned to client_id');
      }
    }
  }

  const row = {
    id: taskId,
    project_id: input.project_id,
    title: input.title,
    description,
    status: 'backlog',
    priority: input.priority ?? 'medium',
    workstream: workstreamForEditorialDelivery(format),
    delivery_type: format,
    assigned_to: input.assigned_to ?? null,
    due_date: input.due_date,
    source,
  };

  const { data, error } = await db()
    .from('tasks')
    .insert(row)
    .select(EDITORIAL_TASK_SELECT)
    .single();
  if (error) {
    // A simultaneous retry races only on the deterministic primary key. Read
    // it back and verify the immutable request fingerprint before replaying.
    if ((error as any).code === '23505') {
      const concurrent = await findExisting();
      if (concurrent) return replayExisting(concurrent);
    }
    throw new WriteError('validation', error.message);
  }
  if (ctx.resultRefHolder) ctx.resultRefHolder.value = data.id;
  return {
    record: { ...data, client_id: input.client_id },
    replayed: false,
    correlation_id: ctx.correlationId,
    effects: {
      task_created: true,
      editorial_post_created: false,
      scheduled: false,
      published: false,
      approved: false,
    },
  };
}

// ─── update_task ──────────────────────────────────────────────
// project_id / source / created_by / ownership fields are NOT updatable.
export const updateTaskSchema = z.object({
  task_id: UUID,
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  status: TASK_STATUS.optional(),
  priority: TASK_PRIORITY.optional(),
  delivery_type: TASK_DELIVERY_TYPE.optional(),
  assigned_to: UUID.nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  milestone_id: UUID.nullable().optional(),
  idempotency_key: IDEMPOTENCY_KEY,
}).strict().refine(
  (v) => Object.keys(v).some(k => k !== 'task_id' && k !== 'idempotency_key'),
  { message: 'at least one updatable field is required' },
);

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export async function updateTask(input: UpdateTaskInput, ctx: WriteCtx) {
  // Confirm task exists, is not soft-deleted; capture project for milestone check.
  const { data: existing, error: fetchErr } = await db()
    .from('tasks').select('id, project_id, status, deleted_at').eq('id', input.task_id).maybeSingle();
  if (fetchErr) throw new WriteError('validation', fetchErr.message);
  if (!existing || (existing as any).deleted_at) throw new WriteError('not_found', 'task_id not found');
  await getWritableProject(String((existing as any).project_id), ctx);

  const replay = await replayIdempotent(
    'aceleriq_update_task', ctx.keyId, input.idempotency_key,
    async (id) => (await db().from('tasks').select('id, project_id, milestone_id, title, description, status, priority, delivery_type, assigned_to, due_date, updated_at').eq('id', id).maybeSingle()).data,
    priorInput => requirePriorResource(priorInput, 'task_id', input.task_id),
  );
  if (replay) {
    if (ctx.resultRefHolder && replay.record) ctx.resultRefHolder.value = (replay.record as any).id;
    return { ...replay, correlation_id: ctx.correlationId, idempotency_replay_of: replay.correlation_id };
  }

  if (input.milestone_id) {
    const { data: ms } = await db()
      .from('milestones').select('id, project_id').eq('id', input.milestone_id).maybeSingle();
    if (!ms || (ms as any).project_id !== (existing as any).project_id) {
      throw new WriteError('validation', 'milestone_id does not belong to task project');
    }
  }
  if (input.assigned_to) {
    const { data: roles } = await db()
      .from('user_roles').select('role').eq('user_id', input.assigned_to);
    const isStaff = (roles ?? []).some((r: any) => ['admin', 'design', 'traffic', 'manager'].includes(r.role));
    if (!isStaff) throw new WriteError('validation', 'assigned_to must be a staff member');
  }

  // Allowlist patch — nothing outside these keys crosses into the DB call.
  const patch: Record<string, unknown> = {};
  for (const k of ['title', 'description', 'status', 'priority', 'delivery_type', 'assigned_to', 'due_date', 'milestone_id'] as const) {
    if (k in input) (patch as any)[k] = (input as any)[k];
  }

  const { data, error } = await db()
    .from('tasks')
    .update(patch)
    .eq('id', input.task_id)
    .select('id, project_id, milestone_id, title, description, status, priority, delivery_type, assigned_to, due_date, source, created_at, updated_at')
    .single();
  if (error) throw new WriteError('validation', error.message);
  if (ctx.resultRefHolder) ctx.resultRefHolder.value = data.id;
  return { record: data, replayed: false, correlation_id: ctx.correlationId };
}

// ─── complete_task ────────────────────────────────────────────
export const completeTaskSchema = z.object({
  task_id: UUID,
  idempotency_key: IDEMPOTENCY_KEY,
}).strict();
export type CompleteTaskInput = z.infer<typeof completeTaskSchema>;

export async function completeTask(input: CompleteTaskInput, ctx: WriteCtx) {
  const { data: existing, error: fetchErr } = await db()
    .from('tasks').select('id, project_id, status, deleted_at').eq('id', input.task_id).maybeSingle();
  if (fetchErr) throw new WriteError('validation', fetchErr.message);
  if (!existing || (existing as any).deleted_at) throw new WriteError('not_found', 'task_id not found');
  await getWritableProject(String((existing as any).project_id), ctx);

  const replay = await replayIdempotent(
    'aceleriq_complete_task', ctx.keyId, input.idempotency_key,
    async (id) => (await db().from('tasks').select('id, project_id, status, updated_at').eq('id', id).maybeSingle()).data,
    priorInput => requirePriorResource(priorInput, 'task_id', input.task_id),
  );
  if (replay) {
    if (ctx.resultRefHolder && replay.record) ctx.resultRefHolder.value = (replay.record as any).id;
    return { ...replay, correlation_id: ctx.correlationId, idempotency_replay_of: replay.correlation_id };
  }
  if ((existing as any).status === 'done') {
    throw new WriteError('conflict', 'task already completed');
  }

  const { data, error } = await db()
    .from('tasks')
    .update({ status: 'done' })
    .eq('id', input.task_id)
    .neq('status', 'done') // guard against race with a concurrent complete
    .select('id, project_id, milestone_id, title, status, priority, assigned_to, due_date, updated_at')
    .single();
  if (error) throw new WriteError('conflict', error.message);
  if (ctx.resultRefHolder) ctx.resultRefHolder.value = data.id;
  return { record: data, replayed: false, correlation_id: ctx.correlationId };
}

// ─── create_report_draft ──────────────────────────────────────
// Forces status='draft'. No publication, no sending, no approval field.
export const createReportDraftSchema = z.object({
  project_id: UUID,
  title: z.string().trim().min(1).max(200),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  summary: z.string().trim().max(8000).optional(),
  highlights: z.string().trim().max(4000).optional(),
  next_steps: z.string().trim().max(4000).optional(),
  metrics: z.record(z.unknown()).optional(),
  chart_type: z.enum(['area', 'bar', 'line', 'pie']).optional(),
  chart_data: z.array(z.record(z.unknown())).max(500).optional(),
  idempotency_key: IDEMPOTENCY_KEY,
}).strict();
export type CreateReportDraftInput = z.infer<typeof createReportDraftSchema>;

export async function createReportDraft(input: CreateReportDraftInput, ctx: WriteCtx) {
  const project = await getWritableProject(input.project_id, ctx);
  const replay = await replayIdempotent(
    'aceleriq_create_report_draft', ctx.keyId, input.idempotency_key,
    async (id) => (await db().from('reports').select('id, project_id, client_id, title, status, period_start, period_end, summary, highlights, next_steps, metrics, chart_type, chart_data, created_at').eq('id', id).maybeSingle()).data,
    priorInput => requirePriorResource(priorInput, 'project_id', input.project_id),
  );
  if (replay) {
    if (ctx.resultRefHolder && replay.record) ctx.resultRefHolder.value = (replay.record as any).id;
    return { ...replay, correlation_id: ctx.correlationId, idempotency_replay_of: replay.correlation_id };
  }

  if (input.period_start && input.period_end && input.period_end < input.period_start) {
    throw new WriteError('validation', 'period_end must be >= period_start');
  }

  // Allowlist — status is HARDCODED to draft. internal_notes / file_url /
  // created_by / images are not writable through this tool.
  const row = {
    project_id: input.project_id,
    client_id: (project as any).client_id,
    title: input.title,
    status: 'draft' as const,
    period_start: input.period_start ?? null,
    period_end: input.period_end ?? null,
    summary: input.summary ?? null,
    highlights: input.highlights ?? null,
    next_steps: input.next_steps ?? null,
    metrics: input.metrics ?? {},
    chart_type: input.chart_type ?? 'area',
    chart_data: input.chart_data ?? [],
  };

  const { data, error } = await db()
    .from('reports')
    .insert(row)
    .select('id, project_id, client_id, title, status, period_start, period_end, summary, highlights, next_steps, metrics, chart_type, chart_data, created_at')
    .single();
  if (error) throw new WriteError('validation', error.message);
  if (ctx.resultRefHolder) ctx.resultRefHolder.value = data.id;
  return { record: data, replayed: false, correlation_id: ctx.correlationId };
}

// ─── update_project ───────────────────────────────────────────
// Allows correcting deadline, status, progress and other operational fields.
// Never touches client_id, brand, billing_mode, total_value, created_by or
// ownership fields. `progress` is clamped to 0..100.
const PROJECT_STATUS = z.enum(['active', 'done', 'paused', 'standby', 'cancelled']);
const PROJECT_TYPE = z.enum(['recurring', 'individual', 'internal']).or(z.string().max(64));

export const updateProjectSchema = z.object({
  project_id: UUID,
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(8000).nullable().optional(),
  status: PROJECT_STATUS.optional(),
  project_type: PROJECT_TYPE.optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  scope: z.string().trim().max(8000).nullable().optional(),
  objectives: z.string().trim().max(8000).nullable().optional(),
  idempotency_key: IDEMPOTENCY_KEY,
}).strict().refine(
  (v) => Object.keys(v).some(k => k !== 'project_id' && k !== 'idempotency_key'),
  { message: 'at least one updatable field is required' },
);
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

const PROJECT_SELECT = 'id, client_id, name, description, project_type, status, progress, start_date, deadline, scope, objectives, brand, billing_mode, total_value, created_at, updated_at';

export async function updateProject(input: UpdateProjectInput, ctx: WriteCtx) {
  const { data: existing, error: fetchErr } = await db()
    .from('projects').select('id, client_id, deleted_at').eq('id', input.project_id).maybeSingle();
  if (fetchErr) throw new WriteError('validation', fetchErr.message);
  if (!existing || (existing as any).deleted_at) throw new WriteError('not_found', 'project_id not found');
  assertWriteClientScope(ctx, String((existing as any).client_id));

  const replay = await replayIdempotent(
    'aceleriq_update_project', ctx.keyId, input.idempotency_key,
    async (id) => (await db().from('projects').select(PROJECT_SELECT).eq('id', id).maybeSingle()).data,
    priorInput => requirePriorResource(priorInput, 'project_id', input.project_id),
  );
  if (replay) {
    if (ctx.resultRefHolder && replay.record) ctx.resultRefHolder.value = (replay.record as any).id;
    return { ...replay, correlation_id: ctx.correlationId, idempotency_replay_of: replay.correlation_id };
  }

  if (input.start_date && input.deadline && input.deadline < input.start_date) {
    throw new WriteError('validation', 'deadline must be >= start_date');
  }

  const patch: Record<string, unknown> = {};
  for (const k of ['name', 'description', 'status', 'project_type', 'start_date', 'deadline', 'progress', 'scope', 'objectives'] as const) {
    if (k in input) (patch as any)[k] = (input as any)[k];
  }

  const { data, error } = await db()
    .from('projects')
    .update(patch)
    .eq('id', input.project_id)
    .select(PROJECT_SELECT)
    .single();
  if (error) throw new WriteError('validation', error.message);
  if (ctx.resultRefHolder) ctx.resultRefHolder.value = data.id;
  return { record: data, replayed: false, correlation_id: ctx.correlationId };
}
