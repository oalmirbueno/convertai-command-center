import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, Cell, PieChart, Pie,
} from "recharts";
import {
  Plus, TrendingUp, TrendingDown, Wallet, AlertTriangle, Download,
  Edit3, Trash2, Calendar, Filter, Sparkles, ArrowUpRight, ArrowDownRight,
  Briefcase,
} from "lucide-react";
import NewIncomeModal from "./NewIncomeModal";

const fmt = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
const fmtCompact = (v: number) => {
  if (Math.abs(v) >= 1000) return `R$ ${(v / 1000).toFixed(1)}k`;
  return fmt(v);
};
const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const INVESTOR_CATEGORY = "investidor";

const CATEGORIES = [
  { value: "salarios", label: "Salários & Pró-labore", color: "#a78bfa" },
  { value: "ferramentas", label: "Ferramentas / SaaS", color: "#60a5fa" },
  { value: "marketing", label: "Marketing & Ads próprios", color: "#f472b6" },
  { value: "impostos", label: "Impostos & Taxas", color: "#fb7185" },
  { value: "fornecedores", label: "Fornecedores", color: "#fbbf24" },
  { value: "infraestrutura", label: "Infraestrutura / Hosting", color: "#34d399" },
  { value: "comissoes", label: "Comissões", color: "#22d3ee" },
  { value: "outros", label: "Outros", color: "#94a3b8" },
  { value: INVESTOR_CATEGORY, label: "Investidor (Aporte de capital)", color: "#00FF66" },
];
const catMeta = (v: string) => CATEGORIES.find(c => c.value === v) || CATEGORIES[CATEGORIES.length - 1];
const isInvestor = (e: any) => e?.category === INVESTOR_CATEGORY;

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

interface Props {
  billing: any[];
  projectPayments: any[];
}

