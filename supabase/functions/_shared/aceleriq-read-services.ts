// Aceleriq OS — Read-only service layer for MCP (Round 3).
// Consults existing tables directly. Does NOT create tables, mirrors, caches,
// duplicate IDs or alter any record. Does NOT touch api-gateway.
//
// Every function:
//   - selects explicit fields (no `select *`);
//   - applies a hard row cap and a per-query timeout;
//   - filters `deleted_at IS NULL` where the column exists;
//   - never returns sensitive fields (portal_password, first_access_token,
//     services_config, internal_notes, sync_error, etc.).

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// ─── Config ───────────────────────────────────────────────────
export const READ_LIMITS = {
  defaultPageSize: 25,
  maxPageSize: 500,
  searchMaxPerEntity: 10,
  contextRecentFiles: 20,
  contextRecentRequests: 20,
  contextOpenTasks: 100,
  queryTimeoutMs: 8000,
} as const;

// Folders whose files pass through the client approval workflow.
const APPROVAL_FOLDERS = new Set(['criativos', 'entregas']);

function enrichFile<T extends Record<string, any>>(f: T): T & {
  approval_state: 'approved' | 'pending' | 'rejected' | 'not_required';
  requires_approval: boolean;
  is_internal_document: boolean;
} {
  const folder = (f?.folder ?? '') as string;
  const requires = APPROVAL_FOLDERS.has(folder);
  const raw = String(f?.approval_status ?? 'none');
  let state: 'approved' | 'pending' | 'rejected' | 'not_required';
  if (raw === 'approved' || raw === 'pending' || raw === 'rejected') state = raw as any;
  else state = requires ? 'pending' : 'not_required';
  return {
    ...f,
    approval_state: state,
    requires_approval: requires,
    is_internal_document: !requires,
  };
}

export function pageMeta(count: number | null | undefined, limit: number, offset: number) {
  const total = count ?? 0;
  const returned = Math.max(0, Math.min(limit, Math.max(0, total - offset)));
  const has_more = offset + returned < total;
  return {
    total,
    limit,
    offset,
    has_more,
    next_offset: has_more ? offset + limit : null,
  };
}

export const ALLOWED_ENTITY_TYPES = [
  'client',
  'project',
  'task',
  'briefing',
  'report',
  'workspace_node',
  'file',
  'client_request',
  'milestone',
] as const;
export type EntityType = (typeof ALLOWED_ENTITY_TYPES)[number];

// ─── Supabase (service role, read-only usage) ─────────────────
let cached: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (cached) return cached;
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-mcp-read': '1' } },
  });
  return cached;
}

