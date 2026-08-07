import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { SignupEmail } from '../_shared/email-templates/signup.tsx'
import { InviteEmail } from '../_shared/email-templates/invite.tsx'
import { MagicLinkEmail } from '../_shared/email-templates/magic-link.tsx'
import { RecoveryEmail } from '../_shared/email-templates/recovery.tsx'
import { EmailChangeEmail } from '../_shared/email-templates/email-change.tsx'
import { ReauthenticationEmail } from '../_shared/email-templates/reauthentication.tsx'
import {
  EMAIL_APP_URL as APP_PUBLIC_URL,
  EMAIL_FROM_DOMAIN as FROM_DOMAIN,
  EMAIL_SITE_NAME as SITE_NAME,
} from '../_shared/email-config.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, webhook-id, webhook-signature, webhook-timestamp, x-lovable-signature, x-lovable-timestamp, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

type EmailActionType =
  | 'signup'
  | 'invite'
  | 'magiclink'
  | 'recovery'
  | 'email_change'
  | 'reauthentication'

const EMAIL_SUBJECTS: Record<EmailActionType, string> = {
  signup: 'Confirm your email',
  invite: "You've been invited",
  magiclink: 'Your login link',
  recovery: 'Reset your password',
  email_change: 'Confirm your new email',
  reauthentication: 'Your verification code',
}

// Template mapping
const EMAIL_TEMPLATES: Record<string, React.ElementType> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
}

