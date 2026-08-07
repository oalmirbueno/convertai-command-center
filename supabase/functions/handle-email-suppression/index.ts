import { createClient } from 'npm:@supabase/supabase-js@2'
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024
const SUPPRESSION_REASONS = new Set(['bounce', 'complaint', 'unsubscribe'] as const)

type SuppressionReason = 'bounce' | 'complaint' | 'unsubscribe'

// Suppression event payload sent by the backend when the email provider reports
// a bounce, complaint, or unsubscribe.
interface SuppressionPayload {
  email: string
  reason: SuppressionReason
  message_id?: string
  metadata?: Record<string, unknown>
  is_retry: boolean
  retry_count: number
}

class SuppressionRequestError extends Error {
  readonly status: number
  readonly publicMessage: string

  constructor(status: number, publicMessage: string) {
    super(publicMessage)
    this.name = 'SuppressionRequestError'
    this.status = status
    this.publicMessage = publicMessage
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function isSuppressionReason(value: string): value is SuppressionReason {
  return SUPPRESSION_REASONS.has(value as SuppressionReason)
}

function normalizeEmail(value: unknown): string {
  const email = optionalString(value)?.toLowerCase()
  const at = email?.lastIndexOf('@') ?? -1
  if (
    !email
    || email.length > 320
    || /[\s\r\n]/.test(email)
    || at <= 0
    || at === email.length - 1
  ) {
    throw new SuppressionRequestError(400, 'Invalid suppression payload')
  }
  return email
}

function redactEmail(email: string): string {
  const at = email.lastIndexOf('@')
  return `${email.slice(0, 1)}***${at > 0 ? email.slice(at) : ''}`
}

function normalizeSuppressionPayload(value: unknown): SuppressionPayload {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new SuppressionRequestError(400, 'Invalid suppression payload')
  }
  const data = value.data
  const rawReason = optionalString(data.reason)
  if (!rawReason || !isSuppressionReason(rawReason)) {
    throw new SuppressionRequestError(400, 'Invalid suppression payload')
  }
  if (data.metadata != null && !isRecord(data.metadata)) {
    throw new SuppressionRequestError(400, 'Invalid suppression payload')
  }
  if (data.is_retry != null && typeof data.is_retry !== 'boolean') {
    throw new SuppressionRequestError(400, 'Invalid suppression payload')
  }
  if (
    data.retry_count != null
    && (
      typeof data.retry_count !== 'number'
      || !Number.isInteger(data.retry_count)
      || data.retry_count < 0
    )
  ) {
    throw new SuppressionRequestError(400, 'Invalid suppression payload')
  }

  const messageId = optionalString(data.message_id)
  if (messageId && messageId.length > 512) {
    throw new SuppressionRequestError(400, 'Invalid suppression payload')
  }

  return {
    email: normalizeEmail(data.email),
    reason: rawReason,
    message_id: messageId,
    metadata: isRecord(data.metadata) ? data.metadata : undefined,
    is_retry: data.is_retry === true,
    retry_count: typeof data.retry_count === 'number' ? data.retry_count : 0,
  }
}

function parseSuppressionPayload(body: string): SuppressionPayload {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new SuppressionRequestError(400, 'Invalid suppression payload')
  }
  return normalizeSuppressionPayload(parsed)
}

function normalizeStandardWebhookSecret(secret: string): string {
  const withoutVersion = secret.trim().replace(/^v1,/, '')
  const normalized = withoutVersion.replace(/^whsec_/, '')
  if (!normalized) {
    throw new SuppressionRequestError(500, 'Server configuration error')
  }
  return normalized
}

async function readWebhookBody(req: Request): Promise<string> {
  const contentLength = Number(req.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BODY_BYTES) {
    throw new SuppressionRequestError(413, 'Webhook payload is too large')
  }
  const rawBody = await req.text()
  if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BODY_BYTES) {
    throw new SuppressionRequestError(413, 'Webhook payload is too large')
  }
  return rawBody
}

