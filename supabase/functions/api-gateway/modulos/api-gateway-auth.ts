export const API_GATEWAY_AUDIENCE = 'api-gateway' as const
export const API_GATEWAY_KEY_ORIGIN = 'api-docs' as const
export const LEGACY_API_GATEWAY_ORIGIN = 'legacy-env' as const

export const API_GATEWAY_ALLOWED_ORIGINS = [
  API_GATEWAY_KEY_ORIGIN,
  'external-api',
  LEGACY_API_GATEWAY_ORIGIN,
] as const

export const API_GATEWAY_SCOPES = {
  DISCOVER: 'gateway:discover',
  CLIENTS_READ: 'clients:read',
  CLIENTS_WRITE: 'clients:write',
  CLIENTS_ADMIN: 'clients:admin',
  PROJECTS_READ: 'projects:read',
  PROJECTS_WRITE: 'projects:write',
  PROJECTS_DELETE: 'projects:delete',
  TASKS_READ: 'tasks:read',
  TASKS_WRITE: 'tasks:write',
  TASKS_DELETE: 'tasks:delete',
  MILESTONES_READ: 'milestones:read',
  MILESTONES_WRITE: 'milestones:write',
  FILES_READ: 'files:read',
  FILES_WRITE: 'files:write',
  REPORTS_READ: 'reports:read',
  REPORTS_WRITE: 'reports:write',
  BILLING_READ: 'billing:read',
  BILLING_WRITE: 'billing:write',
  REQUESTS_READ: 'requests:read',
  REQUESTS_WRITE: 'requests:write',
  BRIEFINGS_READ: 'briefings:read',
  UPDATES_WRITE: 'updates:write',
  WALLET_READ: 'wallet:read',
  WALLET_WRITE: 'wallet:write',
  PAYMENTS_READ: 'payments:read',
  TEAM_READ: 'team:read',
  RECHARGES_READ: 'recharges:read',
  RECHARGES_WRITE: 'recharges:write',
  COMMENTS_WRITE: 'comments:write',
  CHECKLISTS_WRITE: 'checklists:write',
  NOTIFICATIONS_READ: 'notifications:read',
  NOTIFICATIONS_WRITE: 'notifications:write',
  AUDIT_READ: 'audit:read',
} as const

export type ApiGatewayScope = typeof API_GATEWAY_SCOPES[keyof typeof API_GATEWAY_SCOPES]

// This map is the authorization boundary for the service-role-backed gateway.
// Adding a handler without adding an entry here leaves the action inaccessible.
export const API_GATEWAY_ACTION_SCOPES = {
  health: API_GATEWAY_SCOPES.DISCOVER,
  get_schema: API_GATEWAY_SCOPES.DISCOVER,
  list_clients: API_GATEWAY_SCOPES.CLIENTS_READ,
  get_client: API_GATEWAY_SCOPES.CLIENTS_READ,
  create_client: API_GATEWAY_SCOPES.CLIENTS_ADMIN,
  update_client: API_GATEWAY_SCOPES.CLIENTS_WRITE,
  list_projects: API_GATEWAY_SCOPES.PROJECTS_READ,
  get_project: API_GATEWAY_SCOPES.PROJECTS_READ,
  create_project: API_GATEWAY_SCOPES.PROJECTS_WRITE,
  update_project: API_GATEWAY_SCOPES.PROJECTS_WRITE,
  delete_project: API_GATEWAY_SCOPES.PROJECTS_DELETE,
  list_tasks: API_GATEWAY_SCOPES.TASKS_READ,
  get_task: API_GATEWAY_SCOPES.TASKS_READ,
  create_task: API_GATEWAY_SCOPES.TASKS_WRITE,
  update_task: API_GATEWAY_SCOPES.TASKS_WRITE,
  delete_task: API_GATEWAY_SCOPES.TASKS_DELETE,
  list_milestones: API_GATEWAY_SCOPES.MILESTONES_READ,
  create_milestone: API_GATEWAY_SCOPES.MILESTONES_WRITE,
  update_milestone: API_GATEWAY_SCOPES.MILESTONES_WRITE,
  list_files: API_GATEWAY_SCOPES.FILES_READ,
  update_file: API_GATEWAY_SCOPES.FILES_WRITE,
  list_reports: API_GATEWAY_SCOPES.REPORTS_READ,
  create_report: API_GATEWAY_SCOPES.REPORTS_WRITE,
  update_report: API_GATEWAY_SCOPES.REPORTS_WRITE,
  list_billing: API_GATEWAY_SCOPES.BILLING_READ,
  create_billing: API_GATEWAY_SCOPES.BILLING_WRITE,
  update_billing: API_GATEWAY_SCOPES.BILLING_WRITE,
  list_requests: API_GATEWAY_SCOPES.REQUESTS_READ,
  create_request: API_GATEWAY_SCOPES.REQUESTS_WRITE,
  update_request: API_GATEWAY_SCOPES.REQUESTS_WRITE,
  list_briefings: API_GATEWAY_SCOPES.BRIEFINGS_READ,
  get_briefing: API_GATEWAY_SCOPES.BRIEFINGS_READ,
  create_update: API_GATEWAY_SCOPES.UPDATES_WRITE,
  get_wallet: API_GATEWAY_SCOPES.WALLET_READ,
  update_wallet: API_GATEWAY_SCOPES.WALLET_WRITE,
  list_payments: API_GATEWAY_SCOPES.PAYMENTS_READ,
  list_team: API_GATEWAY_SCOPES.TEAM_READ,
  list_recharges: API_GATEWAY_SCOPES.RECHARGES_READ,
  update_recharge: API_GATEWAY_SCOPES.RECHARGES_WRITE,
  create_comment: API_GATEWAY_SCOPES.COMMENTS_WRITE,
  create_checklist_item: API_GATEWAY_SCOPES.CHECKLISTS_WRITE,
  update_checklist_item: API_GATEWAY_SCOPES.CHECKLISTS_WRITE,
  list_notifications: API_GATEWAY_SCOPES.NOTIFICATIONS_READ,
  send_notification: API_GATEWAY_SCOPES.NOTIFICATIONS_WRITE,
  mark_notification_read: API_GATEWAY_SCOPES.NOTIFICATIONS_WRITE,
  list_audit_log: API_GATEWAY_SCOPES.AUDIT_READ,
} as const satisfies Record<string, ApiGatewayScope>

