// Aceleriq OS — Write service layer for MCP (Round 5).
// Exposes ONLY: create_task, update_task, complete_task, create_report_draft.
// Reuses existing tables (public.tasks, public.reports). No new structures.
// Never touches: clients, billing, wallet, users, permissions, emails,
// publication, auto-approval or client delivery.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { z } from 'https://esm.sh/zod@3.23.8';
import { auditPrincipalSelector } from './mcp-security.ts';

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
  // Optional holder: dispatcher passes an object; handler writes result id here
  // so the audit row can persist it and later idempotency lookups can recover.
  resultRefHolder?: { value?: string };
}

export class WriteError extends Error {
  constructor(public code: 'not_found' | 'conflict' | 'validation' | 'forbidden', message: string) {
    super(message);
  }
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
): Promise<{ correlationId: string; resultRef: string | null; record: unknown } | null> {
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
    record: null,
  };
}

async function replayIdempotent<T>(
  toolName: string,
  keyId: string,
  idempotencyKey: string,
  fetchRecord: (id: string) => Promise<T | null>,
): Promise<{ replayed: true; correlation_id: string; record: T | null } | null> {
  const prior = await findIdempotentResult(toolName, keyId, idempotencyKey);
  if (!prior || !prior.resultRef) return null;
  const record = await fetchRecord(prior.resultRef);
  return { replayed: true, correlation_id: prior.correlationId, record };
}

// ─── Shared schemas ───────────────────────────────────────────
const UUID = z.string().uuid();
const IDEMPOTENCY_KEY = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:\-]+$/, {
  message: 'idempotency_key must be 8-128 chars, [A-Za-z0-9._:-]',
});

const TASK_STATUS = z.enum(['backlog', 'todo', 'doing', 'review', 'done']);
const TASK_PRIORITY = z.enum(['low', 'medium', 'high', 'urgent']);

// ─── create_task ──────────────────────────────────────────────
export const createTaskSchema = z.object({
  project_id: UUID,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  status: TASK_STATUS.optional(),
  priority: TASK_PRIORITY.optional(),
  assigned_to: UUID.optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'due_date must be YYYY-MM-DD' }).optional(),
  milestone_id: UUID.optional(),
  idempotency_key: IDEMPOTENCY_KEY,
}).strict();

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export async function createTask(input: CreateTaskInput, ctx: WriteCtx) {
  const replay = await replayIdempotent(
    'aceleriq_create_task', ctx.keyId, input.idempotency_key,
    async (id) => (await db().from('tasks').select('id, project_id, milestone_id, title, description, status, priority, assigned_to, due_date, created_at, updated_at').eq('id', id).maybeSingle()).data,
  );
  if (replay) {
    if (ctx.resultRefHolder && replay.record) ctx.resultRefHolder.value = (replay.record as any).id;
    return { ...replay, correlation_id: ctx.correlationId, idempotency_replay_of: replay.correlation_id };
  }

  // Validate project exists (and is not soft-deleted if column exists).
  const { data: project, error: projErr } = await db()
    .from('projects').select('id, client_id, deleted_at').eq('id', input.project_id).maybeSingle();
  if (projErr) throw new WriteError('validation', projErr.message);
  if (!project || (project as any).deleted_at) throw new WriteError('not_found', 'project_id not found');

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
    assigned_to: input.assigned_to ?? null,
    due_date: input.due_date ?? null,
    milestone_id: input.milestone_id ?? null,
    source: 'mcp',
  };

  const { data, error } = await db()
    .from('tasks')
    .insert(row)
    .select('id, project_id, milestone_id, title, description, status, priority, assigned_to, due_date, source, created_at, updated_at')
    .single();
  if (error) throw new WriteError('validation', error.message);
  if (ctx.resultRefHolder) ctx.resultRefHolder.value = data.id;
  return { record: data, replayed: false, correlation_id: ctx.correlationId };
}

