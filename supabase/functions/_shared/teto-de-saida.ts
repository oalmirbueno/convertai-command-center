/**
 * Teto de saída que vai ao provedor (QA 30/09/2026). Arquivo puro, sem
 * import: roda no Deno (ia-motor.ts) e no vitest.
 *
 * Folga para o raciocínio dos modelos da Anthropic: no Opus 5.5 o
 * pensamento não desliga (adaptativo, esforço médio por padrão) e os tokens
 * dele contam no max_tokens. Com o teto justo da chamada (ex.: 800 nas
 * headlines da proposta), o JSON sairia cortado e a tela diria "fora do
 * formato". A folga só vale como teto: paga-se o que o modelo usar.
 */
export const FOLGA_DO_RACIOCINIO_ANTHROPIC = 8_000;

type ModeloDoTeto = { provedor: string; modelo_api: string };

export function ehModeloDaAnthropic(m: ModeloDoTeto): boolean {
  return m.provedor === "anthropic" || /^~?anthropic\//i.test(String(m.modelo_api || ""));
}

/**
 * O teto pedido, mais a folga do raciocínio (no máximo 64 mil) quando há
 * raciocínio: sempre nos modelos da Anthropic e, nos outros, quando a chamada
 * pede esforço (na OpenAI o raciocínio entra no max_output_tokens; no
 * OpenRouter com esforço, a Anthropic reserva parte do max_tokens para pensar).
 */
export function tetoDeSaidaNoProvedor(m: ModeloDoTeto, teto: number | undefined, raciocinio?: string | null): number | undefined {
  if (teto === undefined || teto === null || !(teto > 0)) return teto;
  return ehModeloDaAnthropic(m) || !!raciocinio ? Math.min(64_000, teto + FOLGA_DO_RACIOCINIO_ANTHROPIC) : teto;
}
