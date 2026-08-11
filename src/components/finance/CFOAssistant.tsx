import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Brain, AlertTriangle, CheckCircle2, TrendingUp, Target, FileDown,
  MessageSquare, Copy, Lightbulb, Landmark,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useFinanceSettings, useFinancePlans, useFinanceMutations } from "@/hooks/useFinanceV2";
import {
  DEFAULT_TAX_RATE, interpolateProLabore, nextProLaboreTier, ONE_OFF_CATALOG,
} from "@/lib/directorPlan";
import { isInternalClient } from "@/lib/clientFlags";
import { useFinanceBoxes, boxesTotal } from "@/hooks/useFinanceBoxes";

const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
const MONTHS_FULL = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const parseDate = (v?: string | null) => {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split("-").map(Number);
    return new Date(y, m - 1, d, 12);
  }
  return new Date(v);
};

const receivedAmountOf = (row: any): number => {
  const total = Number(row?.amount) || 0;
  const paid = Number(row?.paid_amount) || 0;
  if (row?.status === "partial") return Math.min(paid, total);
  if (row?.status === "paid") return paid > 0 && paid < total ? paid : total;
  return 0;
};

const normName = (s: string | null | undefined) => (s || "").trim().toLowerCase();
const isProLaboreExpense = (e: any) => /pr[oó][\s_-]?labore/i.test(`${e?.description || ""} ${e?.notes || ""}`);
const roundTo = (v: number, step: number) => Math.ceil(v / step) * step;

type Severity = "critical" | "attention" | "good";

interface Recommendation {
  severity: Severity;
  title: string;
  detail: string;
}

interface Props {
  billing: any[];
  projectPayments: any[];
  clients: any[];
}