// ─── update_task ──────────────────────────────────────────────
// project_id / source / created_by / ownership fields are NOT updatable.
export const updateTaskSchema = z.object({
  task_id: UUID,
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  status: TASK_STATUS.optional(),
  priority: TASK_PRIORITY.optional(),
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
  const replay = await replayIdempotent(
    'aceleriq_update_task', ctx.keyId, input.idempotency_key,
    async (id) => (await db().from('tasks').select('id, project_id, milestone_id, title, description, status, priority, assigned_to, due_date, updated_at').eq('id', id).maybeSingle()).data,
  );
  if (replay) {
    if (ctx.resultRefHolder && replay.record) ctx.resultRefHolder.value = (replay.record as any).id;
    return { ...replay, correlation_id: ctx.correlationId, idempotency_replay_of: replay.correlation_id };
  }

  // Confirm task exists, is not soft-deleted; capture project for milestone check.
  const { data: existing, error: fetchErr } = await db()
    .from('tasks').select('id, project_id, status, deleted_at').eq('id', input.task_id).maybeSingle();
  if (fetchErr) throw new WriteError('validation', fetchErr.message);
  if (!existing || (existing as any).deleted_at) throw new WriteError('not_found', 'task_id not found');

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
  for (const k of ['title', 'description', 'status', 'priority', 'assigned_to', 'due_date', 'milestone_id'] as const) {
    if (k in input) (patch as any)[k] = (input as any)[k];
  }

  const { data, error } = await db()
    .from('tasks')
    .update(patch)
    .eq('id', input.task_id)
    .select('id, project_id, milestone_id, title, description, status, priority, assigned_to, due_date, source, created_at, updated_at')
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
  const replay = await replayIdempotent(
    'aceleriq_complete_task', ctx.keyId, input.idempotency_key,
    async (id) => (await db().from('tasks').select('id, project_id, status, updated_at').eq('id', id).maybeSingle()).data,
  );
  if (replay) {
    if (ctx.resultRefHolder && replay.record) ctx.resultRefHolder.value = (replay.record as any).id;
    return { ...replay, correlation_id: ctx.correlationId, idempotency_replay_of: replay.correlation_id };
  }

  const { data: existing, error: fetchErr } = await db()
    .from('tasks').select('id, project_id, status, deleted_at').eq('id', input.task_id).maybeSingle();
  if (fetchErr) throw new WriteError('validation', fetchErr.message);
  if (!existing || (existing as any).deleted_at) throw new WriteError('not_found', 'task_id not found');
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
  const replay = await replayIdempotent(
    'aceleriq_create_report_draft', ctx.keyId, input.idempotency_key,
    async (id) => (await db().from('reports').select('id, project_id, client_id, title, status, period_start, period_end, summary, highlights, next_steps, metrics, chart_type, chart_data, created_at').eq('id', id).maybeSingle()).data,
  );
  if (replay) {
    if (ctx.resultRefHolder && replay.record) ctx.resultRefHolder.value = (replay.record as any).id;
    return { ...replay, correlation_id: ctx.correlationId, idempotency_replay_of: replay.correlation_id };
  }

  // Derive client_id from project — caller cannot forge it.
  const { data: project, error: projErr } = await db()
    .from('projects').select('id, client_id, deleted_at').eq('id', input.project_id).maybeSingle();
  if (projErr) throw new WriteError('validation', projErr.message);
  if (!project || (project as any).deleted_at) throw new WriteError('not_found', 'project_id not found');

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
  const replay = await replayIdempotent(
    'aceleriq_update_project', ctx.keyId, input.idempotency_key,
    async (id) => (await db().from('projects').select(PROJECT_SELECT).eq('id', id).maybeSingle()).data,
  );
  if (replay) {
    if (ctx.resultRefHolder && replay.record) ctx.resultRefHolder.value = (replay.record as any).id;
    return { ...replay, correlation_id: ctx.correlationId, idempotency_replay_of: replay.correlation_id };
  }

  const { data: existing, error: fetchErr } = await db()
    .from('projects').select('id, deleted_at').eq('id', input.project_id).maybeSingle();
  if (fetchErr) throw new WriteError('validation', fetchErr.message);
  if (!existing || (existing as any).deleted_at) throw new WriteError('not_found', 'project_id not found');

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
