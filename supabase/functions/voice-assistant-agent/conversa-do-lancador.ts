/**
 * Frente AG3 (29/09): o Aceleriq do lançador entende a conversa. Antes cada
 * pedido chegava sozinho, sem data com dia da semana e sem as trocas
 * anteriores: "e a outra?", "faz isso", "muda para sexta" ficavam sem
 * referência e a resposta saía genérica.
 *
 * Sem import de Deno: o vitest lê este arquivo.
 */

const DIAS_DA_SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

/** "Hoje: 2026-09-29 (terça-feira...)": "amanhã", "sexta" e "semana que vem" viram data certa. */
export function linhaDeHoje(hoje: string): string {
  const [a, m, d] = hoje.split("-").map(Number);
  const dia = DIAS_DA_SEMANA[new Date(Date.UTC(a, (m || 1) - 1, d || 1)).getUTCDay()];
  return `Hoje: ${hoje} (${dia}, horário de Brasília).`;
}

export type TrocaDoHistorico = { papel: "equipe" | "aceleriq"; texto: string };
export const MAX_TROCAS_NO_HISTORICO = 8;

/** O histórico que a tela manda, com teto de trocas e de tamanho (nada de id, só texto). */
export function historicoSeguro(bruto: unknown): TrocaDoHistorico[] {
  if (!Array.isArray(bruto)) return [];
  return bruto
    .map((x) => (x && typeof x === "object" ? x as Record<string, unknown> : {}))
    .map((x) => ({ papel: x.papel === "aceleriq" ? "aceleriq" as const : "equipe" as const, texto: String(x.texto ?? "").replace(/\s+/g, " ").trim().slice(0, 600) }))
    .filter((x) => x.texto.length > 0)
    .slice(-MAX_TROCAS_NO_HISTORICO);
}

export function blocoDoHistorico(h: TrocaDoHistorico[]): string {
  if (!h.length) return "";
  return `\n\n## CONVERSA ATÉ AQUI (as últimas trocas; use para entender referências como "essa", "a outra", "faz isso")\n${h.map((x) => `${x.papel === "aceleriq" ? "Aceleriq" : "Equipe"}: ${x.texto}`).join("\n")}`;
}
