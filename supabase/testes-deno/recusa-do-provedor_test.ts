import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classificarRecusa,
  contaInteiraFora,
  lerCorpoDaRecusa,
  mensagemSemCredito,
  vaiPeloOpenRouter,
} from "../functions/_shared/recusa-do-provedor.ts";
import { type AiProvider, requestAiChatCompletion, resolveAiProviderChain } from "../functions/_shared/ai-provider.ts";

// Corpos reais (forma) dos provedores. Sem chave nem dado de cliente.
const OPENAI_SEM_CREDITO_NOVO = {
  error: { message: "You have no credits remaining. Please add credits to continue.", type: "insufficient_quota", code: "insufficient_quota" },
};
const OPENAI_SEM_CREDITO_ANTIGO = {
  error: { message: "You exceeded your current quota, please check your plan and billing details.", type: "insufficient_quota", code: "insufficient_quota" },
};
const OPENAI_LIMITE_POR_MINUTO = {
  error: {
    message:
      "Rate limit reached for gpt-4o-mini in organization org-x on tokens per min (TPM): Limit 200000, Used 199000, Requested 2000. Please try again in 300ms. You can increase your rate limit by adding a payment method to your account at https://platform.openai.com/account/billing.",
    type: "tokens",
    code: "rate_limit_exceeded",
  },
};

const classificar = (provedor: string, status: number, corpo: unknown) => classificarRecusa(provedor, status, lerCorpoDaRecusa(corpo));

Deno.test("429 da OpenAI sem crédito (texto novo e antigo) é sem_credito", () => {
  assertEquals(classificar("openai", 429, OPENAI_SEM_CREDITO_NOVO), "sem_credito");
  assertEquals(classificar("openai", 429, OPENAI_SEM_CREDITO_ANTIGO), "sem_credito");
  // Só o texto, sem code (o log de produção trazia só a mensagem).
  assertEquals(classificar("openai", 429, { error: { message: "You have no credits remaining..." } }), "sem_credito");
  // Corpo cru em texto (a cadeia antiga lê o corpo como texto).
  assertEquals(classificar("openai", 429, JSON.stringify(OPENAI_SEM_CREDITO_NOVO)), "sem_credito");
});

Deno.test("429 de limite por minuto é limite_de_uso, mesmo falando em billing e payment method", () => {
  assertEquals(classificar("openai", 429, OPENAI_LIMITE_POR_MINUTO), "limite_de_uso");
  // Sem code: o texto "Rate limit reached" decide antes das palavras de cobrança.
  assertEquals(classificar("openai", 429, { error: { message: OPENAI_LIMITE_POR_MINUTO.error.message } }), "limite_de_uso");
  assertEquals(classificar("openai", 429, "Rate limit reached for gpt-4.1 (tokens per min)"), "limite_de_uso");
  assertEquals(classificar("anthropic", 429, { type: "error", error: { type: "rate_limit_error", message: "This request would exceed the rate limit." } }), "limite_de_uso");
  // 429 sem nada no corpo: limite de uso (regra de antes).
  assertEquals(classificar("openai", 429, ""), "limite_de_uso");
});

Deno.test("401 é chave recusada; Anthropic 400 sem saldo é sem_credito; 402 é cobrança", () => {
  assertEquals(classificar("openai", 401, { error: { message: "Incorrect API key provided", code: "invalid_api_key" } }), "chave_recusada");
  assertEquals(classificar("anthropic", 400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }), "sem_credito");
  assertEquals(classificar("openrouter", 402, { error: { message: "This request requires more credits, or fewer max_tokens.", code: 402 } }), "sem_credito");
  assertEquals(classificar("openai", 400, { error: { message: "Invalid schema for response_format" } }), "outro");
  assertEquals(classificar("openai", 500, { error: { message: "server error" } }), "outro");
});

Deno.test("limite de gasto da chave do OpenRouter não é saldo da conta", () => {
  assertEquals(classificar("openrouter", 403, { error: { message: "Key limit exceeded (total limit)" } }), "limite_da_chave");
  assertEquals(classificar("openrouter", 402, { error: { message: "Key limit exceeded" } }), "limite_da_chave");
});

