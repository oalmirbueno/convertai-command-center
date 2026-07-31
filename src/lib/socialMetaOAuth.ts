import { supabase } from "@/integrations/supabase/client";
import { getSupabaseFunctionErrorMessage } from "@/lib/supabaseFunctionError";

export const META_OAUTH_FUNCTION_NAME = "social-meta-oauth";
export const META_OAUTH_CALLBACK_PATH = "/oauth/meta/callback";
export const META_OAUTH_MESSAGE_TYPE = "aceleriq:meta-oauth-complete";

export type MetaOAuthPlatform = "facebook" | "instagram";

export interface MetaOAuthResource {
  candidate_id: string;
  platform: MetaOAuthPlatform;
  display_name: string;
  handle: string | null;
}

export interface StartMetaOAuthInput {
  client_id: string;
  project_id: string;
  return_path: string;
}

export interface CompleteMetaOAuthInput {
  code: string;
  state: string;
}

export interface CompleteMetaOAuthResult {
  oauth_session_id: string;
  resources: MetaOAuthResource[];
}

export interface ConnectMetaOAuthInput {
  oauth_session_id: string;
  candidate_id: string;
  client_id: string;
  project_id: string;
}

export interface DisconnectMetaOAuthInput {
  external_account_id: string;
}

export interface FinishMetaOAuthInput {
  oauth_session_id: string;
  client_id: string;
  project_id: string;
}

export type MetaOAuthPopupMessage =
  | ({
      type: typeof META_OAUTH_MESSAGE_TYPE;
      ok: true;
    } & CompleteMetaOAuthResult)
  | {
      type: typeof META_OAUTH_MESSAGE_TYPE;
      ok: false;
      error: string;
    };

const META_AUTHORIZATION_HOST = /(^|\.)facebook\.com$/i;

