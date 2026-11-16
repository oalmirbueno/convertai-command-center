/**
 * Leitura ampla do CFO (16/11/2026, pedido do dono: "melhore o agente CFO, mais inteligente e que
 * consegue ler tudo"). O retrato olha para a frente (caixa, projeção, limite); aqui entra o que faltava
 * para ele responder sobre o que já aconteceu:
 * - resultado mês a mês dos últimos 12 meses (entrou, saiu, lucro, margem, caixa no fim), com a mesma
 *   conta da aba "Mês a mês" do Financeiro (../../_shared/historico-do-caixa.ts);
 * - de onde entrou o dinheiro do mês (mensalidades, avulsos e extras, projetos, CRM e E-mail);
 * - quem mais pagou nos últimos 3 meses;
 * - para onde foi o dinheiro do mês (despesas pagas por categoria);
 * - os extras dos clientes (mensais ativos, aguardando entrega, variáveis) e o produto CRM e E-mail.
 * Tudo calculado em código: a IA só explica.
 */
import { montarHistorico, somarMes, variacao, type Historico, type Movimento } from "../../_shared/historico-do-caixa.ts";

type Linha = Record<string, unknown>;

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const centavos = (v: number) => Math.round(v * 100) / 100;
const reais = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const rotuloCurto = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  return `${MESES[m - 1]}/${String(a).slice(2)}`;
};

