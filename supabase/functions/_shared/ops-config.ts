type DenoEnvironment = {
  Deno?: {
    env?: {
      get(name: string): string | undefined
    }
  }
}

export type OpsUrlOptions = {
  enabled?: boolean
  baseUrl?: string
  receiveLeadUrl?: string
  receivePortalSyncUrl?: string
  legacyReceivePortalSyncUrl?: string
}

export type LegacyOpsDispatchOptions = {
  enabled?: boolean
  url?: string | null
  secret?: string | null
  payload: Record<string, unknown>
  fetchImpl?: typeof fetch
}

export class OpsConfigurationError extends Error {
  readonly variable: string

  constructor(variable: string, message: string) {
    super(`${variable}: ${message}`)
    this.name = 'OpsConfigurationError'
    this.variable = variable
  }
}

function runtimeEnv(name: string): string | undefined {
  return (globalThis as typeof globalThis & DenoEnvironment).Deno?.env?.get(name)?.trim()
    || undefined
}

function configured(value: string | undefined): string | undefined {
  return value?.trim() || undefined
}

export function isOpsLegacyBridgeEnabled(explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit
  return runtimeEnv('OPS_LEGACY_BRIDGE_ENABLED') === 'true'
}

function requireOpsLegacyBridge(options: OpsUrlOptions): void {
  if (!isOpsLegacyBridgeEnabled(options.enabled)) {
    throw new OpsConfigurationError(
      'OPS_LEGACY_BRIDGE_ENABLED',
      'the retired Ops bridge is disabled by default',
    )
  }
}

function normalizeHttpUrl(
  rawValue: string,
  variable: string,
  options: { allowQuery: boolean },
): string {
  let url: URL
  try {
    url = new URL(rawValue)
  } catch {
    throw new OpsConfigurationError(variable, 'must be an absolute HTTP(S) URL')
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new OpsConfigurationError(variable, 'must use HTTP or HTTPS')
  }
  const loopback = url.hostname === 'localhost'
    || url.hostname === '127.0.0.1'
    || url.hostname === '[::1]'
  if (url.protocol === 'http:' && !loopback) {
    throw new OpsConfigurationError(variable, 'must use HTTPS outside loopback development')
  }
  if (url.username || url.password) {
    throw new OpsConfigurationError(variable, 'must not contain embedded credentials')
  }
  if (url.hash) {
    throw new OpsConfigurationError(variable, 'must not contain a URL fragment')
  }
  if (!options.allowQuery && url.search) {
    throw new OpsConfigurationError(variable, 'must not contain a query string')
  }

  url.pathname = url.pathname.replace(/\/+$/, '')
  const normalized = url.toString()
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
}

function joinFunctionUrl(baseUrl: string, functionName: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(functionName)) {
    throw new OpsConfigurationError('functionName', 'contains unsupported characters')
  }
  return `${baseUrl}/${functionName}`
}

export function resolveOpsBaseUrl(options: OpsUrlOptions = {}): string {
  requireOpsLegacyBridge(options)
  const value = configured(options.baseUrl)
    ?? runtimeEnv('OPS_BASE_URL')
  if (!value) {
    throw new OpsConfigurationError(
      'OPS_BASE_URL',
      'is required when the retired Ops bridge is enabled',
    )
  }
  return normalizeHttpUrl(value, 'OPS_BASE_URL', { allowQuery: false })
}

export function resolveOpsFunctionUrl(
  functionName: string,
  options: OpsUrlOptions = {},
): string {
  return joinFunctionUrl(resolveOpsBaseUrl(options), functionName)
}

export function resolveOpsReceiveLeadUrl(options: OpsUrlOptions = {}): string {
  requireOpsLegacyBridge(options)
  const exactUrl = configured(options.receiveLeadUrl)
    ?? runtimeEnv('OPS_RECEIVE_LEAD_URL')
  if (exactUrl) {
    return normalizeHttpUrl(exactUrl, 'OPS_RECEIVE_LEAD_URL', { allowQuery: true })
  }
  return resolveOpsFunctionUrl('receive-lead', options)
}

export function resolveOpsReceivePortalSyncUrl(options: OpsUrlOptions = {}): string {
  requireOpsLegacyBridge(options)
  const exactUrl = configured(options.receivePortalSyncUrl)
    ?? runtimeEnv('OPS_RECEIVE_PORTAL_SYNC_URL')
  if (exactUrl) {
    return normalizeHttpUrl(exactUrl, 'OPS_RECEIVE_PORTAL_SYNC_URL', { allowQuery: true })
  }

  // OPS_RECEIVE_URL was used by portal-to-ops before the portable names were
  // introduced. Keep it temporarily and give the canonical variable priority.
  const legacyAlias = configured(options.legacyReceivePortalSyncUrl)
    ?? runtimeEnv('OPS_RECEIVE_URL')
  if (legacyAlias) {
    return normalizeHttpUrl(legacyAlias, 'OPS_RECEIVE_URL', { allowQuery: true })
  }

  return resolveOpsFunctionUrl('receive-portal-sync', options)
}

export async function dispatchLegacyOpsJson({
  enabled = isOpsLegacyBridgeEnabled(),
  url,
  secret,
  payload,
  fetchImpl = fetch,
}: LegacyOpsDispatchOptions): Promise<{
  attempted: boolean
  status?: number
  error?: 'request_failed'
}> {
  if (!enabled || !configured(url ?? undefined) || !configured(secret ?? undefined)) {
    return { attempted: false }
  }

  try {
    const response = await fetchImpl(url!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': secret!,
      },
      body: JSON.stringify(payload),
      redirect: 'error',
    })
    try {
      await response.body?.cancel()
    } catch {
      // The request outcome is already known; draining failure is non-fatal.
    }
    return { attempted: true, status: response.status }
  } catch {
    return { attempted: true, error: 'request_failed' }
  }
}

export function resolvePortalFunctionUrl(
  functionName: string,
  supabaseUrl = runtimeEnv('SUPABASE_URL'),
): string {
  const configuredPortalUrl = configured(supabaseUrl)
  if (!configuredPortalUrl) {
    throw new OpsConfigurationError('SUPABASE_URL', 'is required')
  }
  const portalUrl = normalizeHttpUrl(configuredPortalUrl, 'SUPABASE_URL', {
    allowQuery: false,
  })
  return joinFunctionUrl(`${portalUrl}/functions/v1`, functionName)
}
