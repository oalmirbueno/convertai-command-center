/**
 * Por que o provedor de IA recusou a chamada (18/10/2026).
 *
 * Em produção a conta direta da OpenAI ficou sem crédito e devolvia 429
 * ("You have no credits remaining", code insufficient_quota). O mesmo 429
 * também é o limite por minuto (rate_limit_exceeded), e a mensagem desse
 * limite fala em "billing" e "payment method" (convite para subir o limite).
 * Por isso o code e o type do corpo vêm antes do texto, e "rate limit" vem
 * antes das palavras de cobrança.
 *
 * - sem_credito: a conta acabou (vai pela reserva já; não adianta repetir);
 * - chave_recusada: 401, chave inválida ou revogada (vai pela reserva já);
 * - limite_de_uso: limite por minuto (mantém o comportamento de antes:
 *   sem reserva no motor, a cadeia antiga só passa para a próxima tentativa);
 * - limite_da_chave: a chave do OpenRouter bateu o limite de gasto dela;
 * - outro: qualquer outra recusa.
 *
 * Sem import e sem Deno: roda nas funções, no Deno test e no vitest.
 */

export type MotivoDaRecusa = "sem_credito" | "chave_recusada" | "limite_de_uso" | "limite_da_chave" | "outro";

export type CorpoDaRecusa = { mensagem: string; codigo?: string | null; tipo?: string | null };

// Códigos que os provedores mandam no corpo (OpenAI: error.code e error.type; Anthropic: error.type).
const CODIGO_SEM_CREDITO = /insufficient_quota|billing_hard_limit|billing_not_active|insufficient_credit|insufficient_funds/i;
const CODIGO_LIMITE_DE_USO = /rate_limit/i;
// Texto do limite por minuto (vem antes das palavras de cobrança).
const TEXTO_LIMITE_DE_USO = /rate limit|too many requests|tokens per min|requests per min|\b(tpm|rpm)\b/i;
// Texto de falta de crédito que vale em qualquer status (a Anthropic manda 400 "credit balance is too low").
const TEXTO_SEM_CREDITO_FORTE = /no credits remaining|credit balance is too low|exceeded your current quota|insufficient[ _](quota|credits?|funds|balance)|requires more credits|out of credits/i;
// Texto de cobrança aceito só no 429 e no 402 (regra de antes do motor).
const TEXTO_DE_COBRANCA = /credit|quota|billing|insufficient|saldo|payment/i;

/** Lê mensagem, code e type de um corpo de erro (OpenAI, Anthropic, OpenRouter ou texto cru). */
export function lerCorpoDaRecusa(corpo: unknown): CorpoDaRecusa {
  if (typeof corpo === "string") {
    const t = corpo.trim();
    if (t.startsWith("{")) {
      try {
        return lerCorpoDaRecusa(JSON.parse(t));
      } catch { /* texto que só parece JSON */ }
    }
    return { mensagem: t };
  }
  if (!corpo || typeof corpo !== "object") return { mensagem: "" };
  const c = corpo as { error?: unknown; message?: unknown; code?: unknown; type?: unknown };
  const texto = (v: unknown) => (typeof v === "string" ? v : v == null ? null : String(v));
  if (typeof c.error === "string") return { mensagem: c.error, codigo: texto(c.code), tipo: texto(c.type) };
  if (c.error && typeof c.error === "object") {
    const e = c.error as { message?: unknown; code?: unknown; type?: unknown };
    return { mensagem: texto(e.message) ?? "", codigo: texto(e.code), tipo: texto(e.type) };
  }
  return { mensagem: texto(c.message) ?? "", codigo: texto(c.code), tipo: texto(c.type) };
}

/** Classifica a recusa pelo status e pelo corpo. Função pura. */
export function classificarRecusa(provedor: string, status: number, corpo: CorpoDaRecusa): MotivoDaRecusa {
  const msg = String(corpo.mensagem || "");
  const marcas = `${corpo.codigo ?? ""} ${corpo.tipo ?? ""}`;
  // 26/09: o limite de gasto da CHAVE do OpenRouter não é o saldo da conta.
  if (provedor === "openrouter" && (status === 403 || status === 402) && /key limit/i.test(msg)) return "limite_da_chave";
  if (status === 401) return "chave_recusada";
  if (CODIGO_SEM_CREDITO.test(marcas)) return "sem_credito";
  if (CODIGO_LIMITE_DE_USO.test(marcas)) return "limite_de_uso";
  if (status === 429 && TEXTO_LIMITE_DE_USO.test(msg)) return "limite_de_uso";
  if (TEXTO_SEM_CREDITO_FORTE.test(msg) && (status === 400 || status === 402 || status === 403 || status === 429)) return "sem_credito";
  if ((status === 429 || status === 402) && TEXTO_DE_COBRANCA.test(msg)) return "sem_credito";
  // 402 é "Payment Required": sempre cobrança.
  if (status === 402) return "sem_credito";
  if (status === 429) return "limite_de_uso";
  return "outro";
}

const NOME_DO_PROVEDOR: Record<string, string> = { openai: "OpenAI", anthropic: "Anthropic", openrouter: "OpenRouter" };

export function nomeDoProvedor(provedor: string): string {
  return NOME_DO_PROVEDOR[provedor] ?? provedor;
}

/** Frase da tela quando a conta direta está sem crédito e não houve reserva. */
export function mensagemSemCredito(provedor: string): string {
  const nome = nomeDoProvedor(provedor);
  return `A conta da ${nome} está sem crédito. Recarregue na ${nome} ou troque o modelo nas Configurações.`;
}

/** Frase da tela quando a chave da conta direta foi recusada (401) e não houve reserva. */
export function mensagemChaveRecusada(provedor: string): string {
  const nome = nomeDoProvedor(provedor);
  return `A chave da ${nome} foi recusada (401). Confira a chave nas Configurações ou troque o modelo.`;
}

/**
 * Decisão da reserva do motor: a chamada que foi direto ao provedor (OpenAI,
 * Anthropic) e voltou sem crédito ou com a chave recusada vai, na mesma
 * chamada, pelo OpenRouter. Limite por minuto, erro do pedido e qualquer
 * outra recusa não mudam de rota. Função pura (recebe código e detalhes do
 * IaMotorErro).
 */
export function vaiPeloOpenRouter(
  provedorDaRota: string,
  erro: { codigo?: string; detalhes?: Record<string, unknown> } | null | undefined,
): boolean {
  if (provedorDaRota === "openrouter" || !erro) return false;
  if (erro.codigo === "provedor_sem_credito") return true;
  return erro.codigo === "provedor_erro" && erro.detalhes?.chave_recusada === true;
}

/**
 * Cadeia antiga (ai-provider.ts): depois desta recusa, as outras tentativas na
 * MESMA conta (mesma URL e mesma chave) também vão falhar e são puladas. Limite
 * por minuto não pula: o modelo seguinte pode ter outro limite.
 */
export function contaInteiraFora(motivo: MotivoDaRecusa): boolean {
  return motivo === "sem_credito" || motivo === "chave_recusada";
}
