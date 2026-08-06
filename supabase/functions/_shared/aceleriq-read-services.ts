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
import { assertClientAccess, type AuthContext } from './mcp-auth.ts';

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

function enrichFile<T extends Record<string, any>>(f: T): T & {
  approval_state: 'approved' | 'pending' | 'rejected' | 'not_required';
  requires_approval: boolean;
  is_internal_document: boolean;
} {
  const visibility = String(f?.visibility ?? 'internal');
  const requires = visibility === 'approval' && f?.requires_approval === true;
  const raw = String(f?.approval_status ?? 'none');
  const state: 'approved' | 'pending' | 'rejected' | 'not_required' =
    requires && (raw === 'approved' || raw === 'pending' || raw === 'rejected')
      ? raw
      : 'not_required';
  return {
    ...f,
    approval_state: state,
    requires_approval: requires,
    is_internal_document: visibility === 'internal',
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
    'id, project_id, milestone_id, title, description, status, kanban_status, priority, assigned_to, due_date, progress, task_order, workstream, delivery_type, source, created_at, updated_at',
  taskLite:
    'id, project_id, title, status, kanban_status, priority, due_date, workstream, delivery_type, source, updated_at',
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
    'id, project_id, client_id, file_name, file_type, folder, approval_status, agency_approval_status, visibility, requires_approval, status, archived_at, approval_requested_at, feedback, version, parent_file_id, revision_of_file_id, locked_at, caption, description, created_at',
  fileLite:
    'id, project_id, client_id, file_name, file_type, folder, approval_status, agency_approval_status, visibility, requires_approval, status, archived_at, created_at',
  request:
    'id, client_id, project_id, title, description, priority, status, created_at, updated_at',
  milestone:
    'id, project_id, title, description, status, target_date, milestone_order, created_at',
} as const;

// ─── list_clients ────────────────────────────────────────────
export async function listClients(
  opts: { query?: string; limit?: number; offset?: number },
  ctx: AuthContext,
) {
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);
  const q = opts.query ? esc(opts.query) : '';

  // Use the FK join as the role gate so filtering, count and range happen in a
  // single PostgREST query. A preliminary user_roles scan would silently stop
  // at the API row ceiling before profile pagination even began.
  let qb = db()
    .from('profiles')
    .select(`${F.client}, client_roles:user_roles!inner(role)`, { count: 'exact' })
    .eq('client_roles.role', 'client')
    .is('deleted_at', null);

  if (!ctx.dataScope.unrestricted) {
    if (ctx.dataScope.clientIds.length === 0) {
      return { items: [], ...pageMeta(0, limit, offset) };
    }
    qb = qb.in('id', ctx.dataScope.clientIds);
  }

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
  const items = (data ?? []).map(({ client_roles: _roles, ...profile }: any) => profile);
  return { items, ...pageMeta(count, limit, offset) };
}

// ─── get_client_context ──────────────────────────────────────
export async function getClientContext(opts: { client_id: string }, ctx: AuthContext) {
  if (!isUuid(opts.client_id)) throw new Error('client_id must be a UUID');
  const id = opts.client_id;
  assertClientAccess(ctx, id);

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
}, ctx: AuthContext) {
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);
  let qb = db().from('projects').select(F.project, { count: 'exact' }).is('deleted_at', null);
  if (opts.client_id) {
    if (!isUuid(opts.client_id)) throw new Error('client_id must be a UUID');
    assertClientAccess(ctx, opts.client_id);
    qb = qb.eq('client_id', opts.client_id);
  } else if (!ctx.dataScope.unrestricted) {
    if (ctx.dataScope.clientIds.length === 0) {
      return { items: [], ...pageMeta(0, limit, offset) };
    }
    qb = qb.in('client_id', ctx.dataScope.clientIds);
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
  return { items: data ?? [], ...pageMeta(count, limit, offset) };
}

