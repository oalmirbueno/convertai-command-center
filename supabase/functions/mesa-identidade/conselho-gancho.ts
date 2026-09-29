/**
 * Gancho do conselho de agentes (frente CNS). Pedido: "para escolher caminhos
 * criativos e naming, usa o conselho de agentes (_shared/conselho.ts) se
 * existir no main; senão, deixe o gancho".
 *
 * Em 30/09/2026 o `_shared/conselho.ts` ainda não está no main. Enquanto não
 * estiver, a recomendação sai do Jev (Choice), como AVISO: a equipe escolhe.
 * Quando o conselho entrar, troque `recomendarPeloConselho` pela chamada dele
 * (mesma entrada: as opções com apelido e o briefing) e ligue
 * CONSELHO_NO_MAIN. A tela já mostra de onde veio a recomendação (`fonte`).
 */

import { cobrarJev } from "../_shared/ia-motor.ts";
import { jevPerguntar, type RespostaJev } from "../_shared/jev.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";

export const CONSELHO_NO_MAIN = false;

export type OpcaoParaRecomendar = { id: string; titulo: string; descricao: string };
export type Recomendacao = { id: string; confianca: number | null; fonte: "conselho" | "jev"; motivo: string | null };

/** Gancho: o conselho ainda não existe no main (devolve null e a Mesa usa o Jev). */
export async function recomendarPeloConselho(_opcoes: OpcaoParaRecomendar[], _briefing: Record<string, unknown>): Promise<Recomendacao | null> {
  return null;
}

/** Lê a escolha do Choice (exportada para o teste). */
export function lerRecomendacao(r: RespostaJev | undefined, opcoes: OpcaoParaRecomendar[]): Recomendacao | null {
  if (!r || typeof r.choice !== "string") return null;
  const escolhida = opcoes.filter((o) => o.id === r.choice)[0];
  if (!escolhida) return null;
  const p = r.probabilities && typeof r.probabilities[escolhida.id] === "number" ? r.probabilities[escolhida.id] : typeof r.confidence === "number" ? r.confidence : null;
  return { id: escolhida.id, confianca: p, fonte: "jev", motivo: null };
}

/**
 * Recomenda uma opção (caminho criativo ou nome): o conselho quando existir,
 * senão o Jev. Nunca lança: sem recomendação, a tela só não mostra o selo.
 */
export async function recomendar(
  opcoes: OpcaoParaRecomendar[],
  briefing: Record<string, unknown>,
  cobrar: { clientId: string; referencia: { tipo: string; id: string }; userId: string },
  perguntar: typeof jevPerguntar = jevPerguntar,
): Promise<Recomendacao | null> {
  if (opcoes.length < 2) return null;
  try {
    if (CONSELHO_NO_MAIN) {
      const c = await recomendarPeloConselho(opcoes, briefing);
      if (c) return c;
    }
    const criteria: Record<string, string> = {};
    for (const o of opcoes) criteria[o.id] = `${o.titulo}: ${o.descricao}`.slice(0, 600);
    const res = await perguntar({
      state: { briefing },
      questions: {
        melhor: {
          type: "choice",
          instructions: "Qual destas opções atende melhor ao `briefing` da marca (público, personalidade, o que evitar e diferença dos concorrentes)? Avaliação de direção criativa, não de gosto pessoal.",
          criteria,
        },
      },
    });
    await cobrarJev(res, { clientId: cobrar.clientId, tarefa: "identidade", referencia: cobrar.referencia, criadoPor: cobrar.userId });
    return lerRecomendacao(res.answers.melhor, opcoes);
  } catch (e) {
    registrarFalha("mesa-identidade: recomendação não saiu", e);
    return null;
  }
}
