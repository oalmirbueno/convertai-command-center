// Portable MCP endpoint configuration shared by the resource server, OAuth
// metadata endpoint and bearer-token verifier. Production deployments may use
// a stable public MCP URL while keeping Supabase Auth on its canonical issuer.

import { resolvePublicAppUrl } from './public-url.ts';

export type McpRuntimeEnvName =
  | 'SUPABASE_URL'
  | 'MCP_AUTH_ISSUER'
  | 'MCP_RESOURCE_URL'
  | 'MCP_OAUTH_METADATA_URL'
  | 'APP_PUBLIC_URL';

export type McpRuntimeEnvReader = (name: McpRuntimeEnvName) => string | undefined;

export interface McpRuntimeConfig {
  supabaseUrl: string | null;
  authIssuer: string;
  resourceUrl: string;
  oauthMetadataUrl: string;
  appPublicUrl: string;
  authorizationServerMetadataUrl: string;
  jwksUrl: string;
}

const DERIVED_PATHS = {
  authIssuer: '/auth/v1',
  resourceUrl: '/functions/v1/mcp-server',
  oauthMetadataUrl: '/functions/v1/mcp-oauth-metadata',
} as const;

function defaultReadEnv(name: McpRuntimeEnvName): string | undefined {
  const runtime = globalThis as typeof globalThis & {
    Deno?: { env?: { get?: (key: string) => string | undefined } };
  };
  return runtime.Deno?.env?.get?.(name);
}

function readNonEmpty(
  readEnv: McpRuntimeEnvReader,
  name: McpRuntimeEnvName,
): string | null {
  const value = readEnv(name)?.trim();
  return value ? value : null;
}

function normalizeHttpUrl(value: string, name: McpRuntimeEnvName): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${name} must use HTTP or HTTPS`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${name} must not contain embedded credentials`);
  }
  if (parsed.search || parsed.hash) {
    throw new Error(`${name} must not contain a query string or fragment`);
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed.toString().replace(/\/$/, '');
}

function appendPath(baseUrl: string, path: string, name: McpRuntimeEnvName): string {
  const parsed = new URL(baseUrl);
  const basePath = parsed.pathname.replace(/\/+$/, '');
  parsed.pathname = `${basePath}${path}`;
  return normalizeHttpUrl(parsed.toString(), name);
}

function requireSecurePublicUrl(value: string, name: McpRuntimeEnvName): string {
  const url = new URL(value);
  const isLoopback = url.hostname === 'localhost'
    || url.hostname === '127.0.0.1'
    || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !isLoopback) {
    throw new Error(`${name} must use HTTPS outside localhost`);
  }
  return value;
}

function resolveEndpoint(
  readEnv: McpRuntimeEnvReader,
  overrideName: Exclude<McpRuntimeEnvName, 'SUPABASE_URL'>,
  supabaseUrl: string | null,
  derivedPath: string,
): string {
  const override = readNonEmpty(readEnv, overrideName);
  if (override) return normalizeHttpUrl(override, overrideName);
  if (!supabaseUrl) {
    throw new Error(`${overrideName} or SUPABASE_URL must be configured`);
  }
  return appendPath(supabaseUrl, derivedPath, overrideName);
}

export function resolveMcpRuntimeConfig(
  readEnv: McpRuntimeEnvReader = defaultReadEnv,
): Readonly<McpRuntimeConfig> {
  const rawSupabaseUrl = readNonEmpty(readEnv, 'SUPABASE_URL');
  const supabaseUrl = rawSupabaseUrl
    ? normalizeHttpUrl(rawSupabaseUrl, 'SUPABASE_URL')
    : null;

  const authIssuer = requireSecurePublicUrl(resolveEndpoint(
    readEnv,
    'MCP_AUTH_ISSUER',
    supabaseUrl,
    DERIVED_PATHS.authIssuer,
  ), 'MCP_AUTH_ISSUER');
  const resourceUrl = requireSecurePublicUrl(resolveEndpoint(
    readEnv,
    'MCP_RESOURCE_URL',
    supabaseUrl,
    DERIVED_PATHS.resourceUrl,
  ), 'MCP_RESOURCE_URL');
  const oauthMetadataUrl = requireSecurePublicUrl(resolveEndpoint(
    readEnv,
    'MCP_OAUTH_METADATA_URL',
    supabaseUrl,
    DERIVED_PATHS.oauthMetadataUrl,
  ), 'MCP_OAUTH_METADATA_URL');
  const appPublicUrl = resolvePublicAppUrl(name => readEnv(name));

  return Object.freeze({
    supabaseUrl,
    authIssuer,
    resourceUrl,
    oauthMetadataUrl,
    appPublicUrl,
    authorizationServerMetadataUrl: appendPath(
      authIssuer,
      '/.well-known/oauth-authorization-server',
      'MCP_AUTH_ISSUER',
    ),
    jwksUrl: appendPath(authIssuer, '/.well-known/jwks.json', 'MCP_AUTH_ISSUER'),
  });
}

let cachedRuntimeConfig: Readonly<McpRuntimeConfig> | null = null;

export function getMcpRuntimeConfig(): Readonly<McpRuntimeConfig> {
  cachedRuntimeConfig ??= resolveMcpRuntimeConfig();
  return cachedRuntimeConfig;
}