export default function CashFlow({ billing = [], projectPayments = [] }: Props) {
  const qc = useQueryClient();
  const [period, setPeriod] = useState<6 | 12 | 24>(12);
  const [expenseModal, setExpenseModal] = useState<any | null>(null);
  const [incomeModalOpen, setIncomeModalOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [segment, setSegment] = useState<"all" | "recurring" | "one_off">("all");

  // Filter sources by segment
  const billingFiltered = useMemo(() => {
    if (segment === "all") return billing || [];
    return (billing || []).filter((b: any) => {
      const ct = b.client?.client_type || "recurring";
      if (segment === "recurring") return ct === "recurring" || ct === "hybrid";
      return false; // one_off doesn't generate billing
    });
  }, [billing, segment]);

  const paymentsFiltered = useMemo(() => {
    if (segment === "all") return projectPayments || [];
    if (segment === "recurring") return []; // project_payments are one-off by nature
    return (projectPayments || []).filter((p: any) => {
      const mode = p.project?.billing_mode || "one_off";
      return mode === "one_off";
    });
  }, [projectPayments, segment]);

  const { data: allExpenses = [] } = useQuery({
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
      }
      const name = e.supplier || "Investidor";
      byInvestor[name] = (byInvestor[name] || 0) + v;
    });
    const contributors = Object.entries(byInvestor)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    return { total, currentMonth, contributors, monthly };
  }, [investorEntries]);

  // ROI: lucro acumulado do período visível vs total investido
  const periodNet = useMemo(
    () => (series || []).reduce((a, s) => a + (s.receitas - s.despesas), 0),
    [series]
  );
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

  const accountsReceivable = useMemo(() => {
    const out: any[] = [];
    (billingFiltered || []).filter((b: any) => b.status === "pending").forEach((b: any) => {
      const due = parseDate(b.due_date);
      if (!due) return;
      out.push({
        id: b.id, source: "billing", description: b.description || b.type, amount: Number(b.amount) || 0,
        due_date: b.due_date, overdue: due < today, daysUntil: Math.ceil((due.getTime() - today.getTime()) / 86400000),
        client: b.client?.full_name || b.client?.company_name || "—",
      });
    });
    (paymentsFiltered || []).forEach((p: any) => {
      (p.installments || []).filter((i: any) => i.status === "pending" || i.status === "partial").forEach((i: any) => {
        const due = parseDate(i.due_date);
        if (!due) return;
        out.push({
          id: i.id, source: "installment", description: `${p.project?.name || "Projeto"} — Parcela`,
          amount: Math.max((Number(i.amount) || 0) - (Number(i.paid_amount) || 0), 0), due_date: i.due_date, overdue: due < today,
          daysUntil: Math.ceil((due.getTime() - today.getTime()) / 86400000),
          client: p.client?.full_name || p.client?.company_name || "—",
        });
      });
    });
    return out.sort((a, b) => parseDate(a.due_date)!.getTime() - parseDate(b.due_date)!.getTime());
  }, [billingFiltered, paymentsFiltered]);

  // ───────── Mutations ─────────
  const saveExpense = async (form: any) => {
    const payload = {
      description: form.description,
      category: form.category || "outros",
      amount: parseFloat(form.amount) || 0,
      due_date: form.due_date,
      paid_date: form.status === "paid" ? (form.paid_date || form.due_date) : null,
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
    if (form.id) {
      const { error } = await supabase.from("expenses").update(payload).eq("id", form.id);
      if (error) return toast.error(error.message);
      toast.success("Despesa atualizada");
    } else {
      const { error } = await supabase.from("expenses").insert(payload);
      if (error) return toast.error(error.message);
      toast.success("Despesa registrada");
    }
    setExpenseModal(null);
    qc.invalidateQueries({ queryKey: ["expenses"] });
  };

  const togglePaid = async (e: any) => {
    const newStatus = e.status === "paid" ? "pending" : "paid";
    const { error } = await supabase
      .from("expenses")
      .update({ status: newStatus, paid_date: newStatus === "paid" ? new Date().toISOString().slice(0, 10) : null })
      .eq("id", e.id);
    if (error) return toast.error(error.message);
    toast.success(newStatus === "paid" ? "Marcado como pago" : "Reaberto");
    qc.invalidateQueries({ queryKey: ["expenses"] });
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

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground tracking-tight">Fluxo de Caixa</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Visão financeira completa — entradas, saídas, DRE e projeção</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-secondary/50 border border-border rounded-lg p-1">
            {[6, 12, 24].map(n => (
              <button key={n} onClick={() => setPeriod(n as any)}
                className={`px-3 py-1 rounded-md text-[12px] font-medium transition-colors ${period === n ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {n}m
              </button>
            ))}
          </div>
          <button onClick={exportCSV}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-secondary text-muted-foreground hover:text-foreground border border-border cursor-pointer">
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
          <button onClick={() => setIncomeModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-success/15 text-success border border-success/30 hover:bg-success/25 cursor-pointer">
            <ArrowUpRight className="w-3.5 h-3.5" /> Nova Entrada
          </button>
          <button onClick={() => setExpenseModal({})}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-primary text-primary-foreground hover:opacity-90 border-none cursor-pointer">
            <Plus className="w-3.5 h-3.5" /> Nova Despesa
          </button>
        </div>
      </div>

      {/* SEGMENT TOGGLE — Recorrente / Avulso */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Segmento:</span>
        <div className="flex gap-1 bg-secondary/50 border border-border rounded-lg p-1">
          {[
            { v: "all", label: "Tudo" },
            { v: "recurring", label: "Recorrente (MRR)" },
            { v: "one_off", label: "Avulso (Projetos)" },
          ].map((s) => (
            <button key={s.v} onClick={() => setSegment(s.v as any)}
              className={`px-3 py-1 rounded-md text-[12px] font-medium transition-colors cursor-pointer border-none ${
                segment === s.v ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground hover:text-foreground"
              }`}>
              {s.label}
            </button>
          ))}
        </div>
        {segment !== "all" && (
          <span className="text-[10px] text-muted-foreground italic">
            {segment === "recurring" ? "Mostrando apenas mensalidades (billing de clientes recorrentes e híbridos)" : "Mostrando apenas contratos avulsos (project payments)"}
          </span>
        )}
      </div>


      {/* KPI STRIP */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={<ArrowUpRight className="w-4 h-4" />} label="Receitas do mês" value={fmt(cur.receitas)}
          hint={`+${fmt(cur.pendReceita)} previstas`} tone="success" />
        <KpiCard icon={<ArrowDownRight className="w-4 h-4" />} label="Despesas do mês" value={fmt(cur.despesas)}
          hint={`+${fmt(cur.pendDespesa)} previstas`} tone="danger" />
        <KpiCard icon={<Wallet className="w-4 h-4" />} label="Resultado do mês" value={fmt(cur.net)}
          hint={cur.net >= 0 ? "Saldo positivo" : "Saldo negativo"} tone={cur.net >= 0 ? "success" : "danger"} />
        <KpiCard icon={<Sparkles className="w-4 h-4" />} label={`Projeção ${period}m`} value={fmt(lucroProj)}
          hint={`Margem ${margem.toFixed(1)}%`} tone={lucroProj >= 0 ? "primary" : "warning"} />
      </div>

      {/* INVESTIDOR — capital separado do fluxo */}
      {(investor.total > 0 || investorEntries.length > 0) && (
        <div className="relative rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/[0.08] via-card to-card p-5 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none opacity-[0.04]"
               style={{ backgroundImage: "radial-gradient(circle at 20% 20%, hsl(var(--primary)) 0%, transparent 50%)" }} />
          <div className="relative flex items-start justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
                <Briefcase className="w-5 h-5" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  Capital de Investidor
                  <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30">
                    fora do fluxo operacional
                  </span>
                </h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Aportes de sócios investidores — não contam como despesa nem como receita. Comparados ao retorno operacional.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 min-w-[420px]">
              <MiniStat label="Total investido" value={fmt(investor.total)} tone="primary" />
              <MiniStat label="Aporte do mês" value={fmt(investor.currentMonth)} tone="primary" />
              <MiniStat label={`Retorno ${period}m`} value={fmt(periodNet)}
                hint={investor.total > 0 ? `ROI ${roiPct.toFixed(1)}%` : "—"}
                tone={periodNet >= 0 ? "success" : "danger"} />
            </div>
          </div>

          {investor.contributors.length > 0 && (
            <div className="relative mt-4 pt-4 border-t border-primary/15">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Investidores</p>
              <div className="flex flex-wrap gap-2">
                {investor.contributors.map((c, i) => {
                  const pct = investor.total > 0 ? (c.value / investor.total) * 100 : 0;
                  return (
                    <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/40 border border-border">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                      <span className="text-[12px] text-foreground font-medium">{c.name}</span>
                      <span className="text-[11px] font-mono text-muted-foreground">{fmt(c.value)}</span>
                      <span className="text-[10px] text-primary">{pct.toFixed(0)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}



      {/* CASH FLOW CHART */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Evolução do caixa</h3>
            <p className="text-[11px] text-muted-foreground">Entradas vs saídas e saldo acumulado projetado</p>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-success" /> Receita</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-destructive" /> Despesa</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-primary" /> Acumulado</span>
          </div>
        </div>
        <div className="h-[320px]">
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
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }}
                formatter={(v: any) => fmt(Number(v))}
              />
              <Bar dataKey="receitas" stackId="in" fill="url(#recGrad)" radius={[6, 6, 0, 0]} name="Receita" />
              <Bar dataKey="pendReceita" stackId="in" fill="hsl(var(--success) / 0.25)" radius={[6, 6, 0, 0]} name="Receita prevista" />
              <Bar dataKey="despesas" stackId="out" fill="url(#despGrad)" radius={[6, 6, 0, 0]} name="Despesa" />
              <Bar dataKey="pendDespesa" stackId="out" fill="hsl(var(--destructive) / 0.25)" radius={[6, 6, 0, 0]} name="Despesa prevista" />
              <Line type="monotone" dataKey="acumulado" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 3 }} name="Acumulado" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* DRE + DISTRIBUICAO */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">DRE simplificado</h3>
              <p className="text-[11px] text-muted-foreground">Resultado mensal — receita, custo e margem</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-muted-foreground border-b border-border">
                  <th className="text-left py-2 font-medium">Mês</th>
                  <th className="text-right py-2 font-medium">Receita</th>
                  <th className="text-right py-2 font-medium">Despesa</th>
                  <th className="text-right py-2 font-medium">Lucro</th>
                  <th className="text-right py-2 font-medium">Margem</th>
                </tr>
              </thead>
              <tbody>
                {dre.map((r, i) => (
                  <tr key={i} className="border-b border-border/40 last:border-0">
                    <td className="py-2 text-foreground">{r.label}</td>
                    <td className="py-2 text-right font-mono text-success">{fmtCompact(r.receita)}</td>
                    <td className="py-2 text-right font-mono text-destructive">{fmtCompact(r.despesa)}</td>
                    <td className={`py-2 text-right font-mono font-semibold ${r.lucro >= 0 ? "text-foreground" : "text-destructive"}`}>{fmtCompact(r.lucro)}</td>
                    <td className={`py-2 text-right font-mono ${r.margem >= 0 ? "text-success" : "text-destructive"}`}>
                      {r.margem.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1">Despesas por categoria</h3>
          <p className="text-[11px] text-muted-foreground mb-3">Distribuição total</p>
          {byCat.length === 0 ? (
            <p className="text-[12px] text-muted-foreground py-10 text-center">Nenhuma despesa cadastrada</p>
          ) : (
            <>
              <div className="h-[160px]">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={byCat} dataKey="value" innerRadius={45} outerRadius={70} paddingAngle={2}>
                      {byCat.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => fmt(Number(v))} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5 mt-3">
                {byCat.slice(0, 5).map((c, i) => {
                  const pct = (c.value / byCat.reduce((a, x) => a + x.value, 0)) * 100;
                  return (
                    <div key={i} className="flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.color }} />
                        <span className="text-foreground truncate">{c.name}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-muted-foreground">{pct.toFixed(0)}%</span>
                        <span className="font-mono text-foreground">{fmtCompact(c.value)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* AP / AR / DESPESAS */}
      <Tabs defaultValue="ap" className="space-y-4">
        <TabsList className="bg-secondary/50 border border-border rounded-lg p-1">
          <TabsTrigger value="ap" className="text-[12px] rounded-md">A pagar ({accountsPayable.length})</TabsTrigger>
          <TabsTrigger value="ar" className="text-[12px] rounded-md">A receber ({accountsReceivable.length})</TabsTrigger>
          <TabsTrigger value="exp" className="text-[12px] rounded-md">Despesas ({expenses.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="ap">
          <div className="rounded-2xl border border-border bg-card divide-y divide-border">
            {accountsPayable.length === 0 && (
              <div className="p-10 text-center text-[12px] text-muted-foreground">Nada a pagar 🎉</div>
            )}
            {accountsPayable.map((e: any) => {
              const cm = catMeta(e.category);
              return (
                <div key={e.id} className="flex items-center justify-between p-4 hover:bg-secondary/30 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${cm.color}22`, color: cm.color }}>
                      <Calendar className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-foreground truncate">{e.description}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {cm.label} · Vence {parseDate(e.due_date)?.toLocaleDateString("pt-BR")}
                        {e.supplier && ` · ${e.supplier}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {e.overdue ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-destructive/15 text-destructive">{Math.abs(e.daysUntil)}d atrasado</span>
                    ) : e.daysUntil <= 7 ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-warning/15 text-warning">{e.daysUntil}d</span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{e.daysUntil}d</span>
                    )}
                    <span className="text-[13px] font-mono font-semibold text-foreground">{fmt(Number(e.amount))}</span>
                    <button onClick={() => togglePaid(e)} className="text-[11px] px-2.5 py-1 rounded-md bg-success/15 text-success hover:bg-success/25 cursor-pointer border-none">Pagar</button>
                    <button onClick={() => setExpenseModal(e)} className="text-muted-foreground hover:text-foreground cursor-pointer"><Edit3 className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setConfirmDel(e.id)} className="text-muted-foreground hover:text-destructive cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="ar">
          <div className="rounded-2xl border border-border bg-card divide-y divide-border">
            {accountsReceivable.length === 0 && (
              <div className="p-10 text-center text-[12px] text-muted-foreground">Nada a receber no momento</div>
            )}
            {accountsReceivable.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between p-4 hover:bg-secondary/30 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-success/15 text-success">
                    <ArrowUpRight className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-foreground truncate">{r.description}</p>
                    <p className="text-[11px] text-muted-foreground">{r.client} · Vence {parseDate(r.due_date)?.toLocaleDateString("pt-BR")}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {r.overdue ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-destructive/15 text-destructive">{Math.abs(r.daysUntil)}d atrasado</span>
                  ) : r.daysUntil <= 7 ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-warning/15 text-warning">{r.daysUntil}d</span>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{r.daysUntil}d</span>
                  )}
                  <span className="text-[13px] font-mono font-semibold text-success">{fmt(r.amount)}</span>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="exp">
          <div className="rounded-2xl border border-border bg-card divide-y divide-border">
            {expenses.length === 0 && (
              <div className="p-10 text-center text-[12px] text-muted-foreground">
                Nenhuma despesa cadastrada. Clique em "Nova Despesa" para começar.
              </div>
            )}
            {expenses.map((e: any) => {
              const cm = catMeta(e.category);
              return (
                <div key={e.id} className="flex items-center justify-between p-4 hover:bg-secondary/30 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${cm.color}22`, color: cm.color }}>
                      {e.status === "paid" ? <TrendingDown className="w-4 h-4" /> : <Calendar className="w-4 h-4" />}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-foreground truncate">{e.description}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {cm.label} · {parseDate(e.due_date)?.toLocaleDateString("pt-BR")}
                        {e.recurrence === "monthly" && " · Mensal"}
                        {e.recurrence === "yearly" && " · Anual"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${e.status === "paid" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
                      {e.status === "paid" ? "Pago" : "Pendente"}
                    </span>
                    <span className="text-[13px] font-mono font-semibold text-foreground">{fmt(Number(e.amount))}</span>
                    <button onClick={() => togglePaid(e)} className="text-[11px] px-2.5 py-1 rounded-md bg-secondary text-muted-foreground hover:text-foreground cursor-pointer border border-border">
                      {e.status === "paid" ? "Reabrir" : "Pagar"}
                    </button>
                    <button onClick={() => setExpenseModal(e)} className="text-muted-foreground hover:text-foreground cursor-pointer"><Edit3 className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setConfirmDel(e.id)} className="text-muted-foreground hover:text-destructive cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {/* MODAL DESPESA */}
      <Dialog open={!!expenseModal} onOpenChange={(o) => !o && setExpenseModal(null)}>
        <DialogContent className="bg-card border-border max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground">{expenseModal?.id ? "Editar despesa" : "Nova despesa"}</DialogTitle>
          </DialogHeader>
          {expenseModal && <ExpenseForm initial={expenseModal} onSave={saveExpense} onCancel={() => setExpenseModal(null)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader><DialogTitle className="text-foreground">Remover despesa?</DialogTitle></DialogHeader>
          <p className="text-[13px] text-muted-foreground">Essa ação não pode ser desfeita.</p>
          <div className="flex justify-end gap-2 mt-3">
            <button onClick={() => setConfirmDel(null)} className="px-3 py-1.5 rounded-lg text-[12px] bg-secondary text-foreground border border-border cursor-pointer">Cancelar</button>
            <button onClick={() => confirmDel && deleteExpense(confirmDel)} className="px-3 py-1.5 rounded-lg text-[12px] bg-destructive text-destructive-foreground border-none cursor-pointer">Remover</button>
          </div>
        </DialogContent>
      </Dialog>

      <NewIncomeModal open={incomeModalOpen} onClose={() => setIncomeModalOpen(false)} existingProjects={[]} />
    </div>
  );
}

function KpiCard({ icon, label, value, hint, tone }: any) {
  const tones: any = {
    success: "from-success/15 to-success/0 text-success border-success/20",
    danger: "from-destructive/15 to-destructive/0 text-destructive border-destructive/20",
    primary: "from-primary/15 to-primary/0 text-primary border-primary/20",
    warning: "from-warning/15 to-warning/0 text-warning border-warning/20",
  };
  return (
    <div className={`relative rounded-2xl border bg-gradient-to-br ${tones[tone] || tones.primary} p-4 overflow-hidden`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</span>
        <span className="opacity-70">{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-mono font-semibold text-foreground tracking-tight">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>
    </div>
  );
}

function ExpenseForm({ initial, onSave, onCancel }: any) {
  const [form, setForm] = useState({
    id: initial.id || null,
    description: initial.description || "",
    category: initial.category || "outros",
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
    <div className="space-y-3">
      <div>
        <label className="text-[11px] text-muted-foreground">Descrição *</label>
        <Input value={form.description} onChange={e => set("description", e.target.value)} className="mt-1" placeholder="Ex: Aluguel escritório" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] text-muted-foreground">Categoria</label>
          <select value={form.category} onChange={e => set("category", e.target.value)}
            className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground">
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground">Valor (R$) *</label>
          <Input type="number" step="0.01" value={form.amount} onChange={e => set("amount", e.target.value)} className="mt-1" placeholder="0,00" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] text-muted-foreground">Vencimento *</label>
          <Input type="date" value={form.due_date} onChange={e => set("due_date", e.target.value)} className="mt-1" />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground">Recorrência</label>
          <select value={form.recurrence} onChange={e => set("recurrence", e.target.value)}
            className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground">
            <option value="none">Única</option>
            <option value="monthly">Mensal</option>
            <option value="yearly">Anual</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] text-muted-foreground">Fornecedor</label>
          <Input value={form.supplier} onChange={e => set("supplier", e.target.value)} className="mt-1" placeholder="Opcional" />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground">Forma de pagamento</label>
          <select value={form.payment_method} onChange={e => set("payment_method", e.target.value)}
            className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground">
            <option value="">—</option>
            <option value="pix">Pix</option>
            <option value="boleto">Boleto</option>
            <option value="cartao">Cartão</option>
            <option value="transferencia">Transferência</option>
            <option value="dinheiro">Dinheiro</option>
          </select>
        </div>
      </div>
      <div>
        <label className="text-[11px] text-muted-foreground">Status</label>
        <div className="flex gap-2 mt-1">
          {["pending", "paid"].map(s => (
            <button key={s} type="button" onClick={() => set("status", s)}
              className={`flex-1 px-3 py-2 rounded-lg text-[12px] font-medium border transition-colors cursor-pointer ${form.status === s ? "bg-primary text-primary-foreground border-primary" : "bg-secondary text-muted-foreground border-border"}`}>
              {s === "paid" ? "Pago" : "Pendente"}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-[11px] text-muted-foreground">Observações</label>
        <textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2}
          className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground resize-none" />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onCancel} className="px-4 py-2 rounded-lg text-[12px] bg-secondary text-foreground border border-border cursor-pointer">Cancelar</button>
        <button onClick={() => onSave(form)} className="px-4 py-2 rounded-lg text-[12px] bg-primary text-primary-foreground border-none cursor-pointer">
          {form.id ? "Salvar" : "Criar"}
        </button>
      </div>
    </div>
  );
}

function MiniStat({ label, value, hint, tone = "primary" }: any) {
  const toneCls: any = {
    primary: "text-primary",
    success: "text-success",
    danger: "text-destructive",
  };
  return (
    <div className="rounded-xl border border-border bg-card/60 backdrop-blur px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-base font-mono font-semibold ${toneCls[tone] || toneCls.primary}`}>{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}
