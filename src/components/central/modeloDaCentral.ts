/**
 * O modelo que escreve na Central (frente CE, 28/09/2026).
 *
 * Espelho da lista do servidor (supabase/functions/_shared/modelo-da-central.ts;
 * o teste confere que as duas batem). O navegador só escolhe; o servidor
 * confere a escolha contra a lista dele e usa o padrão quando não reconhece.
 * Padrão: GPT-6 Luna com raciocínio máximo.
 */

export const MODELO_PADRAO_DA_CENTRAL = "openrouter:openai/gpt-6-luna";
export const RACIOCINIO_PADRAO_DA_CENTRAL = "max";

export const MODELOS_DA_CENTRAL: ReadonlyArray<{ id: string; rotulo: string; ajuda: string }> = [
  { id: MODELO_PADRAO_DA_CENTRAL, rotulo: "GPT-6 Luna", ajuda: "Padrão. Rápido e barato, pensa bem com raciocínio máximo." },
  { id: "openrouter:openai/gpt-6-sol", rotulo: "GPT-6 Sol", ajuda: "Mais forte e cerca de 20 vezes mais caro." },
  { id: "openrouter:openai/gpt-6.1-sol", rotulo: "GPT-6.1 Sol", ajuda: "Lançado em 29/09: mais forte que o GPT-6 Sol pelo mesmo preço (US$ 2 / 10 por 1M)." },
  { id: "openrouter:anthropic/claude-sonnet-5.5", rotulo: "Claude Sonnet 5.5", ajuda: "Lançado em 28/09: escreve muito bem em português, pela metade do preço do Opus (US$ 2 / 10 por 1M)." },
  { id: "openrouter:anthropic/claude-opus-5.5", rotulo: "Claude Opus 5.5", ajuda: "O mais forte da lista, para o texto que mais importa (US$ 4 / 20 por 1M)." },
  { id: "legado:gpt-4.1", rotulo: "GPT-4.1 (antigo)", ajuda: "O que a Central usava até 28/09." },
];

export const RACIOCINIOS_DA_CENTRAL: ReadonlyArray<{ id: string; rotulo: string }> = [
  { id: "max", rotulo: "Máximo" },
  { id: "xhigh", rotulo: "Muito alto" },
  { id: "high", rotulo: "Alto" },
  { id: "medium", rotulo: "Médio" },
  { id: "low", rotulo: "Baixo (mais rápido)" },
];

export interface EscolhaDoModelo {
  modelo: string;
  raciocinio: string;
}

export const ESCOLHA_PADRAO: EscolhaDoModelo = { modelo: MODELO_PADRAO_DA_CENTRAL, raciocinio: RACIOCINIO_PADRAO_DA_CENTRAL };

export function escolhaValida(v: unknown): v is EscolhaDoModelo {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return MODELOS_DA_CENTRAL.some((m) => m.id === e.modelo) && RACIOCINIOS_DA_CENTRAL.some((r) => r.id === e.raciocinio);
}

/** Nome legível do modelo gravado no rascunho ("openrouter:openai/gpt-6-luna" vira "GPT-6 Luna"). */
export function rotuloDoModelo(id: unknown): string {
  const s = typeof id === "string" ? id : "";
  if (!s) return "";
  const conhecido = MODELOS_DA_CENTRAL.find((m) => m.id === s || m.id.endsWith(`/${s}`) || `legado:${s}` === m.id);
  if (conhecido) return conhecido.rotulo;
  return s.replace(/^(openrouter|openai|legado):/, "").replace(/^openai\//, "");
}

/** Campos que vão no corpo do pedido ao ritual-writer e à esteira. */
export function corpoDoModelo(e: EscolhaDoModelo | null | undefined): { modelo: string; raciocinio: string } {
  const v = escolhaValida(e) ? e : ESCOLHA_PADRAO;
  return { modelo: v.modelo, raciocinio: v.raciocinio };
}

/**
 * A escolha guardada neste navegador (mesma chave do seletor), para quem chama
 * fora de um componente, como o agente da Central. Sem armazenamento: o padrão.
 */
export function escolhaGuardada(): EscolhaDoModelo {
  try {
    if (typeof window === "undefined") return ESCOLHA_PADRAO;
    const bruto = window.localStorage.getItem("tela:v1:central:modelo");
    const v = bruto ? JSON.parse(bruto) : null;
    return escolhaValida(v) ? v : ESCOLHA_PADRAO;
  } catch {
    return ESCOLHA_PADRAO;
  }
}
