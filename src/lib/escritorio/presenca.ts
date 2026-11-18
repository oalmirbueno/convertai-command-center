import type { Presenca } from "./tipos";

/**
 * Presença dos agentes no Escritório: o agente bate o ponto pelo MCP
 * (escritorio_presenca.batimento_em) e diz o que está fazendo.
 */

/** Batimento com menos de 10 minutos = o agente está aqui agora. */
export const JANELA_DA_PRESENCA_MS = 10 * 60_000;

export function presenteAgora(batimentoEm: string | null | undefined, agoraMs: number): boolean {
  if (!batimentoEm) return false;
  const t = new Date(batimentoEm).getTime();
  if (!Number.isFinite(t)) return false;
  return agoraMs - t < JANELA_DA_PRESENCA_MS;
}

/** A presença de cada agente, pelo slug. */
export function presencaPorSlug(presencas: readonly Presenca[]): Map<string, Presenca> {
  const mapa = new Map<string, Presenca>();
  for (const p of presencas) mapa.set(p.operator_slug, p);
  return mapa;
}

/** O que o agente faz agora: só vale enquanto o batimento está fresco. */
export function fazendoAgora(p: Presenca | null | undefined, agoraMs: number): string | null {
  if (!p || !presenteAgora(p.batimento_em, agoraMs)) return null;
  return p.fazendo?.trim() || null;
}

/** A última atividade: o mais recente entre a última execução e o último batimento. */
export function ultimaAtividade(lastRunAt: string | null | undefined, batimentoEm: string | null | undefined): string | null {
  let melhor: string | null = null;
  let quando = -Infinity;
  for (const iso of [lastRunAt, batimentoEm]) {
    if (!iso) continue;
    const t = new Date(iso).getTime();
    if (Number.isFinite(t) && t > quando) { quando = t; melhor = iso; }
  }
  return melhor;
}
