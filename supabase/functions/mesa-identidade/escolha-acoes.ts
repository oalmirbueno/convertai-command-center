/**
 * mesa-identidade: a escolha com motivo do Jev (19/10/2026). Depois da nota
 * de cada proposta (nomes, slogans, paletas e pares de fonte), o Jev aponta
 * as 1 ou 2 melhores e o porquê (Choice entre motivos fixos da peça), numa
 * linha curta na tela. Fração de centavo; falha vira silêncio (a proposta
 * fica só com a nota) e fica registrada. Nunca lança.
 */

import { cobrarJev, type ReferenciaUso, type Tarefa } from "../_shared/ia-motor.ts";
import { jevPerguntar, type PerguntaJev } from "../_shared/jev.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { apontarComJev, marcarDestaques, type PecaDaEscolha } from "./modulos/escolha-do-jev.ts";

export async function apontarMelhoresComJev<T extends object>(
  itens: T[],
  e: {
    clientId: string;
    tarefa: Tarefa;
    referencia: ReferenciaUso;
    userId: string;
    peca: PecaDaEscolha;
    marca: Record<string, unknown>;
    id: (x: T) => string;
    nota: (x: T) => number | null | undefined;
    descrever: (x: T) => string;
  },
): Promise<Array<T & { destaque_jev?: string }>> {
  const r = await apontarComJev(itens, { id: e.id, nota: e.nota, descrever: e.descrever, peca: e.peca, marca: e.marca }, async (pedido) => {
    const res = await jevPerguntar({ state: pedido.state, questions: pedido.questions as unknown as Record<string, PerguntaJev> });
    await cobrarJev(res, { clientId: e.clientId, tarefa: e.tarefa, referencia: e.referencia, criadoPor: e.userId });
    return { answers: res.answers as Record<string, { choice?: string }> };
  });
  if (r.falhou) registrarFalha(`mesa-identidade: escolha do Jev (${e.peca})`, new Error("o Jev não apontou as melhores"));
  return marcarDestaques(itens, e.id, r.destaques);
}
