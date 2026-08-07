import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  API_GATEWAY_ACTION_SCOPES,
  API_GATEWAY_AUDIENCE,
  LEGACY_API_GATEWAY_ORIGIN,
  LEGACY_API_GATEWAY_SCOPES,
  apiGatewayScopeAllowsClient,
  allowedApiGatewayActions,
  authorizeApiGatewayAction,
  normalizeApiGatewayPageLimit,
  type ApiGatewayAction,
  type ApiGatewayClientScopeMode,
  type ApiGatewayPrincipal,
} from '../_shared/api-gateway-auth.ts'
import { sanitizeAuditError, sanitizeAuditInput } from '../_shared/mcp-security.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
}
const MAX_REQUEST_BYTES = 256 * 1024

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function err(message: string, status = 400) {
  return json({ success: false, error: message }, status)
}

function rateLimited(retryAfterSeconds: unknown) {
  const retryAfter = Number.isInteger(retryAfterSeconds)
    ? Math.max(1, Number(retryAfterSeconds))
    : 60
  return new Response(JSON.stringify({ success: false, error: 'Rate limit exceeded.' }), {
    status: 429,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Retry-After': String(retryAfter),
    },
  })
}

function ok(data: unknown) {
  return json({ success: true, data })
}

function requireFields(params: Record<string, unknown>, fields: string[]) {
  const missing = fields.filter(f => params[f] === undefined || params[f] === null || params[f] === '')
  if (missing.length > 0) throw new Error(`Missing required fields: ${missing.join(', ')}`)
}

function allowedUpdates(
  params: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  entity: string,
): Record<string, unknown> {
  const updates = Object.fromEntries(
    Object.entries(params).filter(([key]) => allowed.has(key)),
  )
  if (Object.keys(updates).length === 0) {
    throw new Error(`No supported ${entity} fields to update`)
  }
  return updates
}

const SAFE_PROFILE_COLUMNS = [
  'id',
  'full_name',
  'email',
  'company_name',
  'avatar_url',
  'plan_renewal_date',
  'plan_status',
  'services_config',
  'onboarding_done',
  'created_at',
  'updated_at',
  'phone',
  'plan_name',
  'plan_value',
  'client_type',
  'brand',
  'first_access_used_at',
  'overdue_since',
  'deleted_at',
].join(',')

const SAFE_PROFILE_UPDATES = new Set([
  'full_name',
  'company_name',
  'avatar_url',
  'plan_renewal_date',
  'plan_status',
  'services_config',
  'onboarding_done',
  'phone',
  'plan_name',
  'plan_value',
  'client_type',
  'brand',
  'overdue_since',
])

const SAFE_FILE_UPDATES = new Set([
  'folder',
  'file_type',
  'description',
  'caption',
  'tags',
  'sensitivity',
])

const SAFE_PROJECT_UPDATES = new Set([
  'billing_mode', 'brand', 'deadline', 'description', 'name', 'objectives',
  'pipeline', 'progress', 'project_type', 'scope', 'start_date', 'status',
  'total_value',
])
const SAFE_TASK_UPDATES = new Set([
  'assigned_to', 'delivery_type', 'description', 'due_date', 'kanban_status',
  'milestone_id', 'node_type', 'priority', 'progress', 'sort_order', 'status',
  'task_order', 'title', 'workstream',
])
const SAFE_MILESTONE_UPDATES = new Set([
  'description', 'milestone_order', 'status', 'target_date', 'title',
])
const SAFE_REPORT_UPDATES = new Set([
  'chart_data', 'chart_type', 'file_url', 'highlights', 'images',
  'internal_notes', 'metrics', 'next_steps', 'period_end', 'period_start',
  'status', 'summary', 'title',
])
const SAFE_BILLING_UPDATES = new Set([
  'amount', 'description', 'due_date', 'paid_amount', 'paid_date', 'platform',
  'status', 'type',
])
const SAFE_REQUEST_UPDATES = new Set([
  'ai_draft', 'description', 'priority', 'status', 'title',
])
const SAFE_WALLET_UPDATES = new Set(['balance', 'last_recharge_date'])
const SAFE_RECHARGE_UPDATES = new Set(['amount', 'reason', 'status'])
const SAFE_CHECKLIST_UPDATES = new Set(['checked', 'item_order', 'title'])

function requireActor(context: GatewayRequestContext): string {
  if (!context.principal.ownerId) throw new Error('API key has no bound owner')
  return context.principal.ownerId
}

// ─── Handlers ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any
interface GatewayRequestContext {
  principal: ApiGatewayPrincipal
}