// ─── get_project ─────────────────────────────────────────────
export async function getProject(opts: { project_id: string }, ctx: AuthContext) {
  if (!isUuid(opts.project_id)) throw new Error('project_id must be a UUID');
  const id = opts.project_id;

  // Resolve and authorize the parent client before issuing any child query.
  // The service-role client must never fetch another client's related rows and
  // only then decide whether the caller was allowed to see them.
  const project = await withTimeout(
    db().from('projects').select(F.project).eq('id', id).is('deleted_at', null).maybeSingle(),
  );
  if (project.error) throw new Error(`get_project: ${project.error.message}`);
  if (!project.data) throw new Error('Project not found');
  assertClientAccess(ctx, String(project.data.client_id));

  const [milestones, tasks, files, reports] = await Promise.all([
    withTimeout(db().from('milestones').select(F.milestone).eq('project_id', id)
      .is('deleted_at', null).order('milestone_order', { ascending: true }).limit(50)),
    withTimeout(db().from('tasks').select(F.task).eq('project_id', id)
      .is('deleted_at', null).order('updated_at', { ascending: false }).limit(100)),
    withTimeout(db().from('files').select(F.fileLite).eq('project_id', id)
      .order('created_at', { ascending: false }).limit(30)),
    withTimeout(db().from('reports').select(F.reportLite).eq('project_id', id)
      .order('created_at', { ascending: false }).limit(10)),
  ]);
  for (const r of [milestones, tasks, files, reports]) {
    if (r.error) throw new Error(`get_project: ${r.error.message}`);
  }

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
  delivery_type?: string; workstream?: string;
  only_open?: boolean; limit?: number; offset?: number;
}, ctx: AuthContext) {
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);

  let scopedClientId: string | null = null;

  if (opts.client_id && !isUuid(opts.client_id)) throw new Error('client_id must be a UUID');
  if (opts.project_id && !isUuid(opts.project_id)) throw new Error('project_id must be a UUID');

  if (opts.project_id) {
    const project = await withTimeout(
      db().from('projects').select('id, client_id').eq('id', opts.project_id)
        .is('deleted_at', null).maybeSingle(),
    );
    if (project.error) throw new Error(`projects: ${project.error.message}`);
    if (!project.data) throw new Error('project_id not found or unavailable');
    scopedClientId = String(project.data.client_id);
    assertClientAccess(ctx, scopedClientId);
    if (opts.client_id && opts.client_id !== scopedClientId) {
      throw new Error('project_id does not belong to client_id');
    }
  } else if (opts.client_id) {
    assertClientAccess(ctx, opts.client_id);
    scopedClientId = opts.client_id;
  } else if (!ctx.dataScope.unrestricted) {
    if (ctx.dataScope.clientIds.length === 0) {
      return { items: [], ...pageMeta(0, limit, offset) };
    }
  }

  // Join the parent project in the paginated query. This keeps client scope,
  // exact count and page boundaries in PostgREST instead of first collecting
  // project IDs through a separate request that could hit a row ceiling.
  let qb = db().from('tasks')
    .select(`${F.task}, projects!inner(client_id)`, { count: 'exact' })
    .is('deleted_at', null);
  if (opts.project_id) qb = qb.eq('project_id', opts.project_id);
  if (opts.client_id) qb = qb.eq('projects.client_id', opts.client_id);
  else if (!ctx.dataScope.unrestricted) {
    qb = qb.in('projects.client_id', ctx.dataScope.clientIds);
  }
  if (opts.status) qb = qb.eq('status', opts.status);
  if (opts.delivery_type) qb = qb.eq('delivery_type', opts.delivery_type);
  if (opts.workstream) qb = qb.eq('workstream', opts.workstream);
  if (opts.assigned_to) {
    if (!isUuid(opts.assigned_to)) throw new Error('assigned_to must be a UUID');
    qb = qb.eq('assigned_to', opts.assigned_to);
  }
  if (opts.only_open) qb = qb.not('status', 'in', '("done","archived","cancelled")');

  const { data, error, count } = await withTimeout(
    qb.order('updated_at', { ascending: false }).range(offset, offset + limit - 1),
  );
  if (error) throw new Error(`tasks: ${error.message}`);

  return {
    items: (data ?? []).map((row: any) => {
      const { projects, ...task } = row;
      const project = Array.isArray(projects) ? projects[0] : projects;
      return { ...task, client_id: project?.client_id ?? scopedClientId };
    }),
    ...pageMeta(count, limit, offset),
  };
}

