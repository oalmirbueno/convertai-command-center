export type PublicAppUrlEnvReader = (name: 'APP_PUBLIC_URL') => string | undefined

function runtimeEnv(name: 'APP_PUBLIC_URL'): string | undefined {
  const runtime = globalThis as typeof globalThis & {
    Deno?: { env?: { get?: (key: string) => string | undefined } }
  }
  return runtime.Deno?.env?.get?.(name)
}

export function normalizePublicAppUrl(value: string): string {
  const configured = value.trim()
  let url: URL
  try {
    url = new URL(configured)
  } catch {
    throw new Error('APP_PUBLIC_URL must be an absolute HTTP(S) URL')
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('APP_PUBLIC_URL must use HTTP or HTTPS')
  }
  const loopback = url.hostname === 'localhost'
    || url.hostname === '127.0.0.1'
    || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !loopback) {
    throw new Error('APP_PUBLIC_URL must use HTTPS outside localhost')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('APP_PUBLIC_URL must not contain credentials, query, or fragment')
  }
  if (url.pathname !== '/' || configured.endsWith('/')) {
    throw new Error('APP_PUBLIC_URL must contain only an origin without a path or trailing slash')
  }

  return url.origin
}

export function resolvePublicAppUrl(
  readEnv: PublicAppUrlEnvReader = runtimeEnv,
): string {
  const configured = readEnv('APP_PUBLIC_URL')?.trim()
  if (!configured) {
    throw new Error('APP_PUBLIC_URL is required')
  }
  return normalizePublicAppUrl(configured)
}