async function withTimeout<T>(p: PromiseLike<T>, ms = READ_LIMITS.queryTimeoutMs): Promise<T> {
  return await Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Query timeout after ${ms}ms`)), ms),
    ),
  ]);
}

function clampLimit(n: unknown, def: number = READ_LIMITS.defaultPageSize): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return def;
  return Math.min(Math.floor(v), READ_LIMITS.maxPageSize);
}

function clampOffset(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.floor(v);
}

function esc(term: string): string {
  // Escape PostgREST ilike wildcards inside a user string.
  return term.replace(/[%_,()]/g, ' ').trim();
}

function isUuid(s: unknown): s is string {
  return typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

// Whitelisted field selections — kept narrow on purpose.
const F = {
  client:
    'id, full_name, company_name, email, phone, avatar_url, plan_name, plan_status, plan_value, plan_renewal_date, client_type, brand, onboarding_done, created_at, updated_at',
  clientPublic:
    'id, full_name, company_name, email, avatar_url, plan_name, plan_status, client_type, brand, created_at',
  project:
    'id, client_id, name, description, project_type, status, progress, start_date, deadline, brand, billing_mode, total_value, created_at, updated_at',
  task:
    'id, project_id, milestone_id, title, description, status, kanban_status, priority, assigned_to, due_date, progress, task_order, created_at, updated_at',
  taskLite:
    'id, project_id, title, status, kanban_status, priority, due_date, updated_at',
  briefing:
    'id, client_id, project_id, submitted, required, responses, created_at',
  briefingLite: 'id, client_id, project_id, submitted, required, created_at',
  report:
    'id, project_id, client_id, title, period_start, period_end, summary, highlights, next_steps, status, metrics, chart_type, chart_data, images, file_url, created_at',
  reportLite:
    'id, project_id, client_id, title, period_start, period_end, status, created_at',
  workspaceNode:
    'id, parent_id, scope, client_id, kind, name, mime, size_bytes, duration_sec, storage_path, thumb_path, sort_index, created_at, updated_at',
  file:
    'id, project_id, client_id, file_name, file_type, folder, approval_status, feedback, version, parent_file_id, caption, description, created_at',
  fileLite:
    'id, project_id, client_id, file_name, file_type, folder, approval_status, created_at',
  request:
    'id, client_id, project_id, title, description, priority, status, created_at, updated_at',
  milestone:
    'id, project_id, title, description, status, target_date, milestone_order, created_at',
} as const;

// ─── list_clients ────────────────────────────────────────────
export async function listClients(opts: { query?: string; limit?: number; offset?: number }) {
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);
  const q = opts.query ? esc(opts.query) : '';

  // Clients = users with role='client'. Never trust profile-only listings.
  const roles = await withTimeout(
    db().from('user_roles').select('user_id').eq('role', 'client'),
  );
  if (roles.error) throw new Error(`user_roles: ${roles.error.message}`);
  const ids = (roles.data ?? []).map(r => r.user_id).filter(Boolean);
  if (ids.length === 0) return { items: [], total: 0, limit, offset };

  let qb = db()
    .from('profiles')
    .select(F.client, { count: 'exact' })
    .in('id', ids)
    .is('deleted_at', null);

  if (q) {
    qb = qb.or(
      `full_name.ilike.%${q}%,company_name.ilike.%${q}%,email.ilike.%${q}%`,
    );
  }

  const { data, error, count } = await withTimeout(
    qb.order('company_name', { ascending: true, nullsFirst: false })
      .range(offset, offset + limit - 1),
  );
  if (error) throw new Error(`profiles: ${error.message}`);
  return { items: data ?? [], total: count ?? 0, limit, offset };
}

// ─── get_client_context ──────────────────────────────────────
export async function getClientContext(opts: { client_id: string }) {
  if (!isUuid(opts.client_id)) throw new Error('client_id must be a UUID');
  const id = opts.client_id;

  const role = await withTimeout(
    db().from('user_roles').select('role').eq('user_id', id).eq('role', 'client').maybeSingle(),
  );
  if (role.error) throw new Error(`user_roles: ${role.error.message}`);
  if (!role.data) throw new Error('Not a client');

  const [profile, projects, briefings, reports, files, requests] = await Promise.all([
    withTimeout(db().from('profiles').select(F.client).eq('id', id).is('deleted_at', null).maybeSingle()),
    withTimeout(db().from('projects').select(F.project).eq('client_id', id).is('deleted_at', null)
      .order('updated_at', { ascending: false }).limit(50)),
    withTimeout(db().from('briefings').select(F.briefingLite).eq('client_id', id)
      .order('created_at', { ascending: false }).limit(20)),
    withTimeout(db().from('reports').select(F.reportLite).eq('client_id', id)
      .order('created_at', { ascending: false }).limit(20)),
    withTimeout(db().from('files').select(F.fileLite).eq('client_id', id)
      .order('created_at', { ascending: false }).limit(READ_LIMITS.contextRecentFiles)),
    withTimeout(db().from('client_requests').select(F.request).eq('client_id', id)
      .order('created_at', { ascending: false }).limit(READ_LIMITS.contextRecentRequests)),
  ]);

  for (const r of [profile, projects, briefings, reports, files, requests]) {
    if (r.error) throw new Error(`context: ${r.error.message}`);
  }

  const projectIds = (projects.data ?? []).map(p => p.id);
  let openTasks: unknown[] = [];
  let upcomingMilestones: unknown[] = [];

  if (projectIds.length > 0) {
    const [tasksRes, msRes] = await Promise.all([
      withTimeout(
        db().from('tasks').select(F.taskLite)
          .in('project_id', projectIds)
          .is('deleted_at', null)
          .not('status', 'in', '("done","archived","cancelled")')
          .order('due_date', { ascending: true, nullsFirst: false })
          .limit(READ_LIMITS.contextOpenTasks),
      ),
      withTimeout(
        db().from('milestones').select(F.milestone)
          .in('project_id', projectIds)
          .is('deleted_at', null)
          .not('status', 'eq', 'completed')
          .order('target_date', { ascending: true, nullsFirst: false })
          .limit(50),
      ),
    ]);
    if (tasksRes.error) throw new Error(`tasks: ${tasksRes.error.message}`);
    if (msRes.error) throw new Error(`milestones: ${msRes.error.message}`);
    openTasks = tasksRes.data ?? [];
    upcomingMilestones = msRes.data ?? [];
  }

  return {
    client_id: id,
    profile: profile.data ?? null,
    projects: projects.data ?? [],
    open_tasks: openTasks,
    upcoming_milestones: upcomingMilestones,
    briefings: briefings.data ?? [],
    reports: reports.data ?? [],
    recent_files: files.data ?? [],
    requests: requests.data ?? [],
    counters: {
      projects: (projects.data ?? []).length,
      open_tasks: openTasks.length,
      briefings: (briefings.data ?? []).length,
      reports: (reports.data ?? []).length,
      recent_files: (files.data ?? []).length,
      requests: (requests.data ?? []).length,
    },
  };
}

// ─── list_projects ───────────────────────────────────────────
export async function listProjects(opts: {
  client_id?: string; status?: string; query?: string; limit?: number; offset?: number;
}) {
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);
  let qb = db().from('projects').select(F.project, { count: 'exact' }).is('deleted_at', null);
  if (opts.client_id) {
    if (!isUuid(opts.client_id)) throw new Error('client_id must be a UUID');
    qb = qb.eq('client_id', opts.client_id);
  }
  if (opts.status) qb = qb.eq('status', opts.status);
  if (opts.query) {
    const q = esc(opts.query);
    qb = qb.or(`name.ilike.%${q}%,description.ilike.%${q}%`);
  }
  const { data, error, count } = await withTimeout(
    qb.order('updated_at', { ascending: false }).range(offset, offset + limit - 1),
  );
  if (error) throw new Error(`projects: ${error.message}`);
  return { items: data ?? [], total: count ?? 0, limit, offset };
}

// ─── get_project ─────────────────────────────────────────────
export async function getProject(opts: { project_id: string }) {
  if (!isUuid(opts.project_id)) throw new Error('project_id must be a UUID');
  const id = opts.project_id;

  const [project, milestones, tasks, files, reports] = await Promise.all([
    withTimeout(db().from('projects').select(F.project).eq('id', id).is('deleted_at', null).maybeSingle()),
    withTimeout(db().from('milestones').select(F.milestone).eq('project_id', id)
      .is('deleted_at', null).order('milestone_order', { ascending: true }).limit(50)),
    withTimeout(db().from('tasks').select(F.task).eq('project_id', id)
      .is('deleted_at', null).order('updated_at', { ascending: false }).limit(100)),
    withTimeout(db().from('files').select(F.fileLite).eq('project_id', id)
      .order('created_at', { ascending: false }).limit(30)),
    withTimeout(db().from('reports').select(F.reportLite).eq('project_id', id)
      .order('created_at', { ascending: false }).limit(10)),
  ]);
  for (const r of [project, milestones, tasks, files, reports]) {
    if (r.error) throw new Error(`get_project: ${r.error.message}`);
  }
  if (!project.data) throw new Error('Project not found');

  return {
    project: project.data,
    milestones: milestones.data ?? [],
    tasks: tasks.data ?? [],
    files: files.data ?? [],
    reports: reports.data ?? [],
  };
}

// ─── list_tasks ──────────────────────────────────────────────
export async function listTasks(opts: {
  project_id?: string; client_id?: string; status?: string; assigned_to?: string;
  only_open?: boolean; limit?: number; offset?: number;
}) {
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);

  let projectIds: string[] | null = null;
  if (opts.client_id) {
    if (!isUuid(opts.client_id)) throw new Error('client_id must be a UUID');
    const res = await withTimeout(
      db().from('projects').select('id').eq('client_id', opts.client_id).is('deleted_at', null),
    );
    if (res.error) throw new Error(`projects: ${res.error.message}`);
    projectIds = (res.data ?? []).map(p => p.id);
    if (projectIds.length === 0) return { items: [], total: 0, limit, offset };
  }

  let qb = db().from('tasks').select(F.task, { count: 'exact' }).is('deleted_at', null);
  if (opts.project_id) {
    if (!isUuid(opts.project_id)) throw new Error('project_id must be a UUID');
    qb = qb.eq('project_id', opts.project_id);
  }
  if (projectIds) qb = qb.in('project_id', projectIds);
  if (opts.status) qb = qb.eq('status', opts.status);
  if (opts.assigned_to) {
    if (!isUuid(opts.assigned_to)) throw new Error('assigned_to must be a UUID');
    qb = qb.eq('assigned_to', opts.assigned_to);
  }
  if (opts.only_open) qb = qb.not('status', 'in', '("done","archived","cancelled")');

  const { data, error, count } = await withTimeout(
    qb.order('updated_at', { ascending: false }).range(offset, offset + limit - 1),
  );
  if (error) throw new Error(`tasks: ${error.message}`);
  return { items: data ?? [], total: count ?? 0, limit, offset };
}

// ─── list_reports / get_report ───────────────────────────────
export async function listReports(opts: {
  client_id?: string; project_id?: string; limit?: number; offset?: number;
}) {
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);
  let qb = db().from('reports').select(F.reportLite, { count: 'exact' });
  if (opts.client_id) {
    if (!isUuid(opts.client_id)) throw new Error('client_id must be a UUID');
    qb = qb.eq('client_id', opts.client_id);
  }
  if (opts.project_id) {
    if (!isUuid(opts.project_id)) throw new Error('project_id must be a UUID');
    qb = qb.eq('project_id', opts.project_id);
  }
  const { data, error, count } = await withTimeout(
    qb.order('created_at', { ascending: false }).range(offset, offset + limit - 1),
  );
  if (error) throw new Error(`reports: ${error.message}`);
  return { items: data ?? [], total: count ?? 0, limit, offset };
}

export async function getReport(opts: { report_id: string }) {
  if (!isUuid(opts.report_id)) throw new Error('report_id must be a UUID');
  const { data, error } = await withTimeout(
    db().from('reports').select(F.report).eq('id', opts.report_id).maybeSingle(),
  );
  if (error) throw new Error(`reports: ${error.message}`);
  if (!data) throw new Error('Report not found');
  return { report: data };
}

// ─── list_briefings / get_briefing ───────────────────────────
export async function listBriefings(opts: {
  client_id?: string; project_id?: string; submitted?: boolean;
  limit?: number; offset?: number;
}) {
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);
  let qb = db().from('briefings').select(F.briefingLite, { count: 'exact' });
  if (opts.client_id) {
    if (!isUuid(opts.client_id)) throw new Error('client_id must be a UUID');
    qb = qb.eq('client_id', opts.client_id);
  }
  if (opts.project_id) {
    if (!isUuid(opts.project_id)) throw new Error('project_id must be a UUID');
    qb = qb.eq('project_id', opts.project_id);
  }
  if (typeof opts.submitted === 'boolean') qb = qb.eq('submitted', opts.submitted);

  const { data, error, count } = await withTimeout(
    qb.order('created_at', { ascending: false }).range(offset, offset + limit - 1),
  );
  if (error) throw new Error(`briefings: ${error.message}`);
  return { items: data ?? [], total: count ?? 0, limit, offset };
}

export async function getBriefing(opts: { briefing_id: string }) {
  if (!isUuid(opts.briefing_id)) throw new Error('briefing_id must be a UUID');
  const { data, error } = await withTimeout(
    db().from('briefings').select(F.briefing).eq('id', opts.briefing_id).maybeSingle(),
  );
  if (error) throw new Error(`briefings: ${error.message}`);
  if (!data) throw new Error('Briefing not found');
  return { briefing: data };
}

// ─── list_workspace_nodes / get_workspace_node ───────────────
export async function listWorkspaceNodes(opts: {
  parent_id?: string | null; client_id?: string; scope?: string; kind?: string;
  limit?: number; offset?: number;
}) {
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);
  let qb = db().from('workspace_nodes').select(F.workspaceNode, { count: 'exact' });
  if (opts.parent_id === null) qb = qb.is('parent_id', null);
  else if (opts.parent_id) {
    if (!isUuid(opts.parent_id)) throw new Error('parent_id must be a UUID');
    qb = qb.eq('parent_id', opts.parent_id);
  }
  if (opts.client_id) {
    if (!isUuid(opts.client_id)) throw new Error('client_id must be a UUID');
    qb = qb.eq('client_id', opts.client_id);
  }
  if (opts.scope) qb = qb.eq('scope', opts.scope);
  if (opts.kind) qb = qb.eq('kind', opts.kind);

  const { data, error, count } = await withTimeout(
    qb.order('sort_index', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true })
      .range(offset, offset + limit - 1),
  );
  if (error) throw new Error(`workspace_nodes: ${error.message}`);
  return { items: data ?? [], total: count ?? 0, limit, offset };
}

export async function getWorkspaceNode(opts: { node_id: string }) {
  if (!isUuid(opts.node_id)) throw new Error('node_id must be a UUID');
  const { data, error } = await withTimeout(
    db().from('workspace_nodes').select(F.workspaceNode).eq('id', opts.node_id).maybeSingle(),
  );
  if (error) throw new Error(`workspace_nodes: ${error.message}`);
  if (!data) throw new Error('Workspace node not found');
  return { node: data };
}

// ─── list_files / get_file ───────────────────────────────────
export async function listFiles(opts: {
  client_id?: string; project_id?: string; folder?: string; approval_status?: string;
  limit?: number; offset?: number;
}) {
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);
  let qb = db().from('files').select(F.file, { count: 'exact' });
  if (opts.client_id) {
    if (!isUuid(opts.client_id)) throw new Error('client_id must be a UUID');
    qb = qb.eq('client_id', opts.client_id);
  }
  if (opts.project_id) {
    if (!isUuid(opts.project_id)) throw new Error('project_id must be a UUID');
    qb = qb.eq('project_id', opts.project_id);
  }
  if (opts.folder) qb = qb.eq('folder', opts.folder);
  if (opts.approval_status) qb = qb.eq('approval_status', opts.approval_status);
  const { data, error, count } = await withTimeout(
    qb.order('created_at', { ascending: false }).range(offset, offset + limit - 1),
  );
  if (error) throw new Error(`files: ${error.message}`);
  const items = (data ?? []).map(enrichFile);
  return { items, ...pageMeta(count, limit, offset) };
}

export async function getFile(opts: { file_id: string }) {
  if (!isUuid(opts.file_id)) throw new Error('file_id must be a UUID');
  const { data, error } = await withTimeout(
    db().from('files').select(F.file).eq('id', opts.file_id).maybeSingle(),
  );
  if (error) throw new Error(`files: ${error.message}`);
  if (!data) throw new Error('File not found');
  // Fetch child versions (parent_file_id = this id) for approval history.
  const { data: versions } = await withTimeout(
    db().from('files').select(F.file).eq('parent_file_id', opts.file_id)
      .order('created_at', { ascending: false }).limit(50),
  );
  return {
    file: enrichFile(data),
    versions: (versions ?? []).map(enrichFile),
  };
}

// ─── search ──────────────────────────────────────────────────
export async function search(opts: {
  query: string;
  entities?: EntityType[];
  limit_per_entity?: number;
}) {
  const q = esc(opts.query ?? '');
  if (!q) return { query: '', results: {} };
  const per = Math.min(clampLimit(opts.limit_per_entity, READ_LIMITS.searchMaxPerEntity),
    READ_LIMITS.searchMaxPerEntity);
  const wanted: EntityType[] = (opts.entities && opts.entities.length > 0)
    ? opts.entities.filter(e => ALLOWED_ENTITY_TYPES.includes(e))
    : [...ALLOWED_ENTITY_TYPES];

  const results: Record<string, unknown[]> = {};
  const jobs: Promise<void>[] = [];

  if (wanted.includes('client')) {
    jobs.push((async () => {
      const roles = await withTimeout(db().from('user_roles').select('user_id').eq('role', 'client'));
      const ids = (roles.data ?? []).map(r => r.user_id);
      if (ids.length === 0) { results.client = []; return; }
      const r = await withTimeout(
        db().from('profiles').select(F.clientPublic).in('id', ids).is('deleted_at', null)
          .or(`full_name.ilike.%${q}%,company_name.ilike.%${q}%,email.ilike.%${q}%`)
          .limit(per),
      );
      results.client = r.data ?? [];
    })());
  }
  if (wanted.includes('project')) {
    jobs.push((async () => {
      const r = await withTimeout(
        db().from('projects').select(F.project).is('deleted_at', null)
          .or(`name.ilike.%${q}%,description.ilike.%${q}%`).limit(per),
      );
      results.project = r.data ?? [];
    })());
  }
  if (wanted.includes('task')) {
    jobs.push((async () => {
      const r = await withTimeout(
        db().from('tasks').select(F.taskLite).is('deleted_at', null)
          .or(`title.ilike.%${q}%,description.ilike.%${q}%`).limit(per),
      );
      results.task = r.data ?? [];
    })());
  }
  if (wanted.includes('report')) {
    jobs.push((async () => {
      const r = await withTimeout(
        db().from('reports').select(F.reportLite)
          .or(`title.ilike.%${q}%,summary.ilike.%${q}%`).limit(per),
      );
      results.report = r.data ?? [];
    })());
  }
  if (wanted.includes('workspace_node')) {
    jobs.push((async () => {
      const r = await withTimeout(
        db().from('workspace_nodes').select(F.workspaceNode).ilike('name', `%${q}%`).limit(per),
      );
      results.workspace_node = r.data ?? [];
    })());
  }
  if (wanted.includes('file')) {
    jobs.push((async () => {
      const r = await withTimeout(
        db().from('files').select(F.fileLite)
          .or(`file_name.ilike.%${q}%,caption.ilike.%${q}%,description.ilike.%${q}%`).limit(per),
      );
      results.file = r.data ?? [];
    })());
  }
  if (wanted.includes('client_request')) {
    jobs.push((async () => {
      const r = await withTimeout(
        db().from('client_requests').select(F.request)
          .or(`title.ilike.%${q}%,description.ilike.%${q}%`).limit(per),
      );
      results.client_request = r.data ?? [];
    })());
  }
  if (wanted.includes('milestone')) {
    jobs.push((async () => {
      const r = await withTimeout(
        db().from('milestones').select(F.milestone).is('deleted_at', null)
          .or(`title.ilike.%${q}%,description.ilike.%${q}%`).limit(per),
      );
      results.milestone = r.data ?? [];
    })());
  }
  if (wanted.includes('briefing')) {
    // Briefings have no free-text title column — skip full-text; return recent submitted ones.
    jobs.push((async () => {
      const r = await withTimeout(
        db().from('briefings').select(F.briefingLite).order('created_at', { ascending: false }).limit(per),
      );
      results.briefing = r.data ?? [];
    })());
  }

  await Promise.all(jobs);
  return { query: opts.query, entities: wanted, limit_per_entity: per, results };
}

// ─── fetch ───────────────────────────────────────────────────
export async function fetchEntity(opts: { type: EntityType; id: string }) {
  if (!ALLOWED_ENTITY_TYPES.includes(opts.type)) {
    throw new Error(`Unsupported entity type: ${opts.type}`);
  }
  if (!isUuid(opts.id)) throw new Error('id must be a UUID');
  switch (opts.type) {
    case 'client': {
      const role = await withTimeout(
        db().from('user_roles').select('role').eq('user_id', opts.id).eq('role', 'client').maybeSingle(),
      );
      if (role.error) throw new Error(`user_roles: ${role.error.message}`);
      if (!role.data) throw new Error('Not a client');
      const { data, error } = await withTimeout(
        db().from('profiles').select(F.client).eq('id', opts.id).is('deleted_at', null).maybeSingle(),
      );
      if (error) throw new Error(`profiles: ${error.message}`);
      if (!data) throw new Error('Client not found');
      return { type: 'client', entity: data };
    }
    case 'project': {
      const { data, error } = await withTimeout(
        db().from('projects').select(F.project).eq('id', opts.id).is('deleted_at', null).maybeSingle(),
      );
      if (error) throw new Error(error.message);
      if (!data) throw new Error('Project not found');
      return { type: 'project', entity: data };
    }
    case 'task': {
      const { data, error } = await withTimeout(
        db().from('tasks').select(F.task).eq('id', opts.id).is('deleted_at', null).maybeSingle(),
      );
      if (error) throw new Error(error.message);
      if (!data) throw new Error('Task not found');
      return { type: 'task', entity: data };
    }
    case 'briefing': return { type: 'briefing', entity: (await getBriefing({ briefing_id: opts.id })).briefing };
    case 'report': return { type: 'report', entity: (await getReport({ report_id: opts.id })).report };
    case 'workspace_node': return { type: 'workspace_node', entity: (await getWorkspaceNode({ node_id: opts.id })).node };
    case 'file': {
      const { data, error } = await withTimeout(
        db().from('files').select(F.file).eq('id', opts.id).maybeSingle(),
      );
      if (error) throw new Error(error.message);
      if (!data) throw new Error('File not found');
      return { type: 'file', entity: data };
    }
    case 'client_request': {
      const { data, error } = await withTimeout(
        db().from('client_requests').select(F.request).eq('id', opts.id).maybeSingle(),
      );
      if (error) throw new Error(error.message);
      if (!data) throw new Error('Client request not found');
      return { type: 'client_request', entity: data };
    }
    case 'milestone': {
      const { data, error } = await withTimeout(
        db().from('milestones').select(F.milestone).eq('id', opts.id).is('deleted_at', null).maybeSingle(),
      );
      if (error) throw new Error(error.message);
      if (!data) throw new Error('Milestone not found');
      return { type: 'milestone', entity: data };
    }
  }
}
