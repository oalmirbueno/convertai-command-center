export type AiProviderEnvName =
  | "AI_BASE_URL"
  | "AI_API_KEY"
  | "AI_MODEL"
  | "OPENAI_API_KEY"
  | "LOVABLE_API_KEY";

export type AiProviderEnvReader = (name: AiProviderEnvName) => string | undefined;

export type AiProviderKind = "configured" | "openai" | "lovable";

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

export async function requestAiChatCompletion(
  providers: readonly AiProvider[],
  payload: AiChatCompletionPayload | AiChatCompletionPayloadFactory,
  fetcher: FetchLike = fetch,
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
    const providerPayload = typeof payload === "function"
      ? payload(provider)
      : payload;

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
      lastResponse = response;
      lastProvider = provider;
    } catch (error) {
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