/** Quanto entrou de fato numa cobrança ou parcela (pagamento parcial respeitado). */
function recebido(l: Linha): number {
  const cheio = num(l.amount);
  const pago = num(l.paid_amount);
  if (l.status === "partial") return Math.min(pago, cheio);
  if (l.status === "paid") return pago > 0 && pago < cheio ? pago : cheio;
  return 0;
}
const ehAporte = (cat: unknown) => {
  const c = typeof cat === "string" ? cat : "";
  return c === "investidor" || c.startsWith("inv_");
};
/** Dia de São Paulo de um instante do banco. */
function diaSP(iso: unknown): string {
  const s = typeof iso === "string" ? iso : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

export type LeituraAmpla = {
  historico: Historico;
  fatos: Record<string, unknown>;
};

export function leituraAmpla(e: {
  hoje: string;
  cobrancas: Linha[];
  pagamentos: Linha[];
  despesas: Linha[];
  clientes: Linha[];
  config: Linha | null;
  produto: Linha[];
  extras: Linha[];
}): LeituraAmpla {
  const mesAtual = e.hoje.slice(0, 7);
  const nomeDe = new Map<string, string>();
  for (const c of e.clientes) nomeDe.set(String(c.id), String(c.company_name || c.full_name || "cliente"));

  const entradas: Movimento[] = [];
  const entradasDoCaixa: Movimento[] = [];
  const origemDoMes = { mensalidades: 0, avulsos_e_extras: 0, projetos: 0, crm_email: 0 };
  const porCliente = new Map<string, number>();
  const desde3 = `${somarMes(mesAtual, -2)}-01`;

  for (const b of e.cobrancas) {
    if (b.type === "ads_recharge" || (b.status !== "paid" && b.status !== "partial")) continue;
    const dia = String(b.paid_date || b.due_date || "");
    const v = recebido(b);
    entradas.push({ dia, valor: v });
    entradasDoCaixa.push({ dia, valor: v });
    if (dia.slice(0, 7) === mesAtual) {
      if (b.type === "renewal") origemDoMes.mensalidades += v;
      else origemDoMes.avulsos_e_extras += v;
    }
    if (dia >= desde3 && b.client_id) porCliente.set(String(b.client_id), (porCliente.get(String(b.client_id)) || 0) + v);
  }
  for (const p of e.pagamentos) {
    const parcelas = Array.isArray(p.installments) ? (p.installments as Linha[]) : [];
    for (const i of parcelas) {
      if (i.status !== "paid" && i.status !== "partial") continue;
      const dia = String(i.paid_date || i.due_date || "");
      const v = recebido(i);
      entradas.push({ dia, valor: v });
      entradasDoCaixa.push({ dia, valor: v });
      if (dia.slice(0, 7) === mesAtual) origemDoMes.projetos += v;
      if (dia >= desde3 && p.client_id) porCliente.set(String(p.client_id), (porCliente.get(String(p.client_id)) || 0) + v);
    }
  }
  let crmEmailTotal = 0;
  for (const c of e.produto) {
    const dia = diaSP(c.pago_em);
    entradas.push({ dia, valor: num(c.valor) });
    entradasDoCaixa.push({ dia, valor: num(c.valor_liquido ?? c.valor) });
    crmEmailTotal += num(c.valor);
    if (dia.slice(0, 7) === mesAtual) origemDoMes.crm_email += num(c.valor);
  }

  const saidas: Movimento[] = [];
  const porCategoria = new Map<string, number>();
  for (const d of e.despesas) {
    if (d.status !== "paid" || ehAporte(d.category)) continue;
    const dia = String(d.paid_date || d.due_date || "");
    saidas.push({ dia, valor: num(d.amount) });
    if (dia.slice(0, 7) === mesAtual) porCategoria.set(String(d.category || "outros"), (porCategoria.get(String(d.category || "outros")) || 0) + num(d.amount));
  }

  const abertura = num(e.config?.opening_balance);
  const saldoHoje = abertura + entradasDoCaixa.reduce((s, m) => s + m.valor, 0) - saidas.reduce((s, m) => s + m.valor, 0);
  const historico = montarHistorico({ entradas, entradasDoCaixa, saidas, saldoHoje, ate: mesAtual, quantos: 12 });

  const atual = historico.meses[historico.meses.length - 1];
  const anterior = historico.meses.length > 1 ? historico.meses[historico.meses.length - 2] : null;

  const ativosMensais = e.extras.filter((x) => x.cobranca === "mensal" && x.status === "ativo");
  const aguardando = e.extras.filter((x) => x.cobranca === "mensal" && x.status === "aguardando");

  const fatos: Record<string, unknown> = {
    historico_12_meses: historico.meses.map((m) => ({
      mes: rotuloCurto(m.mes), entrou: m.entrou, saiu: m.saiu, lucro: m.lucro, margem_pct: m.margem, caixa_no_fim: m.caixaNoFim,
    })),
    comparacao_do_lucro: atual ? {
      mes_atual: rotuloCurto(atual.mes),
      lucro_ate_agora: atual.lucro,
      lucro_mes_anterior: anterior ? anterior.lucro : null,
      variacao_vs_anterior_pct: anterior ? variacao(atual.lucro, anterior.lucro) : null,
      media_dos_meses_fechados: historico.media,
      variacao_vs_media_pct: historico.media ? variacao(atual.lucro, historico.media.lucro) : null,
      melhor_mes: historico.melhor ? { mes: rotuloCurto(historico.melhor.mes), lucro: historico.melhor.lucro } : null,
      pior_mes: historico.pior ? { mes: rotuloCurto(historico.pior.mes), lucro: historico.pior.lucro } : null,
    } : null,
    entrou_no_mes_por_origem: Object.fromEntries(Object.entries(origemDoMes).map(([k, v]) => [k, centavos(v)])),
    quem_mais_pagou_3_meses: [...porCliente.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([id, v]) => ({ cliente: nomeDe.get(id) || "cliente", valor: centavos(v) })),
    saiu_no_mes_por_categoria: [...porCategoria.entries()].sort((a, b) => b[1] - a[1])
      .map(([categoria, v]) => ({ categoria, valor: centavos(v) })),
    extras_dos_clientes: {
      mensais_ativos: ativosMensais.length,
      mensais_ativos_por_mes: centavos(ativosMensais.reduce((s, x) => s + num(x.valor), 0)),
      aguardando_entrega: aguardando.length,
      aguardando_entrega_por_mes: centavos(aguardando.reduce((s, x) => s + num(x.valor), 0)),
      variaveis_ativos: e.extras.filter((x) => x.cobranca === "comissao" && x.status === "ativo").length,
    },
    crm_email: { recebido_no_mes: centavos(origemDoMes.crm_email), recebido_no_total: centavos(crmEmailTotal) },
  };
  return { historico, fatos };
}

/** A resposta do motor para "qual foi o lucro", "quanto sobrou", "compare os meses". */
export function respostaDoHistorico(h: Historico, pedido = ""): string {
  const meses = h.meses;
  if (!meses.length) return "Ainda não há movimento suficiente para montar o histórico.";
  const linhas: string[] = [];
  // Mês citado no pedido ("outubro", "mês passado"); sem citação, o mês corrente.
  const t = pedido.toLowerCase();
  const NOMES = ["janeiro", "fevereiro", "marco|março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  let alvo = meses[meses.length - 1];
  if (/m[eê]s passado|m[eê]s anterior|[uú]ltimo m[eê]s/.test(t) && meses.length > 1) alvo = meses[meses.length - 2];
  NOMES.forEach((n, i) => {
    if (new RegExp(`\\b(${n})\\b`).test(t)) {
      const achado = [...meses].reverse().find((m) => Number(m.mes.slice(5, 7)) === i + 1);
      if (achado) alvo = achado;
    }
  });
  const idx = meses.indexOf(alvo);
  const antes = idx > 0 ? meses[idx - 1] : null;
  linhas.push(`${rotuloCurto(alvo.mes)}: entrou ${reais(alvo.entrou)}, saiu ${reais(alvo.saiu)}, lucro ${reais(alvo.lucro)}${alvo.margem !== null ? ` (margem ${String(alvo.margem).replace(".", ",")}%)` : ""}. Caixa no fim do mês: ${reais(alvo.caixaNoFim)}.`);
  if (antes) {
    const v = variacao(alvo.lucro, antes.lucro);
    linhas.push(`Mês anterior (${rotuloCurto(antes.mes)}): lucro ${reais(antes.lucro)}${v !== null ? `, ${v >= 0 ? "alta" : "queda"} de ${String(Math.abs(v)).replace(".", ",")}%` : ""}.`);
  }
  if (h.media) linhas.push(`Média dos meses fechados: entrou ${reais(h.media.entrou)}, saiu ${reais(h.media.saiu)}, lucro ${reais(h.media.lucro)}.`);
  if (h.melhor) linhas.push(`Melhor mês: ${rotuloCurto(h.melhor.mes)} (${reais(h.melhor.lucro)})${h.pior ? `; pior: ${rotuloCurto(h.pior.mes)} (${reais(h.pior.lucro)})` : ""}.`);
  linhas.push("Últimos meses (lucro · caixa no fim):");
  for (const m of meses.slice(-6)) linhas.push(`${rotuloCurto(m.mes)}: ${reais(m.lucro)} · ${reais(m.caixaNoFim)}`);
  return linhas.join("\n");
}