export default function CFOAssistant({ billing, projectPayments, clients }: Props) {
  const { data: settings } = useFinanceSettings();
  const { data: plans } = useFinancePlans();
  const { updateSettings } = useFinanceMutations();
  const [responseType, setResponseType] = useState("resumo");
  const [responseClientId, setResponseClientId] = useState("");
  const [responseText, setResponseText] = useState("");
  const [goalDraft, setGoalDraft] = useState("");
  const { data: financeBoxes } = useFinanceBoxes();

  const { data: allExpenses = [] } = useQuery({
    queryKey: ["expenses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("expenses").select("*").order("due_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // ───────── Análise do mês corrente ─────────
  const analysis = useMemo(() => {
    const now = new Date();
    const monthLabel = `${MONTHS_FULL[now.getMonth()]} ${now.getFullYear()}`;
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const inThisMonth = (v?: string | null) => {
      const d = parseDate(v);
      return !!d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    };

    const rateByPlanName = new Map<string, number>();
    (plans || []).forEach((p) => {
      const rate = p.currentVersion?.taxRate;
      if (rate !== null && rate !== undefined) rateByPlanName.set(normName(p.name), rate);
    });
    const taxRateFor = (client: any) => rateByPlanName.get(normName(client?.plan_name)) ?? DEFAULT_TAX_RATE;
    const clientById = new Map((clients || []).map((c: any) => [c.id, c]));

    // Recebido no mês (bruto) e por cliente
    let grossReceived = 0;
    let taxReserve = 0;
    const receivedByClient = new Map<string, number>();
    const addReceived = (clientId: string | null, amount: number) => {
      grossReceived += amount;
      const client = clientId ? clientById.get(clientId) : null;
      taxReserve += amount * (client ? taxRateFor(client) : DEFAULT_TAX_RATE);
      if (clientId) receivedByClient.set(clientId, (receivedByClient.get(clientId) || 0) + amount);
    };
    (billing || [])
      .filter((b: any) => b.type !== "ads_recharge" && (b.status === "paid" || b.status === "partial") && inThisMonth(b.paid_date || b.due_date))
      .forEach((b: any) => addReceived(b.client_id || null, receivedAmountOf(b)));
    (projectPayments || []).forEach((pp: any) => {
      (pp.installments || [])
        .filter((i: any) => (i.status === "paid" || i.status === "partial") && inThisMonth(i.paid_date || i.due_date))
        .forEach((i: any) => addReceived(pp.client_id || null, receivedAmountOf(i)));
    });
    const operational = grossReceived - taxReserve;

    // Estrutura
    const fixedReal = (allExpenses || [])
      .filter((e: any) => e.recurrence === "monthly" && !isProLaboreExpense(e) && !(e.category || "").startsWith("inv_") && e.category !== "investidor")
      .reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
    const fixedCosts = fixedReal > 0 ? fixedReal : Number(settings?.raw?.tools_systems_cost ?? 2500);
    const proLaboreOfficial = settings?.currentProLabore ?? 3000;
    const proLaboreProp = interpolateProLabore(operational);
    const defaultDirectCost = settings?.defaultDirectCost ?? 275;

    // Carteira (empresas do grupo ficam fora de tudo)
    const activeRecurring = (clients || []).filter((c: any) => c.plan_value && c.plan_status === "active" && c.client_type !== "one_off" && !isInternalClient(c));
    const mrr = activeRecurring.reduce((s: number, c: any) => s + Number(c.plan_value || 0), 0);
    const clientReserveTarget = activeRecurring.length * defaultDirectCost;

    const afterStructure = operational - fixedCosts - proLaboreProp;
    const clientReserve = Math.min(Math.max(afterStructure, 0), clientReserveTarget);
    const profit = afterStructure - clientReserve;

    // Atrasados (billing pendente vencido, excluindo pausados)
    const pausedIds = new Set((clients || []).filter((c: any) => c.plan_status === "standby" || c.plan_status === "inactive" || isInternalClient(c)).map((c: any) => c.id));
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const overdue = (billing || [])
      .filter((b: any) => {
        if (b.status !== "pending" || b.type === "ads_recharge") return false;
        if (b.type === "renewal" && pausedIds.has(b.client_id)) return false;
        const due = parseDate(b.due_date);
        return !!due && due < today;
      })
      .map((b: any) => ({ ...b, clientRow: clientById.get(b.client_id) }));
    const overdueTotal = overdue.reduce((s: number, b: any) => s + Number(b.amount || 0), 0);

    // Clientes sem plano/valor (empresas internas não são pendência)
    const noPlan = (clients || []).filter(
      (c: any) => c.client_type !== "one_off" && (c.plan_status || "active") === "active" && (!c.plan_value || Number(c.plan_value) === 0) && !isInternalClient(c)
    );

    // Abaixo da tabela do catálogo
    const belowTable = activeRecurring
      .map((c: any) => {
        const plan = (plans || []).find((p) => p.isActive && normName(p.name) === normName(c.plan_name));
        const version = plan?.currentVersion || plan?.versions?.[0] || null;
        if (!version || version.amount <= 0) return null;
        const diff = version.amount - Number(c.plan_value);
        return diff > 0.5 ? { client: c, plan, version, diff } : null;
      })
      .filter(Boolean) as any[];

    // Concentração
    const topClient = activeRecurring.reduce((top: any, c: any) => (Number(c.plan_value) > Number(top?.plan_value || 0) ? c : top), null);
    const concentration = topClient && mrr > 0 ? Number(topClient.plan_value) / mrr : 0;

    // Projeção pelo ritmo (estimativa: média diária × dias do mês)
    const projectedOperational = dayOfMonth > 0 ? (operational / dayOfMonth) * daysInMonth : operational;

    // Meta
    const monthlyGoal = settings?.monthlyGoal ?? null;
    const suggestedGoal = Math.max(10000, roundTo((fixedCosts + proLaboreOfficial + clientReserveTarget) * 1.4, 500));
    const goal = monthlyGoal || suggestedGoal;

    // Gaps: o que vale é o RECEBIDO; a projeção é só estimativa secundária.
    const structureGap = Math.max(fixedCosts + proLaboreProp - operational, 0);
    const realGoalGap = Math.max(goal - operational, 0);
    const projectedGap = Math.max(goal - projectedOperational, 0);

    // Saldo em caixa (mesma fórmula do Fluxo de Caixa)
    const isInvestorExp = (e: any) => {
      const c = e?.category || "";
      return c === "investidor" || c.startsWith("inv_");
    };
    const allTimeReceived =
      (billing || [])
        .filter((b: any) => b.type !== "ads_recharge" && (b.status === "paid" || b.status === "partial"))
        .reduce((s: number, b: any) => s + receivedAmountOf(b), 0) +
      (projectPayments || []).reduce(
        (s: number, pp: any) =>
          s + (pp.installments || []).filter((i: any) => i.status === "paid" || i.status === "partial").reduce((x: number, i: any) => x + receivedAmountOf(i), 0),
        0
      );
    const allTimePaidOut = (allExpenses || [])
      .filter((e: any) => e.status === "paid" && !isInvestorExp(e))
      .reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
    const cashBalance = (settings?.openingBalance ?? 0) + allTimeReceived - allTimePaidOut;

    return {
      monthLabel, dayOfMonth, daysInMonth,
      grossReceived, taxReserve, operational, projectedOperational,
      fixedCosts, proLaboreOfficial, proLaboreProp, defaultDirectCost,
      clientReserveTarget, clientReserve, profit, structureGap,
      goal, realGoalGap, projectedGap, cashBalance,
      mrr, activeRecurring, overdue, overdueTotal, noPlan, belowTable,
      topClient, concentration, monthlyGoal, suggestedGoal,
    };
  }, [billing, projectPayments, clients, allExpenses, settings, plans]);

  // ───────── Recomendações priorizadas ─────────
  const recommendations = useMemo<Recommendation[]>(() => {
    const a = analysis;
    const recs: Recommendation[] = [];

    if (a.profit < 0) {
      recs.push({
        severity: "critical",
        title: `Mês ainda no vermelho: faltam ${fmt(a.structureGap)} para cobrir a estrutura`,
        detail: `Custos fixos (${fmt(a.fixedCosts)}) + pró-labore proporcional (${fmt(a.proLaboreProp)}) ainda não estão cobertos pelos ${fmt(a.operational)} operacionais. Prioridade: receber os atrasados e fechar avulsos rápidos antes de qualquer gasto novo.`,
      });
    } else {
      recs.push({
        severity: "good",
        title: `Estrutura do mês coberta · lucro de ${fmt(a.profit)}`,
        detail: `Reserva de clientes/investimento separada: ${fmt(a.clientReserve)} de ${fmt(a.clientReserveTarget)}. O Plano Diretor manda segurar o lucro para reserva antes de aumentar qualquer custo.`,
      });
    }

    if (a.overdue.length > 0) {
      const names = a.overdue.slice(0, 4).map((b: any) => b.clientRow?.company_name || b.clientRow?.full_name || "cliente").join(", ");
      recs.push({
        severity: "critical",
        title: `${fmt(a.overdueTotal)} atrasados em ${a.overdue.length} cobrança(s)`,
        detail: `Cobre hoje: ${names}${a.overdue.length > 4 ? "…" : ""}. Dinheiro atrasado é a receita mais barata de recuperar — use a mensagem pronta de cobrança abaixo.`,
      });
    }

    if (a.noPlan.length > 0) {
      recs.push({
        severity: "attention",
        title: `${a.noPlan.length} cliente(s) ativos sem plano/valor definido`,
        detail: `${a.noPlan.slice(0, 4).map((c: any) => c.company_name || c.full_name).join(", ")}${a.noPlan.length > 4 ? "…" : ""}. O Plano Diretor trata cliente sem preço como pendência crítica: defina plano e valor no cadastro para entrar no MRR e na cobrança automática.`,
      });
    }

    if (a.belowTable.length > 0) {
      const total = a.belowTable.reduce((s: number, r: any) => s + r.diff, 0);
      recs.push({
        severity: "attention",
        title: `${fmt(total)}/mês deixados na mesa por preços abaixo da tabela`,
        detail: `${a.belowTable.map((r: any) => `${r.client.company_name || r.client.full_name} (${fmt(Number(r.client.plan_value))} → tabela ${fmt(r.version.amount)})`).slice(0, 3).join("; ")}. Aplique o degrau "Agora" com aditivo simples — mensagem pronta de reajuste abaixo.`,
      });
    }

    if (a.realGoalGap > 0) {
      const combos = ONE_OFF_CATALOG
        .filter((o) => !o.fromPrice)
        .slice(0, 3)
        .map((o) => `${Math.ceil(a.realGoalGap / o.launchPrice)}× ${o.name} (${fmt(o.launchPrice)})`)
        .join(" · ");
      recs.push({
        severity: "attention",
        title: `Meta de ${fmt(a.goal)}: entrou ${fmt(a.operational)} até o dia ${a.dayOfMonth} — faltam ${fmt(a.realGoalGap)}`,
        detail: `${a.projectedGap > 0
          ? `Se o ritmo continuar (média diária × ${a.daysInMonth} dias), o mês fecha em ~${fmt(a.projectedOperational)} e ainda faltariam ${fmt(a.projectedGap)}.`
          : `Se o ritmo continuar, o mês fecha em ~${fmt(a.projectedOperational)} e alcança a meta — mas só conta quando cair na conta.`} Para fechar o que falta de verdade: ${combos}. Diagnóstico express é a porta de entrada oficial — 100% antecipado e abre relação para o plano recorrente.`,
      });
    } else if (a.monthlyGoal) {
      recs.push({
        severity: "good",
        title: `Meta batida: entrou ${fmt(a.operational)} contra meta de ${fmt(a.monthlyGoal)}`,
        detail: "Hora de subir o funil: 5 empresas do ICP por dia e 3 follow-ups, como manda o ritual comercial — e considerar o próximo degrau de meta.",
      });
    }

    if (financeBoxes && financeBoxes.tax + 0.5 < a.taxReserve) {
      recs.push({
        severity: "attention",
        title: `Caixinha de reserva tributária desatualizada: guardado ${fmt(financeBoxes.tax)}, estimado do mês ${fmt(a.taxReserve)}`,
        detail: "Atualize a caixinha no Fluxo de Caixa para o imposto não se misturar com o dinheiro da operação — tributo não financia a operação.",
      });
    }

    if (a.concentration > 0.3 && a.topClient) {
      recs.push({
        severity: "attention",
        title: `Concentração de ${Math.round(a.concentration * 100)}% em ${a.topClient.company_name || a.topClient.full_name}`,
        detail: "Um cliente acima de 30% do MRR é risco de dependência. Priorize 2 contratos novos no plano de entrada para diluir.",
      });
    }

    const tier = nextProLaboreTier(a.operational);
    if (tier) {
      recs.push({
        severity: "good",
        title: `Próximo degrau do pró-labore: ${fmt(tier.proLabore)} em ${fmt(tier.revenue)} operacionais`,
        detail: `Hoje o proporcional é ${fmt(a.proLaboreProp)}. Faltam ${fmt(Math.max(tier.revenue - a.operational, 0))} operacionais/mês para o degrau cheio — o gap cabe em ${Math.ceil(Math.max(tier.revenue - a.operational, 0) / 997)} contratos de Start Assistido (${fmt(997)}).`,
      });
    }

    const order: Record<Severity, number> = { critical: 0, attention: 1, good: 2 };
    return recs.sort((x, y) => order[x.severity] - order[y.severity]);
  }, [analysis, financeBoxes]);

  // ───────── Respostas prontas ─────────
  const RESPONSE_TYPES = [
    { value: "resumo", label: "Resumo executivo do mês" },
    { value: "contador", label: "Fechamento para o contador" },
    { value: "cobranca", label: "Cobrança de atrasado", needsClient: true },
    { value: "reajuste", label: "Proposta de reajuste", needsClient: true },
    { value: "isca", label: "Oferta de entrada (isca)", needsClient: false },
  ];

  const buildResponse = (type: string, clientId: string): string => {
    const a = analysis;
    const client = (clients || []).find((c: any) => c.id === clientId);
    const clientName = client?.company_name || client?.full_name || "[cliente]";

    if (type === "cobranca") {
      const bill = a.overdue.find((b: any) => b.client_id === clientId) ||
        (billing || []).find((b: any) => b.client_id === clientId && b.status === "pending");
      const valor = bill ? fmt(Number(bill.amount)) : "[valor]";
      const venc = bill ? (parseDate(bill.due_date)?.toLocaleDateString("pt-BR") || "[vencimento]") : "[vencimento]";
      return `Olá! Tudo bem? 😊\n\nPassando para lembrar da mensalidade de ${valor} com vencimento em ${venc}.\n\nPara manter as entregas e os resultados sem pausa, consegue confirmar o pagamento hoje? Se preferir, posso reenviar os dados de pagamento ou combinar uma data que funcione melhor.\n\nQualquer dúvida estou à disposição!`;
    }

    if (type === "reajuste") {
      const row = a.belowTable.find((r: any) => r.client.id === clientId);
      const atual = client?.plan_value ? fmt(Number(client.plan_value)) : "[valor atual]";
      const novo = row ? fmt(row.version.amount) : "[novo valor]";
      const planName = client?.plan_name || "[plano]";
      return `Olá, ${clientName}!\n\nEstamos organizando a operação da Aceleriq para entregar ainda mais resultado, e o plano ${planName} está sendo atualizado para a tabela vigente.\n\n• Valor atual: ${atual}\n• Novo valor: ${novo} a partir da próxima renovação\n• Escopo: mantido por escrito, com limite de entregas claro\n\nO reajuste segue nossa tabela oficial e garante a continuidade com qualidade. Posso enviar o aditivo simples para confirmarmos? Qualquer ponto, conversamos!`;
    }

    if (type === "contador") {
      return `Olá! Segue o fechamento de ${a.monthLabel} da Aceleriq (sócio único):\n\n• Faturamento bruto recebido: ${fmt(a.grossReceived)}\n• Reserva tributária estimada: ${fmt(a.taxReserve)} (alíquotas por plano; padrão ilustrativo de 6%)\n• Receita operacional: ${fmt(a.operational)}\n• Custos fixos do mês: ${fmt(a.fixedCosts)}\n• Pró-labore do período: ${fmt(a.proLaboreOfficial)} (único administrador)\n• MRR contratado: ${fmt(a.mrr)} em ${a.activeRecurring.length} clientes\n\nPode por favor:\n1) Confirmar a alíquota efetiva do Simples (CNAE, RBT12 e Fator R) para ajustarmos a reserva;\n2) Emitir o DAS e a guia do pró-labore (INSS/IRRF);\n3) Validar se a reserva separada cobre os tributos da competência;\n4) Sinalizar qualquer obrigação acessória do mês.\n\nObrigado!`;
    }

    if (type === "isca") {
      const isca = ONE_OFF_CATALOG[0];
      return `Olá${client ? `, ${clientName}` : ""}! Tudo bem?\n\nA Aceleriq está com uma condição de entrada para empresas que querem organizar o marketing e vender mais: o ${isca.name} por ${fmt(isca.launchPrice)}.\n\nEm até ${isca.limit} de análise, você recebe:\n• Diagnóstico do que está travando suas vendas hoje\n• As 3 prioridades de maior impacto para os próximos 30 dias\n• Um plano claro do que fazer (com ou sem a gente)\n\nÉ pagamento único, sem mensalidade. Topa agendar essa análise esta semana?`;
    }

    // resumo executivo
    const status = a.profit >= 0 ? `LUCRO de ${fmt(a.profit)}` : `resultado parcial de ${fmt(a.profit)} (faltam ${fmt(a.structureGap)} para cobrir a estrutura)`;
    const boxesLine = financeBoxes
      ? `\n\nCAIXA\n• Saldo em caixa: ${fmt(a.cashBalance)}\n• Caixinhas — tributária: ${fmt(financeBoxes.tax)} · clientes/investimento: ${fmt(financeBoxes.clients)} · reserva segura: ${fmt(financeBoxes.safety)}\n• Disponível livre: ${fmt(a.cashBalance - boxesTotal(financeBoxes))}`
      : `\n\nCAIXA\n• Saldo em caixa: ${fmt(a.cashBalance)}`;
    return `RESUMO EXECUTIVO · ${a.monthLabel} (até dia ${a.dayOfMonth})\n\nENTRADAS\n• Recebido bruto: ${fmt(a.grossReceived)}\n• Reserva tributária separada: ${fmt(a.taxReserve)}\n• Receita operacional: ${fmt(a.operational)}\n• Meta: ${fmt(a.goal)} — ${a.realGoalGap > 0 ? `faltam ${fmt(a.realGoalGap)}` : "batida"}\n• Se o ritmo continuar, o mês fecha em ~${fmt(a.projectedOperational)} (estimativa)\n\nESTRUTURA\n• Custos fixos: ${fmt(a.fixedCosts)}\n• Pró-labore proporcional: ${fmt(a.proLaboreProp)} (oficial: ${fmt(a.proLaboreOfficial)})\n• Reserva clientes/investimento: ${fmt(a.clientReserve)} de ${fmt(a.clientReserveTarget)}\n\nRESULTADO: ${status}${boxesLine}\n\nCARTEIRA\n• MRR: ${fmt(a.mrr)} em ${a.activeRecurring.length} clientes ativos\n• Atrasados: ${fmt(a.overdueTotal)} (${a.overdue.length} cobranças)\n• Sem plano definido: ${a.noPlan.length} cliente(s)\n\nPRÓXIMOS PASSOS\n${recommendations.slice(0, 3).map((r, i) => `${i + 1}. ${r.title}`).join("\n")}`;
  };

  const generateResponse = (type?: string, clientId?: string) => {
    const t = type ?? responseType;
    const c = clientId ?? responseClientId;
    setResponseText(buildResponse(t, c));
  };

  const copyResponse = async () => {
    try {
      await navigator.clipboard.writeText(responseText);
      toast.success("Copiado! É só colar.");
    } catch {
      toast.error("Não consegui copiar automaticamente — selecione o texto e copie.");
    }
  };

  const whatsappHref = () => {
    const client = (clients || []).find((c: any) => c.id === responseClientId);
    const phone = client?.phone?.replace(/\D/g, "") || "";
    if (!phone || !responseText) return null;
    return `https://wa.me/${phone}?text=${encodeURIComponent(responseText)}`;
  };

  const applySuggestedGoal = async () => {
    if (!settings) return;
    const value = parseFloat(goalDraft) || analysis.suggestedGoal;
    try {
      await updateSettings.mutateAsync({
        currency: settings.currency,
        openingBalance: settings.openingBalance,
        reserveTarget: settings.reserveTarget,
        defaultDueDay: settings.defaultDueDay,
        forecastMonths: settings.forecastMonths,
        monthlyGoal: value,
        growthRetentionRate: settings.growthRetentionRate,
        minimumReserveMonths: settings.minimumReserveMonths,
        desiredMinimumMargin: settings.desiredMinimumMargin,
        currentProLabore: settings.currentProLabore,
        targetProLabore: settings.targetProLabore,
        defaultDirectCost: settings.defaultDirectCost,
        allocationMethod: settings.allocationMethod,
        includeProLaboreInAllocation: settings.includeProLaboreInAllocation,
      });
      toast.success(`Meta mensal definida: ${fmt(value)}`);
    } catch (err: any) {
      toast.error(err.message || "Erro ao definir meta");
    }
  };

  // ───────── PDF do mês (via impressão do navegador) ─────────
  const downloadPdf = () => {
    const a = analysis;
    const sevLabel: Record<Severity, string> = { critical: "AGIR AGORA", attention: "ATENÇÃO", good: "NO CAMINHO" };
    const sevColor: Record<Severity, string> = { critical: "#c62828", attention: "#b26a00", good: "#1b7f3b" };
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Aceleriq · Resumo Financeiro · ${a.monthLabel}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:32px;font-size:12px}
  h1{font-size:20px;margin:0}h2{font-size:13px;margin:24px 0 8px;text-transform:uppercase;letter-spacing:.06em;color:#444;border-bottom:1px solid #ddd;padding-bottom:4px}
  .muted{color:#666}.grid{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px}
  .card{border:1px solid #ddd;border-radius:8px;padding:10px 14px;min-width:150px}
  .card b{display:block;font-size:15px;margin-top:2px;font-family:monospace}
  table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border-bottom:1px solid #eee;padding:6px 8px;text-align:left;font-size:11px}
  td.n,th.n{text-align:right;font-family:monospace}
  .rec{margin:6px 0;padding:8px 10px;border-left:3px solid #999;background:#fafafa}
  @media print{body{margin:12mm}}
</style></head><body>
<h1>Aceleriq · Resumo Financeiro</h1>
<p class="muted">${a.monthLabel} · gerado em ${new Date().toLocaleDateString("pt-BR")} às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · Assistente CFO do Aceleriq OS</p>
<h2>Divisão automática do mês</h2>
<div class="grid">
  <div class="card">Recebido bruto<b>${fmt(a.grossReceived)}</b></div>
  <div class="card">Reserva tributária<b>${fmt(a.taxReserve)}</b></div>
  <div class="card">Receita operacional<b>${fmt(a.operational)}</b></div>
  <div class="card">Custos fixos<b>${fmt(a.fixedCosts)}</b></div>
  <div class="card">Pró-labore proporcional<b>${fmt(a.proLaboreProp)}</b></div>
  <div class="card">Reserva clientes/invest.<b>${fmt(a.clientReserve)} / ${fmt(a.clientReserveTarget)}</b></div>
  <div class="card">Lucro do mês<b style="color:${a.profit >= 0 ? "#1b7f3b" : "#c62828"}">${fmt(a.profit)}</b></div>
  <div class="card">Projeção (ritmo até dia ${a.dayOfMonth})<b>${fmt(a.projectedOperational)}</b></div>
</div>
<h2>Carteira</h2>
<div class="grid">
  <div class="card">MRR contratado<b>${fmt(a.mrr)}</b></div>
  <div class="card">Clientes recorrentes ativos<b>${a.activeRecurring.length}</b></div>
  <div class="card">Atrasados<b style="color:${a.overdueTotal > 0 ? "#c62828" : "#1b7f3b"}">${fmt(a.overdueTotal)}</b></div>
  <div class="card">Sem plano definido<b>${a.noPlan.length}</b></div>
  <div class="card">Meta mensal<b>${a.monthlyGoal ? fmt(a.monthlyGoal) : "não definida"}</b></div>
  <div class="card">Saldo em caixa<b>${fmt(a.cashBalance)}</b></div>
  <div class="card">Caixinhas guardadas<b>${fmt(boxesTotal(financeBoxes))}</b></div>
  <div class="card">Disponível livre<b>${fmt(a.cashBalance - boxesTotal(financeBoxes))}</b></div>
</div>
<h2>Clientes recorrentes</h2>
<table><tr><th>Cliente</th><th>Plano</th><th class="n">Valor/mês</th><th class="n">Renovação</th></tr>
${a.activeRecurring.map((c: any) => `<tr><td>${(c.company_name || c.full_name || "-").replace(/</g, "&lt;")}</td><td>${(c.plan_name || "—").replace(/</g, "&lt;")}</td><td class="n">${fmt(Number(c.plan_value))}</td><td class="n">${c.plan_renewal_date ? (parseDate(c.plan_renewal_date)?.toLocaleDateString("pt-BR") || "—") : "—"}</td></tr>`).join("")}
</table>
<h2>Recomendações do assistente</h2>
${recommendations.map((r) => `<div class="rec" style="border-left-color:${sevColor[r.severity]}"><b style="color:${sevColor[r.severity]};font-size:10px">${sevLabel[r.severity]}</b><br><b>${r.title.replace(/</g, "&lt;")}</b><br><span class="muted">${r.detail.replace(/</g, "&lt;")}</span></div>`).join("")}
<p class="muted" style="margin-top:20px">Valores calculados sobre os lançamentos do painel. Alíquotas e tributos devem ser confirmados pelo contador (CNAE, RBT12, Fator R). Este resumo não substitui a apuração contábil.</p>
</body></html>`;
    const win = window.open("", "_blank");
    if (!win) { toast.error("Habilite pop-ups para gerar o PDF"); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
    toast.success('Na janela de impressão, escolha "Salvar como PDF".');
  };

  const sevStyle: Record<Severity, { badge: string; label: string; icon: any }> = {
    critical: { badge: "bg-destructive/15 text-destructive", label: "Agir agora", icon: AlertTriangle },
    attention: { badge: "bg-warning/15 text-warning", label: "Atenção", icon: Lightbulb },
    good: { badge: "bg-success/15 text-success", label: "No caminho", icon: CheckCircle2 },
  };

  const selectedType = RESPONSE_TYPES.find((t) => t.value === responseType);
  const clientOptions = responseType === "cobranca"
    ? (clients || []).filter((c: any) => analysis.overdue.some((b: any) => b.client_id === c.id) || (billing || []).some((b: any) => b.client_id === c.id && b.status === "pending"))
    : responseType === "reajuste"
      ? analysis.belowTable.map((r: any) => r.client)
      : clients || [];

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="bg-card border border-primary/25 rounded-xl p-5">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0">
            <Brain className="w-5 h-5" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">Assistente CFO · {analysis.monthLabel}</p>
            <p className="text-[11px] text-muted-foreground">
              Analisa a movimentação real do painel (financeiro, clientes e projetos) e recomenda o próximo passo para evoluir o resultado.
            </p>
          </div>
          <button
            onClick={downloadPdf}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium bg-primary text-primary-foreground hover:opacity-90 cursor-pointer border-none"
          >
            <FileDown className="w-3.5 h-3.5" /> Resumo do mês (PDF)
          </button>
        </div>

        {/* Diagnóstico em uma linha */}
        <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Operacional no mês", value: fmt(analysis.operational), color: "text-foreground" },
            { label: "Projeção (ritmo)", value: fmt(analysis.projectedOperational), color: "text-info" },
            { label: "Lucro do mês", value: fmt(analysis.profit), color: analysis.profit >= 0 ? "text-success" : "text-destructive" },
            { label: "Atrasados", value: fmt(analysis.overdueTotal), color: analysis.overdueTotal > 0 ? "text-destructive" : "text-success" },
          ].map((s) => (
            <div key={s.label} className="bg-secondary/30 border border-border rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <p className={`text-base font-mono font-semibold mt-1 ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Meta sugerida */}
      <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3 flex-wrap">
        <Target className="w-4 h-4 text-primary shrink-0" />
        <div className="flex-1 min-w-[200px]">
          <p className="text-[12px] text-foreground font-medium">
            Meta sugerida pelo assistente: {fmt(analysis.suggestedGoal)}/mês
            {analysis.monthlyGoal ? <span className="text-muted-foreground font-normal"> · atual: {fmt(analysis.monthlyGoal)}</span> : <span className="text-warning font-normal"> · nenhuma meta definida</span>}
          </p>
          <p className="text-[10px] text-muted-foreground">
            Cálculo: (custos fixos {fmt(analysis.fixedCosts)} + pró-labore {fmt(analysis.proLaboreOfficial)} + reserva de clientes {fmt(analysis.clientReserveTarget)}) × 1,4 de folga, arredondado — estrutura coberta com 40% de margem.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            value={goalDraft}
            onChange={(e) => setGoalDraft(e.target.value)}
            placeholder={String(analysis.suggestedGoal)}
            className="w-28 h-9"
          />
          <button
            onClick={applySuggestedGoal}
            disabled={updateSettings.isPending}
            className="text-[12px] px-3 py-2 rounded-lg bg-success/15 text-success hover:bg-success/25 cursor-pointer border-none disabled:opacity-50 whitespace-nowrap"
          >
            Definir meta
          </button>
        </div>
      </div>

      {/* Recomendações */}
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5 text-primary" /> Recomendações de hoje ({recommendations.length})
        </p>
        {recommendations.map((r, i) => {
          const s = sevStyle[r.severity];
          return (
            <div key={i} className="bg-card border border-border rounded-xl p-4 flex gap-3">
              <s.icon className={`w-4 h-4 shrink-0 mt-0.5 ${r.severity === "critical" ? "text-destructive" : r.severity === "attention" ? "text-warning" : "text-success"}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[13px] font-medium text-foreground">{r.title}</p>
                  <span className={`text-[9px] px-2 py-0.5 rounded-full ${s.badge}`}>{s.label}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">{r.detail}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Respostas prontas */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-2">
          <MessageSquare className="w-3.5 h-3.5 text-info" /> Respostas prontas · selecione e o assistente monta o texto
        </p>
        <div className="flex gap-1.5 flex-wrap">
          {RESPONSE_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => { setResponseType(t.value); setResponseText(buildResponse(t.value, responseClientId)); }}
              className={`text-[11px] px-3 py-1.5 rounded-full border cursor-pointer transition-colors ${
                responseType === t.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-transparent border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {selectedType?.needsClient !== false && responseType !== "resumo" && responseType !== "contador" && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Cliente</label>
            <select
              value={responseClientId}
              onChange={(e) => { setResponseClientId(e.target.value); setResponseText(buildResponse(responseType, e.target.value)); }}
              className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground"
            >
              <option value="">Selecionar…</option>
              {clientOptions.map((c: any) => (
                <option key={c.id} value={c.id}>{c.company_name || c.full_name}</option>
              ))}
            </select>
          </div>
        )}
        <textarea
          value={responseText}
          onChange={(e) => setResponseText(e.target.value)}
          rows={9}
          placeholder="Escolha um tipo de resposta acima — o texto vem pronto e você ajusta o que quiser."
          className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-[13px] text-foreground resize-y leading-relaxed"
        />
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => generateResponse()}
            className="text-[12px] px-3 py-2 rounded-lg bg-secondary text-muted-foreground hover:text-foreground border border-border cursor-pointer"
          >
            Gerar novamente
          </button>
          <button
            onClick={copyResponse}
            disabled={!responseText}
            className="inline-flex items-center gap-1.5 text-[12px] px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 cursor-pointer border-none disabled:opacity-50"
          >
            <Copy className="w-3.5 h-3.5" /> Copiar
          </button>
          {whatsappHref() && (
            <a
              href={whatsappHref()!}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[12px] px-3 py-2 rounded-lg bg-success/15 text-success hover:bg-success/25 no-underline"
            >
              Enviar no WhatsApp
            </a>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
          <Landmark className="w-3 h-3 shrink-0" />
          O texto do contador traz os números reais do mês, mas alíquotas, guias e obrigações são sempre validadas por ele — o assistente organiza, o contador confirma.
        </p>
      </div>
    </div>
  );
}
