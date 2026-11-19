/**
 * Venda automática do E-mail profissional (19/11/2026).
 *
 * Depois que a cobrança única do pedido (migração, 1º mês e ofertas) é paga, o aviso do Asaas chama
 * `assinarEmailDepoisDoPagamento`: ela cria a mensalidade do e-mail no Asaas, separada da assinatura
 * do CRM, começando no mês que vem. Chamar de novo não cria outra: confere o banco e o Asaas antes.
 *
 * O banco e a rede chegam de fora, para o teste rodar sem nenhum dos dois.
 */
import {
  acharAssinaturaPelaReferencia,
  criarAssinaturaMensal,
  descricaoDosItens,
  diaEmSaoPaulo,
  itensValidos,
  mesQueVem,
  referenciaDoEmail,
  totalDosItens,
} from "./asaas.ts";

type Buscar = (url: string, init?: RequestInit) => Promise<Response>;

// O pedaço do cliente do Supabase que a função usa (o teste passa um falso).
// deno-lint-ignore no-explicit-any
type Banco = { from: (t: string) => any; rpc: (f: string, a?: Record<string, unknown>) => any };

export type ResultadoDaAssinatura =
  | { feito: "criada" | "ja_existia"; assinatura_id: string; valor: number; proximo_vencimento: string | null }
  | { feito: "sem_mensalidade" | "sem_pedido" | "sem_cliente" | "cobrada_fora" };

export async function assinarEmailDepoisDoPagamento(
  db: Banco,
  token: string,
  buscar: Buscar,
  p: { contaId: string; clienteId: string | null; agora?: Date },
): Promise<ResultadoDaAssinatura> {
  const { data: ja } = await db.from("produto_email_assinaturas").select("asaas_assinatura_id, estado, valor_mensal, proximo_vencimento").eq("conta_id", p.contaId).maybeSingle();
  const atual = ja as { asaas_assinatura_id?: string | null; estado?: string; valor_mensal?: number; proximo_vencimento?: string | null } | null;
  if (atual && atual.asaas_assinatura_id && atual.estado !== "cancelada") {
    return { feito: "ja_existia", assinatura_id: atual.asaas_assinatura_id, valor: Number(atual.valor_mensal) || 0, proximo_vencimento: atual.proximo_vencimento || null };
  }

  // O pedido que acabou de ser pago é o que diz a mensalidade (com as ofertas que o cliente marcou).
  const { data: pedidos } = await db.from("produto_email_pedidos").select("id, estado, pago_em, extra_id").eq("conta_id", p.contaId).in("estado", ["pago", "em_andamento", "concluido"]).order("pago_em", { ascending: false }).limit(1);
  const pedido = Array.isArray(pedidos) && pedidos[0] ? (pedidos[0] as { id: string; extra_id: string | null }) : null;
  if (!pedido) return { feito: "sem_pedido" };
  // Cliente da Aceleriq (mensal no extra da ficha) ou empresa em cortesia: a mensalidade não é por aqui.
  const { data: dona } = await db.from("produto_contas").select("estado").eq("id", p.contaId).maybeSingle();
  if (pedido.extra_id || (dona as { estado?: string } | null)?.estado === "cortesia") return { feito: "cobrada_fora" };
  const { data: conta } = await db.rpc("produto_email_cobranca_do_pedido", { _pedido: pedido.id });
  const itens = itensValidos((conta as { itens_mensais?: unknown } | null)?.itens_mensais);
  const valor = totalDosItens(itens);
  if (!(valor > 0)) return { feito: "sem_mensalidade" };

  let clienteId = p.clienteId;
  if (!clienteId) {
    const { data: ass } = await db.from("produto_assinaturas").select("asaas_cliente_id").eq("conta_id", p.contaId).maybeSingle();
    clienteId = (ass as { asaas_cliente_id?: string | null } | null)?.asaas_cliente_id || null;
  }
  if (!clienteId) return { feito: "sem_cliente" };

  const referencia = referenciaDoEmail(p.contaId);
  const primeiro = mesQueVem(diaEmSaoPaulo(p.agora || new Date()));
  // O aviso pode chegar duas vezes: a assinatura que já está no Asaas é a que vale.
  const existente = await acharAssinaturaPelaReferencia(token, buscar, referencia);
  const lida = existente || (await criarAssinaturaMensal(token, buscar, {
    clienteId,
    valor,
    descricao: `Aceleriq · ${descricaoDosItens(itens)}`,
    referencia,
    primeiroVencimento: primeiro,
  }));

  const { error } = await db.from("produto_email_assinaturas").upsert({
    conta_id: p.contaId,
    pedido_id: pedido.id,
    asaas_assinatura_id: lida.id,
    asaas_cliente_id: clienteId,
    estado: "ativa",
    valor_mensal: lida.valor || valor,
    itens,
    proximo_vencimento: lida.proximo_vencimento || primeiro,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: "conta_id" });
  if (error) throw new Error(`assinatura_do_email_nao_gravada: ${String(error.message || "").slice(0, 120)}`);
  await db.from("produto_historico").insert({ conta_id: p.contaId, acao: "email_assinatura_criada", detalhe: { assinatura: lida.id, valor: lida.valor || valor, pedido: pedido.id } });
  return { feito: existente ? "ja_existia" : "criada", assinatura_id: lida.id, valor: lida.valor || valor, proximo_vencimento: lida.proximo_vencimento || primeiro };
}
