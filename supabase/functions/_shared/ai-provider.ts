export type AiProviderEnvName =
  | "AI_BASE_URL"
  | "AI_API_KEY"
  | "AI_MODEL"
  | "OPENAI_API_KEY"
  | "LOVABLE_API_KEY"
  | "OPENROUTER_API_KEY";

export type AiProviderEnvReader = (name: AiProviderEnvName) => string | undefined;

export type AiProviderKind = "configured" | "openai" | "lovable" | "openrouter";

export interface AiProvider {
  kind: AiProviderKind;
  chatCompletionsUrl: string;
  model: string;
  label: string;
  headers: Record<string, string>;
}

export interface AiProviderChainOptions {
  primaryModels: readonly string[];
  lovableModels?: readonly string[];
  /**
   * Rota de reserva (AB2, 26/09): os MESMOS modelos pelo OpenRouter, depois
   * da OpenAI direta, quando há OPENROUTER_API_KEY. O OpenRouter é só a rota
   * do modelo real (gpt-4.1 vira openai/gpt-4.1); o modelo não muda. Serve
   * para o 429 de tokens por minuto da conta direta não derrubar o agente.
   */
  openRouterReserve?: boolean;
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Slug do OpenRouter para um modelo da OpenAI direta (o que já tem dono fica igual). */
export function openRouterSlug(model: string): string {
  const m = model.trim();
  return m.includes("/") ? m : `openai/${m}`;
}

export type AiChatCompletionPayload = Record<string, unknown>;
export type AiChatCompletionPayloadFactory = (
  provider: AiProvider,
) => AiChatCompletionPayload;

export interface AiChatCompletionResult {
  response: Response;
  provider: AiProvider;
  attempts: number;
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const LOVABLE_BASE_URL = "https://ai.gateway.lovable.dev/v1";

// Cadeia padrão do gateway Lovable: modelo atual primeiro, estáveis depois.
// Um nome de modelo aposentado no meio da cadeia não derruba nada, só gasta
// uma tentativa; manter esta lista curta e válida é o que dá resiliência.
export const DEFAULT_LOVABLE_MODEL_CHAIN = [
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-flash",
  "openai/gpt-5-mini",
  "google/gemini-2.5-flash-lite",
] as const;

function readRuntimeEnv(name: AiProviderEnvName): string | undefined {
  return Deno.env.get(name);
}

function optionalValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeBaseUrl(value: string, variableName: string): string {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${variableName} must be an absolute HTTP(S) URL`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${variableName} must be an absolute HTTP(S) URL`);
  }
  const isLoopback = url.hostname === "localhost"
    || url.hostname === "127.0.0.1"
    || url.hostname === "[::1]";
  if (url.protocol === "http:" && !isLoopback) {
    throw new Error(`${variableName} must use HTTPS except for loopback development`);
  }
  if (url.username || url.password) {
    throw new Error(`${variableName} must not contain embedded credentials`);
  }
  if (url.search || url.hash) {
    throw new Error(`${variableName} must not contain a query string or fragment`);
  }

  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

function chatCompletionsUrl(baseUrl: string): string {
  return baseUrl.endsWith("/chat/completions")
    ? baseUrl
    : `${baseUrl}/chat/completions`;
}

function uniqueModels(models: readonly string[]): string[] {
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))];
}

function buildProviders(
  kind: AiProviderKind,
  baseUrl: string,
  apiKey: string,
  models: readonly string[],
): AiProvider[] {
  const endpoint = chatCompletionsUrl(baseUrl);
  return uniqueModels(models).map((model) => ({
    kind,
    chatCompletionsUrl: endpoint,
    model,
    label: `${kind}/${model}`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(kind === "lovable" ? { "Lovable-API-Key": apiKey } : {}),
    },
  }));
}