export type ApiGatewayAction = keyof typeof API_GATEWAY_ACTION_SCOPES

export type ApiGatewayClientScopeMode = 'none' | 'explicit' | 'all'

export const API_GATEWAY_GLOBAL_ACTIONS = [
  'create_client',
  'list_team',
  'list_audit_log',
] as const satisfies readonly ApiGatewayAction[]

export const API_GATEWAY_DEFAULT_PAGE_LIMIT = 50
export const API_GATEWAY_MAX_PAGE_LIMIT = 100

export interface ApiGatewayPrincipal {
  audience: string | null
  origin: string | null
  scopes: readonly string[]
  keyId: string | null
  ownerId: string | null
  ownerIsAdmin: boolean
  scope: ApiGatewayClientScopeMode
  clientIds: readonly string[]
}

interface LegacyApiGatewayPreviewPrincipal {
  audience: string | null
  origin: string | null
  scopes: readonly string[]
  actorId: string | null
}

export type ApiGatewayAuthorization =
  | { allowed: true; action: ApiGatewayAction; requiredScope: ApiGatewayScope }
  | {
      allowed: false
      reason:
        | 'wrong_audience'
        | 'wrong_origin'
        | 'unknown_action'
        | 'missing_scope'
        | 'missing_key'
        | 'missing_owner'
        | 'owner_not_admin'
        | 'client_scope_denied'
        | 'global_scope_required'
      requiredScope?: ApiGatewayScope
    }

const allowedOrigins = new Set<string>(API_GATEWAY_ALLOWED_ORIGINS)
const globalActions = new Set<ApiGatewayAction>(API_GATEWAY_GLOBAL_ACTIONS)

export function isApiGatewayAction(action: string): action is ApiGatewayAction {
  return Object.prototype.hasOwnProperty.call(API_GATEWAY_ACTION_SCOPES, action)
}

export function authorizeApiGatewayAction(
  principal: ApiGatewayPrincipal,
  action: string,
): ApiGatewayAuthorization {
  if (principal.audience !== API_GATEWAY_AUDIENCE) {
    return { allowed: false, reason: 'wrong_audience' }
  }
  if (!principal.origin || !allowedOrigins.has(principal.origin)) {
    return { allowed: false, reason: 'wrong_origin' }
  }
  if (!isApiGatewayAction(action)) {
    return { allowed: false, reason: 'unknown_action' }
  }

  const requiredScope = API_GATEWAY_ACTION_SCOPES[action]
  if (!principal.scopes.includes(requiredScope)) {
    return { allowed: false, reason: 'missing_scope', requiredScope }
  }
  if (requiredScope === API_GATEWAY_SCOPES.DISCOVER) {
    return { allowed: true, action, requiredScope }
  }
  if (!principal.keyId) {
    return { allowed: false, reason: 'missing_key', requiredScope }
  }
  if (!principal.ownerId) {
    return { allowed: false, reason: 'missing_owner', requiredScope }
  }
  if (!principal.ownerIsAdmin) {
    return { allowed: false, reason: 'owner_not_admin', requiredScope }
  }
  if (principal.scope === 'none' || (
    principal.scope === 'explicit' && principal.clientIds.length === 0
  )) {
    return { allowed: false, reason: 'client_scope_denied', requiredScope }
  }
  if (globalActions.has(action) && principal.scope !== 'all') {
    return { allowed: false, reason: 'global_scope_required', requiredScope }
  }
  return { allowed: true, action, requiredScope }
}

