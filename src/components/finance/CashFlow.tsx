import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Cell, PieChart, Pie,
} from "recharts";
import {
  Plus, Wallet, Download, Edit3, Trash2, ArrowUpRight, ArrowDownRight,
  Briefcase, PiggyBank, ChevronDown, ListFilter,
} from "lucide-react";
import {
  AjudaRecolhida, BarraDeAcoes, CampoDeFormulario, Carregando, EstadoDeErro, EstadoVazio, GrupoDeCampos, Painel,
  RegiaoRolavel, Secao, SeletorCompacto, botao, campo, campoTexto, foco, juntar, superficie, texto, useEstadoDaTela,
} from "@/components/sistema";
import {
  AcoesDoDialogo, Etiqueta, GradeDeKpis, Kpi, botaoDeLinha, corDoTom, type Tom,
} from "@/components/finance/pecasDoFinanceiro";
import NewIncomeModal from "./NewIncomeModal";
// Frente CFO (30/09): a trava do limite do mês nas despesas novas.
import { useTravaDeGasto } from "@/components/cfo/TravaDeGasto";
import { useFinanceSettings, useFinanceMutations } from "@/hooks/useFinanceV2";
import { useFinanceBoxes, boxesTotal, EMPTY_BOXES, type FinanceBoxes } from "@/hooks/useFinanceBoxes";
import { DEFAULT_TAX_RATE, interpolateProLabore, nextProLaboreTier } from "@/lib/directorPlan";
import { proximoVencimento } from "@/lib/tributos";

const fmt = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
const fmtCompact = (v: number) => {
  if (Math.abs(v) >= 1000) return `R$ ${(v / 1000).toFixed(1)}k`;
  return fmt(v);
};
const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

// Valor efetivamente recebido de uma fatura/parcela, respeitando pagamentos parciais.
const receivedAmountOf = (row: any): number => {
  const total = Number(row?.amount) || 0;
  const paid = Number(row?.paid_amount) || 0;
  if (row?.status === "partial") return Math.min(paid, total);
  if (row?.status === "paid") return paid > 0 && paid < total ? paid : total;
  return 0;
};

const INVESTOR_LEGACY = "investidor";
const INV_PREFIX = "inv_";

const EXPENSE_CATEGORIES = [
  { value: "salarios", label: "Salários & Pró-labore", color: "#a78bfa" },
  { value: "ferramentas", label: "Ferramentas / SaaS", color: "#60a5fa" },
  { value: "marketing", label: "Marketing & Ads próprios", color: "#f472b6" },
  { value: "impostos", label: "Impostos & Taxas", color: "#fb7185" },
  { value: "fornecedores", label: "Fornecedores", color: "#fbbf24" },
  { value: "infraestrutura", label: "Infraestrutura / Hosting", color: "#34d399" },
  { value: "comissoes", label: "Comissões", color: "#22d3ee" },
  { value: "outros", label: "Outros", color: "#94a3b8" },
];

const INVESTMENT_CATEGORIES = [
  { value: "inv_trafego", label: "Tráfego pago", color: "#00FF66" },
  { value: "inv_ferramentas", label: "Ferramentas", color: "#34d399" },
  { value: "inv_insumos", label: "Insumos", color: "#22d3ee" },
  { value: "inv_escritorio", label: "Escritório", color: "#60a5fa" },
  { value: "inv_outros", label: "Outros investimentos", color: "#a78bfa" },
];

// união (inclui legado "investidor")
const CATEGORIES = [
  ...EXPENSE_CATEGORIES,
  ...INVESTMENT_CATEGORIES,
  { value: INVESTOR_LEGACY, label: "Investidor (legado)", color: "#00FF66" },
];
const catMeta = (v: string) => CATEGORIES.find(c => c.value === v) || EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1];
const isInvestor = (e: any) => {
  const c = e?.category || "";
  return c === INVESTOR_LEGACY || c.startsWith(INV_PREFIX);
};

