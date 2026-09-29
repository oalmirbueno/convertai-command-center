/**
 * Trava da promessa vazia do diretor de fotografia (frente AG2, 29/09/2026).
 *
 * Dado real (agente_mensagens, conversa mesa_foto): em 26/09 20:28 e 20:29
 * ("ela já está ali, pode pegar do clone almir", "Já pode criar") e em 27/09
 * 15:24 ("prepare tudo pra mim") o diretor respondeu "Plano: 3 imagens...
 * Próximo passo: aplique a campanha abaixo" com anexos vazios: nenhum cartão,
 * nenhuma geração. A causa foi corrigida no prompt e nas sugestões (index.ts e
 * diretor-agentico.ts); esta trava é a rede: resposta que diz que fez, vai
 * fazer ou deixou pronto SEM trazer ação vira aviso honesto com uma pergunta.
 *
 * Julgamento de linguagem natural: Jev (Noul), uma chamada curta, só quando a
 * regra barata (pareceQuePromete) já desconfiou e nada veio anexado. Sem Jev,
 * a regra decide (na dúvida, avisar é melhor que prometer).
 */
import { jevPerguntar, probabilidadeNoul } from "../_shared/jev.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { pareceQuePromete } from "./diretor-agentico.ts";

export const LIMIAR_DA_PROMESSA = 0.5;

export type Promessa = { prometeu: boolean; probabilidade: number | null; fonte: "jev" | "regra" | "nenhuma" };

/**
 * A resposta promete uma ação que não veio? Só pergunte quando a resposta
 * não trouxe cartão, geração, ação feita nem sugestão.
 */
export async function prometeuSemFazer(
  resposta: string,
  pedido: string,
  opcoes: { chave?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<Promessa> {
  if (!pareceQuePromete(resposta)) return { prometeu: false, probabilidade: null, fonte: "nenhuma" };
  try {
    const r = await jevPerguntar(
      {
        state: {
          pedido_da_equipe: String(pedido || "").slice(0, 1500),
          resposta_do_agente: String(resposta || "").slice(0, 2500),
          anexos_da_resposta: "nenhum (sem cartão de ação, sem geração, sem sugestão para aplicar)",
        },
        questions: {
          promessa: {
            type: "noul",
            instructions:
              "O agente é o diretor de fotografia de uma agência. A `resposta_do_agente` diz que ele fez, está fazendo, vai fazer agora ou deixou pronto algo para a equipe aplicar ou confirmar (gerar fotos, montar campanha, organizar, um cartão \"abaixo\")? Lembre: `anexos_da_resposta` mostra que nada foi anexado.",
            criteria: {
              true: "promete ou dá como pronta uma ação (\"vou gerar\", \"preparei a campanha\", \"aplique abaixo\", \"já organizei\")",
              false: "só explica, opina, pergunta ou pede algo à equipe, sem dizer que fez ou que deixou pronto",
            },
          },
        },
      },
      { chave: opcoes.chave, fetchImpl: opcoes.fetchImpl, timeoutMs: opcoes.timeoutMs ?? 5_000 },
    );
    const p = probabilidadeNoul(r.answers.promessa);
    if (p !== null) return { prometeu: p >= LIMIAR_DA_PROMESSA, probabilidade: p, fonte: "jev" };
  } catch (e) {
    registrarFalha("mesa-foto: promessa do diretor sem Jev (vale a regra)", e);
  }
  return { prometeu: true, probabilidade: null, fonte: "regra" };
}