async function verifySuppressionRequest(
  req: Request,
  hookSecret: string | undefined,
  legacyApiKey: string | undefined,
): Promise<SuppressionPayload> {
  if (hookSecret) {
    const rawBody = await readWebhookBody(req)
    let webhook: Webhook
    try {
      webhook = new Webhook(normalizeStandardWebhookSecret(hookSecret))
    } catch (error) {
      if (error instanceof SuppressionRequestError) throw error
      throw new SuppressionRequestError(500, 'Server configuration error')
    }

    let verified: unknown
    try {
      verified = webhook.verify(rawBody, Object.fromEntries(req.headers))
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new SuppressionRequestError(400, 'Invalid suppression payload')
      }
      throw new SuppressionRequestError(401, 'Invalid webhook signature')
    }
    return normalizeSuppressionPayload(verified)
  }

  if (legacyApiKey) {
    // Compatibility path for the current Lovable Cloud webhook. A migrated
    // environment configures SUPPRESSION_WEBHOOK_SECRET and never loads it.
    const { WebhookError, verifyWebhookRequest } = await import('npm:@lovable.dev/webhooks-js')
    try {
      const verified = await verifyWebhookRequest({
        req,
        secret: legacyApiKey,
        parser: parseSuppressionPayload,
      })
      return normalizeSuppressionPayload({ data: verified.payload })
    } catch (error) {
      if (error instanceof SuppressionRequestError) throw error
      if (error instanceof WebhookError) {
        if (error.code === 'invalid_payload' || error.code === 'invalid_json') {
          throw new SuppressionRequestError(400, 'Invalid suppression payload')
        }
        throw new SuppressionRequestError(401, 'Invalid webhook signature')
      }
      throw error
    }
  }

  throw new SuppressionRequestError(500, 'Server configuration error')
}

function jsonResponse(
  data: Record<string, unknown>,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, { Allow: 'POST' })
  }

  const hookSecret = Deno.env.get('SUPPRESSION_WEBHOOK_SECRET')?.trim() || undefined
  const legacyApiKey = Deno.env.get('LOVABLE_API_KEY')?.trim() || undefined
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim()
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()

  if ((!hookSecret && !legacyApiKey) || !supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required suppression hook configuration')
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  // Standard Webhooks is the portable path. The Lovable verifier is loaded
  // dynamically only while the existing Cloud callback is still in use.
  let payload: SuppressionPayload
  try {
    payload = await verifySuppressionRequest(req, hookSecret, legacyApiKey)
  } catch (error) {
    const requestError = error instanceof SuppressionRequestError
      ? error
      : new SuppressionRequestError(500, 'Internal hook error')
    console.error('Suppression webhook rejected', {
      status: requestError.status,
      kind: error instanceof Error ? error.name : 'UnknownError',
    })
    return jsonResponse({ error: requestError.publicMessage }, requestError.status)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const normalizedEmail = payload.email

  // 1. Upsert to suppressed_emails (idempotent — safe for retries)
  const { error: suppressError } = await supabase
    .from('suppressed_emails')
    .upsert(
      {
        email: normalizedEmail,
        reason: payload.reason,
        metadata: payload.metadata ?? null,
      },
      { onConflict: 'email' },
    )

  if (suppressError) {
    console.error('Failed to upsert suppressed email', {
      error: suppressError,
      email_redacted: redactEmail(normalizedEmail),
    })
    return jsonResponse({ error: 'Failed to write suppression' }, 500)
  }

  // 2. Append a new log entry for the suppression event (never update existing rows)
  const sendLogStatus = mapReasonToStatus(payload.reason)
  const sendLogMessage = mapReasonToMessage(payload.reason)

  const { error: insertError } = await supabase
    .from('email_send_log')
    .insert({
      message_id: payload.message_id ?? null,
      template_name: 'system',
      recipient_email: normalizedEmail,
      status: sendLogStatus,
      error_message: sendLogMessage,
      metadata: payload.metadata ?? null,
    })

  if (insertError) {
    // Non-fatal — log and continue. The suppression was already recorded.
    console.warn('Failed to insert email_send_log', { error: insertError })
  }

  console.log('Suppression processed', {
    email_redacted: redactEmail(normalizedEmail),
    reason: payload.reason,
    is_retry: payload.is_retry,
    retry_count: payload.retry_count,
    has_message_id: Boolean(payload.message_id),
  })

  return jsonResponse({ success: true })
})

function mapReasonToStatus(
  reason: SuppressionReason,
): 'bounced' | 'complained' | 'suppressed' {
  switch (reason) {
    case 'bounce':
      return 'bounced'
    case 'complaint':
      return 'complained'
    default:
      return 'suppressed'
  }
}

function mapReasonToMessage(reason: SuppressionReason): string {
  switch (reason) {
    case 'bounce':
      return 'Permanent bounce — email address is invalid or rejected'
    case 'complaint':
      return 'Spam complaint — recipient marked email as spam'
    case 'unsubscribe':
      return 'Recipient unsubscribed'
  }
}