const parseDate = (v?: string | null) => {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split("-").map(Number);
    return new Date(y, m - 1, d, 12);
  }
  return new Date(v);
};
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_LABELS[m - 1]}/${String(y).slice(2)}`;
};

const PERIODOS = [6, 12, 24] as const;
const SEGMENTOS = [
  { valor: "all", rotulo: "Tudo" },
  { valor: "recurring", rotulo: "Recorrente" },
  { valor: "one_off", rotulo: "Avulso" },
];
type AbaDasSaidas = "ap" | "exp" | "done" | "pro" | "inv";
const ABAS_DAS_SAIDAS: AbaDasSaidas[] = ["ap", "exp", "done", "pro", "inv"];
const ehBooleano = (v: unknown) => typeof v === "boolean";

interface Props {
  billing: any[];
  projectPayments: any[];
  /** Sugestão para a caixinha de custos de clientes (nº de clientes × custo direto). */
  clientsReserveSuggestion?: number;
}

export default function CashFlow({ billing = [], projectPayments = [], clientsReserveSuggestion = 0 }: Props) {
  const qc = useQueryClient();
  const { pedirLiberacao, janela: janelaDaTrava } = useTravaDeGasto("caixa");
  // Período, segmento, blocos abertos e a lista escolhida em cada bloco
  // ficam lembrados (sair e voltar mantém).
  const [period, setPeriod] = useEstadoDaTela<6 | 12 | 24>("financeiro:fluxo:periodo", 12, {
    validar: (v) => v === 6 || v === 12 || v === 24,
  });
  const [expenseModal, setExpenseModal] = useState<{ mode: "expense" | "investment"; data: any } | null>(null);
  const [incomeModalOpen, setIncomeModalOpen] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [segment, setSegment] = useEstadoDaTela<"all" | "recurring" | "one_off">("financeiro:fluxo:segmento", "all", {
    validar: (v) => v === "all" || v === "recurring" || v === "one_off",
  });
  const [abaEntradas, setAbaEntradas] = useEstadoDaTela<"ar" | "received">("financeiro:fluxo:entradas:aba", "ar", {
    validar: (v) => v === "ar" || v === "received",
  });
  const [abaSaidas, setAbaSaidas] = useEstadoDaTela<AbaDasSaidas>("financeiro:fluxo:saidas:aba", "ap", {
    validar: (v) => ABAS_DAS_SAIDAS.indexOf(v as AbaDasSaidas) >= 0,
  });

  // Filter sources by segment
  // Regra: o segmento decide pelo TIPO DO CLIENTE (não pela natureza do registro).
  // - Recorrente: billing de clientes recurring/hybrid.
  // - Avulso: billing E project_payments de clientes one_off/hybrid (inclui entradas avulsas
  //   lançadas via "Nova entrada" para clientes pontuais, ex.: Armazén do Itamar).
  const billingFiltered = useMemo(() => {
    if (segment === "all") return billing || [];
    return (billing || []).filter((b: any) => {
      const ct = b.client?.client_type || "recurring";
      if (segment === "recurring") return ct === "recurring" || ct === "hybrid";
      // avulso
      return ct === "one_off" || ct === "hybrid";
    });
  }, [billing, segment]);

  const paymentsFiltered = useMemo(() => {
    if (segment === "all") return projectPayments || [];
    if (segment === "recurring") return []; // project_payments são sempre avulsos
    // avulso: todos
    return projectPayments || [];
  }, [projectPayments, segment]);

  const { data: allExpenses = [], isLoading: carregandoDespesas, error: erroDasDespesas, refetch: refetchDespesas } = useQuery({
    queryKey: ["expenses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("expenses").select("*").order("due_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Separar despesas operacionais de aportes de investidor (capital, não despesa)
  const expenses = useMemo(() => (allExpenses || []).filter((e: any) => !isInvestor(e)), [allExpenses]);
  const investorEntries = useMemo(() => (allExpenses || []).filter(isInvestor), [allExpenses]);

  // ───────── Saldo em caixa real ─────────
  // saldo = base de meses anteriores (conciliada) + tudo que entrou − tudo que saiu.
  // A base anterior absorve custos antigos não lançados, sem reescrever o histórico.
  const { data: financeSettings } = useFinanceSettings();
  const { updateSettings } = useFinanceMutations();
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileInput, setReconcileInput] = useState("");
  const [inflowsOpen, setInflowsOpen] = useEstadoDaTela("financeiro:fluxo:entradas:aberto", true, { validar: ehBooleano });
  const [outflowsOpen, setOutflowsOpen] = useEstadoDaTela("financeiro:fluxo:saidas:aberto", true, { validar: ehBooleano });

  const openingBalance = financeSettings?.openingBalance ?? 0;
  const allTimeReceived = useMemo(() => {
    const bills = (billing || [])
      .filter((b: any) => b.type !== "ads_recharge" && (b.status === "paid" || b.status === "partial"))
      .reduce((s: number, b: any) => s + receivedAmountOf(b), 0);
    const inst = (projectPayments || []).reduce(
      (s: number, pp: any) =>
        s +
        (pp.installments || [])
          .filter((i: any) => i.status === "paid" || i.status === "partial")
          .reduce((x: number, i: any) => x + receivedAmountOf(i), 0),
      0
    );
    return bills + inst;
  }, [billing, projectPayments]);
  const allTimePaidOut = useMemo(
    () => (expenses || []).filter((e: any) => e.status === "paid").reduce((s: number, e: any) => s + Number(e.amount || 0), 0),
    [expenses]
  );
  const cashBalance = openingBalance + allTimeReceived - allTimePaidOut;

  // ───────── Caixinhas de reserva ─────────
  const { data: boxes = EMPTY_BOXES, save: saveBoxes } = useFinanceBoxes();
  const [editingBox, setEditingBox] = useState<{ key: keyof FinanceBoxes; value: string } | null>(null);
  const reservedTotal = boxesTotal(boxes);
  const freeBalance = cashBalance - reservedTotal;

  const monthReceivedGross = useMemo(() => {
    const now = new Date();
    const inMonth = (v?: string | null) => {
      const d = parseDate(v);
      return !!d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    };
    const bills = (billing || [])
      .filter((b: any) => b.type !== "ads_recharge" && (b.status === "paid" || b.status === "partial") && inMonth(b.paid_date || b.due_date))
      .reduce((s: number, b: any) => s + receivedAmountOf(b), 0);
    const inst = (projectPayments || []).reduce(
      (s: number, pp: any) =>
        s +
        (pp.installments || [])
          .filter((i: any) => (i.status === "paid" || i.status === "partial") && inMonth(i.paid_date || i.due_date))
          .reduce((x: number, i: any) => x + receivedAmountOf(i), 0),
      0
    );
    return bills + inst;
  }, [billing, projectPayments]);

  const BOX_DEFS: { key: keyof FinanceBoxes; label: string; hint: string; suggestion: number; suggestionLabel: string }[] = [
    {
      key: "tax",
      label: "Reserva tributária",
      hint: "Imposto separado no gross-up · não é dinheiro da operação",
      suggestion: Math.round(monthReceivedGross * DEFAULT_TAX_RATE * 100) / 100,
      suggestionLabel: "estimativa do mês",
    },
    {
      key: "clients",
      label: "Custos de clientes / investimento",
      hint: "Colchão para colocar no cliente quando precisar",
      suggestion: clientsReserveSuggestion,
      suggestionLabel: "alvo (clientes × custo direto)",
    },
    {
      key: "safety",
      label: "Reserva segura da agência",
      hint: "Colchão de emergência da operação",
      suggestion: financeSettings?.reserveTarget || 6300,
      suggestionLabel: "Plano Diretor: R$ 6.300 iniciais",
    },
  ];

  const saveBox = async (key: keyof FinanceBoxes, rawValue: string) => {
    const value = parseFloat(rawValue.replace(",", "."));
    if (!Number.isFinite(value) || value < 0) { toast.error("Informe um valor válido"); return; }
    try {
      await saveBoxes.mutateAsync({ ...boxes, [key]: Math.round(value * 100) / 100 });
      toast.success("Caixinha atualizada");
      setEditingBox(null);
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar caixinha");
    }
  };

  const reconcileBalance = async () => {
    if (!financeSettings) { toast.error("Configurações financeiras indisponíveis"); return; }
    const real = parseFloat(reconcileInput.replace(",", "."));
    if (!Number.isFinite(real)) { toast.error("Informe o saldo real da conta"); return; }
    const newOpening = real - (allTimeReceived - allTimePaidOut);
    try {
      await updateSettings.mutateAsync({
        currency: financeSettings.currency,
        openingBalance: newOpening,
        reserveTarget: financeSettings.reserveTarget,
        defaultDueDay: financeSettings.defaultDueDay,
        forecastMonths: financeSettings.forecastMonths,
        monthlyGoal: financeSettings.monthlyGoal,
        growthRetentionRate: financeSettings.growthRetentionRate,
        minimumReserveMonths: financeSettings.minimumReserveMonths,
        desiredMinimumMargin: financeSettings.desiredMinimumMargin,
        currentProLabore: financeSettings.currentProLabore,
        targetProLabore: financeSettings.targetProLabore,
        defaultDirectCost: financeSettings.defaultDirectCost,
        allocationMethod: financeSettings.allocationMethod,
        includeProLaboreInAllocation: financeSettings.includeProLaboreInAllocation,
      });
      toast.success(`Saldo conciliado: ${fmt(real)} em caixa`);
      setReconcileOpen(false);
      setReconcileInput("");
    } catch (err: any) {
      toast.error(err.message || "Erro ao conciliar saldo");
    }
  };

  // ───────── Build cash flow series ─────────
  const series = useMemo(() => {
    const now = new Date();
    const back = Math.floor(period / 2);
    const fwd = period - back;
    const map: Record<string, { key: string; label: string; receitas: number; despesas: number; pendReceita: number; pendDespesa: number }> = {};
    for (let i = -back; i < fwd; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const k = monthKey(d);
      map[k] = { key: k, label: monthLabel(k), receitas: 0, despesas: 0, pendReceita: 0, pendDespesa: 0 };
    }

    // Receitas (billing)
    (billingFiltered || []).forEach((b: any) => {
      const paidAt = parseDate(b.paid_date);
      const due = parseDate(b.due_date);
      const amount = Number(b.amount) || 0;
      const paidAmount = Number(b.paid_amount) || 0;
      if (b.status === "paid" && paidAt) {
        const k = monthKey(paidAt);
        if (map[k]) map[k].receitas += amount;
      } else if (b.status === "partial" && paidAt) {
        const k = monthKey(paidAt);
        if (map[k]) map[k].receitas += paidAmount;
        // Saldo restante já é representado por um novo billing pendente.
      } else if (due) {
        const k = monthKey(due);
        if (map[k]) map[k].pendReceita += amount;
      }
    });

    // Receitas (project installments)
    (paymentsFiltered || []).forEach((p: any) => {
      (p.installments || []).forEach((i: any) => {
        const paidAt = parseDate(i.paid_date);
        const due = parseDate(i.due_date);
        const amount = Number(i.amount) || 0;
        if (i.status === "paid" && paidAt) {
          const k = monthKey(paidAt);
          if (map[k]) map[k].receitas += amount;
        } else if (i.status === "partial" && paidAt) {
          const k = monthKey(paidAt);
          if (map[k]) map[k].receitas += Number(i.paid_amount) || 0;
        } else if (due) {
          const k = monthKey(due);
          if (map[k]) map[k].pendReceita += amount;
        }
      });
    });

    // Despesas
    (expenses || []).forEach((e: any) => {
      const paidAt = parseDate(e.paid_date);
      const due = parseDate(e.due_date);
      const amount = Number(e.amount) || 0;
      if (e.status === "paid" && paidAt) {
        const k = monthKey(paidAt);
        if (map[k]) map[k].despesas += amount;
      } else if (due) {
        const k = monthKey(due);
        if (map[k]) map[k].pendDespesa += amount;
      }
    });

    // Projeção: recorrências mensais futuras (expenses recurrence=monthly) que tenham primeira ocorrência <= mês alvo
    const monthlyRecurring = (expenses || []).filter((e: any) => e.recurrence === "monthly");
    const yearlyRecurring = (expenses || []).filter((e: any) => e.recurrence === "yearly");
    Object.values(map).forEach((row: any) => {
      const [y, m] = row.key.split("-").map(Number);
      const isFuture = new Date(y, m - 1, 1) > new Date(now.getFullYear(), now.getMonth(), 1);
      if (!isFuture) return;
      monthlyRecurring.forEach((e: any) => {
        const due = parseDate(e.due_date);
        if (!due) return;
        if (new Date(y, m - 1, 1) > new Date(due.getFullYear(), due.getMonth(), 1)) {
          row.pendDespesa += Number(e.amount) || 0;
        }
      });
      yearlyRecurring.forEach((e: any) => {
        const due = parseDate(e.due_date);
        if (!due) return;
        if (due.getMonth() === m - 1 && y > due.getFullYear()) {
          row.pendDespesa += Number(e.amount) || 0;
        }
      });
    });

    // Saldo acumulado
    let acc = 0;
    const rows = Object.values(map).map((r: any) => {
      const net = (r.receitas + r.pendReceita) - (r.despesas + r.pendDespesa);
      acc += net;
      return { ...r, net, acumulado: acc };
    });
    return rows;
  }, [billingFiltered, paymentsFiltered, expenses, period]);

  // KPIs (current month)
  const currentKey = monthKey(new Date());
  const cur = series.find(s => s.key === currentKey) || { receitas: 0, despesas: 0, pendReceita: 0, pendDespesa: 0, net: 0 };
  const nextMonth = series[series.findIndex(s => s.key === currentKey) + 1];
  const totalReceitas12 = series.reduce((a, s) => a + s.receitas + s.pendReceita, 0);
  const totalDespesas12 = series.reduce((a, s) => a + s.despesas + s.pendDespesa, 0);
  const lucroProj = totalReceitas12 - totalDespesas12;
  const margem = totalReceitas12 > 0 ? (lucroProj / totalReceitas12) * 100 : 0;

  // DRE (last 6 months)
  const dre = useMemo(() => {
    return series.map(s => ({
      label: s.label,
      receita: s.receitas + s.pendReceita,
      despesa: s.despesas + s.pendDespesa,
      lucro: (s.receitas + s.pendReceita) - (s.despesas + s.pendDespesa),
      margem: (s.receitas + s.pendReceita) > 0
        ? (((s.receitas + s.pendReceita) - (s.despesas + s.pendDespesa)) / (s.receitas + s.pendReceita)) * 100
        : 0,
    }));
  }, [series]);

  // Distribuição despesas por categoria
  const byCat = useMemo(() => {
    const map: Record<string, number> = {};
    (expenses || []).forEach((e: any) => {
      map[e.category] = (map[e.category] || 0) + (Number(e.amount) || 0);
    });
    return Object.entries(map)
      .map(([k, v]) => ({ name: catMeta(k).label, value: v, color: catMeta(k).color, cat: k }))
      .sort((a, b) => b.value - a.value);
  }, [expenses]);

  // ───────── Investidor (capital, não despesa) ─────────
  const investor = useMemo(() => {
    const curKey = monthKey(new Date());
    let total = 0;
    let currentMonth = 0;
    let firstDate: Date | null = null;
    const byInvestor: Record<string, number> = {};
    const monthly: Record<string, number> = {};
    (investorEntries || []).forEach((e: any) => {
      const v = Number(e.amount) || 0;
      total += v;
      const d = parseDate(e.paid_date || e.due_date);
      if (d) {
        const k = monthKey(d);
        monthly[k] = (monthly[k] || 0) + v;
        if (k === curKey) currentMonth += v;
        if (!firstDate || d < firstDate) firstDate = d;
      }
      const name = e.supplier || "Investidor";
      byInvestor[name] = (byInvestor[name] || 0) + v;
    });
    const contributors = Object.entries(byInvestor)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    return { total, currentMonth, contributors, monthly, firstDate };
  }, [investorEntries]);

  // ROI: conta a partir da DATA exata do primeiro aporte (não do mês inteiro)
  const periodNet = useMemo(() => {
    if (!investor.firstDate) return 0;
    const since = new Date(investor.firstDate);
    since.setHours(0, 0, 0, 0);

    let receitas = 0;
    let despesas = 0;

    (billingFiltered || []).forEach((b: any) => {
      const paidAt = parseDate(b.paid_date);
      if (!paidAt || paidAt < since) return;
      if (b.status === "paid") receitas += Number(b.amount) || 0;
      else if (b.status === "partial") receitas += Number(b.paid_amount) || 0;
    });

    (paymentsFiltered || []).forEach((p: any) => {
      (p.installments || []).forEach((i: any) => {
        const paidAt = parseDate(i.paid_date);
        if (!paidAt || paidAt < since) return;
        if (i.status === "paid") receitas += Number(i.amount) || 0;
        else if (i.status === "partial") receitas += Number(i.paid_amount) || 0;
      });
    });

    (expenses || []).forEach((e: any) => {
      const paidAt = parseDate(e.paid_date);
      if (!paidAt || paidAt < since) return;
      if (e.status === "paid") despesas += Number(e.amount) || 0;
    });

    return receitas - despesas;
  }, [billingFiltered, paymentsFiltered, expenses, investor.firstDate]);

  const daysSinceInvest = useMemo(() => {
    if (!investor.firstDate) return 0;
    const since = new Date(investor.firstDate);
    since.setHours(0, 0, 0, 0);
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.max(1, Math.ceil((now.getTime() - since.getTime()) / 86400000) + 1);
  }, [investor.firstDate]);

  const roiPct = investor.total > 0 ? (periodNet / investor.total) * 100 : 0;



  // Contas a pagar e receber
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const accountsPayable = useMemo(() => {
    return (expenses || [])
      .filter((e: any) => e.status !== "paid")
      .map((e: any) => {
        const due = parseDate(e.due_date)!;
        const overdue = due < today;
        return { ...e, overdue, daysUntil: Math.ceil((due.getTime() - today.getTime()) / 86400000) };
      })
      .sort((a: any, b: any) => (parseDate(a.due_date)!.getTime()) - (parseDate(b.due_date)!.getTime()));
  }, [expenses]);

  /**
   * As saídas JÁ REALIZADAS — o espelho de "Recebidas".
   *
   * A tela tinha "A pagar" e "Todas as despesas", e nenhuma respondia
   * "quanto saiu de verdade": a lista de todas mistura pago com previsto,
   * e o previsto é justamente o que ainda não aconteceu.
   */
  const paidOutList = useMemo(() => {
    return (expenses || [])
      .filter((e: any) => e.status === "paid" && e.paid_date)
      .sort((a: any, b: any) => String(b.paid_date).localeCompare(String(a.paid_date)));
  }, [expenses]);

  const paidOutThisMonth = useMemo(() => {
    const k = monthKey(new Date());
    return paidOutList
      .filter((e: any) => String(e.paid_date).slice(0, 7) === k)
      .reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);
  }, [paidOutList]);

  /**
   * O pró-labore, já configurado pelo proporcional ao faturamento.
   *
   * A escada do Plano Diretor lê a receita OPERACIONAL — o bruto menos o
   * imposto. Usar o bruto inflaria a retirada em toda a faixa, porque a
   * parte do governo nunca foi receita da agência.
   */
  const proLaboreView = useMemo(() => {
    const operacional = monthReceivedGross * (1 - DEFAULT_TAX_RATE);
    const proporcional = interpolateProLabore(operacional);
    const atual = financeSettings?.currentProLabore ?? 0;
    const pagos = (expenses || [])
      .filter((e: any) => /pr[oó][\s_-]?labore/i.test(`${e.description || ""} ${e.notes || ""}`))
      .sort((a: any, b: any) => String(b.paid_date || b.due_date || "").localeCompare(String(a.paid_date || a.due_date || "")));
    const molde = pagos.find((e: any) => e.recurrence === "monthly");
    return {
      operacional,
      proporcional,
      atual,
      proximoDegrau: nextProLaboreTier(operacional),
      linhas: pagos,
      molde,
      realizadoNoAno: pagos
        .filter((e: any) => e.status === "paid" && String(e.paid_date || "").slice(0, 4) === String(new Date().getFullYear()))
        .reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0),
    };
  }, [expenses, monthReceivedGross, financeSettings]);

  /**
   * Lança o pró-labore do mês no valor proporcional — olhando o que já existe.
   *
   * "Já soma com base no que já está": se houver um pró-labore recorrente,
   * criar outro daria DOIS pró-labores somando no fluxo, e o dono só
   * descobriria no fechamento. Então quando já existe, esta ação AJUSTA o
   * valor em vez de criar; quando não existe, cria.
   */
  const lancarProLaboreProporcional = async () => {
    const valor = Math.round(proLaboreView.proporcional * 100) / 100;
    if (valor <= 0) {
      toast.error("Sem receita operacional no mês para calcular o proporcional");
      return;
    }

    const molde = proLaboreView.molde;
    if (molde) {
      const atual = Number(molde.amount) || 0;
      if (Math.abs(atual - valor) < 0.01) {
        toast.info(`O pró-labore já está em ${fmt(valor)}, que é o proporcional de hoje.`);
        return;
      }
      const { error } = await supabase.from("expenses")
        .update({
          amount: valor,
          notes: `Ajustado ao proporcional da receita operacional de ${fmt(proLaboreView.operacional)}`,
        })
        .eq("id", molde.id);
      if (error) return toast.error(error.message);
      toast.success(
        `Pró-labore ajustado de ${fmt(atual)} para ${fmt(valor)}, sem criar uma segunda retirada.`,
      );
      qc.invalidateQueries({ queryKey: ["expenses"] });
      return;
    }

    const hoje = new Date();
    const venc = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-10`;
    const { error } = await supabase.from("expenses").insert({
      description: "Pró-labore Almir",
      category: "salarios",
      amount: valor,
      due_date: venc,
      status: "pending",
      recurrence: "monthly",
      notes: `Proporcional à receita operacional de ${fmt(proLaboreView.operacional)}`,
    });
    if (error) return toast.error(error.message);
    toast.success(`Pró-labore de ${fmt(valor)} lançado com vencimento em ${new Date(`${venc}T12:00:00`).toLocaleDateString("pt-BR")}`);
    qc.invalidateQueries({ queryKey: ["expenses"] });
  };

  const accountsReceivable = useMemo(() => {
    const out: any[] = [];
    (billingFiltered || []).filter((b: any) => b.status === "pending").forEach((b: any) => {
      const due = parseDate(b.due_date);
      if (!due) return;
      out.push({
        id: b.id, source: "billing", description: b.description || b.type, amount: Number(b.amount) || 0,
        due_date: b.due_date, overdue: due < today, daysUntil: Math.ceil((due.getTime() - today.getTime()) / 86400000),
        client: b.client?.full_name || b.client?.company_name || "-",
      });
    });
    (paymentsFiltered || []).forEach((p: any) => {
      (p.installments || []).filter((i: any) => i.status === "pending" || i.status === "partial").forEach((i: any) => {
        const due = parseDate(i.due_date);
        if (!due) return;
        out.push({
          id: i.id, source: "installment", description: `${p.project?.name || "Projeto"} · Parcela`,
          amount: Math.max((Number(i.amount) || 0) - (Number(i.paid_amount) || 0), 0), due_date: i.due_date, overdue: due < today,
          daysUntil: Math.ceil((due.getTime() - today.getTime()) / 86400000),
          client: p.client?.full_name || p.client?.company_name || "-",
        });
      });
    });
    return out.sort((a, b) => parseDate(a.due_date)!.getTime() - parseDate(b.due_date)!.getTime());
  }, [billingFiltered, paymentsFiltered]);

  // Entradas já realizadas (mensalidades e parcelas pagas), mais recentes primeiro.
  const receivedList = useMemo(() => {
    const out: any[] = [];
    (billingFiltered || [])
      .filter((b: any) => b.type !== "ads_recharge" && (b.status === "paid" || b.status === "partial"))
      .forEach((b: any) => {
        out.push({
          id: `b-${b.id}`,
          description: b.description || (b.type === "renewal" ? "Renovação Mensal" : "Serviço"),
          client: b.client?.company_name || b.client?.full_name || "-",
          amount: receivedAmountOf(b),
          total: Number(b.amount) || 0,
          date: b.paid_date || b.due_date,
          partial: b.status === "partial",
        });
      });
    (paymentsFiltered || []).forEach((p: any) => {
      (p.installments || [])
        .filter((i: any) => i.status === "paid" || i.status === "partial")
        .forEach((i: any) => {
          out.push({
            id: `i-${i.id}`,
            description: `${p.project?.name || "Projeto"} · ${i.installment_number === 0 ? "Entrada" : `Parcela ${i.installment_number}`}`,
            client: p.client?.company_name || p.client?.full_name || "-",
            amount: receivedAmountOf(i),
            total: Number(i.amount) || 0,
            date: i.paid_date || i.due_date,
            partial: i.status === "partial",
          });
        });
    });
    return out.sort((a, b) => (parseDate(b.date)?.getTime() || 0) - (parseDate(a.date)?.getTime() || 0));
  }, [billingFiltered, paymentsFiltered]);

  // ───────── Mutations ─────────
  const saveExpense = async (form: any, mode: "expense" | "investment") => {
    const defaultCat = mode === "investment" ? "inv_outros" : "outros";
    const payload = {
      description: form.description,
      category: form.category || defaultCat,
      amount: parseFloat(form.amount) || 0,
      due_date: form.due_date,
      paid_date: form.status === "paid" ? (form.paid_date || new Date().toISOString().slice(0, 10)) : null,
      status: form.status || "pending",
      recurrence: form.recurrence || "none",
      supplier: form.supplier || null,
      payment_method: form.payment_method || null,
      notes: form.notes || null,
    };
    if (!payload.description || !payload.due_date) {
      toast.error("Preencha descrição e vencimento");
      return;
    }
    const label = mode === "investment" ? "Investimento" : "Despesa";
    // Despesa nova passa pela trava do CFO (investimento com dinheiro do sócio fica fora).
    if (!form.id && mode === "expense") {
      const liberado = await pedirLiberacao({ valor: payload.amount, recorrente: payload.recurrence === "monthly", categoria: payload.category, descricao: payload.description });
      if (!liberado) {
        toast.info("Não lancei: ficou dentro do limite do CFO.");
        return;
      }
    }
    if (form.id) {
      const { error } = await supabase.from("expenses").update(payload).eq("id", form.id);
      if (error) return toast.error(error.message);
      toast.success(`${label} atualizado`);
    } else {
      const { error } = await supabase.from("expenses").insert(payload);
      if (error) return toast.error(error.message);
      toast.success(`${label} registrado`);
    }
    setExpenseModal(null);
    qc.invalidateQueries({ queryKey: ["expenses"] });
  };

  /**
   * Pagar e reabrir passam pelo MESMO caminho dos Custos Fixos.
   *
   * Antes esta tela virava o `status` da própria linha. Num custo
   * recorrente isso congela o MOLDE naquele mês: ele para de projetar os
   * meses seguintes e o custo fixo some da previsão sem ninguém notar — e
   * as duas telas passam a discordar sobre o mesmo custo.
   *
   * Agora o banco decide: pontual paga no lugar, recorrente gera a saída
   * real e rola o vencimento. Reabrir estorna, devolvendo o vencimento ao
   * mês pago em vez de deixar a saída solta.
   */
  const togglePaid = async (e: any) => {
    try {
      if (e.status === "paid") {
        const { data, error } = await (supabase as any).rpc("expense_estornar", { _pagamento_id: e.id });
        if (error) throw new Error(error.message);
        toast.success(data?.molde_devolvido
          ? "Estornado · o vencimento voltou para o mês pago"
          : "Reaberto");
      } else {
        const { data, error } = await (supabase as any).rpc("expense_pagar", {
          _expense_id: e.id,
          _pago_em: new Date().toISOString().slice(0, 10),
          _valor: null,
          _proximo_vencimento: null,
        });
        if (error) throw new Error(error.message);
        toast.success(data?.proximo_vencimento
          ? `Pago · próximo vencimento ${new Date(`${data.proximo_vencimento}T12:00:00`).toLocaleDateString("pt-BR")}`
          : "Marcado como pago");
      }
      qc.invalidateQueries({ queryKey: ["expenses"] });
    } catch (err: any) {
      toast.error(err.message || "Não consegui registrar");
    }
  };

  const deleteExpense = async (id: string) => {
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Despesa removida");
    setConfirmDel(null);
    qc.invalidateQueries({ queryKey: ["expenses"] });
  };

  const exportCSV = () => {
    const rows = [
      ["Mês", "Receitas Confirmadas", "Receitas Previstas", "Despesas Pagas", "Despesas Previstas", "Resultado", "Acumulado"],
      ...series.map(s => [s.label, s.receitas, s.pendReceita, s.despesas, s.pendDespesa, s.net, s.acumulado]),
    ];
    const csv = rows.map(r => r.join(";")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `fluxo-de-caixa-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const aReceber = accountsReceivable.reduce((s: number, r: any) => s + r.amount, 0);
  const aPagar = accountsPayable.reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  // Esqueleto só na primeira carga: depois, o dado velho fica na tela enquanto relê.
  const primeiraCarga = carregandoDespesas && (allExpenses || []).length === 0;

  const prazo = (overdue: boolean, daysUntil: number) =>
    overdue ? (
      <Etiqueta tom="perigo">{Math.abs(daysUntil)}d atrasado</Etiqueta>
    ) : daysUntil <= 7 ? (
      <Etiqueta tom="aviso">{daysUntil}d</Etiqueta>
    ) : (
      <Etiqueta tom="apagado">{daysUntil}d</Etiqueta>
    );

  const estadoDasSaidas = erroDasDespesas ? (
    <div className="p-4">
      <EstadoDeErro
        titulo="Não consegui ler as saídas."
        acao={<button type="button" onClick={() => refetchDespesas()} className={botao.secundario}>Tentar de novo</button>}
      />
    </div>
  ) : primeiraCarga ? (
    <Carregando linhas={4} rotulo="Carregando saídas" className="p-4" />
  ) : null;

  const acoesDaLinha = (e: any, modo: "expense" | "investment") => (
    <>
      <button type="button" onClick={() => setExpenseModal({ mode: modo, data: e })} className={juntar(botao.icone, "ml-1")} aria-label={`Editar ${e.description}`} title="Editar">
        <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <button type="button" onClick={() => setConfirmDel(e.id)} className={juntar(botao.icone, "hover:text-destructive")} aria-label={`Remover ${e.description}`} title="Remover">
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </>
  );

  const renderExpenseRow = (e: any) => {
    const cm = catMeta(e.category);
    return (
      <li key={e.id} className="flex min-w-0 flex-wrap items-center px-4 py-2.5 hover:bg-muted/40">
        <span className="mr-3 h-2 w-2 shrink-0 rounded-full" style={{ background: cm.color }} aria-hidden="true" />
        <div className="mr-3 min-w-0 flex-1 basis-48">
          <p className="truncate text-[13px] font-medium text-foreground">{e.description}</p>
          <p className={juntar(texto.auxiliar, "truncate")}>
            {cm.label} · {parseDate(e.due_date)?.toLocaleDateString("pt-BR")}
            {e.recurrence === "monthly" && " · Fixa mensal"}
            {e.recurrence === "yearly" && " · Fixa anual"}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center py-0.5">
          <Etiqueta tom={e.status === "paid" ? "sucesso" : "aviso"} className="mr-3">{e.status === "paid" ? "Pago" : "Pendente"}</Etiqueta>
          <span className="mr-2 text-[13px] font-semibold tabular-nums text-foreground">{fmt(Number(e.amount))}</span>
          <button type="button" onClick={() => togglePaid(e)} className={botaoDeLinha}>
            {e.status === "paid" ? "Reabrir" : "Pagar"}
          </button>
          {acoesDaLinha(e, "expense")}
        </div>
      </li>
    );
  };

  const opcoesDasSaidas = [
    { valor: "ap", rotulo: "A pagar", contador: accountsPayable.length },
    { valor: "exp", rotulo: "Todas as despesas", contador: expenses.length },
    { valor: "done", rotulo: "Realizadas", contador: paidOutList.length },
    { valor: "pro", rotulo: "Pró-labore" },
    { valor: "inv", rotulo: "Investimentos", contador: investorEntries.length },
  ];

  return (
    <div className="min-w-0 space-y-6">
      {janelaDaTrava}
      {/* Filtros e ações da aba: período e segmento (lembram ao voltar), CSV e Lançamento. */}
      <BarraDeAcoes
        inicio={
          <div className="-m-1 flex min-w-0 flex-wrap items-center [&>*]:m-1">
            <SeletorCompacto
              opcoes={PERIODOS.map((n) => ({ valor: String(n), rotulo: `${n}m` }))}
              valor={String(period)}
              onEscolher={(v) => setPeriod(Number(v) as 6 | 12 | 24)}
              rotulo="Período"
              modo="segmentado"
            />
            <SeletorCompacto
              opcoes={SEGMENTOS}
              valor={segment}
              onEscolher={(v) => setSegment(v as "all" | "recurring" | "one_off")}
              rotulo="Segmento"
              modo="segmentado"
            />
            <AjudaRecolhida rotulo="Sobre o período e o segmento">
              Período: meses mostrados no gráfico e no DRE (metade para trás, metade para frente). Recorrente: só mensalidades de clientes
              recorrentes e híbridos. Avulso: projetos pontuais e cobranças de clientes avulsos (ex.: Armazén do Itamar).
            </AjudaRecolhida>
          </div>
        }
      >
        <button type="button" onClick={exportCSV} className={botao.secundario} aria-label="Baixar CSV" title="Baixar CSV">
          <Download className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" />
          <span className="hidden sm:inline">CSV</span>
        </button>
        <button type="button" onClick={() => setLauncherOpen(true)} className={botao.primario}>
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Lançamento
        </button>
      </BarraDeAcoes>

      {/* CAIXA DA ACELERIQ */}
      <Secao
        titulo="Caixa"
        ajuda="Saldo real na conta: base anterior conciliada + entradas − saídas. Confira com o extrato e concilie quando não bater."
        acao={
          <button
            type="button"
            onClick={() => { setReconcileInput(""); setReconcileOpen(true); }}
            className={botao.secundario}
            aria-label="Conciliar saldo"
          >
            <Wallet className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Conciliar saldo</span>
          </button>
        }
      >
        <GradeDeKpis colunas={5}>
          <Kpi rotulo="Saldo em caixa hoje" valor={fmt(cashBalance)} apoio="Confira com o extrato" tom={cashBalance >= 0 ? "primario" : "perigo"} />
          <Kpi rotulo="Base de meses anteriores" valor={fmt(openingBalance)} apoio="Ajustada na conciliação" tom="aviso" />
          <Kpi rotulo="Entradas (histórico)" valor={fmt(allTimeReceived)} apoio="Tudo que já foi recebido" tom="sucesso" />
          <Kpi rotulo="Saídas do mês" valor={fmt(cur.despesas + cur.pendDespesa)} apoio={`${fmt(cur.despesas)} pagas · ${fmt(cur.pendDespesa)} previstas`} tom="perigo" />
          <Kpi rotulo="Saídas (histórico)" valor={fmt(allTimePaidOut)} apoio="Tudo que já foi pago" tom="perigo" />
        </GradeDeKpis>
      </Secao>

      {/* CAIXINHAS DE RESERVA */}
      <Secao
        divisoria
        titulo="Caixinhas de reserva"
        descricao={`Guardado ${fmt(reservedTotal)}`}
        ajuda="Dinheiro separado dentro do caixa. Você atualiza os valores; a sugestão aparece quando o guardado está diferente dela."
      >
        <GradeDeKpis>
          {BOX_DEFS.map((b) => {
            const value = Number(boxes[b.key]) || 0;
            const isEditing = editingBox?.key === b.key;
            return (
              <Kpi key={b.key} rotulo={b.label} ajuda={b.hint} valor={fmt(value)} tom="info">
                {isEditing ? (
                  <div className="mt-2 flex min-w-0 items-center">
                    <input
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      autoFocus
                      value={editingBox.value}
                      onChange={(e) => setEditingBox({ key: b.key, value: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter") saveBox(b.key, editingBox.value); if (e.key === "Escape") setEditingBox(null); }}
                      className={juntar(campo, "flex-1 tabular-nums")}
                      aria-label={`Novo valor de ${b.label}`}
                    />
                    <button type="button" onClick={() => saveBox(b.key, editingBox.value)} className={juntar(botaoDeLinha, "ml-1.5")}>
                      OK
                    </button>
                  </div>
                ) : (
                  <div className="-mb-1 mt-2 flex min-w-0 flex-wrap items-center [&>*]:mb-1 [&>*]:mr-1.5">
                    <button type="button" onClick={() => setEditingBox({ key: b.key, value: String(value || "") })} className={botaoDeLinha}>
                      Atualizar
                    </button>
                    {b.suggestion > 0 && Math.abs(b.suggestion - value) > 0.5 && (
                      <button
                        type="button"
                        onClick={() => saveBox(b.key, String(b.suggestion))}
                        title={b.suggestionLabel}
                        className={juntar(botaoDeLinha, "max-w-full border-info/40 text-info hover:bg-info/10")}
                      >
                        <span className="truncate">Usar {fmt(b.suggestion)}</span>
                      </button>
                    )}
                  </div>
                )}
              </Kpi>
            );
          })}
          <Kpi
            rotulo="Disponível livre"
            valor={fmt(freeBalance)}
            apoio="Caixa − caixinhas"
            tom={freeBalance >= 0 ? "sucesso" : "perigo"}
            ajuda={<>Saldo em caixa {fmt(cashBalance)} − caixinhas {fmt(reservedTotal)}. É o que pode ser usado sem tocar nas reservas.</>}
          />
        </GradeDeKpis>
      </Secao>

      {/* RESUMO DO MÊS */}
      <Secao divisoria titulo="Resumo do mês" ajuda="Indicadores operacionais. Investimento não entra aqui.">
        <GradeDeKpis>
          <Kpi rotulo="Receitas do mês" valor={fmt(cur.receitas)} apoio={`+${fmt(cur.pendReceita)} previstas`} tom="sucesso" />
          <Kpi rotulo="Despesas do mês" valor={fmt(cur.despesas)} apoio={`+${fmt(cur.pendDespesa)} previstas`} tom="perigo" />
          <Kpi rotulo="Resultado do mês" valor={fmt(cur.net)} apoio={cur.net >= 0 ? "Saldo positivo" : "Saldo negativo"} tom={cur.net >= 0 ? "sucesso" : "perigo"} />
          <Kpi rotulo={`Projeção ${period}m`} valor={fmt(lucroProj)} apoio={`Margem ${margem.toFixed(1)}%`} tom={lucroProj >= 0 ? "primario" : "aviso"} />
        </GradeDeKpis>
        {/* Capital de Investidor foi movido para sua própria aba ("Capital") em /financeiro */}
        {investorEntries.length > 0 && (
          <p className={juntar(superficie.poco, "mt-3 flex min-w-0 items-center px-3 py-2 text-[12px] text-muted-foreground")}>
            <Briefcase className="mr-2 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
            <span className="min-w-0 truncate">
              <span className="font-semibold tabular-nums text-primary">{fmt(investor.total)}</span> de capital de investidor ficam na aba Capital, fora deste fluxo.
            </span>
          </p>
        )}
      </Secao>

      {/* FLUXO DE CAIXA · gráfico */}
      <Secao
        divisoria
        titulo="Evolução do caixa"
        ajuda="Entradas e saídas por mês (a parte clara é o previsto) e o saldo acumulado projetado."
        acao={
          <div className={juntar(texto.auxiliar, "hidden items-center sm:flex")}>
            <span className="mr-3 flex items-center"><span className="mr-1.5 h-2.5 w-2.5 rounded-sm bg-success" /> Receita</span>
            <span className="mr-3 flex items-center"><span className="mr-1.5 h-2.5 w-2.5 rounded-sm bg-destructive" /> Despesa</span>
            <span className="flex items-center"><span className="mr-1.5 h-2.5 w-2.5 rounded-sm bg-primary" /> Acumulado</span>
          </div>
        }
      >
        <Painel>
          <div className="h-[300px]">
            <ResponsiveContainer>
              <ComposedChart data={series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="recGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0.4} />
                  </linearGradient>
                  <linearGradient id="despGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0.4} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 12 }}
                  formatter={(v: any) => fmt(Number(v))}
                />
                <Bar dataKey="receitas" stackId="in" fill="url(#recGrad)" radius={[4, 4, 0, 0]} name="Receita" isAnimationActive={false} />
                <Bar dataKey="pendReceita" stackId="in" fill="hsl(var(--success) / 0.25)" radius={[4, 4, 0, 0]} name="Receita prevista" isAnimationActive={false} />
                <Bar dataKey="despesas" stackId="out" fill="url(#despGrad)" radius={[4, 4, 0, 0]} name="Despesa" isAnimationActive={false} />
                <Bar dataKey="pendDespesa" stackId="out" fill="hsl(var(--destructive) / 0.25)" radius={[4, 4, 0, 0]} name="Despesa prevista" isAnimationActive={false} />
                <Line type="monotone" dataKey="acumulado" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 3 }} name="Acumulado" isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Painel>
      </Secao>

      {/* ANÁLISE · DRE + distribuição */}
      <div className="grid min-w-0 grid-cols-1 gap-6 border-t border-border pt-5 lg:grid-cols-3">
        <Secao
          titulo="DRE simplificado"
          descricao={`${dre.length} meses`}
          ajuda="Resultado mensal: receita, despesa, lucro e margem. Soma o realizado e o previsto de cada mês."
          className="lg:col-span-2"
        >
          <RegiaoRolavel memoria="financeiro:fluxo:dre" rotulo="DRE simplificado" className="lg:max-h-[360px]">
            {/* Computador: tabela. Celular: lista. */}
            <table className="hidden w-full text-[13px] sm:table">
              <thead className="bg-background lg:sticky lg:top-0 lg:z-10">
                <tr className="border-b border-border">
                  <th className={juntar(texto.rotulo, "py-2 pr-3 text-left")}>Mês</th>
                  <th className={juntar(texto.rotulo, "px-3 py-2 text-right")}>Receita</th>
                  <th className={juntar(texto.rotulo, "px-3 py-2 text-right")}>Despesa</th>
                  <th className={juntar(texto.rotulo, "px-3 py-2 text-right")}>Lucro</th>
                  <th className={juntar(texto.rotulo, "py-2 pl-3 text-right")}>Margem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {dre.map((r, i) => (
                  <tr key={i}>
                    <td className="py-2 pr-3 text-foreground">{r.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-success">{fmtCompact(r.receita)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-destructive">{fmtCompact(r.despesa)}</td>
                    <td className={juntar("px-3 py-2 text-right font-semibold tabular-nums", r.lucro >= 0 ? "text-foreground" : "text-destructive")}>{fmtCompact(r.lucro)}</td>
                    <td className={juntar("py-2 pl-3 text-right tabular-nums", r.margem >= 0 ? "text-success" : "text-destructive")}>
                      {r.margem.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-border sm:hidden">
              {dre.map((r, i) => (
                <li key={i} className="min-w-0 py-2">
                  <div className="flex min-w-0 items-center">
                    <span className="mr-2 min-w-0 flex-1 text-[13px] text-foreground">{r.label}</span>
                    <span className={juntar("shrink-0 text-[13px] font-semibold tabular-nums", r.lucro >= 0 ? "text-foreground" : "text-destructive")}>{fmtCompact(r.lucro)}</span>
                  </div>
                  <p className={juntar(texto.auxiliar, "mt-0.5 truncate tabular-nums")}>
                    Receita {fmtCompact(r.receita)} · despesa {fmtCompact(r.despesa)} · margem {r.margem.toFixed(1)}%
                  </p>
                </li>
              ))}
            </ul>
          </RegiaoRolavel>
        </Secao>

        <Secao titulo="Despesas por categoria" descricao="Distribuição total">
          {byCat.length === 0 ? (
            <EstadoVazio compacto titulo="Nenhuma despesa cadastrada." />
          ) : (
            <>
              <div className="h-[160px]">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={byCat} dataKey="value" innerRadius={45} outerRadius={70} paddingAngle={2} isAnimationActive={false}>
                      {byCat.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => fmt(Number(v))} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-3 space-y-1.5">
                {byCat.slice(0, 5).map((c, i) => {
                  const pct = (c.value / byCat.reduce((a, x) => a + x.value, 0)) * 100;
                  return (
                    <li key={i} className="flex min-w-0 items-center text-[12px]">
                      <span className="mr-2 h-2 w-2 shrink-0 rounded-full" style={{ background: c.color }} />
                      <span className="mr-2 min-w-0 flex-1 truncate text-foreground">{c.name}</span>
                      <span className="mr-2 shrink-0 tabular-nums text-muted-foreground">{pct.toFixed(0)}%</span>
                      <span className="shrink-0 tabular-nums text-foreground">{fmtCompact(c.value)}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Secao>
      </div>

      {/* MOVIMENTAÇÕES */}
      <Secao
        divisoria
        titulo="Movimentações"
        ajuda="Entradas e saídas em blocos separados, cada um com pendentes e realizadas. Toque no título do bloco para recolher; o que ficou aberto e a lista escolhida continuam assim ao voltar."
      >
        <div className="min-w-0 space-y-4">
          {/* ENTRADAS */}
          <Painel semEspaco as="section" aria-label="Entradas">
            <CabecalhoDoBloco
              aberto={inflowsOpen}
              onAlternar={() => setInflowsOpen((v) => !v)}
              controla="financeiro-entradas"
              titulo="Entradas"
              valores={[
                { rotulo: "A receber", valor: fmt(aReceber), tom: "aviso" },
                { rotulo: "Recebido (histórico)", valor: fmt(allTimeReceived), tom: "sucesso" },
              ]}
              // O seletor da lista mora no cabeçalho do bloco (nada de faixa própria).
              seletor={
                <SeletorCompacto
                  opcoes={[
                    { valor: "ar", rotulo: "A receber", contador: accountsReceivable.length },
                    { valor: "received", rotulo: "Recebidas", contador: receivedList.length },
                  ]}
                  valor={abaEntradas}
                  onEscolher={(v) => setAbaEntradas(v as "ar" | "received")}
                  rotulo="Lista de entradas"
                  modo="segmentado"
                />
              }
            />
            {inflowsOpen && (
              <div id="financeiro-entradas">

                {abaEntradas === "ar" && (
                  accountsReceivable.length === 0 ? (
                    <div className="border-t border-border p-4"><EstadoVazio compacto titulo="Nada a receber no momento." /></div>
                  ) : (
                    <RegiaoRolavel memoria="financeiro:fluxo:a-receber" rotulo="A receber" sobre="cartao" className="lg:max-h-[420px]">
                      <ul className="divide-y divide-border border-t border-border">
                        {accountsReceivable.map((r: any) => (
                          <li key={r.id} className="flex min-w-0 flex-wrap items-center px-4 py-2.5 hover:bg-muted/40">
                            <div className="mr-3 min-w-0 flex-1 basis-48">
                              <p className="truncate text-[13px] font-medium text-foreground">{r.description}</p>
                              <p className={juntar(texto.auxiliar, "truncate")}>{r.client} · Vence {parseDate(r.due_date)?.toLocaleDateString("pt-BR")}</p>
                            </div>
                            <div className="ml-auto flex shrink-0 items-center py-0.5">
                              {prazo(r.overdue, r.daysUntil)}
                              <span className="ml-3 text-[13px] font-semibold tabular-nums text-success">{fmt(r.amount)}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </RegiaoRolavel>
                  )
                )}

                {abaEntradas === "received" && (
                  receivedList.length === 0 ? (
                    <div className="border-t border-border p-4"><EstadoVazio compacto titulo="Nenhuma entrada recebida ainda." /></div>
                  ) : (
                    <RegiaoRolavel memoria="financeiro:fluxo:recebidas" rotulo="Recebidas" sobre="cartao" className="lg:max-h-[420px]">
                      <ul className="divide-y divide-border border-t border-border">
                        {receivedList.map((r: any) => (
                          <li key={r.id} className="flex min-w-0 flex-wrap items-center px-4 py-2.5 hover:bg-muted/40">
                            <div className="mr-3 min-w-0 flex-1 basis-48">
                              <p className="truncate text-[13px] font-medium text-foreground">{r.description}</p>
                              <p className={juntar(texto.auxiliar, "truncate")}>
                                {r.client} · Recebido em {parseDate(r.date)?.toLocaleDateString("pt-BR")}
                                {r.partial && ` · parcial (${fmt(r.amount)} de ${fmt(r.total)})`}
                              </p>
                            </div>
                            <span className="ml-auto shrink-0 py-0.5 text-[13px] font-semibold tabular-nums text-success">{fmt(r.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    </RegiaoRolavel>
                  )
                )}
              </div>
            )}
          </Painel>

          {/* SAÍDAS */}
          <Painel semEspaco as="section" aria-label="Saídas">
            <CabecalhoDoBloco
              aberto={outflowsOpen}
              onAlternar={() => setOutflowsOpen((v) => !v)}
              controla="financeiro-saidas"
              titulo="Saídas"
              valores={[
                { rotulo: "A pagar", valor: fmt(aPagar), tom: "aviso" },
                { rotulo: "Pago (histórico)", valor: fmt(allTimePaidOut), tom: "perigo" },
              ]}
              // Cinco listas: mais de quatro opções vira seletor, no cabeçalho do bloco.
              seletor={
                <SeletorCompacto
                  opcoes={opcoesDasSaidas}
                  valor={abaSaidas}
                  onEscolher={(v) => setAbaSaidas(v as AbaDasSaidas)}
                  rotulo="Lista de saídas"
                  icone={<ListFilter className="h-3.5 w-3.5" />}
                  modo="lista"
                />
              }
            />
            {outflowsOpen && (
              <div id="financeiro-saidas">

                {estadoDasSaidas}

                {!estadoDasSaidas && abaSaidas === "ap" && (
                  accountsPayable.length === 0 ? (
                    <div className="border-t border-border p-4"><EstadoVazio compacto titulo="Nada a pagar." /></div>
                  ) : (
                    <RegiaoRolavel memoria="financeiro:fluxo:a-pagar" rotulo="A pagar" sobre="cartao" className="lg:max-h-[420px]">
                      <ul className="divide-y divide-border border-t border-border">
                        {accountsPayable.map((e: any) => {
                          const cm = catMeta(e.category);
                          return (
                            <li key={e.id} className="flex min-w-0 flex-wrap items-center px-4 py-2.5 hover:bg-muted/40">
                              <span className="mr-3 h-2 w-2 shrink-0 rounded-full" style={{ background: cm.color }} aria-hidden="true" />
                              <div className="mr-3 min-w-0 flex-1 basis-48">
                                <p className="truncate text-[13px] font-medium text-foreground">{e.description}</p>
                                <p className={juntar(texto.auxiliar, "truncate")}>
                                  {cm.label} · Vence {parseDate(e.due_date)?.toLocaleDateString("pt-BR")}
                                  {e.supplier && ` · ${e.supplier}`}
                                </p>
                              </div>
                              <div className="ml-auto flex shrink-0 items-center py-0.5">
                                {prazo(e.overdue, e.daysUntil)}
                                <span className="mx-3 text-[13px] font-semibold tabular-nums text-foreground">{fmt(Number(e.amount))}</span>
                                <button type="button" onClick={() => togglePaid(e)} className={juntar(botaoDeLinha, "border-success/40 text-success hover:bg-success/10")}>Pagar</button>
                                {acoesDaLinha(e, isInvestor(e) ? "investment" : "expense")}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </RegiaoRolavel>
                  )
                )}

                {!estadoDasSaidas && abaSaidas === "exp" && (
                  expenses.length === 0 ? (
                    <div className="border-t border-border p-4">
                      <EstadoVazio compacto titulo="Nenhuma despesa cadastrada." descricao='Use "Lançamento" e escolha Despesa.' />
                    </div>
                  ) : (
                    <RegiaoRolavel memoria="financeiro:fluxo:despesas" rotulo="Todas as despesas" sobre="cartao" className="lg:max-h-[420px]">
                      {/* Organização pedida: tudo por MÊS, e dentro do mês as FIXAS
                          (mensal/anual) separadas das PONTUAIS, cada grupo com o seu
                          subtotal. Acabou a lista única misturando tudo. */}
                      {(() => {
                        const byMonth = new Map<string, { fixed: any[]; oneOff: any[] }>();
                        for (const e of expenses) {
                          const due = parseDate(e.due_date);
                          const key = due ? monthKey(due) : "0000-00";
                          if (!byMonth.has(key)) byMonth.set(key, { fixed: [], oneOff: [] });
                          const bucket = byMonth.get(key)!;
                          if (e.recurrence === "monthly" || e.recurrence === "yearly") bucket.fixed.push(e);
                          else bucket.oneOff.push(e);
                        }
                        const sum = (list: any[]) => list.reduce((s, e) => s + (Number(e.amount) || 0), 0);
                        const keys = [...byMonth.keys()].sort().reverse();

                        return keys.map((key) => {
                          const bucket = byMonth.get(key)!;
                          const fixedTotal = sum(bucket.fixed);
                          const oneOffTotal = sum(bucket.oneOff);
                          return (
                            <div key={key} className="border-t border-border">
                              <div className="flex min-w-0 flex-wrap items-center justify-between border-b border-border bg-card px-4 py-2 lg:sticky lg:top-0 lg:z-10">
                                <p className="mr-3 text-[13px] font-semibold text-foreground">
                                  {key === "0000-00" ? "Sem data" : monthLabel(key)}
                                </p>
                                <p className={juntar(texto.auxiliar, "tabular-nums")}>
                                  Fixas {fmt(fixedTotal)} · Pontuais {fmt(oneOffTotal)} ·{" "}
                                  <span className="font-semibold text-foreground">Total {fmt(fixedTotal + oneOffTotal)}</span>
                                </p>
                              </div>
                              {bucket.fixed.length > 0 && (
                                <>
                                  <p className={juntar(texto.rotulo, "px-4 pt-2")}>Fixas do mês</p>
                                  <ul className="divide-y divide-border">{bucket.fixed.map(renderExpenseRow)}</ul>
                                </>
                              )}
                              {bucket.oneOff.length > 0 && (
                                <>
                                  <p className={juntar(texto.rotulo, "px-4 pt-2")}>Pontuais do mês</p>
                                  <ul className="divide-y divide-border">{bucket.oneOff.map(renderExpenseRow)}</ul>
                                </>
                              )}
                            </div>
                          );
                        });
                      })()}
                    </RegiaoRolavel>
                  )
                )}

                {/* SAÍDAS JÁ REALIZADAS · o espelho de "Recebidas" */}
                {!estadoDasSaidas && abaSaidas === "done" && (
                  <>
                    <div className={juntar(texto.auxiliar, "flex min-w-0 flex-wrap items-center justify-between border-t border-border px-4 py-2")}>
                      <span className="mr-3">
                        Neste mês saiu <strong className="font-semibold tabular-nums text-destructive">{fmt(paidOutThisMonth)}</strong>
                      </span>
                      <span>
                        Histórico completo <strong className="font-semibold tabular-nums text-foreground">{fmt(allTimePaidOut)}</strong>
                      </span>
                    </div>
                    {paidOutList.length === 0 ? (
                      <div className="border-t border-border p-4">
                        <EstadoVazio compacto titulo="Nenhuma saída realizada ainda." descricao="Pagar um custo em Custos Fixos registra a saída aqui." />
                      </div>
                    ) : (
                      <RegiaoRolavel memoria="financeiro:fluxo:realizadas" rotulo="Saídas realizadas" sobre="cartao" className="lg:max-h-[420px]">
                        <ul className="divide-y divide-border border-t border-border">
                          {paidOutList.map((e: any) => {
                            const cm = catMeta(e.category);
                            return (
                              <li key={e.id} className="flex min-w-0 flex-wrap items-center px-4 py-2.5 hover:bg-muted/40">
                                <span className="mr-3 h-2 w-2 shrink-0 rounded-full" style={{ background: cm.color }} aria-hidden="true" />
                                <div className="mr-3 min-w-0 flex-1 basis-48">
                                  <p className="truncate text-[13px] font-medium text-foreground">{e.description}</p>
                                  <p className={juntar(texto.auxiliar, "truncate")}>
                                    {cm.label} · pago em {parseDate(e.paid_date)?.toLocaleDateString("pt-BR")}
                                    {e.due_date && ` · venc. ${parseDate(e.due_date)?.toLocaleDateString("pt-BR")}`}
                                    {e.parent_expense_id && " · custo fixo"}
                                  </p>
                                </div>
                                <div className="ml-auto flex shrink-0 items-center py-0.5">
                                  <span className="mr-3 text-[13px] font-semibold tabular-nums text-destructive">{fmt(Number(e.amount))}</span>
                                  <button type="button" onClick={() => togglePaid(e)}
                                    title="Estornar: apaga a saída e devolve o vencimento ao mês pago"
                                    className={botaoDeLinha}>
                                    Estornar
                                  </button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </RegiaoRolavel>
                    )}
                  </>
                )}

                {/* PRÓ-LABORE · já configurado pelo proporcional ao faturamento */}
                {!estadoDasSaidas && abaSaidas === "pro" && (
                  <div className="min-w-0 border-t border-border">
                    <div className="space-y-3 p-4">
                      <GradeDeKpis colunas={3} semMoldura>
                        <Kpi emPoco rotulo="Receita operacional do mês" valor={fmt(proLaboreView.operacional)} apoio={`${fmt(monthReceivedGross)} bruto − imposto`} />
                        <Kpi
                          emPoco
                          rotulo="Proporcional pela escada"
                          valor={fmt(proLaboreView.proporcional)}
                          apoio={proLaboreView.proximoDegrau ? `próximo degrau ${fmt(proLaboreView.proximoDegrau.proLabore)} em ${fmt(proLaboreView.proximoDegrau.revenue)}` : "topo da escada"}
                          tom="sucesso"
                        />
                        <Kpi
                          emPoco
                          rotulo="Configurado hoje"
                          valor={fmt(proLaboreView.atual)}
                          apoio={proLaboreView.molde ? `lançado, vence ${parseDate(proLaboreView.molde.due_date)?.toLocaleDateString("pt-BR")}` : "ainda não lançado como saída"}
                          tom="info"
                        />
                      </GradeDeKpis>

                      {!proLaboreView.molde && proLaboreView.proporcional > 0 && (
                        <div className="flex min-w-0 flex-wrap items-center rounded-md border border-success/30 px-3 py-2">
                          <p className="mr-3 flex min-w-0 flex-1 items-center py-1 text-[13px] leading-5 text-muted-foreground">
                            <span className="min-w-0 truncate">Pró-labore ainda não lançado como saída</span>
                            <AjudaRecolhida className="ml-1" rotulo="Sobre lançar o pró-labore">
                              O pró-labore ainda não é saída recorrente. Lançar no proporcional coloca ele no fluxo, vencendo no dia 10.
                            </AjudaRecolhida>
                          </p>
                          <button type="button" onClick={lancarProLaboreProporcional}
                            className={juntar(botaoDeLinha, "border-success/40 text-success hover:bg-success/10")}>
                            Lançar {fmt(proLaboreView.proporcional)}/mês
                          </button>
                        </div>
                      )}

                      <p className={juntar(texto.auxiliar, "flex min-w-0 items-center")}>
                        <span className="mr-1 truncate">
                          Retirado no ano: <strong className="font-semibold tabular-nums text-foreground">{fmt(proLaboreView.realizadoNoAno)}</strong>
                        </span>
                        <AjudaRecolhida rotulo="Como o proporcional é calculado">
                          A escada lê a receita operacional: o bruto menos o imposto. Usar o bruto inflaria a retirada em toda a faixa, porque a
                          parte do governo nunca foi receita da agência. O reajuste nunca é automático: o valor só muda quando você confirma.
                        </AjudaRecolhida>
                      </p>
                    </div>

                    {proLaboreView.linhas.length === 0 ? (
                      <div className="border-t border-border p-4"><EstadoVazio compacto titulo="Nenhuma retirada registrada ainda." /></div>
                    ) : (
                      <RegiaoRolavel memoria="financeiro:fluxo:prolabore" rotulo="Retiradas de pró-labore" sobre="cartao" className="lg:max-h-[300px]">
                        <ul className="divide-y divide-border border-t border-border">
                          {proLaboreView.linhas.map((e: any) => (
                            <li key={e.id} className="flex min-w-0 flex-wrap items-center px-4 py-2.5 hover:bg-muted/40">
                              <div className="mr-3 min-w-0 flex-1 basis-48">
                                <p className="truncate text-[13px] font-medium text-foreground">{e.description}</p>
                                <p className={juntar(texto.auxiliar, "truncate")}>
                                  {e.status === "paid"
                                    ? `retirado em ${parseDate(e.paid_date)?.toLocaleDateString("pt-BR")}`
                                    : `previsto para ${parseDate(e.due_date)?.toLocaleDateString("pt-BR")}`}
                                  {e.recurrence === "monthly" && " · mensal"}
                                </p>
                              </div>
                              <div className="ml-auto flex shrink-0 items-center py-0.5">
                                <Etiqueta tom={e.status === "paid" ? "sucesso" : "aviso"} className="mr-3">
                                  {e.status === "paid" ? "Retirado" : "Previsto"}
                                </Etiqueta>
                                <span className="mr-3 text-[13px] font-semibold tabular-nums text-foreground">{fmt(Number(e.amount))}</span>
                                <button type="button" onClick={() => togglePaid(e)} className={botaoDeLinha}>
                                  {e.status === "paid" ? "Estornar" : "Pagar"}
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </RegiaoRolavel>
                    )}
                  </div>
                )}

                {!estadoDasSaidas && abaSaidas === "inv" && (
                  investorEntries.length === 0 ? (
                    <div className="border-t border-border p-4">
                      <EstadoVazio compacto titulo="Nenhum investimento registrado." descricao='Use "Lançamento" e escolha Investimento.' />
                    </div>
                  ) : (
                    <RegiaoRolavel memoria="financeiro:fluxo:investimentos" rotulo="Investimentos" sobre="cartao" className="lg:max-h-[420px]">
                      <ul className="divide-y divide-border border-t border-border">
                        {investorEntries.map((e: any) => {
                          const cm = catMeta(e.category);
                          return (
                            <li key={e.id} className="flex min-w-0 flex-wrap items-center px-4 py-2.5 hover:bg-muted/40">
                              <Briefcase className="mr-3 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                              <div className="mr-3 min-w-0 flex-1 basis-48">
                                <p className="truncate text-[13px] font-medium text-foreground">{e.description}</p>
                                <p className={juntar(texto.auxiliar, "truncate")}>
                                  {cm.label} · {parseDate(e.due_date)?.toLocaleDateString("pt-BR")}
                                  {e.supplier && ` · ${e.supplier}`}
                                </p>
                              </div>
                              <div className="ml-auto flex shrink-0 items-center py-0.5">
                                <Etiqueta tom="primario" className="mr-3">Capital</Etiqueta>
                                <span className="text-[13px] font-semibold tabular-nums text-primary">{fmt(Number(e.amount))}</span>
                                {acoesDaLinha(e, "investment")}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </RegiaoRolavel>
                  )
                )}
              </div>
            )}
          </Painel>
        </div>
      </Secao>

      {/* Modal conciliar saldo */}
      <Dialog open={reconcileOpen} onOpenChange={setReconcileOpen}>
        <DialogContent className="max-w-md border-border bg-card">
          <DialogHeader><DialogTitle className="text-foreground">Conciliar saldo em caixa</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <dl className={juntar(superficie.poco, "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-3 py-2.5 text-[13px]")}>
              <dt className="text-muted-foreground">Saldo calculado pelo painel</dt>
              <dd className="text-right tabular-nums text-foreground">{fmt(cashBalance)}</dd>
              <dt className="text-muted-foreground">Entradas</dt>
              <dd className="text-right tabular-nums text-muted-foreground">{fmt(allTimeReceived)}</dd>
              <dt className="text-muted-foreground">Saídas</dt>
              <dd className="text-right tabular-nums text-muted-foreground">− {fmt(allTimePaidOut)}</dd>
              <dt className="text-muted-foreground">Base anterior</dt>
              <dd className="text-right tabular-nums text-muted-foreground">{fmt(openingBalance)}</dd>
            </dl>
            <GrupoDeCampos colunas={1}>
              <CampoDeFormulario
                rotulo="Saldo real na conta hoje (R$)"
                ajuda={'A diferença (custos antigos não lançados, tarifas etc.) vai para a "base de meses anteriores". Nenhum lançamento é alterado ou apagado. Repita a conciliação sempre que quiser bater o painel com o extrato.'}
              >
                <input type="number" step="0.01" inputMode="decimal" value={reconcileInput} onChange={(e) => setReconcileInput(e.target.value)} className={campo} placeholder="Ex.: 5882.07" />
              </CampoDeFormulario>
            </GrupoDeCampos>
            <AcoesDoDialogo>
              <button type="button" onClick={() => setReconcileOpen(false)} className={botao.discreto}>Cancelar</button>
              <button type="button" onClick={reconcileBalance} disabled={updateSettings.isPending} className={botao.primario}>
                Conciliar com este saldo
              </button>
            </AcoesDoDialogo>
          </div>
        </DialogContent>
      </Dialog>

      {/* LAUNCHER · escolha do tipo de lançamento */}
      <Dialog open={launcherOpen} onOpenChange={setLauncherOpen}>
        <DialogContent className="max-w-md border-border bg-card">
          <DialogHeader>
            <DialogTitle className="text-foreground">Novo lançamento</DialogTitle>
          </DialogHeader>
          <ul className="divide-y divide-border rounded-md border border-border">
            <LauncherChoice
              icon={<ArrowUpRight className="h-4 w-4" />}
              tone="success"
              title="Entrada"
              desc="Receita avulsa de projeto. Conta como receita no fluxo."
              onClick={() => { setLauncherOpen(false); setIncomeModalOpen(true); }}
            />
            <LauncherChoice
              icon={<ArrowDownRight className="h-4 w-4" />}
              tone="danger"
              title="Despesa"
              desc="Custo operacional recorrente ou avulso. Conta como despesa no DRE."
              onClick={() => { setLauncherOpen(false); setExpenseModal({ mode: "expense", data: {} }); }}
            />
            {/* O pró-labore em um clique: o valor já sai calculado pela
                escada, e a ação sabe se é para criar ou só ajustar. */}
            <LauncherChoice
              icon={<PiggyBank className="h-4 w-4" />}
              tone="success"
              title={proLaboreView.molde
                ? `Ajustar pró-labore para ${fmt(proLaboreView.proporcional)}`
                : `Lançar pró-labore proporcional · ${fmt(proLaboreView.proporcional)}`}
              desc={proLaboreView.molde
                ? `Hoje está em ${fmt(proLaboreView.atual)}. Ajusta a retirada que já existe, sem criar uma segunda.`
                : `Pela escada sobre ${fmt(proLaboreView.operacional)} operacionais. Entra como saída mensal, vencendo no dia 10.`}
              onClick={() => { setLauncherOpen(false); void lancarProLaboreProporcional(); }}
            />
          </ul>
          <p className={juntar(superficie.poco, "flex items-start px-3 py-2 text-[12px] leading-5 text-muted-foreground")}>
            <Briefcase className="mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
            <span>Capital de investidor (aporte de sócio) entra pela aba Capital, fora do fluxo operacional.</span>
          </p>
        </DialogContent>
      </Dialog>

      {/* MODAL DESPESA / INVESTIMENTO */}
      <Dialog open={!!expenseModal} onOpenChange={(o) => !o && setExpenseModal(null)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border-border bg-card">
          <DialogHeader>
            <DialogTitle className="flex items-center text-foreground">
              {expenseModal?.mode === "investment"
                ? <Briefcase className="mr-2 h-4 w-4 text-primary" aria-hidden="true" />
                : <ArrowDownRight className="mr-2 h-4 w-4 text-destructive" aria-hidden="true" />}
              {expenseModal?.data?.id
                ? (expenseModal.mode === "investment" ? "Editar investimento" : "Editar despesa")
                : (expenseModal?.mode === "investment" ? "Novo investimento" : "Nova despesa")}
            </DialogTitle>
          </DialogHeader>
          {expenseModal && (
            <ExpenseForm
              initial={expenseModal.data}
              mode={expenseModal.mode}
              onSave={(form: any) => saveExpense(form, expenseModal.mode)}
              onCancel={() => setExpenseModal(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <DialogContent className="max-w-sm border-border bg-card">
          <DialogHeader><DialogTitle className="text-foreground">Remover lançamento?</DialogTitle></DialogHeader>
          <p className="text-[13px] text-muted-foreground">Não dá para desfazer.</p>
          <AcoesDoDialogo>
            <button type="button" onClick={() => setConfirmDel(null)} className={botao.discreto}>Cancelar</button>
            <button type="button" onClick={() => confirmDel && deleteExpense(confirmDel)} className={botao.perigo}>Remover</button>
          </AcoesDoDialogo>
        </DialogContent>
      </Dialog>

      <NewIncomeModal open={incomeModalOpen} onClose={() => setIncomeModalOpen(false)} existingProjects={[]} />
    </div>
  );
}

/** Cabeçalho de um bloco recolhível (Entradas, Saídas): título e os totais à direita. */
function CabecalhoDoBloco({
  aberto,
  onAlternar,
  controla,
  titulo,
  valores,
  seletor,
}: {
  aberto: boolean;
  onAlternar: () => void;
  controla: string;
  titulo: string;
  valores: { rotulo: string; valor: string; tom: Tom }[];
  /** Seletor da lista do bloco (só com o bloco aberto), na mesma linha do título. */
  seletor?: ReactNode;
}) {
  return (
    <div className="-mb-1 flex min-w-0 flex-wrap items-center px-4 py-3 [&>*]:mb-1">
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={aberto}
        aria-controls={controla}
        className={juntar("mr-3 flex min-w-0 flex-1 items-center rounded-md text-left", foco)}
      >
        <ChevronDown className={juntar("mr-1.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform", !aberto && "-rotate-90")} aria-hidden="true" />
        <span className={juntar(texto.tituloSecao, "truncate")}>{titulo}</span>
      </button>
      {aberto && seletor ? <div className="mr-4 min-w-0">{seletor}</div> : null}
      <span className="ml-auto flex shrink-0 items-center">
        {valores.map((v, i) => (
          <span key={v.rotulo} className={juntar("text-right", i > 0 && "ml-4")}>
            <span className={juntar(texto.rotulo, "block")}>{v.rotulo}</span>
            <span className={juntar("block text-[13px] font-semibold tabular-nums", corDoTom[v.tom])}>{v.valor}</span>
          </span>
        ))}
      </span>
    </div>
  );
}

function ExpenseForm({ initial, onSave, onCancel, mode = "expense" }: any) {
  const cats = mode === "investment" ? INVESTMENT_CATEGORIES : EXPENSE_CATEGORIES;
  const defaultCat = mode === "investment" ? "inv_outros" : "outros";
  const placeholder = mode === "investment" ? "Ex.: Campanha Meta Ads · junho" : "Ex.: Aluguel escritório";
  const supplierLabel = mode === "investment" ? "Plataforma / origem" : "Fornecedor";

  const [form, setForm] = useState({
    id: initial.id || null,
    description: initial.description || "",
    category: initial.category || defaultCat,
    amount: initial.amount?.toString() || "",
    due_date: initial.due_date || new Date().toISOString().slice(0, 10),
    paid_date: initial.paid_date || "",
    status: initial.status || "pending",
    recurrence: initial.recurrence || "none",
    supplier: initial.supplier || "",
    payment_method: initial.payment_method || "",
    notes: initial.notes || "",
  });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div className="space-y-4">
      {mode === "investment" && (
        <p className={juntar(superficie.poco, "flex min-w-0 items-center px-3 py-2 text-[12px] leading-5 text-muted-foreground")}>
          <span className="min-w-0 truncate"><span className="font-semibold text-primary">Investimento</span> fora do DRE</span>
          <AjudaRecolhida className="ml-1" rotulo="Sobre investimento">
            Investimento não conta como despesa no DRE. Vai para o bloco de Capital e o retorno é medido contra ele.
          </AjudaRecolhida>
        </p>
      )}
      <GrupoDeCampos>
        <CampoDeFormulario rotulo="Descrição" obrigatorio largo>
          <input value={form.description} onChange={e => set("description", e.target.value)} className={campo} placeholder={placeholder} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Categoria">
          <select value={form.category} onChange={e => set("category", e.target.value)} className={campo}>
            {cats.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Valor (R$)" obrigatorio>
          <input type="number" step="0.01" inputMode="decimal" value={form.amount} onChange={e => set("amount", e.target.value)} className={campo} placeholder="0,00" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Vencimento" obrigatorio>
          <input type="date" value={form.due_date} onChange={e => set("due_date", e.target.value)} className={campo} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Recorrência">
          <select value={form.recurrence} onChange={e => set("recurrence", e.target.value)} className={campo}>
            <option value="none">Única</option>
            <option value="monthly">Mensal</option>
            <option value="yearly">Anual</option>
          </select>
        </CampoDeFormulario>
        <CampoDeFormulario rotulo={supplierLabel}>
          <input value={form.supplier} onChange={e => set("supplier", e.target.value)} className={campo} placeholder="Opcional" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Forma de pagamento">
          <select value={form.payment_method} onChange={e => set("payment_method", e.target.value)} className={campo}>
            <option value="">-</option>
            <option value="pix">Pix</option>
            <option value="boleto">Boleto</option>
            <option value="cartao">Cartão</option>
            <option value="transferencia">Transferência</option>
            <option value="dinheiro">Dinheiro</option>
          </select>
        </CampoDeFormulario>
        <div className="min-w-0 sm:col-span-full">
          <p className={juntar(texto.rotulo, "mb-1.5")}>Status</p>
          <SeletorCompacto
            opcoes={[{ valor: "pending", rotulo: "Pendente" }, { valor: "paid", rotulo: "Pago" }]}
            valor={form.status}
            onEscolher={(v) => set("status", v)}
            rotulo="Status do lançamento"
            modo="segmentado"
            larguraTotal
          />
        </div>
        <CampoDeFormulario rotulo="Observações" largo>
          <textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2} className={juntar(campoTexto, "resize-none")} />
        </CampoDeFormulario>
      </GrupoDeCampos>
      <AcoesDoDialogo>
        <button type="button" onClick={onCancel} className={botao.discreto}>Cancelar</button>
        <button type="button" onClick={() => onSave(form)} className={botao.primario}>
          {form.id ? "Salvar" : "Criar"}
        </button>
      </AcoesDoDialogo>
    </div>
  );
}

function LauncherChoice({ icon, tone, title, desc, onClick }: any) {
  const iconTone: any = {
    success: "bg-success/15 text-success",
    danger: "bg-destructive/15 text-destructive",
    primary: "bg-primary/15 text-primary",
  };
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={juntar("flex w-full min-w-0 items-start px-3 py-3 text-left transition-colors hover:bg-muted/60", foco)}
      >
        <span className={juntar("mr-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-md", iconTone[tone] || iconTone.primary)}>
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold text-foreground">{title}</span>
          <span className={juntar(texto.auxiliar, "mt-0.5 block leading-5")}>{desc}</span>
        </span>
      </button>
    </li>
  );
}