function scopeClientQuery(
  query: DB,
  context: GatewayRequestContext,
  column = 'client_id',
): DB {
  return context.principal.scope === 'explicit'
    ? query.in(column, context.principal.clientIds)
    : query
}

function withoutScopeRelation(data: unknown, relation: string): unknown {
  if (!Array.isArray(data)) return data
  return data.map(row => {
    if (!row || typeof row !== 'object') return row
    const { [relation]: _scopeRelation, ...result } = row as Record<string, unknown>
    return result
  })
}

async function lookupRow(
  db: DB,
  table: string,
  idColumn: string,
  id: unknown,
  columns: string,
): Promise<Record<string, unknown> | null> {
  if (typeof id !== 'string' || !id) return null
  const { data, error } = await db
    .from(table)
    .select(columns)
    .eq(idColumn, id)
    .maybeSingle()
  if (error) throw error
  return data && typeof data === 'object' ? data as Record<string, unknown> : null
}

async function projectClientId(db: DB, projectId: unknown): Promise<string | null> {
  const row = await lookupRow(db, 'projects', 'id', projectId, 'client_id')
  return typeof row?.client_id === 'string' ? row.client_id : null
}

async function projectBoundClientId(
  db: DB,
  table: string,
  idColumn: string,
  id: unknown,
): Promise<string | null> {
  const row = await lookupRow(db, table, idColumn, id, 'project_id')
  return row ? projectClientId(db, row.project_id) : null
}

async function directRowClientId(
  db: DB,
  table: string,
  idColumn: string,
  id: unknown,
  clientColumn = 'client_id',
): Promise<string | null> {
  const row = await lookupRow(db, table, idColumn, id, clientColumn)
  return typeof row?.[clientColumn] === 'string' ? row[clientColumn] as string : null
}

async function briefingClientIds(db: DB, briefingId: unknown): Promise<string[] | null> {
  const row = await lookupRow(db, 'briefings', 'id', briefingId, 'client_id,project_id')
  if (!row) return null
  const result: string[] = []
  if (typeof row.client_id === 'string') result.push(row.client_id)
  if (typeof row.project_id === 'string') {
    const projectClient = await projectClientId(db, row.project_id)
    if (!projectClient) return null
    result.push(projectClient)
  }
  return result.length > 0 ? result : null
}

async function actionTenantAllowed(
  db: DB,
  action: ApiGatewayAction,
  params: Record<string, unknown>,
  principal: ApiGatewayPrincipal,
): Promise<boolean> {
  if (action === 'health' || action === 'get_schema') return true
  if (action === 'create_client' || action === 'list_team' || action === 'list_audit_log') {
    return principal.scope === 'all'
  }

  const clientIds: string[] = []
  let unresolved = false
  const add = (clientId: string | null) => {
    if (clientId) clientIds.push(clientId)
    else unresolved = true
  }

  if (params.client_id !== undefined) {
    add(typeof params.client_id === 'string' && params.client_id ? params.client_id : null)
  }
  if (params.project_id !== undefined) add(await projectClientId(db, params.project_id))
  if (params.task_id !== undefined) {
    add(await projectBoundClientId(db, 'tasks', 'id', params.task_id))
  }
  if (params.milestone_id !== undefined) {
    add(await projectBoundClientId(db, 'milestones', 'id', params.milestone_id))
  }

  const directTargets: Partial<Record<ApiGatewayAction, [string, string, string]>> = {
    update_file: ['files', 'file_id', 'client_id'],
    update_report: ['reports', 'report_id', 'client_id'],
    update_billing: ['billing', 'billing_id', 'client_id'],
    update_request: ['client_requests', 'request_id', 'client_id'],
    update_wallet: ['ads_wallet', 'wallet_id', 'client_id'],
    update_recharge: ['recharge_requests', 'recharge_id', 'client_id'],
    mark_notification_read: ['notifications', 'notification_id', 'user_id'],
  }
  const directTarget = directTargets[action]
  if (directTarget) {
    const [table, idParam, clientColumn] = directTarget
    add(await directRowClientId(db, table, 'id', params[idParam], clientColumn))
  }

  if (action === 'get_briefing') {
    const resolved = await briefingClientIds(db, params.briefing_id)
    if (!resolved) unresolved = true
    else clientIds.push(...resolved)
  }
  if (action === 'update_checklist_item') {
    const checklist = await lookupRow(
      db,
      'task_checklist_items',
      'id',
      params.item_id,
      'task_id',
    )
    add(checklist
      ? await projectBoundClientId(db, 'tasks', 'id', checklist.task_id)
      : null)
  }
  if (action === 'list_notifications' || action === 'send_notification') {
    if (params.user_id !== undefined) {
      add(typeof params.user_id === 'string' && params.user_id ? params.user_id : null)
    }
  }

  if (unresolved) return false
  const uniqueClientIds = [...new Set(clientIds)]
  if (uniqueClientIds.length === 0) return true
  if (uniqueClientIds.length > 1) return false

  const { data: clientRoles, error: clientRoleError } = await db
    .from('user_roles')
    .select('user_id')
    .eq('role', 'client')
    .in('user_id', uniqueClientIds)
  if (clientRoleError) throw clientRoleError
  const currentClientIds = new Set(
    (clientRoles ?? [])
      .map((row: Record<string, unknown>) => row.user_id)
      .filter((id: unknown): id is string => typeof id === 'string'),
  )
  if (uniqueClientIds.some(clientId => !currentClientIds.has(clientId))) return false

  return uniqueClientIds.every(clientId => apiGatewayScopeAllowsClient(principal, clientId))
}
type Handler = (
  db: DB,
  params: Record<string, any>,
  context: GatewayRequestContext,
) => Promise<Response>

