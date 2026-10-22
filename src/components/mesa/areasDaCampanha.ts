import type { FaseNaLinha } from "../../../supabase/functions/agente-calendario/modulos/linha-do-tempo";
import { faseDaEtapa } from "../../../supabase/functions/agente-calendario/modulos/linha-do-tempo";

/**
 * Stories e Vídeos da campanha (22/10/2026): o que mora em cada fase da linha do tempo. A sequência e a peça
 * entram na fase pela data (dentro da janela); fora da janela, pela fase escrita; sem nenhuma, na fase mais
 * perto. Puro.
 */

export interface ComDataEFase {
  data?: string | null;
  etapa?: string | null;
}

/** O índice da fase de um item (data primeiro; depois a etapa; senão a fase mais perto pela data). */
export function indiceDaFase(fases: Pick<FaseNaLinha, "fase" | "inicio" | "fim">[], x: ComDataEFase): number {
  if (!fases.length) return -1;
  const d = x.data || "";
  if (d) {
    const k = fases.findIndex((f) => d >= f.inicio && d <= f.fim);
    if (k >= 0) return k;
  }
  const pela = faseDaEtapa(x.etapa);
  if (pela) {
    const k = fases.findIndex((f) => f.fase === pela);
    if (k >= 0) return k;
  }
  if (d) return d < fases[0].inicio ? 0 : fases.length - 1;
  return 0;
}

/** Agrupa pela fase, na ordem das fases (fase sem nada vem com lista vazia). */
export function porFase<T extends ComDataEFase>(fases: FaseNaLinha[], itens: T[]): Array<{ fase: FaseNaLinha; itens: T[] }> {
  const grupos = fases.map((f) => ({ fase: f, itens: [] as T[] }));
  itens.forEach((x) => {
    const k = indiceDaFase(fases, x);
    if (k >= 0) grupos[k].itens.push(x);
  });
  grupos.forEach((g) => g.itens.sort((a, b) => String(a.data || "").localeCompare(String(b.data || ""))));
  return grupos;
}
