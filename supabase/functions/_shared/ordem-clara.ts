/**
 * "O pedido é uma ordem clara?" (regra 6 do contrato, _shared/acoes-do-agente.ts):
 * decide se a proposta sem custo e com Desfazer vai direto ou pede Confirmar.
 *
 * Julgamento de linguagem natural: Jev (Noul), uma chamada, com tempo curto.
 * Sem Jev (sem chave, fora do ar), a reserva é a regra do verbo no começo
 * (pareceOrdem). Na dúvida, não: o cartão pede Confirmar.
 *
 * Na mesma chamada (27/09, "faz e me leva"), uma segunda pergunta sobre o
 * mesmo estado: além de fazer, a pessoa pede para ir à tela do resultado?
 * As duas rodam em paralelo no Jev (sem chamada a mais). Sem Jev, a reserva
 * é pedeParaLevar (mapa do painel). Na dúvida, não abre sozinho: o botão
 * "Ir para" continua no cartão.
 *
 * Quem chama só pergunta quando a proposta já passou em todas as outras travas
 * (podeExecutarDireto com pedidoClaro: true), para não gastar à toa.
 */
import { jevPerguntar, probabilidadeNoul } from "./jev.ts";
import { pareceOrdem } from "./acoes-do-agente.ts";
import { pedeParaLevar } from "./mapa-do-painel.ts";
// Frente FS (29/09): sem Jev a regra do verbo decide, mas a falha fica no log.
import { registrarFalha } from "./falha-registrada.ts";

export const LIMIAR_DA_ORDEM = 0.75;
/** Ir sozinho para outra tela é mais incômodo que ficar: limiar mais alto. */
export const LIMIAR_DO_LEVAR = 0.8;

export async function ehOrdemClara(
  pedido: string,
  contexto: { agente: string; resumo?: string | null },
): Promise<{ clara: boolean; probabilidade: number | null; fonte: "jev" | "regra"; levar: boolean }> {
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
          levar: {
            type: "noul",
            instructions: "Além de fazer, o `pedido` pede para a PESSOA ser levada à tela onde o resultado fica (ex.: \"e me leva lá\", \"abre pra mim depois\", \"quero ver\")?",
            criteria: {
              true: "pede para a pessoa ir, abrir ou ver a tela do resultado",
              false: "só pede para fazer; \"leva isso para a Agenda\" no sentido de mover o item não conta",
            },
          },
        },
      },
      { timeoutMs: 6_000 },
    );
    const p = probabilidadeNoul(r.answers.ordem);
    const l = probabilidadeNoul(r.answers.levar);
    if (p !== null) return { clara: p >= LIMIAR_DA_ORDEM, probabilidade: p, fonte: "jev", levar: l !== null ? l >= LIMIAR_DO_LEVAR : pedeParaLevar(texto) };
  } catch (e) {
    // Sem Jev: a regra do verbo decide.
    registrarFalha("ordem-clara: jev falhou (vale a regra do verbo)", e, { agente: contexto.agente });
  }
  return { clara: pareceOrdem(texto), probabilidade: null, fonte: "regra", levar: pedeParaLevar(texto) };
}
