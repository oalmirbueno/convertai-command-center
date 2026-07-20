import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sanitizeAuditError, sanitizeAuditInput } from '../_shared/mcp-security.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function err(message: string, status = 400) {
  return json({ success: false, error: message }, status)
}

function ok(data: unknown) {
  return json({ success: true, data })
}

function requireFields(params: Record<string, unknown>, fields: string[]) {
  const missing = fields.filter(f => params[f] === undefined || params[f] === null || params[f] === '')
  if (missing.length > 0) throw new Error(`Missing required fields: ${missing.join(', ')}`)
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

// ─── Handlers ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any
type Handler = (db: DB, params: Record<string, any>) => Promise<Response>

const handlers: Record<string, Handler> = {

  // ── System ──
  health: async () => ok({ status: 'ok', version: '1.1', timestamp: new Date().toISOString() }),

  get_schema: async () => ok({
    version: '1.1',
    actions: Object.keys(handlers).sort(),
    docs: 'POST with { "action": "<name>", ...params }. Auth via X-API-Key header.',
    context_params: {
      get_wallet: 'Requires client_id — returns all wallets for a specific client',
      list_notifications: 'Requires user_id — returns notifications for a specific user',
      list_billing: 'Optional client_id — filters billing by client. Without it returns all.',
      list_tasks: 'Optional project_id, status, assigned_to, milestone_id to filter',
      list_files: 'Optional client_id, project_id, approval_status to filter',
      list_reports: 'Optional client_id, project_id, status to filter',
      list_payments: 'Optional client_id, project_id to filter',
      list_recharges: 'Optional client_id, status to filter',
      list_requests: 'Optional client_id, status to filter',
    },
  }),

  // ── Clients (profiles with role=client) ──
  list_clients: async (db, p) => {
    // Get client user_ids first
    const { data: roles, error: rolesErr } = await db.from('user_roles').select('user_id').eq('role', 'client')
    if (rolesErr) throw rolesErr
    const clientIds = (roles || []).map((r: any) => r.user_id)
    if (clientIds.length === 0) return ok([])
    let q = db.from('profiles').select(SAFE_PROFILE_COLUMNS).in('id', clientIds)
    if (p.plan_status) q = q.eq('plan_status', p.plan_status)
    if (p.limit) q = q.limit(p.limit)
    const { data, error } = await q.order('created_at', { ascending: false })
    if (error) throw error
    return ok(data)
  },

  get_client: async (db, p) => {
    requireFields(p, ['client_id'])
    const { data, error } = await db.from('profiles').select(SAFE_PROFILE_COLUMNS).eq('id', p.client_id).single()
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

  update_client: async (db, p) => {
    requireFields(p, ['client_id'])
    const updates = Object.fromEntries(
      Object.entries(p).filter(([key]) => SAFE_PROFILE_UPDATES.has(key)),
    )
    if (Object.keys(updates).length === 0) {
      throw new Error('No supported profile fields to update')
    }
    const { data, error } = await db
      .from('profiles')
      .update(updates)
      .eq('id', p.client_id)
      .select(SAFE_PROFILE_COLUMNS)
      .single()
    if (error) throw error
    return ok(data)
  },

  // ── Projects ──
  list_projects: async (db, p) => {
    let q = db.from('projects').select('*')
    if (p.client_id) q = q.eq('client_id', p.client_id)
    if (p.status) q = q.eq('status', p.status)
    if (p.limit) q = q.limit(p.limit)
    const { data, error } = await q.order('created_at', { ascending: false })
    if (error) throw error
    return ok(data)
  },

  get_project: async (db, p) => {
    requireFields(p, ['project_id'])
    const { data, error } = await db.from('projects').select('*, milestones(*), tasks(*)').eq('id', p.project_id).single()
    if (error) throw error
    return ok(data)
  },

  create_project: async (db, p) => {
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
      created_by: p.created_by || null,
    }).select().single()
    if (error) throw error
    return ok(data)
  },

  update_project: async (db, p) => {
    requireFields(p, ['project_id'])
    const { project_id, ...updates } = p
    delete updates.action
    const { data, error } = await db.from('projects').update(updates).eq('id', project_id).select().single()
    if (error) throw error
    return ok(data)
  },

  delete_project: async (db, p) => {
    requireFields(p, ['project_id'])
    const { error } = await db.from('projects').delete().eq('id', p.project_id)
    if (error) throw error
    return ok({ deleted: p.project_id })
  },

  // ── Tasks ──
  list_tasks: async (db, p) => {
    let q = db.from('tasks').select('*')
    if (p.project_id) q = q.eq('project_id', p.project_id)
    if (p.status) q = q.eq('status', p.status)
    if (p.assigned_to) q = q.eq('assigned_to', p.assigned_to)
    if (p.milestone_id) q = q.eq('milestone_id', p.milestone_id)
    if (p.limit) q = q.limit(p.limit)
    const { data, error } = await q.order('task_order', { ascending: true })
    if (error) throw error
    return ok(data)
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
    const { task_id, ...updates } = p
    delete updates.action
    const { data, error } = await db.from('tasks').update(updates).eq('id', task_id).select().single()
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
  list_milestones: async (db, p) => {
    let q = db.from('milestones').select('*')
    if (p.project_id) q = q.eq('project_id', p.project_id)
    const { data, error } = await q.order('milestone_order', { ascending: true })
    if (error) throw error
    return ok(data)
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
    const { milestone_id, ...updates } = p
    delete updates.action
    const { data, error } = await db.from('milestones').update(updates).eq('id', milestone_id).select().single()
    if (error) throw error
    return ok(data)
  },

  // ── Files ──
  list_files: async (db, p) => {
    let q = db.from('files').select('*')
    if (p.client_id) q = q.eq('client_id', p.client_id)
    if (p.project_id) q = q.eq('project_id', p.project_id)
    if (p.approval_status) q = q.eq('approval_status', p.approval_status)
    if (p.limit) q = q.limit(p.limit)
    const { data, error } = await q.order('created_at', { ascending: false })
    if (error) throw error
    return ok(data)
  },

  update_file: async (db, p) => {
    requireFields(p, ['file_id'])
    const { file_id, ...updates } = p
    delete updates.action
    const { data, error } = await db.from('files').update(updates).eq('id', file_id).select().single()
    if (error) throw error
    return ok(data)
  },

  // ── Reports ──
  list_reports: async (db, p) => {
    let q = db.from('reports').select('*')
    if (p.client_id) q = q.eq('client_id', p.client_id)
    if (p.project_id) q = q.eq('project_id', p.project_id)
    if (p.status) q = q.eq('status', p.status)
    if (p.limit) q = q.limit(p.limit)
    const { data, error } = await q.order('created_at', { ascending: false })
    if (error) throw error
    return ok(data)
  },

  create_report: async (db, p) => {
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
      created_by: p.created_by || null,
      internal_notes: p.internal_notes || null,
    }).select().single()
    if (error) throw error
    return ok(data)
  },

  update_report: async (db, p) => {
    requireFields(p, ['report_id'])
    const { report_id, ...updates } = p
    delete updates.action
    const { data, error } = await db.from('reports').update(updates).eq('id', report_id).select().single()
    if (error) throw error
    return ok(data)
  },

  // ── Billing ──
  list_billing: async (db, p) => {
    let q = db.from('billing').select('*')
    if (p.client_id) q = q.eq('client_id', p.client_id)
    if (p.status) q = q.eq('status', p.status)
    if (p.limit) q = q.limit(p.limit)
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

  update_billing: async (db, p) => {
    requireFields(p, ['billing_id'])
    const { billing_id, ...updates } = p
    delete updates.action
    const { data, error } = await db.from('billing').update(updates).eq('id', billing_id).select().single()
    if (error) throw error
    return ok(data)
  },

  // ── Client Requests ──
  list_requests: async (db, p) => {
    let q = db.from('client_requests').select('*')
    if (p.client_id) q = q.eq('client_id', p.client_id)
    if (p.status) q = q.eq('status', p.status)
    if (p.limit) q = q.limit(p.limit)
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

  update_request: async (db, p) => {
    requireFields(p, ['request_id'])
    const { request_id, ...updates } = p
    delete updates.action
    const { data, error } = await db.from('client_requests').update(updates).eq('id', request_id).select().single()
    if (error) throw error
    return ok(data)
  },

  // ── Briefings ──
  list_briefings: async (db, p) => {
    let q = db.from('briefings').select('*')
    if (p.client_id) q = q.eq('client_id', p.client_id)
    if (p.submitted !== undefined) q = q.eq('submitted', p.submitted)
    if (p.limit) q = q.limit(p.limit)
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
  create_update: async (db, p) => {
    requireFields(p, ['project_id', 'author_id', 'message', 'update_type'])
    const { data, error } = await db.from('updates').insert({
      project_id: p.project_id,
      author_id: p.author_id,
      message: p.message,
      update_type: p.update_type,
    }).select().single()
    if (error) throw error
    return ok(data)
  },

  // ── Ads Wallet ──
  get_wallet: async (db, p) => {
    requireFields(p, ['client_id'])
    const { data, error } = await db.from('ads_wallet').select('*').eq('client_id', p.client_id)
    if (error) throw error
    return ok(data)
  },

  update_wallet: async (db, p) => {
    requireFields(p, ['wallet_id'])
    const { wallet_id, ...updates } = p
    delete updates.action
    const { data, error } = await db.from('ads_wallet').update(updates).eq('id', wallet_id).select().single()
    if (error) throw error
    return ok(data)
  },

  // ── Project Payments ──
  list_payments: async (db, p) => {
    let q = db.from('project_payments').select('*, payment_installments(*)')
    if (p.client_id) q = q.eq('client_id', p.client_id)
    if (p.project_id) q = q.eq('project_id', p.project_id)
    if (p.limit) q = q.limit(p.limit)
    const { data, error } = await q.order('created_at', { ascending: false })
    if (error) throw error
    return ok(data)
  },

  // ── User Roles ──
  list_team: async (db) => {
    const { data, error } = await db
      .from('user_roles')
      .select(`*, profiles(${SAFE_PROFILE_COLUMNS})`)
      .neq('role', 'client')
    if (error) throw error
    return ok(data)
  },

  // ── Recharge Requests ──
  list_recharges: async (db, p) => {
    let q = db.from('recharge_requests').select('*')
    if (p.client_id) q = q.eq('client_id', p.client_id)
    if (p.status) q = q.eq('status', p.status)
    const { data, error } = await q.order('created_at', { ascending: false })
    if (error) throw error
    return ok(data)
  },

  update_recharge: async (db, p) => {
    requireFields(p, ['recharge_id'])
    const { recharge_id, ...updates } = p
    delete updates.action
    const { data, error } = await db.from('recharge_requests').update(updates).eq('id', recharge_id).select().single()
    if (error) throw error
    return ok(data)
  },

  // ── Task Comments ──
  create_comment: async (db, p) => {
    requireFields(p, ['task_id', 'author_id', 'content'])
    const { data, error } = await db.from('task_comments').insert({
      task_id: p.task_id,
      author_id: p.author_id,
      content: p.content,
    }).select().single()
    if (error) throw error
    return ok(data)
  },

  // ── Task Checklist ──
  create_checklist_item: async (db, p) => {
    requireFields(p, ['task_id', 'created_by', 'title'])
    const { data, error } = await db.from('task_checklist_items').insert({
      task_id: p.task_id,
      created_by: p.created_by,
      title: p.title,
      item_order: p.item_order || 0,
    }).select().single()
    if (error) throw error
    return ok(data)
  },

  update_checklist_item: async (db, p) => {
    requireFields(p, ['item_id'])
    const { item_id, ...updates } = p
    delete updates.action
    const { data, error } = await db.from('task_checklist_items').update(updates).eq('id', item_id).select().single()
    if (error) throw error
    return ok(data)
  },
  // ── Notifications ──
  list_notifications: async (db, p) => {
    let q = db.from('notifications').select('*')
    if (p.user_id) q = q.eq('user_id', p.user_id)
    if (p.read !== undefined) q = q.eq('read', p.read)
    if (p.notification_type) q = q.eq('notification_type', p.notification_type)
    q = q.order('created_at', { ascending: false })
    if (p.limit) q = q.limit(p.limit)
    else q = q.limit(50)
    const { data, error } = await q
    if (error) throw error
    return ok(data)
  },

  send_notification: async (db, p) => {
    requireFields(p, ['user_id', 'message', 'notification_type'])
    const { data, error } = await db.from('notifications').insert({
      user_id: p.user_id,
      message: p.message,
      notification_type: p.notification_type,
      link: p.link || null,
    }).select().single()
    if (error) throw error
    return ok(data)
  },

  mark_notification_read: async (db, p) => {
    requireFields(p, ['notification_id'])
    const { data, error } = await db.from('notifications').update({ read: true }).eq('id', p.notification_id).select().single()
    if (error) throw error
    return ok(data)
  },

  // ── Audit Log ──
  list_audit_log: async (db, p) => {
    let q = db.from('api_audit_log').select('*')
    if (p.action) q = q.eq('action', p.action)
    if (p.ip_address) q = q.eq('ip_address', p.ip_address)
    if (p.limit) q = q.limit(p.limit)
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

    // Also accept the legacy env var key
    const legacyKey = Deno.env.get('EXTERNAL_API_KEY')
    let keyName = 'legacy'

    if (apiKey !== legacyKey) {
      // Check against DB
      const { data: keyRow, error: keyErr } = await db.rpc('validate_api_key', { _key_hash: keyHash })
      if (keyErr || !keyRow || keyRow.length === 0) {
        return err('Invalid API key.', 401)
      }
      keyName = keyRow[0].name
      // Update last_used_at
      db.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRow[0].id).then(() => {})
    }

    // Parse body
    try {
      body = await req.json()
    } catch {
      return err('Invalid JSON body. Send { "action": "...", ...params }')
    }

    const { action, ...params } = body!
    if (!action || typeof action !== 'string') {
      return err('Missing "action" field. Use get_schema to list available actions.')
    }

    const handler = handlers[action]
    if (!handler) {
      return err(`Unknown action "${action}". Use get_schema to list available actions.`, 404)
    }

    // Get client IP
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('cf-connecting-ip')
      || req.headers.get('x-real-ip')
      || 'unknown'

    const response = await handler(db, params)

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

    return err(e.message || 'Internal error', 500)
  }
})
