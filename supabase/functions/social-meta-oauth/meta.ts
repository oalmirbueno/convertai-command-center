export const META_REQUIRED_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
] as const;

/**
 * Permissao PEDIDA, mas nao exigida.
 *
 * `ads_read` faz o mesmo login que conecta o Instagram trazer tambem as
 * contas de anuncio. O dono pediu exatamente isso: "deixar igual o do
 * social, que e facil e ja puxa" — em vez de criar usuario do sistema no
 * Business Manager e colar token a mao, conta por conta.
 *
 * Fica em OPCIONAL, e nao em obrigatoria, por um motivo pratico: a
 * configuracao do Facebook Login for Business e quem decide de verdade o
 * que o usuario ve na tela de consentimento. Se `ads_read` nao estiver
 * ligado la, exigi-la aqui faria TODA conexao de Instagram passar a
 * falhar, inclusive as que funcionam hoje. Assim, quem ja usa continua
 * usando; quem autorizar tambem os anuncios ganha o token de graca, no
 * mesmo clique.
 */
export const META_OPTIONAL_SCOPES = ["ads_read"] as const;

export type MetaPlatform = "facebook" | "instagram";

export type SanitizedMetaResource = {
  candidate_id: string;
  platform: MetaPlatform;
  display_name: string;
  handle?: string;
};

export type StoredMetaResource = SanitizedMetaResource & {
  external_account_id: string;
  page_id: string;
  instagram_user_id: string | null;
  picture_url: string | null;
  page_access_token: string;
  tasks: string[];
};

type MetaPage = {
  id?: unknown;
  name?: unknown;
  access_token?: unknown;
  tasks?: unknown;
  picture?: {
    data?: {
      url?: unknown;
    };
  } | null;
  instagram_business_account?: {
    id?: unknown;
    username?: unknown;
    name?: unknown;
    profile_picture_url?: unknown;
  } | null;
};

const GRAPH_VERSION_PATTERN = /^v\d+\.\d+$/;
const SENSITIVE_KEY_PATTERN =
  /(?:access[_-]?token|client[_-]?secret|app[_-]?secret|authorization|appsecret[_-]?proof|\bcode\b|\bstate\b)/i;

export function normalizeGraphVersion(value: string | undefined): string {
  const version = (value || "v26.0").trim();
  if (!GRAPH_VERSION_PATTERN.test(version)) {
    throw new Error("META_GRAPH_VERSION inválida");
  }
  return version;
}

export function validateMetaRedirectUri(value: string): URL {
  let redirect: URL;
  try {
    redirect = new URL(value);
  } catch {
    throw new Error("META_REDIRECT_URI inválida");
  }

  const localHttp =
    redirect.protocol === "http:" &&
    (redirect.hostname === "localhost" || redirect.hostname === "127.0.0.1");
  if (redirect.protocol !== "https:" && !localHttp) {
    throw new Error("META_REDIRECT_URI precisa usar HTTPS fora do ambiente local");
  }
  if (
    redirect.username ||
    redirect.password ||
    redirect.hash ||
    redirect.search ||
    redirect.pathname !== "/oauth/meta/callback"
  ) {
    throw new Error("META_REDIRECT_URI inválida");
  }
  return redirect;
}

export function buildAllowedOrigins(
  redirectUri: string,
  appPublicUrl?: string,
): Set<string> {
  const redirect = validateMetaRedirectUri(redirectUri);
  const origins = new Set([redirect.origin]);
  if (appPublicUrl) {
    const appUrl = new URL(appPublicUrl);
    origins.add(appUrl.origin);
  }
  return origins;
}

