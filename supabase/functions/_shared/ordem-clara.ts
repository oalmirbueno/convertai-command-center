/**
 * "O pedido é uma ordem clara?" (regra 6 do contrato, _shared/acoes-do-agente.ts):
 * decide se a proposta sem custo e com Desfazer vai direto ou pede Confirmar.
 *
 * Julgamento de linguagem natural: Jev (Noul), uma pergunta, com tempo curto.
 * Sem Jev (sem chave, fora do ar), a reserva é a regra do verbo no começo
 * (pareceOrdem). Na dúvida, não: o cartão pede Confirmar.
 *
 * Quem chama só pergunta quando a proposta já passou em todas as outras travas
 * (podeExecutarDireto com pedidoClaro: true), para não gastar à toa.
 */
import { jevPerguntar, probabilidadeNoul } from "./jev.ts";
import { pareceOrdem } from "./acoes-do-agente.ts";

export const LIMIAR_DA_ORDEM = 0.75;

export async function ehOrdemClara(pedido: string, contexto: { agente: string; resumo?: string | null }): Promise<{ clara: boolean; probabilidade: number | null; fonte: "jev" | "regra" }> {
  const texto = String(pedido || "").slice(0, 1500);
  try {
    const r = await jevPerguntar(
      {
        state: { pedido: texto, agente: contexto.agente, o_que_o_agente_vai_fazer: String(contexto.resumo || "").slice(0, 400) },
        questions: {
          ordem: {
            type: "noul",
            instructions: "O `pedido` da equipe é uma ordem clara para fazer agora exatamente o que `o_que_o_agente_vai_fazer` descreve, sem precisar perguntar nada?",
            criteria: { true: "ordem clara e específica que bate com o que o agente vai fazer", false: "pergunta, dúvida, sugestão, pedido vago ou algo diferente do que o agente vai fazer" },
          },
        },
      },
      { timeoutMs: 6_000 },
    );
    const p = probabilidadeNoul(r.answers.ordem);
    if (p !== null) return { clara: p >= LIMIAR_DA_ORDEM, probabilidade: p, fonte: "jev" };
  } catch {
    // Sem Jev: a regra do verbo decide.
  }
  return { clara: pareceOrdem(texto), probabilidade: null, fonte: "regra" };
}