export function resolveAiProviderChain(
  options: AiProviderChainOptions,
  env: AiProviderEnvReader = readRuntimeEnv,
): AiProvider[] {
  const aiApiKey = optionalValue(env("AI_API_KEY"));
  const openAiApiKey = optionalValue(env("OPENAI_API_KEY"));
  const lovableApiKey = optionalValue(env("LOVABLE_API_KEY"));
  const configuredModel = optionalValue(env("AI_MODEL"));
  const primaryModels = configuredModel
    ? [configuredModel]
    : uniqueModels(options.primaryModels);

  if (primaryModels.length === 0) {
    throw new Error("At least one primary AI model must be configured");
  }

  const providers: AiProvider[] = [];
  let configuredBaseUrl: string | null = null;

  if (aiApiKey) {
    configuredBaseUrl = normalizeBaseUrl(
      optionalValue(env("AI_BASE_URL")) ?? OPENAI_BASE_URL,
      "AI_BASE_URL",
    );
    providers.push(...buildProviders(
      "configured",
      configuredBaseUrl,
      aiApiKey,
      primaryModels,
    ));
  }

  if (
    openAiApiKey
    && (
      !aiApiKey
      || openAiApiKey !== aiApiKey
      || configuredBaseUrl !== OPENAI_BASE_URL
    )
  ) {
    providers.push(...buildProviders(
      "openai",
      OPENAI_BASE_URL,
      openAiApiKey,
      primaryModels,
    ));
  }

  const openRouterApiKey = optionalValue(env("OPENROUTER_API_KEY"));
  if (options.openRouterReserve && openRouterApiKey) {
    // O mesmo modelo pelo OpenRouter vem logo depois da conta direta dele,
    // antes de cair para o modelo seguinte da cadeia.
    const reserve = buildProviders(
      "openrouter",
      OPENROUTER_BASE_URL,
      openRouterApiKey,
      primaryModels.map(openRouterSlug),
    );
    const direct = providers.splice(0, providers.length);
    for (const model of primaryModels) {
      providers.push(...direct.filter((p) => p.model === model));
      providers.push(...reserve.filter((p) => p.model === openRouterSlug(model)));
    }
  }

  if (lovableApiKey && options.lovableModels?.length) {
    providers.push(...buildProviders(
      "lovable",
      LOVABLE_BASE_URL,
      lovableApiKey,
      options.lovableModels,
    ));
  }

  return providers;
}

export async function fetchAiChatCompletion(
  provider: AiProvider,
  payload: AiChatCompletionPayload,
  fetcher: FetchLike = fetch,
): Promise<Response> {
  return await fetcher(provider.chatCompletionsUrl, {
    method: "POST",
    headers: provider.headers,
    body: JSON.stringify({ ...payload, model: provider.model }),
  });
}

/**
 * Frente SPP (30/09): o método da casa (superpoderes-catalogo.ts) na cadeia
 * antiga. Junta o texto no fim da primeira mensagem de sistema (ou abre uma no
 * começo); sem método, o payload sai igual. Mesma regra de juntarMetodoAoSistema.
 */
export function payloadComMetodo(
  payload: AiChatCompletionPayload,
  metodo?: { texto: string } | null,
): AiChatCompletionPayload {
  const texto = metodo && typeof metodo.texto === "string" ? metodo.texto.trim() : "";
  if (!texto) return payload;
  const mensagens = Array.isArray(payload.messages) ? payload.messages as Array<Record<string, unknown>> : [];
  const i = mensagens.findIndex((m) => m && m.role === "system" && typeof m.content === "string");
  const novas = mensagens.slice();
  if (i >= 0) novas[i] = { ...novas[i], content: `${novas[i].content as string}\n\n${texto}` };
  else novas.unshift({ role: "system", content: texto });
  return { ...payload, messages: novas };
}

export async function requestAiChatCompletion(
  providers: readonly AiProvider[],
  payload: AiChatCompletionPayload | AiChatCompletionPayloadFactory,
  fetcher: FetchLike = fetch,
  metodo?: { texto: string } | null,
): Promise<AiChatCompletionResult> {
  if (providers.length === 0) {
    throw new Error(
      "No AI provider configured. Set AI_API_KEY or OPENAI_API_KEY.",
    );
  }

  let lastResponse: Response | null = null;
  let lastProvider: AiProvider | null = null;
  let lastError: unknown = null;

  for (let index = 0; index < providers.length; index += 1) {
    const provider = providers[index];
    const providerPayload = payloadComMetodo(
      typeof payload === "function" ? payload(provider) : payload,
      metodo,
    );

    try {
      const response = await fetchAiChatCompletion(
        provider,
        providerPayload,
        fetcher,
      );
      if (response.ok) {
        if (lastResponse?.body) await lastResponse.body.cancel().catch(() => {});
        return { response, provider, attempts: index + 1 };
      }

      if (lastResponse?.body) await lastResponse.body.cancel().catch(() => {});
      // A causa real de cada tentativa vai para o log da função: é o que
      // transforma "a IA não funciona" em "401 no provider X, 402 no Y".
      const snippet = await response.clone().text()
        .then((text) => text.slice(0, 300))
        .catch(() => "");
      console.warn(`[ai] ${provider.label} -> HTTP ${response.status} ${snippet}`);
      lastResponse = response;
      lastProvider = provider;
    } catch (error) {
      console.warn(
        `[ai] ${provider.label} -> ${error instanceof Error ? error.message : String(error)}`,
      );
      lastError = error;
    }
  }

  if (lastResponse && lastProvider) {
    return {
      response: lastResponse,
      provider: lastProvider,
      attempts: providers.length,
    };
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("All configured AI providers failed");
}
