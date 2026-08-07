export type McpEndpointEnvironment = {
  VITE_MCP_SERVER_URL?: string;
  VITE_MCP_OAUTH_METADATA_URL?: string;
  VITE_SUPABASE_URL?: string;
};

export type McpEndpoints = {
  serverUrl: string;
  oauthMetadataUrl: string;
};

function normalizeAbsoluteHttpUrl(value: string, variableName: string): string {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${variableName} precisa ser uma URL absoluta válida.`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${variableName} precisa usar http ou https.`);
  }

  const isLoopback = url.hostname === "localhost"
    || url.hostname === "127.0.0.1"
    || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !isLoopback) {
    throw new Error(`${variableName} precisa usar https fora do ambiente local.`);
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      `${variableName} não pode conter credenciais, query string ou fragmento.`,
    );
  }

  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

function optionalUrl(value: string | undefined, variableName: string): string | null {
  if (!value?.trim()) return null;
  return normalizeAbsoluteHttpUrl(value, variableName);
}

function functionUrl(supabaseUrl: string, functionName: string): string {
  return `${supabaseUrl}/functions/v1/${functionName}`;
}

export function resolveMcpEndpoints(env: McpEndpointEnvironment): McpEndpoints {
  const supabaseUrl = optionalUrl(env.VITE_SUPABASE_URL, "VITE_SUPABASE_URL");
  const configuredServerUrl = optionalUrl(env.VITE_MCP_SERVER_URL, "VITE_MCP_SERVER_URL");
  const configuredMetadataUrl = optionalUrl(
    env.VITE_MCP_OAUTH_METADATA_URL,
    "VITE_MCP_OAUTH_METADATA_URL",
  );

  if (!configuredServerUrl && !supabaseUrl) {
    throw new Error(
      "Configuração MCP ausente: defina VITE_MCP_SERVER_URL ou VITE_SUPABASE_URL.",
    );
  }

  if (!configuredMetadataUrl && !supabaseUrl) {
    throw new Error(
      "Configuração OAuth MCP ausente: defina VITE_MCP_OAUTH_METADATA_URL ou VITE_SUPABASE_URL.",
    );
  }

  return {
    serverUrl: configuredServerUrl ?? functionUrl(supabaseUrl!, "mcp-server"),
    oauthMetadataUrl:
      configuredMetadataUrl ?? functionUrl(supabaseUrl!, "mcp-oauth-metadata"),
  };
}

const endpoints = resolveMcpEndpoints(import.meta.env);

export const MCP_SERVER_URL = endpoints.serverUrl;
export const MCP_OAUTH_METADATA_URL = endpoints.oauthMetadataUrl;