const handlers: Record<ApiGatewayAction, Handler> = {

  // ── System ──
  health: async () => ok({ status: 'ok', version: '1.1', timestamp: new Date().toISOString() }),

  get_schema: async (_db, _params, context) => {
    const actions = allowedApiGatewayActions(context.principal)
    const contextParams = {
      get_wallet: 'Requires client_id — returns all wallets for a specific client',
      list_notifications: 'Requires user_id — returns notifications for a specific user',
      list_billing: 'Optional client_id — filters billing by client. Without it returns all.',
      list_tasks: 'Optional project_id, status, assigned_to, milestone_id to filter',
      list_files: 'Optional client_id, project_id, approval_status to filter',
      list_reports: 'Optional client_id, project_id, status to filter',
      list_payments: 'Optional client_id, project_id to filter',
      list_recharges: 'Optional client_id, status to filter',
      list_requests: 'Optional client_id, status to filter',
    } satisfies Partial<Record<ApiGatewayAction, string>>
    return ok({
      version: '1.1',
      actions,
      required_scopes: Object.fromEntries(
        actions.map(action => [action, API_GATEWAY_ACTION_SCOPES[action]]),
      ),
      docs: 'POST with { "action": "<name>", ...params }. Auth via X-API-Key header.',
      context_params: Object.fromEntries(
        Object.entries(contextParams)
          .filter(([action]) => actions.includes(action as ApiGatewayAction)),
      ),
    })
  },

  // ── Clients (profiles with role=client) ──
  list_clients: async (db, p, context) => {
    let q = db
      .from('profiles')
      .select(`${SAFE_PROFILE_COLUMNS}, client_roles:user_roles!inner(role)`)
      .eq('client_roles.role', 'client')
    q = scopeClientQuery(q, context, 'id')
    if (p.plan_status) q = q.eq('plan_status', p.plan_status)
    q = q.limit(normalizeApiGatewayPageLimit(p.limit))
    const { data, error } = await q.order('created_at', { ascending: false })
    if (error) throw error
    return ok(withoutScopeRelation(data, 'client_roles'))
  },

  get_client: async (db, p, context) => {
    requireFields(p, ['client_id'])
    let q = db.from('profiles').select(SAFE_PROFILE_COLUMNS).eq('id', p.client_id)
    q = scopeClientQuery(q, context, 'id')
    const { data, error } = await q.single()
    if (error) throw error
    return ok(data)
  },

  create_client: async (db, p) => {
    requireFields(p, ['email', 'full_name'])
    // Create auth user first
    const { data: authData, error: authErr } = await db.auth.admin.createUser({
      email: p.email,
      password: p.password || crypto.randomUUID().slice(0, 12),
      email_confirm: true,
      user_metadata: {
        full_name: p.full_name,
        company_name: p.company_name || null,
        role: 'client',
      },
    })
    if (authErr) throw authErr
    // Update profile with extra fields
    if (p.phone || p.plan_name || p.plan_value || p.plan_renewal_date) {
      await db.from('profiles').update({
        phone: p.phone || null,
        plan_name: p.plan_name || null,
        plan_value: p.plan_value || null,
        plan_renewal_date: p.plan_renewal_date || null,
      }).eq('id', authData.user.id)
    }
    return ok({ id: authData.user.id, email: p.email })
  },

  update_client: async (db, p, context) => {
    requireFields(p, ['client_id'])
    const updates = Object.fromEntries(
      Object.entries(p).filter(([key]) => SAFE_PROFILE_UPDATES.has(key)),
    )
    if (Object.keys(updates).length === 0) {
      throw new Error('No supported profile fields to update')
    }
    let q = db
      .from('profiles')
      .update(updates)
      .eq('id', p.client_id)
    q = scopeClientQuery(q, context, 'id')
    const { data, error } = await q
      .select(SAFE_PROFILE_COLUMNS)
      .single()
    if (error) throw error
    return ok(data)
  },

  // ── Projects ──
  list_projects: async (db, p, context) => {
    let q = db.from('projects').select('*')
    q = scopeClientQuery(q, context)
    if (p.client_id) q = q.eq('client_id', p.client_id)
    if (p.status) q = q.eq('status', p.status)
    q = q.limit(normalizeApiGatewayPageLimit(p.limit))
    const { data, error } = await q.order('created_at', { ascending: false })
    if (error) throw error
    return ok(data)
  },

  get_project: async (db, p, context) => {
    requireFields(p, ['project_id'])
    let q = db.from('projects').select('*, milestones(*), tasks(*)').eq('id', p.project_id)
    q = scopeClientQuery(q, context)
    const { data, error } = await q.single()
    if (error) throw error
    return ok(data)
  },

  create_project: async (db, p, context) => {
    requireFields(p, ['client_id', 'name', 'project_type', 'start_date', 'deadline'])
    const { data, error } = await db.from('projects').insert({
      client_id: p.client_id,
      name: p.name,
      project_type: p.project_type,
      start_date: p.start_date,
      deadline: p.deadline,
      description: p.description || null,
      objectives: p.objectives || null,
      scope: p.scope || null,
      status: p.status || 'planning',
      created_by: requireActor(context),
    }).select().single()
    if (error) throw error
    return ok(data)
  },

  update_project: async (db, p, context) => {
    requireFields(p, ['project_id'])
    const updates = allowedUpdates(p, SAFE_PROJECT_UPDATES, 'project')
    let q = db.from('projects').update(updates).eq('id', p.project_id)
    q = scopeClientQuery(q, context)
    const { data, error } = await q.select().single()
    if (error) throw error
    return ok(data)
  },

  delete_project: async (db, p, context) => {
    requireFields(p, ['project_id'])
    let q = db.from('projects').delete().eq('id', p.project_id)
    q = scopeClientQuery(q, context)
    const { error } = await q
    if (error) throw error
    return ok({ deleted: p.project_id })
  },

  // ── Tasks ──
  list_tasks: async (db, p, context) => {
    let q = db.from('tasks').select('*, scope_project:projects!inner(client_id)')
    if (context.principal.scope === 'explicit') {
      q = q.in('scope_project.client_id', context.principal.clientIds)
    }
    if (p.project_id) q = q.eq('project_id', p.project_id)
    if (p.status) q = q.eq('status', p.status)
    if (p.assigned_to) q = q.eq('assigned_to', p.assigned_to)
    if (p.milestone_id) q = q.eq('milestone_id', p.milestone_id)
    q = q.limit(normalizeApiGatewayPageLimit(p.limit))
    const { data, error } = await q.order('task_order', { ascending: true })
    if (error) throw error
    return ok(withoutScopeRelation(data, 'scope_project'))
  },

  get_task: async (db, p) => {
    requireFields(p, ['task_id'])
    const { data, error } = await db.from('tasks').select('*, task_comments(*), task_checklist_items(*), task_attachments(*)').eq('id', p.task_id).single()
    if (error) throw error
    return ok(data)
  },

  create_task: async (db, p) => {
    requireFields(p, ['project_id', 'title'])
    const { data, error } = await db.from('tasks').insert({
      project_id: p.project_id,
      title: p.title,
      description: p.description || null,
      status: p.status || 'backlog',
      priority: p.priority || 'medium',
      assigned_to: p.assigned_to || null,
      due_date: p.due_date || null,
      milestone_id: p.milestone_id || null,
      task_order: p.task_order || 0,
    }).select().single()
    if (error) throw error
    return ok(data)
  },

  update_task: async (db, p) => {
    requireFields(p, ['task_id'])
    const updates = allowedUpdates(p, SAFE_TASK_UPDATES, 'task')
    const { data, error } = await db.from('tasks').update(updates).eq('id', p.task_id).select().single()
    if (error) throw error
    return ok(data)
  },

  delete_task: async (db, p) => {
    requireFields(p, ['task_id'])
    const { error } = await db.from('tasks').delete().eq('id', p.task_id)
    if (error) throw error
    return ok({ deleted: p.task_id })
  },

  // ── Milestones ──
  list_milestones: async (db, p, context) => {
    let q = db.from('milestones').select('*, scope_project:projects!inner(client_id)')
    if (context.principal.scope === 'explicit') {
      q = q.in('scope_project.client_id', context.principal.clientIds)
    }
    if (p.project_id) q = q.eq('project_id', p.project_id)
    q = q.limit(normalizeApiGatewayPageLimit(p.limit))
    const { data, error } = await q.order('milestone_order', { ascending: true })
    if (error) throw error
    return ok(withoutScopeRelation(data, 'scope_project'))
  },

  create_milestone: async (db, p) => {
    requireFields(p, ['project_id', 'title', 'target_date'])
    const { data, error } = await db.from('milestones').insert({
      project_id: p.project_id,
      title: p.title,
      description: p.description || null,
      target_date: p.target_date,
      milestone_order: p.milestone_order || 0,
      status: p.status || 'pending',
    }).select().single()
    if (error) throw error
    return ok(data)
  },

  update_milestone: async (db, p) => {
    requireFields(p, ['milestone_id'])
    const updates = allowedUpdates(p, SAFE_MILESTONE_UPDATES, 'milestone')
    const { data, error } = await db.from('milestones').update(updates).eq('id', p.milestone_id).select().single()
    if (error) throw error
    return ok(data)
  },

  // ── Files ──
  list_files: async (db, p, context) => {
    let q = db.from('files').select('*')
    q = scopeClientQuery(q, context)
    if (p.client_id) q = q.eq('client_id', p.client_id)
    if (p.project_id) q = q.eq('project_id', p.project_id)
    if (p.approval_status) q = q.eq('approval_status', p.approval_status)
    q = q.limit(normalizeApiGatewayPageLimit(p.limit))
    const { data, error } = await q.order('created_at', { ascending: false })
    if (error) throw error
    return ok(data)
  },

  update_file: async (db, p, context) => {
    requireFields(p, ['file_id'])
    const { file_id } = p
    const updates = Object.fromEntries(
      Object.entries(p).filter(([key]) => SAFE_FILE_UPDATES.has(key)),
    )
    if (Object.keys(updates).length === 0) {
      throw new Error('No supported file metadata fields to update')
    }
    let q = db.from('files').update(updates).eq('id', file_id)
    q = scopeClientQuery(q, context)
    const { data, error } = await q.select().single()
    if (error) throw error
    return ok(data)
  },

  // ── Reports ──
  list_reports: async (db, p, context) => {
    let q = db.from('reports').select('*')
    q = scopeClientQuery(q, context)
    if (p.client_id) q = q.eq('client_id', p.client_id)
    if (p.project_id) q = q.eq('project_id', p.project_id)
    if (p.status) q = q.eq('status', p.status)
    q = q.limit(normalizeApiGatewayPageLimit(p.limit))
    const { data, error } = await q.order('created_at', { ascending: false })
    if (error) throw error
    return ok(data)
  },

  create_report: async (db, p, context) => {
    requireFields(p, ['client_id', 'project_id', 'title'])
    const { data, error } = await db.from('reports').insert({
      client_id: p.client_id,
      project_id: p.project_id,
      title: p.title,
      summary: p.summary || null,
      highlights: p.highlights || null,
      next_steps: p.next_steps || null,
      metrics: p.metrics || {},
      chart_data: p.chart_data || [],
      chart_type: p.chart_type || 'area',
      period_start: p.period_start || null,
      period_end: p.period_end || null,
      status: p.status || 'draft',
      created_by: requireActor(context),
      internal_notes: p.internal_notes || null,
    }).select().single()
    if (error) throw error
    return ok(data)
  },

  update_report: async (db, p, context) => {
    requireFields(p, ['report_id'])
    const updates = allowedUpdates(p, SAFE_REPORT_UPDATES, 'report')
    let q = db.from('reports').update(updates).eq('id', p.report_id)
    q = scopeClientQuery(q, context)
    const { data, error } = await q.select().single()
    if (error) throw error
    return ok(data)
  },

  // ── Billing ──
  list_billing: async (db, p, context) => {
    let q = db.from('billing').select('*')
    q = scopeClientQuery(q, context)
    if (p.client_id) q = q.eq('client_id', p.client_id)
    if (p.status) q = q.eq('status', p.status)
    q = q.limit(normalizeApiGatewayPageLimit(p.limit))
    const { data, error } = await q.order('due_date', { ascending: false })
    if (error) throw error
    return ok(data)
  },

  create_billing: async (db, p) => {
    requireFields(p, ['client_id', 'amount', 'due_date', 'type'])
    const { data, error } = await db.from('billing').insert({
      client_id: p.client_id,
      amount: p.amount,
      due_date: p.due_date,
      type: p.type,
      description: p.description || null,
      status: p.status || 'pending',
      platform: p.platform || null,
    }).select().single()
    if (error) throw error
    return ok(data)
  },

  update_billing: async (db, p, context) => {
    requireFields(p, ['billing_id'])
    const updates = allowedUpdates(p, SAFE_BILLING_UPDATES, 'billing')
    let q = db.from('billing').update(updates).eq('id', p.billing_id)
    q = scopeClientQuery(q, context)
    const { data, error } = await q.select().single()
    if (error) throw error
    return ok(data)
  },

  // ── Client Requests ──
  list_requests: async (db, p, context) => {
    let q = db.from('client_requests').select('*')
    q = scopeClientQuery(q, context)
    if (p.client_id) q = q.eq('client_id', p.client_id)
    if (p.status) q = q.eq('status', p.status)
    q = q.limit(normalizeApiGatewayPageLimit(p.limit))
    const { data, error } = await q.order('created_at', { ascending: false })
    if (error) throw error
    return ok(data)
  },

  create_request: async (db, p) => {
    requireFields(p, ['client_id', 'title', 'description'])
    const { data, error } = await db.from('client_requests').insert({
      client_id: p.client_id,
      title: p.title,
      description: p.description,
      priority: p.priority || 'normal',
      project_id: p.project_id || null,
    }).select().single()
    if (error) throw error
    return ok(data)
  },

  update_request: async (db, p, context) => {
    requireFields(p, ['request_id'])
    const updates = allowedUpdates(p, SAFE_REQUEST_UPDATES, 'request')
    let q = db.from('client_requests').update(updates).eq('id', p.request_id)
    q = scopeClientQuery(q, context)
    const { data, error } = await q.select().single()
    if (error) throw error
    return ok(data)
  },

  // ── Briefings ──
  list_briefings: async (db, p, context) => {
    let q = db.from('briefings').select('*')
    q = scopeClientQuery(q, context)
    if (p.client_id) q = q.eq('client_id', p.client_id)
    if (p.submitted !== undefined) q = q.eq('submitted', p.submitted)
    q = q.limit(normalizeApiGatewayPageLimit(p.limit))
    const { data, error } = await q.order('created_at', { ascending: false })
    if (error) throw error
    return ok(data)
  },

  get_briefing: async (db, p) => {
    requireFields(p, ['briefing_id'])
    const { data, error } = await db.from('briefings').select('*').eq('id', p.briefing_id).single()
    if (error) throw error
    return ok(data)
  },

  // ── Updates Feed ──
  create_update: async (db, p, context) => {
    requireFields(p, ['project_id', 'message', 'update_type'])
    const { data, error } = await db.from('updates').insert({
      project_id: p.project_id,
      author_id: requireActor(context),
      message: p.message,
      update_type: p.update_type,
    }).select().single()
    if (error) throw error
    return ok(data)
  },

  // ── Ads Wallet ──
  get_wallet: async (db, p, context) => {
    requireFields(p, ['client_id'])
    let q = db.from('ads_wallet').select('*').eq('client_id', p.client_id)
    q = scopeClientQuery(q, context)
    q = q.limit(normalizeApiGatewayPageLimit(p.limit))
    const { data, error } = await q
    if (error) throw error
    return ok(data)
  },

  update_wallet: async (db, p, context) => {
    requireFields(p, ['wallet_id'])
    const updates = allowedUpdates(p, SAFE_WALLET_UPDATES, 'wallet')
    let q = db.from('ads_wallet').update(updates).eq('id', p.wallet_id)
    q = scopeClientQuery(q, context)
    const { data, error } = await q.select().single()
    if (error) throw error
    return ok(data)
  },

  // ── Project Payments ──
  list_payments: async (db, p, context) => {
    let q = db.from('project_payments').select('*, payment_installments(*)')
    q = scopeClientQuery(q, context)
    if (p.client_id) q = q.eq('client_id', p.client_id)
    if (p.project_id) q = q.eq('project_id', p.project_id)
    q = q.limit(normalizeApiGatewayPageLimit(p.limit))
    const { data, error } = await q.order('created_at', { ascending: false })
    if (error) throw error
    return ok(data)
  },

  // ── User Roles ──
  list_team: async (db, p) => {
    const { data, error } = await db
      .from('user_roles')
      .select(`*, profiles(${SAFE_PROFILE_COLUMNS})`)
      .neq('role', 'client')
      .limit(normalizeApiGatewayPageLimit(p.limit))
    if (error) throw error
    return ok(data)
  },

  // ── Recharge Requests ──
  list_recharges: async (db, p, context) => {
    let q = db.from('recharge_requests').select('*')
    q = scopeClientQuery(q, context)
    if (p.client_id) q = q.eq('client_id', p.client_id)
    if (p.status) q = q.eq('status', p.status)
    q = q.limit(normalizeApiGatewayPageLimit(p.limit))
    const { data, error } = await q.order('created_at', { ascending: false })
    if (error) throw error
    return ok(data)
  },

  update_recharge: async (db, p, context) => {
    requireFields(p, ['recharge_id'])
    const updates = allowedUpdates(p, SAFE_RECHARGE_UPDATES, 'recharge')
    if (updates.status === 'approved') updates.approved_by = requireActor(context)
    let q = db.from('recharge_requests').update(updates).eq('id', p.recharge_id)
    q = scopeClientQuery(q, context)
    const { data, error } = await q.select().single()
    if (error) throw error
    return ok(data)
  },

  // ── Task Comments ──
  create_comment: async (db, p, context) => {
    requireFields(p, ['task_id', 'content'])
    const { data, error } = await db.from('task_comments').insert({
      task_id: p.task_id,
      author_id: requireActor(context),
      content: p.content,
    }).select().single()
    if (error) throw error
    return ok(data)
  },

  // ── Task Checklist ──
  create_checklist_item: async (db, p, context) => {
    requireFields(p, ['task_id', 'title'])
    const { data, error } = await db.from('task_checklist_items').insert({
      task_id: p.task_id,
      created_by: requireActor(context),
      title: p.title,
      item_order: p.item_order || 0,
    }).select().single()
    if (error) throw error
    return ok(data)
  },

  update_checklist_item: async (db, p) => {
    requireFields(p, ['item_id'])
    const updates = allowedUpdates(p, SAFE_CHECKLIST_UPDATES, 'checklist item')
    const { data, error } = await db.from('task_checklist_items').update(updates).eq('id', p.item_id).select().single()
    if (error) throw error
    return ok(data)
  },
  // ── Notifications ──
  list_notifications: async (db, p, context) => {
    let q = db.from('notifications').select('*')
    q = scopeClientQuery(q, context, 'user_id')
    if (p.user_id) q = q.eq('user_id', p.user_id)
    if (p.read !== undefined) q = q.eq('read', p.read)
    if (p.notification_type) q = q.eq('notification_type', p.notification_type)
    q = q
      .order('created_at', { ascending: false })
      .limit(normalizeApiGatewayPageLimit(p.limit))
    const { data, error } = await q
    if (error) throw error
    return ok(data)
  },

  send_notification: async (db, p) => {
    requireFields(p, ['user_id', 'message', 'notification_type'])
    const notificationLink = typeof p.link === 'string' ? p.link.trim() : ''
    if (
      notificationLink.length > 2048
      || (notificationLink && (
        !notificationLink.startsWith('/')
        || notificationLink.startsWith('//')
        || notificationLink.includes('\\')
        || /%5c/i.test(notificationLink)
        || /[\u0000-\u001f\u007f]/.test(notificationLink)
      ))
    ) {
      throw new Error('link must be a safe application-relative path')
    }
    const { data, error } = await db.from('notifications').insert({
      user_id: p.user_id,
      message: p.message,
      notification_type: p.notification_type,
      link: notificationLink || null,
    }).select().single()
    if (error) throw error
    return ok(data)
  },

  mark_notification_read: async (db, p, context) => {
    requireFields(p, ['notification_id'])
    let q = db.from('notifications').update({ read: true }).eq('id', p.notification_id)
    q = scopeClientQuery(q, context, 'user_id')
    const { data, error } = await q.select().single()
    if (error) throw error
    return ok(data)
  },

  // ── Audit Log ──
  list_audit_log: async (db, p) => {
    let q = db.from('api_audit_log').select('*')
    if (p.action) q = q.eq('action', p.action)
    if (p.ip_address) q = q.eq('ip_address', p.ip_address)
    q = q.limit(normalizeApiGatewayPageLimit(p.limit))
    const { data, error } = await q.order('created_at', { ascending: false })
    if (error) throw error
    return ok(data)
  },
}

