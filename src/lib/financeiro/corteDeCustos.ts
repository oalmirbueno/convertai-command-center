import { supabase } from "@/integrations/supabase/client";
import { proximoVencimento } from "@/lib/tributos";

/**
 * Corte de custos (27/11/2026, dono: "uma área de encerradas ou pausadas e poder reassinar").
 *
 * Encerrar e pausar seguem sendo recurrence -> "none" (o resto do painel e o agente CFO já leem assim); o
 * gatilho expenses_marca_corte guarda quando e qual era a recorrência (corte_em, corte_recorrencia).
 * Reassinar devolve a recorrência e o gatilho limpa a marcação.
 */

export type EstadoDoCorte = "pausada" | "encerrada";

export type LinhaDeDespesa = {
  id: string;
  description: string | null;
  category: string | null;
  amount: number | string | null;
  due_date: string | null;
  status: string | null;
  recurrence: string | null;
  notes?: string | null;
  corte_estado?: string | null;
  corte_em?: string | null;
  corte_recorrencia?: string | null;
};

const ehProLabore = (e: LinhaDeDespesa) =>
  e.category === "salarios" || /pr[oó][\s_-]?labore/i.test(`${e.description || ""} ${e.notes || ""}`);

/** O que a linha custa por mês (anual rateado por doze). */
export function porMes(valor: number | string | null, recorrencia: string | null | undefined): number {
  const v = Number(valor) || 0;
  return recorrencia === "yearly" ? v / 12 : v;
}

export type ResumoDoCorte = {
  ativos: LinhaDeDespesa[];
  pausadas: LinhaDeDespesa[];
  encerradas: LinhaDeDespesa[];
  /** Custos fixos por mês agora, sem pró-labore. */
  agora: number;
  /** Liberado por mês com o que está pausado ou encerrado. */
  liberado: number;
  /** Como era antes dos cortes (agora + liberado). */
  antes: number;
  /** Fração cortada (0 a 1). */
  fracao: number;
};

export function resumoDoCorte(despesas: readonly LinhaDeDespesa[]): ResumoDoCorte {
  const ativos = despesas
    .filter((e) => (e.recurrence === "monthly" || e.recurrence === "yearly") && !ehProLabore(e))
    .sort((a, b) => porMes(b.amount, b.recurrence) - porMes(a.amount, a.recurrence));
  const cortadas = despesas.filter((e) => e.recurrence === "none" && (e.corte_estado === "pausada" || e.corte_estado === "encerrada"));
  const porData = (a: LinhaDeDespesa, b: LinhaDeDespesa) => String(b.corte_em || "").localeCompare(String(a.corte_em || ""));
  const pausadas = cortadas.filter((e) => e.corte_estado === "pausada").sort(porData);
  const encerradas = cortadas.filter((e) => e.corte_estado === "encerrada").sort(porData);
  const agora = ativos.reduce((s, e) => s + porMes(e.amount, e.recurrence), 0);
  const liberado = cortadas.reduce((s, e) => s + porMes(e.amount, e.corte_recorrencia), 0);
  const antes = agora + liberado;
  return { ativos, pausadas, encerradas, agora, liberado, antes, fracao: antes > 0 ? liberado / antes : 0 };
}

/** Ao reassinar, o vencimento volta para o primeiro dia igual a hoje ou depois (nunca nasce atrasado). */
export function vencimentoAoReassinar(vencimento: string | null, recorrencia: "monthly" | "yearly", hoje: string): string {
  let v = (vencimento || hoje).slice(0, 10);
  for (let i = 0; v < hoje && i < 120; i++) v = proximoVencimento(v, recorrencia);
  return v;
}

/** A última parcela ficou em aberto no Fluxo de caixa (a linha cortada ainda está pendente). */
export const parcelaEmAberto = (e: LinhaDeDespesa) => e.status === "pending";

const db = supabase as unknown as {
  from: (t: string) => { update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => PromiseLike<{ error: { message: string } | null }> } };
};

async function atualizar(id: string, valores: Record<string, unknown>) {
  const { error } = await db.from("expenses").update(valores).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Pausa: deixa de contar e de rolar, com volta prevista. */
export const pausar = (id: string) => atualizar(id, { recurrence: "none", corte_estado: "pausada" });

/** Encerra uma ativa, ou passa uma pausada para encerrada. */
export const encerrar = (e: LinhaDeDespesa) =>
  atualizar(e.id, e.recurrence === "none" ? { corte_estado: "encerrada" } : { recurrence: "none", corte_estado: "encerrada" });

/** Reassina: volta a se repetir, com o próximo vencimento a partir de hoje. */
export function reassinar(e: LinhaDeDespesa, hoje: string) {
  const recorrencia = e.corte_recorrencia === "yearly" ? "yearly" : "monthly";
  return atualizar(e.id, { recurrence: recorrencia, due_date: vencimentoAoReassinar(e.due_date, recorrencia, hoje), status: "pending" });
}
