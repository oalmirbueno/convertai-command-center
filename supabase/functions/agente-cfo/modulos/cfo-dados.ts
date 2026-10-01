/**
 * Das linhas do banco para a entrada do motor do CFO (cfo-calculos.ts).
 *
 * A tela (Financeiro › CFO, com o login do admin) e a função agente-cfo
 * (chave de serviço depois de conferir que quem pede é admin) leem as MESMAS
 * tabelas e passam por aqui, para o número ser o mesmo nos dois lugares.
 * Puro: sem Deno, sem npm.
 */

import type { CaixinhasDoCFO, ClienteDoCFO, DadosDoCFO, DespesaDoCFO, MetaDoCFO, ParcelaDoCFO, CobrancaDoCFO, TravaRegistrada } from "./cfo-calculos.ts";

type Linha = Record<string, unknown>;

const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};

/** Hoje em São Paulo (AAAA-MM-DD): a data que o dono vê. */
export function hojeEmSaoPaulo(agora: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
  } catch {
    const d = new Date(agora.getTime() - 3 * 3_600_000);
    return d.toISOString().slice(0, 10);
  }
}

/** Colunas que cada leitura pede (as duas pontas usam as mesmas). */
export const COLUNAS = {
  cobrancas: "id, client_id, type, amount, paid_amount, status, due_date, paid_date, description",
  pagamentos: "id, client_id, project:projects!project_payments_project_id_fkey(name), installments:payment_installments(id, amount, paid_amount, status, due_date, paid_date, description)",
  despesas: "id, description, category, amount, status, due_date, paid_date, recurrence, notes",
  clientes: "id, company_name, full_name, plan_name, plan_value, plan_status, client_type, services_config",
  config: "opening_balance, monthly_goal, current_pro_labore, target_pro_labore, reserve_target",
  metas: "id, titulo, tipo, valor_alvo, prazo, criado_em",
  travas: "valor, limite, decisao, criado_em",
} as const;

export function caixinhasDe(servicesConfig: unknown): CaixinhasDoCFO {
  const sc = servicesConfig && typeof servicesConfig === "object" ? (servicesConfig as Linha) : {};
  const b = sc.finance_boxes && typeof sc.finance_boxes === "object" ? (sc.finance_boxes as Linha) : {};
  return { tax: num(b.tax) || 0, clients: num(b.clients) || 0, safety: num(b.safety) || 0 };
}

export function montarDadosDoCFO(e: {
  hoje: string;
  cobrancas: Linha[] | null | undefined;
  pagamentos: Linha[] | null | undefined;
  despesas: Linha[] | null | undefined;
  clientes: Linha[] | null | undefined;
  config: Linha | null | undefined;
  caixinhas: CaixinhasDoCFO | null | undefined;
  metas?: Linha[] | null;
  travas?: Linha[] | null;
}): DadosDoCFO {
  const cobrancas: CobrancaDoCFO[] = (e.cobrancas || []).map((b) => ({
    id: String(b.id),
    client_id: txt(b.client_id),
    type: txt(b.type),
    amount: num(b.amount),
    paid_amount: num(b.paid_amount),
    status: txt(b.status),
    due_date: txt(b.due_date),
    paid_date: txt(b.paid_date),
    description: txt(b.description),
  }));
  const parcelas: ParcelaDoCFO[] = [];
  for (const p of e.pagamentos || []) {
    const projeto = p.project && typeof p.project === "object" ? txt((p.project as Linha).name) : null;
    const lista = Array.isArray(p.installments) ? (p.installments as Linha[]) : [];
    for (const i of lista) {
      parcelas.push({
        id: String(i.id),
        client_id: txt(p.client_id),
        amount: num(i.amount),
        paid_amount: num(i.paid_amount),
        status: txt(i.status),
        due_date: txt(i.due_date),
        paid_date: txt(i.paid_date),
        description: txt(i.description),
        projeto,
      });
    }
  }
  const despesas: DespesaDoCFO[] = (e.despesas || []).map((x) => ({
    id: String(x.id),
    description: txt(x.description),
    category: txt(x.category),
    amount: num(x.amount),
    status: txt(x.status),
    due_date: txt(x.due_date),
    paid_date: txt(x.paid_date),
    recurrence: txt(x.recurrence),
    notes: txt(x.notes),
  }));
  const clientes: ClienteDoCFO[] = (e.clientes || []).map((c) => {
    const sc = c.services_config && typeof c.services_config === "object" ? (c.services_config as Linha) : {};
    return {
      id: String(c.id),
      nome: txt(c.company_name) || txt(c.full_name) || "Cliente",
      plan_name: txt(c.plan_name),
      plan_value: num(c.plan_value),
      plan_status: txt(c.plan_status),
      client_type: txt(c.client_type),
      interno: sc.internal_company === true,
    };
  });
  const cfg = e.config || {};
  const metas: MetaDoCFO[] = (e.metas || []).map((m) => ({
    id: String(m.id),
    titulo: txt(m.titulo) || "Meta",
    tipo: txt(m.tipo) || "outra",
    valor_alvo: num(m.valor_alvo),
    prazo: txt(m.prazo),
    criado_em: txt(m.criado_em),
  }));
  const travas: TravaRegistrada[] = (e.travas || []).map((t) => ({
    valor: num(t.valor),
    limite: num(t.limite),
    decisao: txt(t.decisao),
    criado_em: txt(t.criado_em) || "",
  }));
  return {
    hoje: e.hoje,
    cobrancas,
    parcelas,
    despesas,
    clientes,
    config: {
      saldoInicial: num(cfg.opening_balance) || 0,
      metaMensal: num(cfg.monthly_goal),
      proLaboreAtual: num(cfg.current_pro_labore),
      proLaboreAlvo: num(cfg.target_pro_labore),
      reservaAlvo: num(cfg.reserve_target),
    },
    caixinhas: e.caixinhas || { tax: 0, clients: 0, safety: 0 },
    metas,
    travas,
  };
}