// ─── list_editorial_calendar ─────────────────────────────────
// The calendar builds one deterministic page from active editorial posts plus
// publishable tasks that do not yet have an active post. The post is canonical
// when both exist. Accounts and media are attached only after pagination and
// never expose credentials, storage paths, signed URLs or internal notes.
export const PUBLISHABLE_DELIVERY_TYPES = [
  'design', 'static', 'carousel', 'reel', 'story',
  'video', 'short', 'article', 'google_post',
] as const;

const EDITORIAL_TASK_STATUSES = ['backlog', 'todo', 'doing', 'review', 'approved', 'blocked'] as const;

function carouselOrderFromName(value: string | null | undefined): number | null {
  if (!value) return null;
  const fraction = value.match(/\((\d+)\s*\/\s*\d+\)/);
  if (fraction) return Number(fraction[1]);
  const labelled = value.match(/(?:card|slide|p[aá]gina|page)[\s._-]*(\d+)/i);
  if (labelled) return Number(labelled[1]);
  const leading = value.match(/^(\d+)(?=[\s._-])/);
  return leading ? Number(leading[1]) : null;
}

function isRealCalendarDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function safeMediaGroup(rootId: string | null, files: any[]) {
  if (!rootId) return null;
  const root = files.find(file => file.id === rootId);
  if (!root) return null;
  const children = files
    .filter(file => file.parent_file_id === rootId && !file.archived_at)
    .sort((left, right) => {
      const a = carouselOrderFromName(left.file_name);
      const b = carouselOrderFromName(right.file_name);
      if (a !== null && b !== null && a !== b) return a - b;
      if (a !== null && b === null) return -1;
      if (a === null && b !== null) return 1;
      return String(left.created_at ?? '').localeCompare(String(right.created_at ?? ''))
        || String(left.id).localeCompare(String(right.id));
    });

  const safe = (file: any, position: number) => ({
    id: file.id,
    position,
    parent_file_id: file.parent_file_id,
    file_name: file.file_name,
    file_type: file.file_type,
    mime_type: file.mime_type,
    extension: file.extension,
    size_bytes: file.size_bytes,
    caption: file.caption,
    carousel_text: file.carousel_text,
    description: file.description,
    agency_approval_status: file.agency_approval_status,
    approval_status: file.approval_status,
    visibility: file.visibility,
    status: file.status,
    version: file.version,
    created_at: file.created_at,
  });

  return {
    root_file_id: rootId,
    count: 1 + children.length,
    files: [safe(root, 1), ...children.map((file, index) => safe(file, index + 2))],
  };
}

