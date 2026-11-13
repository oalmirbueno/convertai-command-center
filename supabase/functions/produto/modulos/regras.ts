/**
 * Regras de cobrança do produto que não dependem de rede (13/11/2026), para o
 * teste provar: o pagamento vale pelo que foi pago, a redução espera a próxima
 * cobrança e cancelar em atraso não dá mês de graça.
 */

export interface Pedido {
  plano_id: string;
  usuarios: number;
  valor: number;
}

/** O pedido guardado para um checkout, só se estiver inteiro. */
export function pedidoDoCheckout(pedidos: unknown, checkoutId: string | null | undefined): Pedido | null {
  if (!checkoutId || !pedidos || typeof pedidos !== "object") return null;
  const p = (pedidos as Record<string, unknown>)[checkoutId];
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  const usuarios = Math.floor(Number(o.usuarios));
  const valor = Number(o.valor);
  if (typeof o.plano_id !== "string" || !/^[a-z0-9_]{2,40}$/.test(o.plano_id) || !(usuarios >= 1 && usuarios <= 500)) return null;
  return { plano_id: o.plano_id, usuarios, valor: isFinite(valor) && valor >= 0 ? valor : 0 };
}

/** Acrescenta o pedido de um checkout, guardando só os oito mais novos (os links antigos expiram em duas horas). */
export function comPedido(pedidos: unknown, checkoutId: string, pedido: Pedido, agora: Date): Record<string, unknown> {
  const atuais = (pedidos && typeof pedidos === "object" ? pedidos : {}) as Record<string, { em?: string }>;
  const todos: Array<[string, unknown]> = Object.keys(atuais).map((k) => [k, atuais[k]] as [string, unknown]);
  todos.push([checkoutId, { ...pedido, em: agora.toISOString() }]);
  todos.sort((a, b) => String((a[1] as { em?: string }).em || "").localeCompare(String((b[1] as { em?: string }).em || "")));
  const saida: Record<string, unknown> = {};
  todos.slice(-8).forEach(([k, v]) => {
    saida[k] = v;
  });
  return saida;
}

/** Baixar o valor no meio do ciclo espera a próxima cobrança; subir vale na hora. */
export const ehReducao = (valorNovo: number, valorAtual: number) => valorNovo < valorAtual - 0.009;

/**
 * Até quando a empresa usa depois de cancelar. Só quem está em dia leva o
 * período já pago até o fim; em atraso, o acesso termina na hora.
 */
export function fimDoAcessoAoCancelar(p: { estadoDaConta: string; proximoVencimento: string | null | undefined; agora: Date }): string {
  const hoje = new Date(p.agora.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const emDia = p.estadoDaConta === "ativa";
  if (emDia && p.proximoVencimento && /^\d{4}-\d{2}-\d{2}$/.test(p.proximoVencimento) && p.proximoVencimento > hoje) return `${p.proximoVencimento}T23:59:59-03:00`;
  return p.agora.toISOString();
}