// SHA-256 hash helper
async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // Create service-role client early (needed for key validation)
  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  let body: Record<string, any> | undefined

  try {
    // Auth check — validate against DB keys
    const apiKey = req.headers.get('x-api-key')
    if (!apiKey) {
      return err('Missing API key. Send X-API-Key header.', 401)
    }

    const keyHash = await sha256(apiKey)

    // The legacy environment key remains discovery-only during rotation.
    const legacyKey = Deno.env.get('EXTERNAL_API_KEY')
    let keyName = 'legacy'
    let principal: ApiGatewayPrincipal

    if (legacyKey && apiKey === legacyKey) {
      principal = {
        audience: API_GATEWAY_AUDIENCE,
        origin: LEGACY_API_GATEWAY_ORIGIN,
        scopes: LEGACY_API_GATEWAY_SCOPES,
        keyId: null,
        ownerId: null,
        ownerIsAdmin: false,
        scope: 'none',
        clientIds: [],
      }
    } else {
      const { data, error: keyErr } = await db.rpc('validate_api_key_for_audience', {
        _key_hash: keyHash,
        _audience: API_GATEWAY_AUDIENCE,
      })
      const keyRow = Array.isArray(data) ? data[0] : data
      if (keyErr || !keyRow) {
        return err('Invalid API key.', 401)
      }
      keyName = keyRow.name
      const clientScopeMode: ApiGatewayClientScopeMode = (
        keyRow.client_scope_mode === 'explicit' || keyRow.client_scope_mode === 'all'
      ) ? keyRow.client_scope_mode : 'none'
      principal = {
        audience: typeof keyRow.audience === 'string' ? keyRow.audience : null,
        origin: typeof keyRow.origin === 'string' ? keyRow.origin : null,
        scopes: Array.isArray(keyRow.scopes)
          ? keyRow.scopes.filter((scope: unknown): scope is string => typeof scope === 'string')
          : [],
        keyId: typeof keyRow.id === 'string' ? keyRow.id : null,
        ownerId: typeof keyRow.created_by === 'string' ? keyRow.created_by : null,
        ownerIsAdmin: keyRow.owner_is_admin === true,
        scope: clientScopeMode,
        clientIds: Array.isArray(keyRow.client_ids)
          ? keyRow.client_ids.filter((id: unknown): id is string => typeof id === 'string')
          : [],
      }
      // Update last_used_at
      db.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRow.id).then(() => {})
    }

    const { data: rateData, error: rateError } = await db.rpc(
      'consume_api_gateway_rate_limit',
      { _key_fingerprint: keyHash },
    )
    const rateRow = Array.isArray(rateData) ? rateData[0] : rateData
    if (rateError || !rateRow || typeof rateRow.is_allowed !== 'boolean') {
      return err('API gateway rate limit unavailable.', 503)
    }
    if (!rateRow.is_allowed) return rateLimited(rateRow.retry_after_seconds)

    // Parse body
    try {
      const declaredLength = Number(req.headers.get('content-length') || '0')
      if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
        return err('Request body too large.', 413)
      }
      const rawBody = await req.text()
      if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
        return err('Request body too large.', 413)
      }
      const parsed: unknown = JSON.parse(rawBody)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return err('Invalid JSON body. Send an object.', 400)
      }
      body = parsed as Record<string, any>
    } catch {
      return err('Invalid JSON body. Send { "action": "...", ...params }')
    }

    const { action, ...params } = body!
    if (!action || typeof action !== 'string') {
      return err('Missing "action" field. Use get_schema to list available actions.')
    }

    // Get client IP
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('cf-connecting-ip')
      || req.headers.get('x-real-ip')
      || 'unknown'

    const authorization = authorizeApiGatewayAction(principal, action)
    if (!authorization.allowed) {
      const status = authorization.reason === 'unknown_action' ? 404 : 403
      const message = authorization.reason === 'unknown_action'
        ? `Unknown action "${action}". Use get_schema to list available actions.`
        : 'API key is not authorized for this action.'

      db.from('api_audit_log').insert({
        action,
        ip_address: ip,
        status_code: status,
        params: Object.keys(params).length > 0 ? sanitizeAuditInput(params) : null,
        key_name: keyName,
        error_message: authorization.reason,
      }).then(() => {})
      return err(message, status)
    }

    const handler = handlers[authorization.action]
    const tenantAllowed = await actionTenantAllowed(
      db,
      authorization.action,
      params,
      principal,
    )
    if (!tenantAllowed) {
      db.from('api_audit_log').insert({
        action,
        ip_address: ip,
        status_code: 403,
        params: Object.keys(params).length > 0 ? sanitizeAuditInput(params) : null,
        key_name: keyName,
        error_message: 'tenant_scope_denied',
      }).then(() => {})
      return err('API key is not authorized for this client.', 403)
    }
    const response = await handler(db, params, { principal })

    // Log audit (fire-and-forget)
    db.from('api_audit_log').insert({
      action,
      ip_address: ip,
      status_code: response.status,
      params: Object.keys(params).length > 0 ? sanitizeAuditInput(params) : null,
      key_name: keyName,
    }).then(() => {})

    return response
  } catch (e: any) {
    console.error('API Gateway error:', e)

    try {
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
      db.from('api_audit_log').insert({
        action: body?.action || 'unknown',
        ip_address: ip,
        status_code: 500,
        error_message: sanitizeAuditError(e.message || 'Internal error'),
      }).then(() => {})
    } catch {}

    return err('Internal server error', 500)
  }
})
