/**
 * Excluir projeto (21/10/2026, pedido do dono): o projeto em uso não sai.
 * Função pura sobre as execuções do projeto (lab_execucoes), sem banco, para
 * a ação projeto_excluir e os testes (Deno e Vitest).
 *
 * Em uso = na última execução de cada nó:
 * - algo rodando (na_fila ou rodando): apagar agora deixaria a rodada
 *   escrevendo num projeto que não existe;
 * - Pôr no ar com pedido aberto (status aguardando; estado aguardando_aprovacao
 *   ou com_agente): o pedido está em Precisa de você ou já com o agente, e
 *   aprovado iria ao ar sem o projeto.
 */

export interface ExecucaoParaExcluir {
  no_id: string;
  tipo: string;
  status: string;
  saida?: Record<string, unknown> | null;
  created_at?: string | null;
}

const RODANDO = ["na_fila", "rodando"];
const PEDIDO_ABERTO = ["aguardando_aprovacao", "com_agente"];

/** A última execução de cada nó (a lista pode vir em qualquer ordem). */
function ultimaPorNo(execucoes: ExecucaoParaExcluir[]): ExecucaoParaExcluir[] {
  const por: Record<string, ExecucaoParaExcluir> = {};
  for (const e of execucoes) {
    const velha = por[e.no_id];
    if (!velha || String(e.created_at || "") > String(velha.created_at || "")) por[e.no_id] = e;
  }
  return Object.keys(por).map((k) => por[k]);
}

/** Frase do motivo quando o projeto está em uso (409 projeto_em_uso); null quando pode excluir. */
export function motivoDoProjetoEmUso(execucoes: ExecucaoParaExcluir[]): string | null {
  const ultimas = ultimaPorNo(execucoes);
  const rodando = ultimas.filter((e) => RODANDO.indexOf(e.status) >= 0).length;
  const pedidos = ultimas.filter((e) => {
    if (e.tipo !== "por_no_ar" || e.status !== "aguardando") return false;
    const estado = e.saida && typeof e.saida.estado === "string" ? e.saida.estado : "aguardando_aprovacao";
    return PEDIDO_ABERTO.indexOf(estado) >= 0;
  }).length;
  if (!rodando && !pedidos) return null;
  const partes: string[] = [];
  if (rodando) partes.push(rodando === 1 ? "1 nó está rodando" : `${rodando} nós estão rodando`);
  if (pedidos) partes.push(pedidos === 1 ? "o Pôr no ar tem um pedido aberto (aguardando aprovação ou com o agente)" : `${pedidos} Pôr no ar têm pedido aberto (aguardando aprovação ou com o agente)`);
  return `Este projeto está em uso: ${partes.join(" e ")}. Espere terminar, ou recuse o pedido em Precisa de você, e exclua de novo. Nada foi apagado.`;
}
