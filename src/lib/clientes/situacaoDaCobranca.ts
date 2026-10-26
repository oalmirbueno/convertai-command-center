/**
 * Situação da cobrança de cada cliente na lista de Clientes (26/10/2026, dono: "tem cliente que já pagou e
 * ainda fica o alerta de atrasado; se já pagou, mesmo atrasado, o alerta tem que sair; só para os atrasados e
 * não pagos"). Uma regra só para a linha, o filtro e o alerta da renovação.
 *
 * - Atrasado: há cobrança pendente ou parcial, vencida antes de hoje, com saldo a pagar (valor menos o pago).
 * - A receber: cobrança com saldo a pagar que vence neste mês (ainda não venceu).
 * - Em dia: pagou neste mês, ou já pagou e não deve nada vencido.
 * - Sem cobrança: nenhuma das anteriores.
 * Recarga de anúncio não conta (é dinheiro do cliente para a Meta, não mensalidade).
 * Puro (Safari 11: sem lookbehind, sem grupo nomeado).
 */

export type TomDaCobranca = "late" | "due" | "paid";
export type FiltroDaCobranca = "todas" | "atrasados" | "a_receber" | "em_dia" | "sem_cobranca";

export interface CobrancaLida {
  client_id?: string | null;
  type?: string | null;
  status?: string | null;
  amount?: number | string | null;
  paid_amount?: number | string | null;
  due_date?: string | null;
  paid_date?: string | null;
}

export interface SituacaoDaCobranca {
  tom: TomDaCobranca;
  rotulo: string;
  detalhe: string;
  /** Data (AAAA-MM-DD) do último pagamento, quando há. */
  ultimoPagamento: string | null;
}

export const FILTROS_DA_COBRANCA: Array<{ valor: FiltroDaCobranca; rotulo: string }> = [
  { valor: "todas", rotulo: "Todos" },
  { valor: "atrasados", rotulo: "Atrasados" },
  { valor: "a_receber", rotulo: "A receber" },
  { valor: "em_dia", rotulo: "Em dia" },
  { valor: "sem_cobranca", rotulo: "Sem cobrança" },
];

const dia = (v?: string | null) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "");
const num = (v: unknown) => Number(v) || 0;
const br = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

/** O que ainda falta pagar desta cobrança (zero quando pagou, mesmo que o status tenha ficado para trás). */
export function saldoDaCobranca(c: CobrancaLida): number {
  const status = String(c.status || "").toLowerCase();
  if (status === "paid" || status === "cancelled" || status === "canceled" || status === "waived") return 0;
  if (status !== "pending" && status !== "partial") return 0;
  const total = num(c.amount);
  const pago = num(c.paid_amount);
  return Math.max(0, Math.round((total - pago) * 100) / 100);
}

/** A situação de um cliente a partir das cobranças dele. `hoje` em AAAA-MM-DD. */
export function situacaoDoCliente(cobrancas: CobrancaLida[], hoje: string): SituacaoDaCobranca | null {
  const mes = hoje.slice(0, 7);
  let atrasada: CobrancaLida | null = null;
  let aReceber: CobrancaLida | null = null;
  let ultimoPagamento = "";
  for (const c of cobrancas) {
    if (c.type === "ads_recharge") continue;
    const venc = dia(c.due_date);
    const saldo = saldoDaCobranca(c);
    if (saldo > 0 && venc && venc < hoje) {
      if (!atrasada || venc < dia(atrasada.due_date)) atrasada = c;
      continue;
    }
    if (saldo > 0 && venc && venc.slice(0, 7) === mes) {
      if (!aReceber || venc < dia(aReceber.due_date)) aReceber = c;
      continue;
    }
    const status = String(c.status || "").toLowerCase();
    const pagoEm = dia(c.paid_date) || (status === "paid" ? venc : "");
    if ((status === "paid" || (status === "partial" && saldo === 0)) && pagoEm && pagoEm > ultimoPagamento) ultimoPagamento = pagoEm;
  }
  if (atrasada) return { tom: "late", rotulo: "Atrasado", detalhe: `Venceu ${br(dia(atrasada.due_date))}`, ultimoPagamento: ultimoPagamento || null };
  if (aReceber) return { tom: "due", rotulo: "A receber", detalhe: `Vence ${br(dia(aReceber.due_date))}`, ultimoPagamento: ultimoPagamento || null };
  if (ultimoPagamento && ultimoPagamento.slice(0, 7) === mes) return { tom: "paid", rotulo: "Em dia", detalhe: `Pago em ${br(ultimoPagamento)}`, ultimoPagamento };
  if (ultimoPagamento) return { tom: "paid", rotulo: "Em dia", detalhe: `Último pagamento em ${br(ultimoPagamento)}`, ultimoPagamento };
  return null;
}

/** A situação de todos os clientes de uma vez (cobranças de vários clientes misturadas). */
export function situacoesPorCliente(cobrancas: CobrancaLida[], hoje: string): Map<string, SituacaoDaCobranca> {
  const porCliente = new Map<string, CobrancaLida[]>();
  for (const c of cobrancas) {
    if (!c || !c.client_id) continue;
    const k = String(c.client_id);
    const lista = porCliente.get(k);
    if (lista) lista.push(c);
    else porCliente.set(k, [c]);
  }
  const saida = new Map<string, SituacaoDaCobranca>();
  porCliente.forEach((lista, k) => {
    const s = situacaoDoCliente(lista, hoje);
    if (s) saida.set(k, s);
  });
  return saida;
}

/** O cliente passa no filtro da cobrança? */
export function passaNoFiltroDaCobranca(s: SituacaoDaCobranca | null | undefined, filtro: FiltroDaCobranca): boolean {
  if (filtro === "todas") return true;
  if (filtro === "atrasados") return !!s && s.tom === "late";
  if (filtro === "a_receber") return !!s && s.tom === "due";
  if (filtro === "em_dia") return !!s && s.tom === "paid";
  return !s;
}

/**
 * O alerta da data de renovação só existe quando há cobrança vencida e não paga. Cliente que já pagou (mesmo
 * com a data de renovação para trás no cadastro) mostra a data sem alerta.
 */
export function renovacaoEmAlerta(nivel: string | null | undefined, situacao: SituacaoDaCobranca | null | undefined): boolean {
  if (nivel !== "expired" && nivel !== "urgent") return false;
  if (!situacao) return nivel === "urgent";
  return situacao.tom === "late" || (nivel === "urgent" && situacao.tom === "due");
}
