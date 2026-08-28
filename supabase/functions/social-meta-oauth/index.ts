import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.97.0";
import {
  buildAllowedOrigins,
  buildFacebookLoginUrl,
  createAppSecretProof,
  missingMetaScopes,
  normalizeGraphVersion,
  parseManagedPages,
  redactSensitive,
  sanitizeMetaResources,
  validateMetaRedirectUri,
} from "./meta.ts";
import { resolvePublicAppUrl } from "../_shared/public-url.ts";

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_META_RESPONSE_BYTES = 1024 * 1024;
const META_TIMEOUT_MS = 20_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set([
  "start",
  "complete",
  "connect",
  "finish",
  "disconnect",
]);
type Action = "start" | "complete" | "connect" | "finish" | "disconnect";
type JsonRecord = Record<string, unknown>;

type SupabaseRuntimeConfig = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
};

type RuntimeConfig = SupabaseRuntimeConfig & {
  metaAppId: string;
  metaAppSecret: string;
  metaLoginConfigId: string;
  metaGraphVersion: string;
  metaRedirectUri: string;
};

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly publicDetails?: JsonRecord,
    readonly logContext?: JsonRecord,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function requiredMetaEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new ApiError(
      "A conexão com a Meta ainda não está configurada.",
      503,
      "META_NOT_CONFIGURED",
      undefined,
      { missing_env: name },
    );
  }
  return value;
}

function loadSupabaseConfig(): SupabaseRuntimeConfig {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim();
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw new ApiError(
      "Backend não configurado.",
      503,
      "BACKEND_NOT_CONFIGURED",
    );
  }
  return { supabaseUrl, anonKey, serviceRoleKey };
}

function loadMetaConfig(supabase: SupabaseRuntimeConfig): RuntimeConfig {
  const metaRedirectUri = requiredMetaEnv("META_REDIRECT_URI");
  try {
    validateMetaRedirectUri(metaRedirectUri);
  } catch {
    throw new ApiError(
      "A conexão com a Meta ainda não está configurada.",
      503,
      "META_NOT_CONFIGURED",
      undefined,
      { invalid_env: "META_REDIRECT_URI" },
    );
  }

  let metaGraphVersion: string;
  try {
    metaGraphVersion = normalizeGraphVersion(Deno.env.get("META_GRAPH_VERSION"));
  } catch {
    throw new ApiError(
      "A conexão com a Meta ainda não está configurada.",
      503,
      "META_NOT_CONFIGURED",
      undefined,
      { invalid_env: "META_GRAPH_VERSION" },
    );
  }

  return {
    ...supabase,
    metaAppId: requiredMetaEnv("META_APP_ID"),
    metaAppSecret: requiredMetaEnv("META_APP_SECRET"),
    metaLoginConfigId: requiredMetaEnv("META_LOGIN_CONFIG_ID"),
    metaGraphVersion,
    metaRedirectUri,
  };
}