Deno.test("decisão da reserva: conta direta sem crédito ou chave recusada vai pelo OpenRouter", () => {
  assert(vaiPeloOpenRouter("openai", { codigo: "provedor_sem_credito", detalhes: { status_provedor: 429 } }));
  assert(vaiPeloOpenRouter("anthropic", { codigo: "provedor_sem_credito", detalhes: {} }));
  assert(vaiPeloOpenRouter("openai", { codigo: "provedor_erro", detalhes: { status_provedor: 401, chave_recusada: true } }));
  // Limite por minuto mantém a rota (sem reserva no motor).
  assertEquals(vaiPeloOpenRouter("openai", { codigo: "provedor_erro", detalhes: { status_provedor: 429, limite_de_uso: true } }), false);
  // Outros erros e o próprio OpenRouter não vão pelo OpenRouter.
  assertEquals(vaiPeloOpenRouter("openai", { codigo: "provedor_erro", detalhes: { status_provedor: 500 } }), false);
  assertEquals(vaiPeloOpenRouter("openai", { codigo: "provedor_timeout", detalhes: {} }), false);
  assertEquals(vaiPeloOpenRouter("openrouter", { codigo: "provedor_sem_credito", detalhes: {} }), false);
  assertEquals(vaiPeloOpenRouter("openai", null), false);
});

Deno.test("frase sem crédito pedida pelo dono", () => {
  assertEquals(mensagemSemCredito("openai"), "A conta da OpenAI está sem crédito. Recarregue na OpenAI ou troque o modelo nas Configurações.");
  assert(contaInteiraFora("sem_credito") && contaInteiraFora("chave_recusada"));
  assertEquals(contaInteiraFora("limite_de_uso"), false);
});

// Cadeia antiga (ai-provider.ts): mesma decisão com fetch falso.
const env = (v: Record<string, string>) => (n: string) => v[n];
const cadeia = (): AiProvider[] =>
  resolveAiProviderChain({ primaryModels: ["gpt-4.1", "gpt-4o-mini"], openRouterReserve: true }, env({ OPENAI_API_KEY: "k", OPENROUTER_API_KEY: "r" }));
const json = (corpo: unknown, status: number) => new Response(JSON.stringify(corpo), { status });

Deno.test("cadeia antiga: OpenAI sem crédito pula a conta direta e atende pelo OpenRouter", async () => {
  const urls: string[] = [];
  const fetcher = (url: string | URL | Request, init?: RequestInit) => {
    urls.push(`${String(url)} ${JSON.parse(String(init?.body)).model}`);
    // OpenRouter também falha no primeiro modelo, para provar que a OpenAI do segundo modelo é pulada.
    if (String(url).includes("openai.com")) return Promise.resolve(json(OPENAI_SEM_CREDITO_NOVO, 429));
    return Promise.resolve(urls.length === 2 ? new Response("upstream", { status: 503 }) : json({}, 200));
  };
  const r = await requestAiChatCompletion(cadeia(), { messages: [] }, fetcher);
  assertEquals(r.provider.kind, "openrouter");
  assertEquals(r.provider.model, "openai/gpt-4o-mini");
  assertEquals(urls, [
    "https://api.openai.com/v1/chat/completions gpt-4.1",
    "https://openrouter.ai/api/v1/chat/completions openai/gpt-4.1",
    "https://openrouter.ai/api/v1/chat/completions openai/gpt-4o-mini",
  ]);
});

Deno.test("cadeia antiga: limite por minuto não pula a conta (comportamento de antes)", async () => {
  const urls: string[] = [];
  const fetcher = (url: string | URL | Request, init?: RequestInit) => {
    urls.push(`${String(url)} ${JSON.parse(String(init?.body)).model}`);
    if (String(url).includes("openai.com") && urls.length === 1) return Promise.resolve(json(OPENAI_LIMITE_POR_MINUTO, 429));
    if (String(url).includes("openrouter.ai")) return Promise.resolve(new Response("upstream", { status: 503 }));
    return Promise.resolve(json({}, 200));
  };
  const r = await requestAiChatCompletion(cadeia(), { messages: [] }, fetcher);
  assertEquals(r.provider.kind, "openai");
  assertEquals(r.provider.model, "gpt-4o-mini");
  assertEquals(urls.length, 3);
});