export function apiGatewayScopeAllowsClient(
  principal: Pick<ApiGatewayPrincipal, 'scope' | 'clientIds'>,
  clientId: string,
): boolean {
  return principal.scope === 'all'
    || (principal.scope === 'explicit' && principal.clientIds.includes(clientId))
}

export function normalizeApiGatewayPageLimit(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return API_GATEWAY_DEFAULT_PAGE_LIMIT
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return API_GATEWAY_DEFAULT_PAGE_LIMIT
  return Math.min(
    API_GATEWAY_MAX_PAGE_LIMIT,
    Math.max(1, Math.trunc(numeric)),
  )
}

export function allowedApiGatewayActions(
  principal: ApiGatewayPrincipal | LegacyApiGatewayPreviewPrincipal,
): ApiGatewayAction[] {
  const normalized: ApiGatewayPrincipal = 'keyId' in principal
    ? principal
    : {
        audience: principal.audience,
        origin: principal.origin,
        scopes: principal.scopes,
        keyId: null,
        ownerId: null,
        ownerIsAdmin: false,
        scope: 'none',
        clientIds: [],
      }
  return (Object.keys(API_GATEWAY_ACTION_SCOPES) as ApiGatewayAction[])
    .filter(action => authorizeApiGatewayAction(normalized, action).allowed)
    .sort()
}

const READ_ONLY_SCOPES: ApiGatewayScope[] = [
  API_GATEWAY_SCOPES.DISCOVER,
  API_GATEWAY_SCOPES.CLIENTS_READ,
  API_GATEWAY_SCOPES.PROJECTS_READ,
  API_GATEWAY_SCOPES.TASKS_READ,
  API_GATEWAY_SCOPES.MILESTONES_READ,
  API_GATEWAY_SCOPES.FILES_READ,
  API_GATEWAY_SCOPES.REPORTS_READ,
  API_GATEWAY_SCOPES.BILLING_READ,
  API_GATEWAY_SCOPES.REQUESTS_READ,
  API_GATEWAY_SCOPES.BRIEFINGS_READ,
  API_GATEWAY_SCOPES.WALLET_READ,
  API_GATEWAY_SCOPES.PAYMENTS_READ,
  API_GATEWAY_SCOPES.RECHARGES_READ,
  API_GATEWAY_SCOPES.NOTIFICATIONS_READ,
]

const OPERATIONAL_WRITE_SCOPES: ApiGatewayScope[] = [
  API_GATEWAY_SCOPES.CLIENTS_WRITE,
  API_GATEWAY_SCOPES.PROJECTS_WRITE,
  API_GATEWAY_SCOPES.TASKS_WRITE,
  API_GATEWAY_SCOPES.MILESTONES_WRITE,
  API_GATEWAY_SCOPES.FILES_WRITE,
  API_GATEWAY_SCOPES.REPORTS_WRITE,
  API_GATEWAY_SCOPES.BILLING_WRITE,
  API_GATEWAY_SCOPES.REQUESTS_WRITE,
  API_GATEWAY_SCOPES.UPDATES_WRITE,
  API_GATEWAY_SCOPES.WALLET_WRITE,
  API_GATEWAY_SCOPES.RECHARGES_WRITE,
  API_GATEWAY_SCOPES.COMMENTS_WRITE,
  API_GATEWAY_SCOPES.CHECKLISTS_WRITE,
  API_GATEWAY_SCOPES.NOTIFICATIONS_WRITE,
]

export const API_GATEWAY_SCOPE_PRESETS = {
  read_only: [...READ_ONLY_SCOPES],
  automation: [...READ_ONLY_SCOPES, ...OPERATIONAL_WRITE_SCOPES],
  administrator: [...new Set(Object.values(API_GATEWAY_ACTION_SCOPES))],
} as const satisfies Record<string, readonly ApiGatewayScope[]>

export type ApiGatewayScopePreset = keyof typeof API_GATEWAY_SCOPE_PRESETS

export const LEGACY_API_GATEWAY_SCOPES: readonly ApiGatewayScope[] = [
  API_GATEWAY_SCOPES.DISCOVER,
]