function allowedOrigins(): Set<string> {
  const redirectUri = Deno.env.get("META_REDIRECT_URI")?.trim();
  const appPublicUrl = resolvePublicAppUrl();
  if (!redirectUri) return new Set([new URL(appPublicUrl).origin]);
  try {
    return buildAllowedOrigins(redirectUri, appPublicUrl);
  } catch {
    return new Set([new URL(appPublicUrl).origin]);
  }
}

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  });
  if (origin && allowedOrigins().has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function jsonResponse(
  body: JsonRecord,
  status: number,
  origin: string | null,
  extraHeaders?: Record<string, string>,
): Response {
  const headers = corsHeaders(origin);
  for (const [key, value] of Object.entries(extraHeaders || {})) {
    headers.set(key, value);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return Array.from(value)
    .map((character) => {
      const codePoint = character.codePointAt(0) || 0;
      return codePoint >= 32 && codePoint !== 127 ? character : " ";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function requiredText(
  value: unknown,
  message: string,
  maxLength: number,
): string {
  const normalized = cleanText(value, maxLength);
  if (!normalized) {
    throw new ApiError(message, 400, "INVALID_REQUEST");
  }
  return normalized;
}

function requiredUuid(value: unknown, message: string): string {
  const normalized = requiredText(value, message, 64);
  if (!UUID_PATTERN.test(normalized)) {
    throw new ApiError(message, 400, "INVALID_REQUEST");
  }
  return normalized;
}

function recordValue(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function rpcRecord(value: unknown): JsonRecord | null {
  if (Array.isArray(value)) return recordValue(value[0]);
  return recordValue(value);
}

function alias(body: JsonRecord, snakeCase: string, camelCase: string): unknown {
  return body[snakeCase] ?? body[camelCase];
}

async function readJsonBody(req: Request): Promise<JsonRecord> {
  const declaredLength = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new ApiError("Requisição muito grande.", 413, "PAYLOAD_TOO_LARGE");
  }

  if (!req.body) {
    throw new ApiError("Dados inválidos.", 400, "INVALID_JSON");
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new ApiError("Requisição muito grande.", 413, "PAYLOAD_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError("Dados inválidos.", 400, "INVALID_JSON");
  }
  const body = recordValue(parsed);
  if (!body) throw new ApiError("Dados inválidos.", 400, "INVALID_JSON");
  return body;
}

function bearerToken(req: Request): string {
  const authorization = req.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match?.[1]) {
    throw new ApiError("Faça login para continuar.", 401, "UNAUTHENTICATED");
  }
  return match[1];
}

async function authenticate(req: Request, config: SupabaseRuntimeConfig) {
  const jwt = bearerToken(req);
  const admin = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) {
    throw new ApiError(
      "Sua sessão expirou. Entre novamente.",
      401,
      "UNAUTHENTICATED",
    );
  }

  const caller = createClient(config.supabaseUrl, config.anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { admin, caller, userId: data.user.id };
}

async function rpcOrThrow(
  client: SupabaseClient,
  name: string,
  args: JsonRecord,
  publicMessage: string,
): Promise<unknown> {
  const { data, error } = await client.rpc(name, args);
  if (error) {
    throw new ApiError(
      publicMessage,
      422,
      "DATABASE_REJECTED",
      undefined,
      { rpc: name, database_code: error.code || "unknown" },
    );
  }
  return data;
}

async function readMetaJson(response: Response): Promise<JsonRecord> {
  const declaredLength = Number(response.headers.get("content-length") || "0");
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_META_RESPONSE_BYTES
  ) {
    throw new ApiError(
      "A Meta devolveu uma resposta inválida.",
      502,
      "META_INVALID_RESPONSE",
      undefined,
      { provider_status: response.status, reason: "response_too_large" },
    );
  }

  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_META_RESPONSE_BYTES) {
    throw new ApiError(
      "A Meta devolveu uma resposta inválida.",
      502,
      "META_INVALID_RESPONSE",
      undefined,
      { provider_status: response.status, reason: "response_too_large" },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError(
      "A Meta devolveu uma resposta inválida.",
      502,
      "META_INVALID_RESPONSE",
      undefined,
      { provider_status: response.status, reason: "invalid_json" },
    );
  }
  const payload = recordValue(parsed);
  if (!payload) {
    throw new ApiError(
      "A Meta devolveu uma resposta inválida.",
      502,
      "META_INVALID_RESPONSE",
      undefined,
      { provider_status: response.status, reason: "invalid_payload" },
    );
  }

  if (!response.ok) {
    const providerError = recordValue(payload.error);
    throw new ApiError(
      "A Meta recusou a conexão. Inicie o login novamente.",
      502,
      "META_PROVIDER_ERROR",
      undefined,
      {
        provider_status: response.status,
        provider_code: providerError?.code,
        provider_subcode: providerError?.error_subcode,
        provider_type: providerError?.type,
        provider_trace: providerError?.fbtrace_id,
      },
    );
  }
  return payload;
}

async function fetchMetaJson(
  url: URL,
  init: RequestInit,
): Promise<JsonRecord> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), META_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    return await readMetaJson(response);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      "Não foi possível falar com a Meta. Tente novamente.",
      502,
      "META_UNAVAILABLE",
      undefined,
      {
        reason:
          error instanceof DOMException && error.name === "AbortError"
            ? "timeout"
            : "network_error",
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function exchangeToken(
  config: RuntimeConfig,
  params: Record<string, string>,
): Promise<JsonRecord> {
  const url = new URL(
    `https://graph.facebook.com/${config.metaGraphVersion}/oauth/access_token`,
  );
  const body = new URLSearchParams({
    client_id: config.metaAppId,
    client_secret: config.metaAppSecret,
    ...params,
  });
  return fetchMetaJson(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body,
  });
}

async function graphGet(
  config: RuntimeConfig,
  path: string,
  accessToken: string,
  params: Record<string, string> = {},
): Promise<JsonRecord> {
  const url = new URL(
    `https://graph.facebook.com/${config.metaGraphVersion}/${path.replace(/^\/+/, "")}`,
  );
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set(
    "appsecret_proof",
    await createAppSecretProof(accessToken, config.metaAppSecret),
  );
  return fetchMetaJson(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

function requiredMetaToken(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 8_192) {
    throw new ApiError(
      "A Meta não confirmou a autorização. Inicie o login novamente.",
      502,
      "META_INVALID_RESPONSE",
    );
  }
  return value;
}

function unixTimestampToIso(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function expiresInToIso(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const cappedSeconds = Math.min(value, 366 * 24 * 60 * 60);
  return new Date(Date.now() + cappedSeconds * 1000).toISOString();
}

async function loadManagedPages(
  config: RuntimeConfig,
  userAccessToken: string,
): Promise<unknown[]> {
  const pages: unknown[] = [];
  let after = "";

  for (let requestNumber = 0; requestNumber < 10 && pages.length < 500; requestNumber++) {
    const payload = await graphGet(config, "me/accounts", userAccessToken, {
      fields:
        "id,name,access_token,tasks,picture{url},instagram_business_account{id,username,name,profile_picture_url}",
      limit: "100",
      ...(after ? { after } : {}),
    });
    if (Array.isArray(payload.data)) {
      pages.push(...payload.data.slice(0, 500 - pages.length));
    }

    const paging = recordValue(payload.paging);
    const cursors = recordValue(paging?.cursors);
    const nextAfter = cleanText(cursors?.after, 512);
    if (!nextAfter || nextAfter === after) break;
    after = nextAfter;
  }
  return pages;
}

async function handleStart(
  body: JsonRecord,
  config: RuntimeConfig,
  caller: SupabaseClient,
  admin: SupabaseClient,
): Promise<JsonRecord> {
  const clientId = requiredUuid(
    alias(body, "client_id", "clientId"),
    "Cliente inválido.",
  );
  const projectId = requiredUuid(
    alias(body, "project_id", "projectId"),
    "Projeto inválido.",
  );
  await rpcOrThrow(
    admin,
    "social_meta_oauth_register_redirect_uri",
    { _redirect_uri: config.metaRedirectUri },
    "A configuração de callback da Meta não pôde ser validada.",
  );
  const data = await rpcOrThrow(
    caller,
    "social_meta_oauth_create_session",
    {
      _client_id: clientId,
      _project_id: projectId,
      _redirect_uri: config.metaRedirectUri,
    },
    "Não foi possível iniciar a conexão com a Meta.",
  );
  const session = rpcRecord(data);
  const oauthSessionId = requiredUuid(
    session?.oauth_session_id,
    "A sessão de conexão com a Meta é inválida.",
  );
  const state = requiredText(
    session?.state,
    "A sessão de conexão com a Meta é inválida.",
    1_024,
  );

  return {
    authorization_url: buildFacebookLoginUrl({
      appId: config.metaAppId,
      configId: config.metaLoginConfigId,
      graphVersion: config.metaGraphVersion,
      redirectUri: config.metaRedirectUri,
      state,
    }),
    oauth_session_id: oauthSessionId,
  };
}

async function handleComplete(
  body: JsonRecord,
  config: RuntimeConfig,
  caller: SupabaseClient,
  admin: SupabaseClient,
  userId: string,
): Promise<JsonRecord> {
  const code = requiredText(
    body.code,
    "Código de autorização ausente.",
    4_096,
  );
  const state = requiredText(
    body.state,
    "Estado de autorização ausente.",
    1_024,
  );
  const consumedData = await rpcOrThrow(
    caller,
    "social_meta_oauth_consume_session",
    { _state: state },
    "A sessão de conexão com a Meta expirou. Inicie novamente.",
  );
  const consumed = rpcRecord(consumedData);
  const oauthSessionId = requiredUuid(
    consumed?.oauth_session_id,
    "A sessão de conexão com a Meta expirou. Inicie novamente.",
  );

  const shortLived = await exchangeToken(config, {
    redirect_uri: config.metaRedirectUri,
    code,
  });
  const shortLivedToken = requiredMetaToken(shortLived.access_token);
  const longLived = await exchangeToken(config, {
    grant_type: "fb_exchange_token",
    fb_exchange_token: shortLivedToken,
  });
  const userAccessToken = requiredMetaToken(longLived.access_token);

  const appAccessToken = `${config.metaAppId}|${config.metaAppSecret}`;
  const debugPayload = await graphGet(
    config,
    "debug_token",
    appAccessToken,
    { input_token: userAccessToken },
  );
  const debugData = recordValue(debugPayload.data);
  const metaUserId = cleanText(debugData?.user_id, 64);
  if (
    debugData?.is_valid !== true ||
    cleanText(debugData?.app_id, 128) !== config.metaAppId ||
    !metaUserId
  ) {
    throw new ApiError(
      "A Meta não confirmou a autorização. Inicie o login novamente.",
      422,
      "META_INVALID_TOKEN",
    );
  }

  const permissionsPayload = await graphGet(
    config,
    "me/permissions",
    userAccessToken,
  );
  const permissions = missingMetaScopes(permissionsPayload.data);
  if (permissions.missing.length > 0) {
    throw new ApiError(
      "Autorize todas as permissões necessárias para conectar as contas.",
      422,
      "META_MISSING_PERMISSIONS",
      { missing_scopes: permissions.missing },
    );
  }

  const pages = await loadManagedPages(config, userAccessToken);
  const resources = parseManagedPages(pages);
  await rpcOrThrow(
    admin,
    "social_meta_oauth_store_resources",
    {
      _actor_id: userId,
      _oauth_session_id: oauthSessionId,
      _meta_user_id: metaUserId,
      _user_access_token: userAccessToken,
      _user_access_token_expires_at:
        expiresInToIso(longLived.expires_in) ||
        unixTimestampToIso(debugData.expires_at),
      _data_access_expires_at: unixTimestampToIso(
        debugData.data_access_expires_at,
      ),
      _granted_scopes: permissions.granted,
      _declined_scopes: permissions.declined,
      _resources: resources,
      _graph_version: config.metaGraphVersion,
    },
    "Não foi possível salvar as contas encontradas na Meta.",
  );

  // ─── Anuncios de brinde, no mesmo clique ────────────────────────────
  //
  // O token de usuario que acabamos de guardar tambem le contas de
  // anuncio, SE a pessoa autorizou `ads_read`. Aproveitar isso aqui e o
  // que dispensa o ritual do usuario do sistema no Business Manager.
  //
  // Falhar aqui NAO derruba a conexao do Instagram. A pessoa veio conectar
  // rede social; se o lado dos anuncios nao vier junto, ela leva o que
  // pediu e o resto fica para depois. Quebrar o principal por causa do
  // acessorio seria trocar um problema por outro pior.
  let anuncios: JsonRecord = { autorizado: false };
  if (permissions.granted.includes("ads_read")) {
    try {
      const contas = await graphGet(
        config,
        "me/adaccounts",
        userAccessToken,
        { fields: "id,name,account_status", limit: "200" },
      );
      await rpcOrThrow(
        admin,
        "save_meta_ads_token_from_login",
        { _token: userAccessToken, _label: "Token do login da Meta" },
        "Nao foi possivel guardar o acesso de anuncios.",
      );
      anuncios = {
        autorizado: true,
        contas: Array.isArray(contas.data) ? contas.data.length : 0,
      };
    } catch (error) {
      anuncios = {
        autorizado: true,
        guardado: false,
        motivo: error instanceof Error ? error.message : "falha ao ler as contas de anuncio",
      };
    }
  }

  return {
    oauth_session_id: oauthSessionId,
    resources: sanitizeMetaResources(resources),
    anuncios,
  };
}

async function handleConnect(
  body: JsonRecord,
  caller: SupabaseClient,
): Promise<JsonRecord> {
  const oauthSessionId = requiredUuid(
    alias(body, "oauth_session_id", "oauthSessionId"),
    "A sessão de conexão com a Meta expirou.",
  );
  const candidateId = requiredUuid(
    alias(body, "candidate_id", "candidateId"),
    "Selecione uma conta da Meta.",
  );
  const clientId = requiredUuid(
    alias(body, "client_id", "clientId"),
    "Cliente inválido.",
  );
  const projectId = requiredUuid(
    alias(body, "project_id", "projectId"),
    "Projeto inválido.",
  );
  const data = await rpcOrThrow(
    caller,
    "social_meta_connect_resource",
    {
      _oauth_session_id: oauthSessionId,
      _candidate_id: candidateId,
      _client_id: clientId,
      _project_id: projectId,
    },
    "Não foi possível vincular a conta da Meta.",
  );
  const result = rpcRecord(data);
  const externalAccountId = requiredText(
    result?.external_account_id,
    "A Meta não confirmou a conta conectada.",
    255,
  );
  return { external_account_id: externalAccountId };
}

async function handleFinish(
  body: JsonRecord,
  caller: SupabaseClient,
): Promise<JsonRecord> {
  const oauthSessionId = requiredUuid(
    alias(body, "oauth_session_id", "oauthSessionId"),
    "A sessão de conexão com a Meta expirou.",
  );
  const clientId = requiredUuid(
    alias(body, "client_id", "clientId"),
    "Cliente inválido.",
  );
  const projectId = requiredUuid(
    alias(body, "project_id", "projectId"),
    "Projeto inválido.",
  );
  await rpcOrThrow(
    caller,
    "social_meta_oauth_finish_session",
    {
      _oauth_session_id: oauthSessionId,
      _client_id: clientId,
      _project_id: projectId,
    },
    "Não foi possível finalizar a sessão da Meta.",
  );
  return { ok: true, success: true };
}

async function handleDisconnect(
  body: JsonRecord,
  caller: SupabaseClient,
): Promise<JsonRecord> {
  const externalAccountId = requiredText(
    alias(body, "external_account_id", "externalAccountId") ??
      alias(body, "account_id", "accountId"),
    "Conta inválida.",
    255,
  );
  await rpcOrThrow(
    caller,
    "social_meta_disconnect_account",
    { _external_account_id: externalAccountId },
    "Não foi possível desconectar a conta da Meta.",
  );
  return { ok: true, success: true };
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const origin = req.headers.get("origin");

  if (origin && !allowedOrigins().has(origin)) {
    return jsonResponse(
      { error: "Origem não permitida.", code: "ORIGIN_NOT_ALLOWED" },
      403,
      null,
    );
  }
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return jsonResponse(
      { error: "Método não permitido.", code: "METHOD_NOT_ALLOWED" },
      405,
      origin,
      { Allow: "POST, OPTIONS" },
    );
  }

  try {
    const supabaseConfig = loadSupabaseConfig();
    const { admin, caller, userId } = await authenticate(req, supabaseConfig);
    const body = await readJsonBody(req);
    const actionValue = cleanText(body.action, 32).toLowerCase();
    if (!ACTIONS.has(actionValue)) {
      throw new ApiError("Ação inválida.", 400, "INVALID_ACTION");
    }
    const action = actionValue as Action;

    let result: JsonRecord;
    if (action === "start") {
      const config = loadMetaConfig(supabaseConfig);
      result = await handleStart(body, config, caller, admin);
    } else if (action === "complete") {
      const config = loadMetaConfig(supabaseConfig);
      result = await handleComplete(
        body,
        config,
        caller,
        admin,
        userId,
      );
    } else if (action === "connect") {
      result = await handleConnect(body, caller);
    } else if (action === "finish") {
      result = await handleFinish(body, caller);
    } else {
      result = await handleDisconnect(body, caller);
    }

    return jsonResponse(result, 200, origin);
  } catch (error) {
    const apiError =
      error instanceof ApiError
        ? error
        : new ApiError(
            "Erro interno ao conectar a Meta.",
            500,
            "INTERNAL_ERROR",
          );
    console.error(
      "social-meta-oauth failed",
      redactSensitive({
        request_id: requestId,
        status: apiError.status,
        code: apiError.code,
        context: apiError.logContext,
        error_type:
          error instanceof Error ? error.name : typeof error,
      }),
    );
    return jsonResponse(
      {
        error: apiError.message,
        code: apiError.code,
        ...(apiError.publicDetails || {}),
      },
      apiError.status,
      origin,
    );
  }
});
