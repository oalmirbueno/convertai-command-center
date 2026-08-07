const DEFAULT_RESEND_API_URL = 'https://api.resend.com'
const MAX_ERROR_BODY_LENGTH = 16_000

type DenoEnvironment = {
  Deno?: {
    env?: {
      get(name: string): string | undefined
    }
  }
}

export type ResendEmailPayload = {
  from: string
  to: string | string[]
  subject: string
  html?: string
  text?: string
  cc?: string | string[]
  bcc?: string | string[]
  reply_to?: string | string[]
  headers?: Record<string, string>
  tags?: Array<{ name: string; value: string }>
}

export type ResendSendOptions = {
  apiKey?: string
  apiUrl?: string
  fetchImpl?: typeof fetch
  idempotencyKey?: string
}

export type ResendSendResult = {
  id: string | null
  status: number
  data: Record<string, unknown>
}

type ResendApiErrorOptions = {
  status: number
  retryAfterSeconds?: number | null
  code?: string | null
  details?: unknown
}

export class ResendApiError extends Error {
  readonly status: number
  readonly retryAfterSeconds: number | null
  readonly code: string | null
  readonly details: unknown

  constructor(message: string, options: ResendApiErrorOptions) {
    super(message)
    this.name = 'ResendApiError'
    this.status = options.status
    this.retryAfterSeconds = options.retryAfterSeconds ?? null
    this.code = options.code ?? null
    this.details = options.details ?? null
  }
}

function runtimeEnv(name: string): string | undefined {
  return (globalThis as typeof globalThis & DenoEnvironment).Deno?.env?.get(name)?.trim() || undefined
}

export function resolveResendEmailsUrl(configuredUrl?: string): string {
  const rawUrl = configuredUrl?.trim() || DEFAULT_RESEND_API_URL
  let url: URL

  try {
    url = new URL(rawUrl)
  } catch {
    throw new ResendApiError('Email transport endpoint is invalid', { status: 500 })
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new ResendApiError('Email transport endpoint is invalid', { status: 500 })
  }

  url.pathname = url.pathname.replace(/\/+$/, '')
  if (!url.pathname.endsWith('/emails')) {
    url.pathname = `${url.pathname}/emails`.replace(/\/+/g, '/')
  }

  return url.toString()
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null
  const seconds = Number(value.trim())
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds)

  const retryAt = Date.parse(value)
  if (!Number.isFinite(retryAt)) return null
  return Math.max(0, Math.ceil((retryAt - now) / 1000))
}

function parseResponseBody(text: string): Record<string, unknown> {
  if (!text) return {}
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { message: text.slice(0, MAX_ERROR_BODY_LENGTH) }
  } catch {
    return { message: text.slice(0, MAX_ERROR_BODY_LENGTH) }
  }
}

function providerMessage(body: Record<string, unknown>, status: number): string {
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  return message || `Email provider request failed with status ${status}`
}

export async function sendResendEmail(
  payload: ResendEmailPayload,
  options: ResendSendOptions = {},
): Promise<ResendSendResult> {
  const apiKey = options.apiKey?.trim() || runtimeEnv('RESEND_API_KEY')
  if (!apiKey) {
    throw new ResendApiError('Email transport is not configured', { status: 500 })
  }

  const url = resolveResendEmailsUrl(options.apiUrl ?? runtimeEnv('RESEND_API_URL'))
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey

  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
  } catch {
    throw new ResendApiError('Email provider is unavailable', {
      status: 503,
    })
  }

  const rawBody = (await response.text()).slice(0, MAX_ERROR_BODY_LENGTH)
  const data = parseResponseBody(rawBody)
  if (!response.ok) {
    const retryAfterSeconds = parseRetryAfter(
      response.headers.get('retry-after') ?? response.headers.get('ratelimit-reset'),
    )
    const code = typeof data.name === 'string'
      ? data.name
      : typeof data.code === 'string'
        ? data.code
        : null

    throw new ResendApiError(providerMessage(data, response.status), {
      status: response.status,
      retryAfterSeconds,
      code,
      details: data,
    })
  }

  return {
    id: typeof data.id === 'string' ? data.id : null,
    status: response.status,
    data,
  }
}