function withoutControlCharacters(value: string) {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 31 || codePoint === 127 ? " " : character;
  }).join("");
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return withoutControlCharacters(value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function requiredText(value: unknown, label: string, maxLength: number) {
  const normalized = cleanText(value, maxLength);
  if (!normalized) throw new Error(label);
  return normalized;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function metaPlatform(value: unknown): MetaOAuthPlatform | null {
  const normalized = cleanText(value, 32).toLowerCase();
  return normalized === "facebook" || normalized === "instagram"
    ? normalized
    : null;
}

export function sanitizeMetaOAuthResources(
  value: unknown,
): MetaOAuthResource[] {
  if (!Array.isArray(value)) return [];

  const resources: MetaOAuthResource[] = [];
  const candidateIds = new Set<string>();

  for (const candidate of value) {
    const row = recordValue(candidate);
    if (!row) continue;

    const candidateId = cleanText(row.candidate_id, 256);
    const platform = metaPlatform(row.platform);
    const displayName = cleanText(row.display_name, 120);
    if (!candidateId || !platform || !displayName || candidateIds.has(candidateId)) {
      continue;
    }

    candidateIds.add(candidateId);
    resources.push({
      candidate_id: candidateId,
      platform,
      display_name: displayName,
      handle: cleanText(row.handle, 180) || null,
    });
  }

  return resources.slice(0, 100);
}

export function safeMetaOAuthError(value: unknown) {
  return (
    cleanText(value, 240) ||
    "Não foi possível concluir a conexão com a Meta."
  );
}

export function parseMetaOAuthPopupMessage(
  value: unknown,
): MetaOAuthPopupMessage | null {
  const message = recordValue(value);
  if (
    !message ||
    message.type !== META_OAUTH_MESSAGE_TYPE ||
    typeof message.ok !== "boolean"
  ) {
    return null;
  }

  if (!message.ok) {
    return {
      type: META_OAUTH_MESSAGE_TYPE,
      ok: false,
      error: safeMetaOAuthError(message.error),
    };
  }

  const oauthSessionId = cleanText(message.oauth_session_id, 256);
  if (!oauthSessionId) return null;

  return {
    type: META_OAUTH_MESSAGE_TYPE,
    ok: true,
    oauth_session_id: oauthSessionId,
    resources: sanitizeMetaOAuthResources(message.resources),
  };
}

export function metaAuthorizationUrl(value: unknown) {
  const rawUrl = requiredText(
    value,
    "A Meta não devolveu uma URL de autorização válida.",
    2_048,
  );

  let authorizationUrl: URL;
  try {
    authorizationUrl = new URL(rawUrl);
  } catch {
    throw new Error("A Meta não devolveu uma URL de autorização válida.");
  }

  if (
    authorizationUrl.protocol !== "https:" ||
    !META_AUTHORIZATION_HOST.test(authorizationUrl.hostname)
  ) {
    throw new Error("A URL de autorização da Meta não é confiável.");
  }

  return authorizationUrl.toString();
}

async function invokeMetaOAuth(
  body: Record<string, unknown>,
  fallback: string,
) {
  const { data, error } = await supabase.functions.invoke(
    META_OAUTH_FUNCTION_NAME,
    { body },
  );

  if (error) {
    throw new Error(await getSupabaseFunctionErrorMessage(error, fallback));
  }

  const payload = recordValue(data);
  if (!payload) throw new Error(fallback);
  return payload;
}

export async function startMetaOAuth(input: StartMetaOAuthInput) {
  const clientId = requiredText(input.client_id, "Cliente inválido.", 64);
  const projectId = requiredText(input.project_id, "Projeto inválido.", 64);
  const returnPath = requiredText(
    input.return_path,
    "Rota de retorno inválida.",
    512,
  );
  if (!returnPath.startsWith("/") || returnPath.startsWith("//")) {
    throw new Error("Rota de retorno inválida.");
  }

  const payload = await invokeMetaOAuth(
    {
      action: "start",
      client_id: clientId,
      project_id: projectId,
      return_path: returnPath,
    },
    "Não foi possível iniciar a conexão com a Meta.",
  );

  return { authorization_url: metaAuthorizationUrl(payload.authorization_url) };
}

export async function completeMetaOAuth(
  input: CompleteMetaOAuthInput,
): Promise<CompleteMetaOAuthResult> {
  const payload = await invokeMetaOAuth(
    {
      action: "complete",
      code: requiredText(input.code, "Código de autorização ausente.", 4_096),
      state: requiredText(input.state, "Estado de autorização ausente.", 4_096),
    },
    "Não foi possível concluir a conexão com a Meta.",
  );

  return {
    oauth_session_id: requiredText(
      payload.oauth_session_id,
      "A sessão de conexão com a Meta expirou.",
      256,
    ),
    resources: sanitizeMetaOAuthResources(payload.resources),
  };
}

export async function connectMetaOAuth(input: ConnectMetaOAuthInput) {
  const payload = await invokeMetaOAuth(
    {
      action: "connect",
      oauth_session_id: requiredText(
        input.oauth_session_id,
        "A sessão de conexão com a Meta expirou.",
        256,
      ),
      candidate_id: requiredText(
        input.candidate_id,
        "Selecione uma conta da Meta.",
        256,
      ),
      client_id: requiredText(input.client_id, "Cliente inválido.", 64),
      project_id: requiredText(input.project_id, "Projeto inválido.", 64),
    },
    "Não foi possível vincular a conta da Meta.",
  );

  return {
    external_account_id: requiredText(
      payload.external_account_id,
      "A Meta não confirmou a conta conectada.",
      64,
    ),
  };
}

export async function disconnectMetaOAuth(input: DisconnectMetaOAuthInput) {
  const payload = await invokeMetaOAuth(
    {
      action: "disconnect",
      external_account_id: requiredText(
        input.external_account_id,
        "Conta inválida.",
        64,
      ),
    },
    "Não foi possível desconectar a conta da Meta.",
  );

  if (payload.ok !== true) {
    throw new Error("A Meta não confirmou a desconexão da conta.");
  }
  return { ok: true as const };
}

export async function finishMetaOAuth(input: FinishMetaOAuthInput) {
  const payload = await invokeMetaOAuth(
    {
      action: "finish",
      oauth_session_id: requiredText(
        input.oauth_session_id,
        "A sessão de conexão com a Meta expirou.",
        256,
      ),
      client_id: requiredText(input.client_id, "Cliente inválido.", 64),
      project_id: requiredText(input.project_id, "Projeto inválido.", 64),
    },
    "Não foi possível finalizar a sessão de conexão com a Meta.",
  );

  if (payload.ok !== true) {
    throw new Error("A Meta não confirmou o encerramento da sessão.");
  }
  return { ok: true as const };
}
