import type { AdsDailyRow, GoalKind } from "@/lib/adsLanguage";
import { resultadosPorObjetivo } from "@/lib/adsResumo";

/**
 * Tendência simples da tela de anúncios (16/10, dono: "mais intuitivo, mais
 * claro"): uma seta ao lado do número, em código e sem IA. Compara a metade
 * recente do período (15 dias) com a metade anterior, no MESMO objetivo:
 * conversa não compara com venda.
 */

export type Direcao = "subiu" | "caiu" | "igual";

/** Mudança menor que 10% é ruído: a seta fica de lado. */
export const LIMIAR_DA_TENDENCIA = 0.1;

const diaLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Para onde foi o número. Sem base de comparação, null (nada de seta inventada). */
export function direcao(atual: number | null, antes: number | null): Direcao | null {
  if (atual == null || antes == null) return null;
  if (antes <= 0) return atual > 0 ? "subiu" : null;
  const variacao = (atual - antes) / antes;
  if (variacao > LIMIAR_DA_TENDENCIA) return "subiu";
  if (variacao < -LIMIAR_DA_TENDENCIA) return "caiu";
  return "igual";
}

export interface TendenciaDoCliente {
  /** Quantidade de resultados: subir é bom. */
  resultados: Direcao | null;
  /** Custo por resultado: subir é ruim. */
  custo: Direcao | null;
}

/**
 * Os últimos `metade` dias contra os `metade` dias de antes, no objetivo
 * `kind`. Sem dia nenhum antes do corte (conta nova), não há tendência.
 */
export function tendenciaDoCliente(
  rows: AdsDailyRow[],
  kind: GoalKind | null | undefined,
  agora: Date = new Date(),
  metade = 15,
): TendenciaDoCliente {
  const nada = { resultados: null, custo: null };
  if (!kind || !rows || rows.length === 0) return nada;
  const corte = diaLocal(new Date(agora.getTime() - metade * 86400000));
  const recentes = rows.filter((r) => String(r.day).slice(0, 10) >= corte);
  const anteriores = rows.filter((r) => String(r.day).slice(0, 10) < corte);
  if (anteriores.length === 0) return nada;
  const achar = (lista: AdsDailyRow[]) => resultadosPorObjetivo(lista).find((r) => r.kind === kind) || null;
  const agoraR = achar(recentes);
  const antesR = achar(anteriores);
  return {
    resultados: direcao(agoraR ? agoraR.resultados : 0, antesR ? antesR.resultados : 0),
    custo: direcao(agoraR ? agoraR.custoPorResultado : null, antesR ? antesR.custoPorResultado : null),
  };
}
