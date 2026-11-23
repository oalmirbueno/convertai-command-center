import { supabase } from "@/integrations/supabase/client";

/**
 * Pagamento que entrou só em parte (23/11/2026, dono: "marquei como pago, mas ele pagou só 100").
 *
 * O mesmo desenho da janela "Registrar pagamento" do Financeiro: a cobrança original vira "partial" com o
 * valor recebido (o Recebido do mês soma só isso) e o que falta nasce como uma cobrança pendente
 * "Saldo restante" com o mesmo vencimento (entra em A receber, atrasados e régua, que leem "pending").
 * Se o saldo não for criado, a original volta a pendente: o restante nunca some.
 */

export type ResultadoDoPagamento = { tipo: "total" } | { tipo: "parcial"; recebido: number; restante: number };

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Lê o valor digitado ("100", "100,50", "1.200,00") e devolve número com 2 casas, ou null. */
export function valorRecebido(digitado: string): number | null {
  const limpo = String(digitado || "").trim().replace(/\s/g, "");
  if (!limpo) return null;
  const normal = limpo.indexOf(",") >= 0 ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normal);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/** O que acontece com o valor recebido: total (cobre tudo) ou parcial (com o restante). */
export function classificarPagamento(total: number, recebido: number): ResultadoDoPagamento {
  if (recebido >= total - 0.004) return { tipo: "total" };
  return { tipo: "parcial", recebido, restante: Math.round((total - recebido) * 100) / 100 };
}

/** Registra o pagamento de uma cobrança pendente com o valor que entrou de fato. */
export async function registrarPagamento(billingId: string, recebido: number, hoje: string): Promise<ResultadoDoPagamento> {
  const { data: atual, error: erroDeLeitura } = await supabase.from("billing").select("*").eq("id", billingId).maybeSingle();
  if (erroDeLeitura) throw erroDeLeitura;
  const cobranca = atual as { id: string; client_id: string | null; type: string | null; amount: number; due_date: string | null; description: string | null; status: string; extra_id?: string | null } | null;
  if (!cobranca || cobranca.status !== "pending") throw new Error("Essa cobrança já saiu dos pendentes.");
  const total = Number(cobranca.amount) || 0;
  const resultado = classificarPagamento(total, recebido);

  if (resultado.tipo === "total") {
    const { data, error } = await supabase
      .from("billing")
      .update({ status: "paid", paid_date: hoje, paid_amount: total } as never)
      .eq("id", billingId)
      .eq("status", "pending")
      .select("id");
    if (error) throw error;
    if (!data || !data.length) throw new Error("Essa cobrança já saiu dos pendentes.");
    return resultado;
  }

  const descricao = `${cobranca.description || "Cobrança"} (parcial: ${reais(resultado.recebido)} de ${reais(total)})`;
  const { data: mudou, error: erroDoParcial } = await supabase
    .from("billing")
    .update({ status: "partial", paid_date: hoje, paid_amount: resultado.recebido, description: descricao } as never)
    .eq("id", billingId)
    .eq("status", "pending")
    .select("id");
  if (erroDoParcial) throw erroDoParcial;
  if (!mudou || !mudou.length) throw new Error("Essa cobrança já saiu dos pendentes.");

  const { error: erroDoSaldo } = await supabase.from("billing").insert({
    client_id: cobranca.client_id,
    type: cobranca.type || "renewal",
    amount: resultado.restante,
    due_date: cobranca.due_date || hoje,
    description: `Saldo restante: ${reais(resultado.restante)}`,
    ...(cobranca.extra_id ? { extra_id: cobranca.extra_id } : {}),
  } as never);
  if (erroDoSaldo) {
    await supabase
      .from("billing")
      .update({ status: "pending", paid_date: null, paid_amount: null, description: cobranca.description } as never)
      .eq("id", billingId)
      .eq("status", "partial");
    throw new Error("O saldo restante não foi criado, então a cobrança voltou a pendente. Tente de novo.");
  }
  return resultado;
}
