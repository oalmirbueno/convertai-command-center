import { janelaDoPedidoLivre } from "../acoes-agenda.ts";

export class ErroDoPeriodoDoPedido extends Error {
  readonly codigo = "periodo_do_pedido_invalido";
}

export function dataRealDoPeriodo(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T12:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Campo novo é opcional: pedidos antigos continuam com sua janela de pelo menos 30 dias. */
export function janelaDoPedidoComLimite(inicio: string, mensagem: string, dataFim: unknown, mes?: unknown, fimDeSemana = false): { fim: string; uteis: string[] } {
  if (dataFim === undefined) return janelaDoPedidoLivre(inicio, mensagem, fimDeSemana);
  if (!dataRealDoPeriodo(inicio) || !dataRealDoPeriodo(dataFim) || dataFim < inicio || dataFim.slice(0, 7) !== inicio.slice(0, 7)) {
    throw new ErroDoPeriodoDoPedido("Escolha início e fim válidos dentro do mesmo mês.");
  }
  if (mes !== undefined && (typeof mes !== "string" || !/^\d{4}-\d{2}(?:-01)?$/.test(mes) || mes.slice(0, 7) !== inicio.slice(0, 7))) {
    throw new ErroDoPeriodoDoPedido("O período precisa pertencer ao mês selecionado.");
  }
  const uteis: string[] = [];
  const d = new Date(`${inicio}T12:00:00.000Z`);
  const fimEmMs = new Date(`${dataFim}T12:00:00.000Z`).getTime();
  while (d.getTime() <= fimEmMs) {
    // 24/10: cliente com postar_fim_de_semana também ganha o sábado e o domingo.
    if (fimDeSemana || (d.getUTCDay() >= 1 && d.getUTCDay() <= 5)) uteis.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  if (!uteis.length) throw new ErroDoPeriodoDoPedido("Este período não tem dias úteis. Escolha outro início.");
  return { fim: dataFim, uteis };
}

/** Última conferência antes da proposta: a IA nunca amplia a janela escolhida. */
export function conferirDatasDoPeriodo(itens: Array<{ data: string }>, inicio: string, fim: string) {
  if (itens.some((i) => !dataRealDoPeriodo(i.data) || i.data < inicio || i.data > fim)) {
    throw new ErroDoPeriodoDoPedido("A proposta trouxe uma data fora do período escolhido. Gere a proposta novamente.");
  }
}