export async function listEditorialCalendar(opts: {
  client_id: string;
  project_id?: string;
  date_from?: string;
  date_to?: string;
  format?: typeof PUBLISHABLE_DELIVERY_TYPES[number];
  // Deprecated compatibility alias. `format` is the canonical MCP input.
  delivery_type?: typeof PUBLISHABLE_DELIVERY_TYPES[number];
  status?: typeof EDITORIAL_TASK_STATUSES[number];
  production_status?: 'draft' | 'production' | 'ready';
  publication_status?: 'planned' | 'scheduled' | 'published' | 'failed' | 'cancelled';
  include_unscheduled?: boolean;
  limit?: number;
  offset?: number;
}, ctx: AuthContext) {
  if (!isUuid(opts.client_id)) throw new Error('client_id must be a UUID');
  assertClientAccess(ctx, opts.client_id);
  if (opts.project_id && !isUuid(opts.project_id)) throw new Error('project_id must be a UUID');
  if (opts.date_from && !isRealCalendarDate(opts.date_from)) {
    throw new Error('date_from must be a real calendar date');
  }
  if (opts.date_to && !isRealCalendarDate(opts.date_to)) {
    throw new Error('date_to must be a real calendar date');
  }
  if (opts.date_from && opts.date_to && opts.date_to < opts.date_from) {
    throw new Error('date_to must be on or after date_from');
  }
  if (opts.format && opts.delivery_type && opts.format !== opts.delivery_type) {
    throw new Error('format and delivery_type cannot conflict');
  }

  const requestedFormat = opts.format ?? opts.delivery_type ?? null;
  const hasPeriodFilter = Boolean(opts.date_from || opts.date_to);
  const includeUnscheduled = opts.include_unscheduled ?? !hasPeriodFilter;
  const periodStart = opts.date_from ? `${opts.date_from}T00:00:00-03:00` : null;
  const periodEnd = opts.date_to ? `${opts.date_to}T23:59:59.999-03:00` : null;
  const fromTime = periodStart ? Date.parse(periodStart) : Number.NEGATIVE_INFINITY;
  const toTime = periodEnd ? Date.parse(periodEnd) : Number.POSITIVE_INFINITY;
  const inPeriod = (scheduledAt: string | null) => {
    if (!scheduledAt) return false;
    const value = Date.parse(scheduledAt);
    return Number.isFinite(value) && value >= fromTime && value <= toTime;
  };

  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);
  const FETCH_PAGE = 500;
  const MAX_CANDIDATES = 10_000;
  const collect = async (
    label: string,
    fetchPage: (from: number, to: number) => PromiseLike<any>,
  ): Promise<any[]> => {
    const rows: any[] = [];
    for (let from = 0; ; from += FETCH_PAGE) {
      const response = await withTimeout(fetchPage(from, from + FETCH_PAGE - 1));
      if (response.error) throw new Error(`${label}: ${response.error.message}`);
      const page = response.data ?? [];
      rows.push(...page);
      if (rows.length > MAX_CANDIDATES) {
        throw new Error(`${label} exceeds ${MAX_CANDIDATES} candidates; filter by project or period`);
      }
      if (page.length < FETCH_PAGE) break;
    }
    return rows;
  };
  const collectInChunks = async (
    label: string,
    values: string[],
    fetchChunk: (chunk: string[], from: number, to: number) => PromiseLike<any>,
  ): Promise<any[]> => {
    const rows: any[] = [];
    for (let index = 0; index < values.length; index += 100) {
      const chunk = values.slice(index, index + 100);
      rows.push(...await collect(label, (from, to) => fetchChunk(chunk, from, to)));
      if (rows.length > MAX_CANDIDATES) {
        throw new Error(`${label} exceeds ${MAX_CANDIDATES} rows; use a smaller page`);
      }
    }
    return rows;
  };

  const projectRows = await collect('projects', (from, to) => {
    let query = db().from('projects').select('id, client_id, name, status')
      .eq('client_id', opts.client_id).is('deleted_at', null);
    if (opts.project_id) query = query.eq('id', opts.project_id);
    return query.order('id', { ascending: true }).range(from, to);
  });
  if (opts.project_id && projectRows.length === 0) {
    throw new Error('project_id does not belong to client_id or is unavailable');
  }
  const projectIds = projectRows.map(project => String(project.id));
  if (projectIds.length === 0) {
    return {
      items: [],
      ...pageMeta(0, limit, offset),
      filters: {
        client_id: opts.client_id,
        project_id: opts.project_id ?? null,
        date_from: opts.date_from ?? null,
        date_to: opts.date_to ?? null,
        format: requestedFormat,
        status: opts.status ?? null,
        production_status: opts.production_status ?? null,
        publication_status: opts.publication_status ?? null,
        include_unscheduled: includeUnscheduled,
      },
    };
  }

  const tasks = await collect('editorial tasks', (from, to) => {
    let query = db().from('tasks').select(F.task)
      .in('project_id', projectIds)
      .in('delivery_type', [...PUBLISHABLE_DELIVERY_TYPES])
      .or('source.is.null,and(source.not.ilike.client_request,source.not.ilike.client_request:*)')
      .not('status', 'in', '("done","archived","cancelled")')
      .is('deleted_at', null);
    if (requestedFormat === 'design' || requestedFormat === 'static') {
      query = query.in('delivery_type', ['design', 'static']);
    } else if (requestedFormat) {
      query = query.eq('delivery_type', requestedFormat);
    }
    if (opts.status) query = query.eq('status', opts.status);
    if (opts.date_from) query = query.gte('due_date', opts.date_from);
    if (opts.date_to) query = query.lte('due_date', opts.date_to);
    return query.order('due_date', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true }).range(from, to);
  });

  // All active posts are loaded for this one client/project scope so linked
  // tasks can be de-duplicated before pagination. This mirrors the UI rule:
  // an active editorial post is canonical and its task is nested, not counted
  // as a second calendar item.
  const rawActivePosts = await collect('editorial posts', (from, to) => {
    let query = db().from('editorial_posts')
      .select('id, client_id, project_id, primary_file_id, title, content_type, objective, default_caption, production_status, version, archived_at, created_at, updated_at, publication_counts:editorial_publications(count)')
      .eq('client_id', opts.client_id)
      .is('archived_at', null)
      .in('content_type', ['static', 'carousel', 'reel', 'story', 'video', 'short', 'article', 'google_post'])
      .in('production_status', ['draft', 'production', 'ready']);
    if (opts.project_id) query = query.eq('project_id', opts.project_id);
    return query.order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, to);
  });
  const publicationCountByPost = new Map<string, number>();
  const allActivePosts = rawActivePosts.map((row: any) => {
    const { publication_counts: counts, ...post } = row;
    const countRow = Array.isArray(counts) ? counts[0] : counts;
    publicationCountByPost.set(String(post.id), Number(countRow?.count ?? 0));
    return post;
  });
  const allPostIds = allActivePosts.map(post => String(post.id));

  const publications = await collectInChunks(
    'editorial publications',
    allPostIds,
    (postIds, from, to) => {
    let query = db().from('editorial_publications')
      .select('id, post_id, client_id, project_id, external_account_id, file_id, platform, caption, first_comment, alt_text, scheduled_at, scheduled_timezone, status, published_at, permalink, version, delivery_mode, created_at, updated_at')
      .eq('client_id', opts.client_id)
      .in('post_id', postIds);
    if (opts.project_id) query = query.eq('project_id', opts.project_id);
    if (opts.publication_status) query = query.eq('status', opts.publication_status);
    if (hasPeriodFilter) {
      if (includeUnscheduled) {
        const filters = ['scheduled_at.is.null'];
        const periodParts: string[] = [];
        if (periodStart) periodParts.push(`scheduled_at.gte.${periodStart}`);
        if (periodEnd) periodParts.push(`scheduled_at.lte.${periodEnd}`);
        if (periodParts.length > 0) filters.push(`and(${periodParts.join(',')})`);
        query = query.or(filters.join(','));
      } else {
        if (periodStart) query = query.gte('scheduled_at', periodStart);
        if (periodEnd) query = query.lte('scheduled_at', periodEnd);
      }
    }
    return query.order('scheduled_at', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true }).range(from, to);
    },
  );

  const linkRows: any[] = [];
  for (let index = 0; index < allPostIds.length; index += 200) {
    const ids = allPostIds.slice(index, index + 200);
    const links = await withTimeout(
      db().from('editorial_post_internal').select('task_id, post_id').in('post_id', ids),
    );
    if (links.error) throw new Error(`editorial links: ${links.error.message}`);
    linkRows.push(...(links.data ?? []));
  }

  const publicationsByPost = new Map<string, any[]>();
  for (const publication of publications) {
    const key = String(publication.post_id);
    const current = publicationsByPost.get(key) ?? [];
    current.push(publication);
    publicationsByPost.set(key, current);
  }
  const taskIdByPost = new Map<string, string>();
  const linkedTaskIds = new Set<string>();
  for (const link of linkRows) {
    if (!link.task_id) continue;
    taskIdByPost.set(String(link.post_id), String(link.task_id));
    linkedTaskIds.add(String(link.task_id));
  }

  const contentType = requestedFormat === 'design'
    ? 'static'
    : requestedFormat ?? null;
  const postCandidates = allActivePosts.filter((post: any) => {
    if (contentType && post.content_type !== contentType) return false;
    if (opts.production_status && post.production_status !== opts.production_status) return false;
    const allPublications = publicationsByPost.get(String(post.id)) ?? [];
    const statusPublications = opts.publication_status
      ? allPublications.filter(publication => publication.status === opts.publication_status)
      : allPublications;
    if (opts.publication_status && statusPublications.length === 0) return false;
    if (!hasPeriodFilter) return true;
    // With a period, scheduled plans must match publications.scheduled_at.
    // Unscheduled backlog only enters when include_unscheduled=true.
    return statusPublications.some(publication => inPeriod(publication.scheduled_at))
      || (
        includeUnscheduled
        && (
          publicationCountByPost.get(String(post.id)) === 0
          || statusPublications.some(publication => !publication.scheduled_at)
        )
      );
  });

  const candidates = [
    ...postCandidates.map((post: any) => {
      const postPublications = publicationsByPost.get(String(post.id)) ?? [];
      const matchingSchedule = postPublications
        .filter(publication => (!opts.publication_status || publication.status === opts.publication_status))
        .filter(publication => !hasPeriodFilter || inPeriod(publication.scheduled_at))
        .map(publication => publication.scheduled_at)
        .filter(Boolean)
        .sort()[0] ?? null;
      return {
        key: `post:${post.id}`,
        kind: 'editorial_post' as const,
        calendar_date: matchingSchedule,
        updated_at: post.updated_at,
        post,
      };
    }),
    ...(!opts.publication_status && !opts.production_status ? tasks : [])
      .filter((task: any) => !linkedTaskIds.has(String(task.id)))
      .map((task: any) => ({
        key: `task:${task.id}`,
        kind: 'editorial_task' as const,
        calendar_date: task.due_date,
        updated_at: task.updated_at,
        task,
      })),
  ].sort((left, right) => {
    const leftDate = left.calendar_date
      ? Date.parse(left.calendar_date.length === 10 ? `${left.calendar_date}T12:00:00-03:00` : left.calendar_date)
      : Number.POSITIVE_INFINITY;
    const rightDate = right.calendar_date
      ? Date.parse(right.calendar_date.length === 10 ? `${right.calendar_date}T12:00:00-03:00` : right.calendar_date)
      : Number.POSITIVE_INFINITY;
    return leftDate - rightDate
      || String(right.updated_at ?? '').localeCompare(String(left.updated_at ?? ''))
      || left.key.localeCompare(right.key);
  });

  const pageCandidates = candidates.slice(offset, offset + limit);
  const pagePostIds = pageCandidates
    .filter(item => item.kind === 'editorial_post')
    .map(item => String((item as any).post.id));
  const pageTaskIds = [...new Set(pagePostIds.map(postId => taskIdByPost.get(postId)).filter(Boolean) as string[])];
  const linkedTasks = pageTaskIds.length > 0
    ? await withTimeout(
      db().from('tasks').select(F.task)
        .in('id', pageTaskIds)
        .in('project_id', projectIds)
        .is('deleted_at', null),
    )
    : { data: [], error: null };
  if (linkedTasks.error) throw new Error(`editorial linked tasks: ${linkedTasks.error.message}`);
  const taskById = new Map((linkedTasks.data ?? []).map((task: any) => [String(task.id), task]));

  const pagePublications = publications.filter(publication => pagePostIds.includes(String(publication.post_id)));
  const accountIds = [...new Set(pagePublications.map((publication: any) => String(publication.external_account_id)))];
  const accountRows = await collectInChunks(
    'external accounts',
    accountIds,
    (chunk, from, to) => db().from('external_accounts')
        .select('id, client_id, display_name, handle, platform, status, created_at, updated_at')
        .in('id', chunk).eq('client_id', opts.client_id)
        .order('id', { ascending: true }).range(from, to),
  );

  const rootFileIds = [...new Set([
    ...pageCandidates.filter(item => item.kind === 'editorial_post').map((item: any) => item.post.primary_file_id),
    ...pagePublications.map((publication: any) => publication.file_id),
  ].filter(Boolean).map(String))];
  const safeFileFields = 'id, parent_file_id, client_id, project_id, file_name, file_type, mime_type, extension, size_bytes, caption, carousel_text, description, created_at, agency_approval_status, approval_status, visibility, status, archived_at, version';
  const rootRows = await collectInChunks(
    'editorial media',
    rootFileIds,
    (chunk, from, to) => {
      let query = db().from('files')
        .select(safeFileFields)
        .in('id', chunk).eq('client_id', opts.client_id).is('archived_at', null);
      if (opts.project_id) query = query.eq('project_id', opts.project_id);
      return query.order('id', { ascending: true }).range(from, to);
    },
  );
  const childRows = await collectInChunks(
    'editorial carousel media',
    rootFileIds,
    (chunk, from, to) => {
      let query = db().from('files')
        .select(safeFileFields)
        .in('parent_file_id', chunk).eq('client_id', opts.client_id)
        .is('archived_at', null);
      if (opts.project_id) query = query.eq('project_id', opts.project_id);
      return query.order('created_at', { ascending: true })
        .order('id', { ascending: true }).range(from, to);
    },
  );

  const projectsById = new Map(projectRows.map((project: any) => [String(project.id), project]));
  const accountsById = new Map(accountRows.map((account: any) => [String(account.id), account]));
  const files = [...rootRows, ...childRows];
  const items = pageCandidates.map((candidate: any) => {
    if (candidate.kind === 'editorial_task') {
      return {
        kind: 'editorial_task',
        calendar_date: candidate.calendar_date,
        client_id: opts.client_id,
        project: projectsById.get(String(candidate.task.project_id)) ?? null,
        task: { ...candidate.task, client_id: opts.client_id },
        post: null,
      };
    }

    const post = candidate.post;
    const linkedTaskId = taskIdByPost.get(String(post.id)) ?? null;
    const taskId = linkedTaskId && taskById.has(linkedTaskId) ? linkedTaskId : null;
    const allPostPublications = publicationsByPost.get(String(post.id)) ?? [];
    return {
      kind: 'editorial_post',
      calendar_date: candidate.calendar_date,
      period_match: candidate.calendar_date ? 'scheduled' : 'unscheduled',
      client_id: opts.client_id,
      project: projectsById.get(String(post.project_id)) ?? null,
      task_id: taskId,
      task: taskId && taskById.has(taskId)
        ? { ...taskById.get(taskId), client_id: opts.client_id }
        : null,
      post: {
        ...post,
        media: safeMediaGroup(post.primary_file_id, files),
        publications: allPostPublications
          .sort((a: any, b: any) => String(a.scheduled_at ?? '').localeCompare(String(b.scheduled_at ?? '')))
          .map((publication: any) => ({
            ...publication,
            in_requested_period: hasPeriodFilter ? inPeriod(publication.scheduled_at) : true,
            account: accountsById.get(String(publication.external_account_id)) ?? null,
            media: safeMediaGroup(publication.file_id, files),
          })),
      },
    };
  });

  return {
    items,
    ...pageMeta(candidates.length, limit, offset),
    filters: {
      client_id: opts.client_id,
      project_id: opts.project_id ?? null,
      date_from: opts.date_from ?? null,
      date_to: opts.date_to ?? null,
      format: requestedFormat,
      status: opts.status ?? null,
      production_status: opts.production_status ?? null,
      publication_status: opts.publication_status ?? null,
      include_unscheduled: includeUnscheduled,
    },
    semantics: {
      primary_source: 'active_editorial_posts_plus_unlinked_publishable_tasks',
      date_fields: {
        editorial_task: 'tasks.due_date',
        editorial_post: 'editorial_publications.scheduled_at',
      },
      deduplication: 'active_editorial_post_wins_over_linked_task',
      unscheduled_posts_within_period_filter: includeUnscheduled
        ? 'included_with_calendar_date_null'
        : 'excluded',
      excludes: ['client_request:*', 'non_publishable_delivery_types'],
      media: 'safe_metadata_only',
      writes: 'none',
    },
  };
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
  return { items: data ?? [], ...pageMeta(count, limit, offset) };
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
  return { items: data ?? [], ...pageMeta(count, limit, offset) };
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
  return { items: data ?? [], ...pageMeta(count, limit, offset) };
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
  // Revisions are separate from carousel children.
  const { data: versions } = await withTimeout(
    db().from('files').select(F.file).eq('revision_of_file_id', opts.file_id)
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