// Configuration. Defaults preserve today's production behavior while every
// value can be replaced when the frontend/backend moves to another host.
// Sample data for preview mode ONLY (not used in actual email sending).
// URLs are baked in at scaffold time from the project's real data.
// The sample email uses a fixed placeholder (RFC 6761 .test TLD) so the Go backend
// can always find-and-replace it with the actual recipient when sending test emails,
// even if the project's domain has changed since the template was scaffolded.
const SAMPLE_PROJECT_URL = APP_PUBLIC_URL
const SAMPLE_EMAIL = "user@example.test"
const SAMPLE_DATA: Record<string, object> = {
  signup: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    recipient: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  magiclink: {
    siteName: SITE_NAME,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  recovery: {
    siteName: SITE_NAME,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  invite: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  email_change: {
    siteName: SITE_NAME,
    oldEmail: SAMPLE_EMAIL,
    email: SAMPLE_EMAIL,
    newEmail: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  reauthentication: {
    token: '123456',
  },
}

// Preview endpoint handler - returns rendered HTML without sending email
async function handlePreview(req: Request): Promise<Response> {
  const previewCorsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: previewCorsHeaders })
  }

  const apiKey = Deno.env.get('EMAIL_PREVIEW_SECRET')
    ?? Deno.env.get('INTERNAL_HOOK_SECRET')
    ?? Deno.env.get('LOVABLE_API_KEY') // temporary compatibility fallback
  const authHeader = req.headers.get('Authorization')

  if (!apiKey || authHeader !== `Bearer ${apiKey}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let type: string
  try {
    const body = await req.json()
    type = body.type
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
      status: 400,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const EmailTemplate = EMAIL_TEMPLATES[type]

  if (!EmailTemplate) {
    return new Response(JSON.stringify({ error: `Unknown email type: ${type}` }), {
      status: 400,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const sampleData = SAMPLE_DATA[type] || {}
  const html = await renderAsync(React.createElement(EmailTemplate, sampleData))

  return new Response(html, {
    status: 200,
    headers: { ...previewCorsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
  })
}

interface NormalizedAuthEmailPayload {
  run_id: string
  version: string
  delivery_id?: string
  data: {
    action_type: EmailActionType
    email: string
    url: string
    token?: string
    old_email?: string
    new_email?: string
  }
}

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024

class AuthHookRequestError extends Error {
  readonly status: number
  readonly publicMessage: string

  constructor(status: number, publicMessage: string) {
    super(publicMessage)
    this.name = 'AuthHookRequestError'
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

function requiredString(value: unknown, field: string): string {
  const normalized = optionalString(value)
  if (!normalized) {
    throw new AuthHookRequestError(400, `Invalid Send Email Hook field: ${field}`)
  }
  return normalized
}

function normalizeEmail(value: unknown, field: string): string {
  const email = requiredString(value, field)
  const at = email.lastIndexOf('@')
  if (
    email.length > 320
    || /[\s\r\n]/.test(email)
    || at <= 0
    || at === email.length - 1
  ) {
    throw new AuthHookRequestError(400, `Invalid Send Email Hook field: ${field}`)
  }
  return email
}

function redactEmail(email: string): string {
  const at = email.lastIndexOf('@')
  return `${email.slice(0, 1)}***${at > 0 ? email.slice(at) : ''}`
}

function readEnv(name: string): string | undefined {
  return Deno.env.get(name)?.trim() || undefined
}

function normalizeStandardWebhookSecret(secret: string): string {
  const withoutVersion = secret.trim().replace(/^v1,/, '')
  const normalized = withoutVersion.replace(/^whsec_/, '')
  if (!normalized) {
    throw new AuthHookRequestError(500, 'Server configuration error')
  }
  return normalized
}

async function readWebhookBody(req: Request): Promise<string> {
  const contentLength = Number(req.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BODY_BYTES) {
    throw new AuthHookRequestError(413, 'Webhook payload is too large')
  }

  const rawBody = await req.text()
  if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BODY_BYTES) {
    throw new AuthHookRequestError(413, 'Webhook payload is too large')
  }
  return rawBody
}

function isEmailActionType(value: string): value is EmailActionType {
  return Object.prototype.hasOwnProperty.call(EMAIL_TEMPLATES, value)
}

function confirmationUrl(
  supabaseUrl: string,
  actionType: EmailActionType,
  tokenHash: string | undefined,
  redirectTo: string,
): string {
  if (!tokenHash) return redirectTo

  let url: URL
  try {
    url = new URL(supabaseUrl)
    const basePath = url.pathname.replace(/\/+$/, '')
    url.pathname = `${basePath}/auth/v1/verify`
    url.search = ''
    url.hash = ''
  } catch {
    throw new AuthHookRequestError(500, 'Server configuration error')
  }

  url.searchParams.set('token', tokenHash)
  url.searchParams.set('type', actionType)
  url.searchParams.set('redirect_to', redirectTo)
  return url.toString()
}

function normalizeSupabaseAuthPayload(
  verified: unknown,
  supabaseUrl: string,
  webhookId: string,
): NormalizedAuthEmailPayload[] {
  if (!isRecord(verified) || !isRecord(verified.user) || !isRecord(verified.email_data)) {
    throw new AuthHookRequestError(400, 'Invalid Send Email Hook payload')
  }

  const user = verified.user
  const emailData = verified.email_data
  const email = normalizeEmail(user.email, 'user.email')
  const rawActionType = requiredString(emailData.email_action_type, 'email_data.email_action_type')
  if (!isEmailActionType(rawActionType)) {
    throw new AuthHookRequestError(400, 'Unsupported authentication email type')
  }
  const actionType = rawActionType
  const redirectTo = optionalString(emailData.redirect_to) ?? APP_PUBLIC_URL

  const delivery = (
    recipient: string,
    tokenHash: string | undefined,
    token: string | undefined,
    deliverySuffix?: string,
    oldEmail?: string,
    newEmail?: string,
  ): NormalizedAuthEmailPayload => ({
    run_id: webhookId,
    version: '1',
    delivery_id: deliverySuffix ? `${webhookId}:${deliverySuffix}` : webhookId,
    data: {
      action_type: actionType,
      email: recipient,
      url: confirmationUrl(supabaseUrl, actionType, tokenHash, redirectTo),
      token,
      old_email: oldEmail,
      new_email: newEmail,
    },
  })

  if (actionType === 'email_change') {
    const newEmail = normalizeEmail(
      user.new_email ?? emailData.new_email,
      'user.new_email',
    )
    const token = optionalString(emailData.token)
    const tokenNew = optionalString(emailData.token_new)
    const tokenHash = optionalString(emailData.token_hash)
    const tokenHashNew = optionalString(emailData.token_hash_new)

    if (!tokenHash) {
      throw new AuthHookRequestError(400, 'Invalid email change token payload')
    }

    if (tokenHashNew) {
      // Supabase preserves these counterintuitive names for compatibility:
      // token_hash_new confirms the current address; token_hash confirms the new one.
      return [
        delivery(email, tokenHashNew, token, 'current', email, newEmail),
        delivery(newEmail, tokenHash, tokenNew, 'new', email, newEmail),
      ]
    }

    // With Secure Email Change disabled, Supabase sends one confirmation to
    // the new address using token_hash and whichever OTP field is populated.
    return [delivery(newEmail, tokenHash, tokenNew ?? token, undefined, email, newEmail)]
  }

  const token = optionalString(emailData.token)
  const tokenHash = optionalString(emailData.token_hash)
  if (actionType === 'reauthentication') {
    if (!token) throw new AuthHookRequestError(400, 'Invalid reauthentication token payload')
  } else if (!tokenHash) {
    throw new AuthHookRequestError(400, 'Invalid authentication token payload')
  }

  return [delivery(email, tokenHash, token)]
}

function normalizeLegacyPayload(value: unknown): NormalizedAuthEmailPayload {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new AuthHookRequestError(400, 'Invalid webhook payload')
  }
  const actionType = requiredString(value.data.action_type, 'data.action_type')
  if (!isEmailActionType(actionType)) {
    throw new AuthHookRequestError(400, 'Unsupported authentication email type')
  }

  return {
    run_id: requiredString(value.run_id, 'run_id'),
    version: requiredString(value.version, 'version'),
    data: {
      action_type: actionType,
      email: normalizeEmail(value.data.email, 'data.email'),
      url: requiredString(value.data.url, 'data.url'),
      token: optionalString(value.data.token),
      old_email: optionalString(value.data.old_email),
      new_email: optionalString(value.data.new_email),
    },
  }
}

async function verifySupabaseAuthHook(
  req: Request,
  hookSecret: string,
  supabaseUrl: string,
): Promise<NormalizedAuthEmailPayload[]> {
  const rawBody = await readWebhookBody(req)
  let webhook: Webhook
  try {
    webhook = new Webhook(normalizeStandardWebhookSecret(hookSecret))
  } catch (error) {
    if (error instanceof AuthHookRequestError) throw error
    throw new AuthHookRequestError(500, 'Server configuration error')
  }

  let verified: unknown
  try {
    verified = webhook.verify(rawBody, Object.fromEntries(req.headers))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new AuthHookRequestError(400, 'Invalid Send Email Hook payload')
    }
    throw new AuthHookRequestError(401, 'Invalid webhook signature')
  }

  const webhookId = requiredString(req.headers.get('webhook-id'), 'webhook-id')
  return normalizeSupabaseAuthPayload(verified, supabaseUrl, webhookId)
}

async function verifyLegacyLovableHook(
  req: Request,
  apiKey: string,
): Promise<NormalizedAuthEmailPayload[]> {
  // Loaded only in the existing Lovable Cloud environment. A migrated or
  // self-managed Supabase project uses SEND_EMAIL_HOOK_SECRET and never loads
  // either package.
  const [{ parseEmailWebhookPayload }, { WebhookError, verifyWebhookRequest }] = await Promise.all([
    import('npm:@lovable.dev/email-js'),
    import('npm:@lovable.dev/webhooks-js'),
  ])
  try {
    const verified = await verifyWebhookRequest({
      req,
      secret: apiKey,
      parser: parseEmailWebhookPayload,
    })
    return [normalizeLegacyPayload(verified.payload)]
  } catch (error) {
    if (error instanceof WebhookError) {
      if (error.code === 'invalid_payload' || error.code === 'invalid_json') {
        throw new AuthHookRequestError(400, 'Invalid webhook payload')
      }
      throw new AuthHookRequestError(401, 'Invalid webhook signature')
    }
    throw error
  }
}

function authHookError(
  status: number,
  message: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify({ error: { http_code: status, message } }),
    {
      status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
    },
  )
}

async function enqueueAuthEmail(
  supabase: ReturnType<typeof createClient>,
  payload: NormalizedAuthEmailPayload,
): Promise<void> {
  const emailType = payload.data.action_type
  const messageId = payload.delivery_id ?? crypto.randomUUID()

  // Standard Webhooks keeps webhook-id stable across retries. Reusing it as
  // message_id lets the dispatcher discard retries after a successful send.
  // We intentionally do not treat a pending log as delivered: the process may
  // have stopped after logging but before the queue write.
  if (payload.delivery_id) {
    const { data: existing, error: lookupError } = await supabase
      .from('email_send_log')
      .select('id')
      .eq('message_id', messageId)
      .eq('status', 'sent')
      .limit(1)

    if (lookupError) {
      console.warn('Could not check auth email idempotency', {
        run_id: payload.run_id,
        emailType,
      })
    } else if (existing && existing.length > 0) {
      console.log('Auth email webhook already accepted', {
        run_id: payload.run_id,
        emailType,
      })
      return
    }
  }

  const EmailTemplate = EMAIL_TEMPLATES[emailType]
  const templateProps = {
    siteName: SITE_NAME,
    siteUrl: APP_PUBLIC_URL,
    recipient: payload.data.email,
    confirmationUrl: payload.data.url,
    token: payload.data.token,
    email: payload.data.email,
    oldEmail: payload.data.old_email,
    newEmail: payload.data.new_email,
  }
  const [html, text] = await Promise.all([
    renderAsync(React.createElement(EmailTemplate, templateProps)),
    renderAsync(React.createElement(EmailTemplate, templateProps), { plainText: true }),
  ])

  const { error: logError } = await supabase.from('email_send_log').insert({
    message_id: messageId,
    template_name: emailType,
    recipient_email: payload.data.email,
    status: 'pending',
  })
  if (logError) {
    console.warn('Failed to record pending auth email', {
      run_id: payload.run_id,
      emailType,
    })
  }

  const { error: enqueueError } = await supabase.rpc('enqueue_email', {
    queue_name: 'auth_emails',
    payload: {
      run_id: payload.run_id,
      message_id: messageId,
      to: payload.data.email,
      from: `${SITE_NAME} <notify@${FROM_DOMAIN}>`,
      sender_domain: FROM_DOMAIN,
      subject: EMAIL_SUBJECTS[emailType],
      html,
      text,
      purpose: 'transactional',
      label: emailType,
      queued_at: new Date().toISOString(),
    },
  })

  if (enqueueError) {
    console.error('Failed to enqueue auth email', {
      run_id: payload.run_id,
      emailType,
    })
    if (!logError) {
      await supabase
        .from('email_send_log')
        .update({ status: 'failed', error_message: 'Failed to enqueue email' })
        .eq('message_id', messageId)
        .eq('status', 'pending')
    }
    throw new AuthHookRequestError(500, 'Failed to queue authentication email')
  }

  console.log('Auth email enqueued', {
    emailType,
    email_redacted: redactEmail(payload.data.email),
    run_id: payload.run_id,
  })
}

// Webhook handler - verifies signature and queues one or two auth emails.
async function handleWebhook(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return authHookError(405, 'Method not allowed', { Allow: 'POST, OPTIONS' })
  }

  const hookSecret = readEnv('SEND_EMAIL_HOOK_SECRET')
  const legacyApiKey = readEnv('LOVABLE_API_KEY')
  const supabaseUrl = readEnv('SUPABASE_URL')
  const supabaseServiceKey = readEnv('SUPABASE_SERVICE_ROLE_KEY')

  if ((!hookSecret && !legacyApiKey) || !supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required auth email hook configuration')
    return authHookError(500, 'Server configuration error')
  }

  let payloads: NormalizedAuthEmailPayload[]
  try {
    // The legacy verifier is imported only when the portable secret is absent.
    payloads = hookSecret
      ? await verifySupabaseAuthHook(req, hookSecret, supabaseUrl)
      : await verifyLegacyLovableHook(req, legacyApiKey!)
  } catch (error) {
    const requestError = error instanceof AuthHookRequestError
      ? error
      : new AuthHookRequestError(500, 'Internal hook error')
    console.error('Auth email webhook rejected', {
      status: requestError.status,
      kind: error instanceof Error ? error.name : 'UnknownError',
    })
    return authHookError(requestError.status, requestError.publicMessage)
  }

  const unsupported = payloads.find((payload) => payload.version !== '1')
  if (unsupported) {
    console.error('Unsupported payload version', {
      version: unsupported.version,
      run_id: unsupported.run_id,
    })
    return authHookError(400, 'Unsupported webhook payload version')
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  try {
    for (const payload of payloads) {
      await enqueueAuthEmail(supabase, payload)
    }
  } catch (error) {
    const requestError = error instanceof AuthHookRequestError
      ? error
      : new AuthHookRequestError(500, 'Internal hook error')
    return authHookError(requestError.status, requestError.publicMessage)
  }

  return new Response(
    JSON.stringify({ success: true, queued: true }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  // Handle CORS preflight for main endpoint
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // Route to preview handler for /preview path
  if (url.pathname.endsWith('/preview')) {
    return handlePreview(req)
  }

  // Main webhook handler
  try {
    return await handleWebhook(req)
  } catch (error) {
    console.error('Unhandled auth email hook error', {
      kind: error instanceof Error ? error.name : 'UnknownError',
    })
    return authHookError(500, 'Internal hook error')
  }
})
