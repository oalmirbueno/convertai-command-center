import { resolvePublicAppUrl } from './public-url.ts'

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function configured(value: string | undefined): string | null {
  return value?.trim() || null
}

function emailDomain(value: string): string {
  const domain = value.trim().toLowerCase()
  let parsed: URL
  try {
    parsed = new URL(`https://${domain}`)
  } catch {
    throw new Error('EMAIL_FROM_DOMAIN must be a valid hostname')
  }
  if (
    !domain
    || parsed.hostname !== domain
    || parsed.port
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
  ) {
    throw new Error('EMAIL_FROM_DOMAIN must be a valid hostname')
  }
  return domain
}

export const EMAIL_APP_URL = withoutTrailingSlash(
  resolvePublicAppUrl(),
)

export const EMAIL_SITE_NAME = configured(Deno.env.get('EMAIL_SITE_NAME'))
  ?? 'AcelerIQ'

export const EMAIL_FROM_DOMAIN = emailDomain(
  configured(Deno.env.get('EMAIL_FROM_DOMAIN'))
    ?? new URL(EMAIL_APP_URL).hostname,
)

const supabaseUrl = Deno.env.get('SUPABASE_URL')

export const EMAIL_LOGO_URL = Deno.env.get('EMAIL_LOGO_URL')
  ?? (supabaseUrl
    ? `${withoutTrailingSlash(supabaseUrl)}/storage/v1/object/public/email-assets/logo-aceleriq-email.png`
    : `${EMAIL_APP_URL}/logo-aceleriq-email.png`)