export function buildFacebookLoginUrl(input: {
  appId: string;
  configId: string;
  graphVersion: string;
  redirectUri: string;
  state: string;
}): string {
  const graphVersion = normalizeGraphVersion(input.graphVersion);
  validateMetaRedirectUri(input.redirectUri);
  if (!input.appId.trim() || !input.configId.trim() || !input.state.trim()) {
    throw new Error("Configuração OAuth da Meta incompleta");
  }

  const url = new URL(
    `https://www.facebook.com/${graphVersion}/dialog/oauth`,
  );
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("config_id", input.configId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", input.state);
  url.searchParams.set(
    "scope",
    [...META_REQUIRED_SCOPES, ...META_OPTIONAL_SCOPES].join(","),
  );
  return url.toString();
}

export async function createAppSecretProof(
  accessToken: string,
  appSecret: string,
): Promise<string> {
  if (!accessToken || !appSecret) {
    throw new Error("Token ou segredo ausente para appsecret_proof");
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(accessToken),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function missingMetaScopes(
  permissionRows: unknown,
): { granted: string[]; declined: string[]; missing: string[] } {
  const rows = Array.isArray(permissionRows) ? permissionRows : [];
  const granted = new Set<string>();
  const declined = new Set<string>();

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const permission = (row as Record<string, unknown>).permission;
    const status = (row as Record<string, unknown>).status;
    if (typeof permission !== "string") continue;
    if (status === "granted") granted.add(permission);
    else declined.add(permission);
  }

  return {
    granted: [...granted].sort(),
    declined: [...declined].sort(),
    missing: META_REQUIRED_SCOPES.filter((scope) => !granted.has(scope)),
  };
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0) || 0;
      return codePoint >= 32 && codePoint !== 127;
    })
    .join("")
    .trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function cleanTasks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 100))
    .filter(Boolean)
    .slice(0, 50);
}

export function parseManagedPages(
  pages: unknown[],
  createId: () => string = () => crypto.randomUUID(),
): StoredMetaResource[] {
  const resources: StoredMetaResource[] = [];
  const seen = new Set<string>();

  for (const rawPage of pages.slice(0, 500)) {
    if (!rawPage || typeof rawPage !== "object") continue;
    const page = rawPage as MetaPage;
    const pageId = cleanText(page.id, 64);
    const pageName = cleanText(page.name, 200);
    const pageToken = cleanText(page.access_token, 4096);
    if (!pageId || !pageName || !pageToken) continue;

    const pageKey = `facebook:${pageId}`;
    if (!seen.has(pageKey)) {
      seen.add(pageKey);
      resources.push({
        candidate_id: createId(),
        platform: "facebook",
        external_account_id: pageId,
        display_name: pageName,
        page_id: pageId,
        instagram_user_id: null,
        picture_url: cleanText(page.picture?.data?.url, 2048),
        page_access_token: pageToken,
        tasks: cleanTasks(page.tasks),
      });
    }

    const instagram = page.instagram_business_account;
    if (!instagram || typeof instagram !== "object") continue;
    const instagramId = cleanText(instagram.id, 64);
    if (!instagramId) continue;
    const instagramKey = `instagram:${instagramId}`;
    if (seen.has(instagramKey)) continue;
    seen.add(instagramKey);

    const username = cleanText(instagram.username, 100);
    const instagramName = cleanText(instagram.name, 200);
    resources.push({
      candidate_id: createId(),
      platform: "instagram",
      external_account_id: instagramId,
      display_name: instagramName || username || pageName,
      ...(username ? { handle: username } : {}),
      page_id: pageId,
      instagram_user_id: instagramId,
      picture_url: cleanText(instagram.profile_picture_url, 2048),
      page_access_token: pageToken,
      tasks: cleanTasks(page.tasks),
    });
  }

  return resources;
}

export function sanitizeMetaResources(
  resources: StoredMetaResource[],
): SanitizedMetaResource[] {
  return resources.map(({ candidate_id, platform, display_name, handle }) => ({
    candidate_id,
    platform,
    display_name,
    ...(handle ? { handle } : {}),
  }));
}

export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redactSensitive(item),
      ]),
    );
  }
  if (typeof value !== "string") return value;

  let redacted = value.replace(
    /Bearer\s+[A-Za-z0-9._~+\-/=|]+/gi,
    "Bearer [REDACTED]",
  );
  try {
    const url = new URL(redacted);
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }
    redacted = url.toString();
  } catch {
    redacted = redacted.replace(
      /((?:access[_-]?token|client[_-]?secret|appsecret[_-]?proof|code|state)=)[^&\s]+/gi,
      "$1[REDACTED]",
    );
  }
  return redacted;
}
