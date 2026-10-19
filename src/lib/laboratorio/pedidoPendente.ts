/**
 * Pedido de projeto completo vindo da Início (v2, 20/10/2026): a Início cria
 * o projeto vazio e abre o canvas; o Canvas Studio do editor pega o pedido
 * daqui e manda o `planejar` (modo projeto_completo), para o dono ver o
 * quadro sendo construído. Só na memória da aba: nada de texto no endereço.
 */

export interface PedidoPendente {
  pedido: string;
  modelo: string;
  modo?: "projeto_completo";
  /** v3: o dono já respondeu as perguntas guiadas na Início (vai junto, sem perguntar de novo). */
  respostas?: string;
  /** v3: o dono pulou as perguntas na Início. */
  pularPerguntas?: boolean;
}

const pendentes: Record<string, PedidoPendente> = {};

export function guardarPedidoPendente(projetoId: string, p: PedidoPendente) {
  pendentes[projetoId] = p;
}

/** Devolve e apaga (o pedido vai uma vez só). */
export function tirarPedidoPendente(projetoId: string): PedidoPendente | null {
  const p = pendentes[projetoId] || null;
  delete pendentes[projetoId];
  return p;
}
