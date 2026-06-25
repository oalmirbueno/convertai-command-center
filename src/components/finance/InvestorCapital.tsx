import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell,
} from "recharts";
import {
  Plus, Briefcase, TrendingUp, Edit3, Trash2, Calendar,
  ArrowUpRight, ArrowDownRight, Wallet, Info,
} from "lucide-react";

const fmt = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
const fmtCompact = (v: number) => {
  if (Math.abs(v) >= 1000) return `R$ ${(v / 1000).toFixed(1)}k`;
  return fmt(v);
};
const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const INVESTOR_LEGACY = "investidor";
const INV_PREFIX = "inv_";

const INVESTMENT_CATEGORIES = [
  { value: "inv_trafego", label: "Tráfego pago", color: "#00FF66" },
  { value: "inv_ferramentas", label: "Ferramentas", color: "#34d399" },
  { value: "inv_insumos", label: "Insumos", color: "#22d3ee" },
  { value: "inv_escritorio", label: "Escritório", color: "#60a5fa" },
  { value: "inv_outros", label: "Outros investimentos", color: "#a78bfa" },
];
const CAT_ALL = [
  ...INVESTMENT_CATEGORIES,
  { value: INVESTOR_LEGACY, label: "Aporte de sócio", color: "#00FF66" },
];
const catMeta = (v: string) => CAT_ALL.find(c => c.value === v) || INVESTMENT_CATEGORIES[INVESTMENT_CATEGORIES.length - 1];
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

interface Props {
  billing: any[];
  projectPayments: any[];
}

export default function InvestorCapital({ billing = [], projectPayments = [] }: Props) {
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ data: any } | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const { data: allExpenses = [] } = useQuery({
    queryKey: ["expenses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("expenses").select("*").order("due_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const investorEntries = useMemo(
    () => (allExpenses || []).filter(isInvestor).sort((a: any, b: any) => {
      const da = parseDate(a.paid_date || a.due_date)?.getTime() || 0;
      const db = parseDate(b.paid_date || b.due_date)?.getTime() || 0;
      return db - da;
    }),
    [allExpenses]
  );
  const operationalExpenses = useMemo(() => (allExpenses || []).filter((e: any) => !isInvestor(e)), [allExpenses]);

  // ───────── Capital agregado ─────────
  const investor = useMemo(() => {
    const curKey = monthKey(new Date());
    let total = 0;
    let currentMonth = 0;
    let firstDate: Date | null = null;
    const byInvestor: Record<string, number> = {};
    const byCat: Record<string, number> = {};
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
      byCat[e.category] = (byCat[e.category] || 0) + v;
    });
    const contributors = Object.entries(byInvestor)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    const allocation = Object.entries(byCat)
      .map(([k, v]) => ({ name: catMeta(k).label, value: v, color: catMeta(k).color }))
      .sort((a, b) => b.value - a.value);
    return { total, currentMonth, contributors, monthly, firstDate, allocation };
  }, [investorEntries]);

  // ───────── Retorno bruto desde a data exata do primeiro aporte ─────────
  const returns = useMemo(() => {
    if (!investor.firstDate) return { receitas: 0, despesas: 0, net: 0 };
    const since = new Date(investor.firstDate);
    since.setHours(0, 0, 0, 0);

    let receitas = 0;
    let despesas = 0;

    (billing || []).forEach((b: any) => {
      const paidAt = parseDate(b.paid_date);
      if (!paidAt || paidAt < since) return;
      if (b.status === "paid") receitas += Number(b.amount) || 0;
      else if (b.status === "partial") receitas += Number(b.paid_amount) || 0;
    });

    (projectPayments || []).forEach((p: any) => {
      (p.installments || []).forEach((i: any) => {
        const paidAt = parseDate(i.paid_date);
        if (!paidAt || paidAt < since) return;
        if (i.status === "paid") receitas += Number(i.amount) || 0;
        else if (i.status === "partial") receitas += Number(i.paid_amount) || 0;
      });
    });

    (operationalExpenses || []).forEach((e: any) => {
      const paidAt = parseDate(e.paid_date);
      if (!paidAt || paidAt < since) return;
      if (e.status === "paid") despesas += Number(e.amount) || 0;
    });

    return { receitas, despesas, net: receitas - despesas };
  }, [billing, projectPayments, operationalExpenses, investor.firstDate]);

  const daysSinceInvest = useMemo(() => {
    if (!investor.firstDate) return 0;
    const since = new Date(investor.firstDate);
    since.setHours(0, 0, 0, 0);
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.max(1, Math.ceil((now.getTime() - since.getTime()) / 86400000) + 1);
  }, [investor.firstDate]);

  const roiBruto = investor.total > 0 ? (returns.net / investor.total) * 100 : 0;
  const recoveryPct = investor.total > 0 ? Math.min(100, Math.max(0, (returns.net / investor.total) * 100)) : 0;

  // ───────── Série mensal (aporte vs retorno bruto acumulado desde 1º aporte) ─────────
  const series = useMemo(() => {
    if (!investor.firstDate) return [];
    const start = new Date(investor.firstDate.getFullYear(), investor.firstDate.getMonth(), 1);
    const now = new Date();
    const rows: { key: string; label: string; aporte: number; retorno: number; acumAporte: number; acumRetorno: number }[] = [];
    let accAporte = 0;
    let accRetorno = 0;
    for (let d = new Date(start); d <= now; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const k = monthKey(d);
      let aporte = investor.monthly[k] || 0;

      let receitas = 0;
      let despesas = 0;
      (billing || []).forEach((b: any) => {
        const paidAt = parseDate(b.paid_date);
        if (!paidAt) return;
        if (monthKey(paidAt) !== k) return;
        if (b.status === "paid") receitas += Number(b.amount) || 0;
        else if (b.status === "partial") receitas += Number(b.paid_amount) || 0;
      });
      (projectPayments || []).forEach((p: any) => {
        (p.installments || []).forEach((i: any) => {
          const paidAt = parseDate(i.paid_date);
          if (!paidAt || monthKey(paidAt) !== k) return;
          if (i.status === "paid") receitas += Number(i.amount) || 0;
          else if (i.status === "partial") receitas += Number(i.paid_amount) || 0;
        });
      });
      (operationalExpenses || []).forEach((e: any) => {
        const paidAt = parseDate(e.paid_date);
        if (!paidAt || monthKey(paidAt) !== k) return;
        if (e.status === "paid") despesas += Number(e.amount) || 0;
      });
      // primeiro mês: contar apenas do dia do aporte em diante
      if (k === monthKey(investor.firstDate)) {
        const since = new Date(investor.firstDate); since.setHours(0,0,0,0);
        receitas = 0; despesas = 0;
        (billing || []).forEach((b: any) => {
          const paidAt = parseDate(b.paid_date);
          if (!paidAt || paidAt < since || monthKey(paidAt) !== k) return;
          if (b.status === "paid") receitas += Number(b.amount) || 0;
          else if (b.status === "partial") receitas += Number(b.paid_amount) || 0;
        });
        (projectPayments || []).forEach((p: any) => {
          (p.installments || []).forEach((i: any) => {
            const paidAt = parseDate(i.paid_date);
            if (!paidAt || paidAt < since || monthKey(paidAt) !== k) return;
            if (i.status === "paid") receitas += Number(i.amount) || 0;
            else if (i.status === "partial") receitas += Number(i.paid_amount) || 0;
          });
        });
        (operationalExpenses || []).forEach((e: any) => {
          const paidAt = parseDate(e.paid_date);
          if (!paidAt || paidAt < since || monthKey(paidAt) !== k) return;
          if (e.status === "paid") despesas += Number(e.amount) || 0;
        });
      }
      const retorno = receitas - despesas;
      accAporte += aporte;
      accRetorno += retorno;
      rows.push({ key: k, label: monthLabel(k), aporte, retorno, acumAporte: accAporte, acumRetorno: accRetorno });
    }
    return rows;
  }, [investor.firstDate, investor.monthly, billing, projectPayments, operationalExpenses]);

  // ───────── Mutations ─────────
  const save = async (form: any) => {
    const payload = {
      description: form.description,
      category: form.category || "inv_outros",
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
      toast.error("Preencha descrição e data");
      return;
    }
    if (form.id) {
      const { error } = await supabase.from("expenses").update(payload).eq("id", form.id);
      if (error) return toast.error(error.message);
      toast.success("Aporte atualizado");
    } else {
      const { error } = await supabase.from("expenses").insert(payload);
      if (error) return toast.error(error.message);
      toast.success("Aporte registrado");
    }
    setModal(null);
    qc.invalidateQueries({ queryKey: ["expenses"] });
  };

  const del = async (id: string) => {
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Aporte removido");
    setConfirmDel(null);
    qc.invalidateQueries({ queryKey: ["expenses"] });
  };

  const hasData = investor.total > 0 || investorEntries.length > 0;

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
            <Briefcase className="w-5 h-5" />
          </span>
          <div>
            <h2 className="text-xl font-semibold text-foreground tracking-tight">Capital de Investidor</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Aportes de sócios isolados do fluxo operacional. ROI bruto medido a partir da data exata do primeiro aporte.
            </p>
          </div>
        </div>
        <button
          onClick={() => setModal({ data: {} })}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-primary text-primary-foreground hover:opacity-90 border-none cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" /> Novo aporte
        </button>
      </div>

      {!hasData ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center">
          <span className="inline-flex w-12 h-12 rounded-2xl bg-primary/10 text-primary items-center justify-center mb-3">
            <Briefcase className="w-6 h-6" />
          </span>
          <h3 className="text-sm font-semibold text-foreground">Nenhum capital registrado</h3>
          <p className="text-[12px] text-muted-foreground mt-1 max-w-md mx-auto">
            Quando um sócio investir, registre aqui. O valor não entra no DRE · fica isolado e serve de base para medir o retorno bruto da operação.
          </p>
          <button
            onClick={() => setModal({ data: {} })}
            className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-primary text-primary-foreground border-none cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Registrar primeiro aporte
          </button>
        </div>
      ) : (
        <>
          {/* RESUMO CAPITAL */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              icon={<Briefcase className="w-4 h-4" />}
              label="Total aportado"
              value={fmt(investor.total)}
              hint={investor.contributors.length === 1 ? "1 investidor" : `${investor.contributors.length} investidores`}
              tone="primary"
            />
            <StatCard
              icon={<Calendar className="w-4 h-4" />}
              label="Aporte deste mês"
              value={fmt(investor.currentMonth)}
              hint={investor.firstDate ? `Início ${investor.firstDate.toLocaleDateString("pt-BR")}` : "-"}
              tone="primary"
            />
            <StatCard
              icon={returns.net >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
              label={`Retorno bruto${daysSinceInvest ? ` (${daysSinceInvest}d)` : ""}`}
              value={fmt(returns.net)}
              hint={`${fmt(returns.receitas)} entradas · ${fmt(returns.despesas)} saídas`}
              tone={returns.net >= 0 ? "success" : "danger"}
            />
            <StatCard
              icon={<TrendingUp className="w-4 h-4" />}
              label="ROI bruto"
              value={investor.total > 0 ? `${roiBruto.toFixed(1)}%` : "-"}
              hint={returns.net >= 0 ? "Antes da divisão de custos" : "Ainda em recuperação"}
              tone={roiBruto >= 0 ? "success" : "danger"}
            />
          </div>

          {/* Barra de recuperação do capital */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Recuperação do capital</h3>
                <p className="text-[11px] text-muted-foreground">Quanto do total aportado já foi devolvido pela operação (bruto, sem divisão).</p>
              </div>
              <span className="text-sm font-mono font-semibold text-primary">{recoveryPct.toFixed(1)}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
              <div
                className={`h-full ${returns.net >= 0 ? "bg-primary" : "bg-destructive"}`}
                style={{ width: `${Math.max(2, recoveryPct)}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-2 text-[11px] text-muted-foreground font-mono">
              <span>R$ 0</span>
              <span>{fmt(investor.total)}</span>
            </div>
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2">
              <Info className="w-3.5 h-3.5 text-primary mt-0.5 flex-shrink-0" />
              <p className="text-[11px] text-muted-foreground leading-snug">
                ROI bruto = receitas confirmadas <span className="text-foreground">menos</span> despesas operacionais pagas, divididas pelo total aportado. Não considera ainda a divisão de custo entre sócios · esse rateio acontece em uma etapa posterior.
              </p>
            </div>
          </div>

          {/* GRÁFICO */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Evolução do capital vs retorno</h3>
                <p className="text-[11px] text-muted-foreground">Aporte acumulado e retorno bruto acumulado mês a mês.</p>
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-primary" /> Aporte acumulado</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-success" /> Retorno acumulado</span>
              </div>
            </div>
            <div className="h-[280px]">
              <ResponsiveContainer>
                <AreaChart data={series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="aporteGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                    </linearGradient>
                    <linearGradient id="retornoGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0.05} />
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
                  <Area type="monotone" dataKey="acumAporte" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#aporteGrad)" name="Aporte acumulado" />
                  <Area type="monotone" dataKey="acumRetorno" stroke="hsl(var(--success))" strokeWidth={2} fill="url(#retornoGrad)" name="Retorno acumulado" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* INVESTIDORES + ALOCAÇÃO */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground mb-1">Investidores</h3>
              <p className="text-[11px] text-muted-foreground mb-4">Participação no capital total aportado.</p>
              <div className="space-y-2">
                {investor.contributors.map((c, i) => {
                  const pct = investor.total > 0 ? (c.value / investor.total) * 100 : 0;
                  return (
                    <div key={i} className="rounded-xl border border-border bg-secondary/30 px-3 py-2.5">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                          <span className="text-[13px] font-medium text-foreground truncate">{c.name}</span>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <span className="text-[11px] text-primary font-mono font-semibold">{pct.toFixed(1)}%</span>
                          <span className="text-[13px] font-mono text-foreground">{fmt(c.value)}</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground mb-1">Alocação do capital</h3>
              <p className="text-[11px] text-muted-foreground mb-3">Para onde o capital está sendo direcionado.</p>
              {investor.allocation.length === 0 ? (
                <p className="text-[12px] text-muted-foreground py-10 text-center">Sem dados</p>
              ) : (
                <>
                  <div className="h-[160px]">
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={investor.allocation} dataKey="value" innerRadius={45} outerRadius={70} paddingAngle={2}>
                          {investor.allocation.map((d, i) => <Cell key={i} fill={d.color} />)}
                        </Pie>
                        <Tooltip formatter={(v: any) => fmt(Number(v))}
                          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-1.5 mt-3">
                    {investor.allocation.slice(0, 5).map((c, i) => {
                      const tot = investor.allocation.reduce((a, x) => a + x.value, 0);
                      const pct = tot > 0 ? (c.value / tot) * 100 : 0;
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

          {/* MOVIMENTAÇÕES */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Histórico de aportes</h3>
                <p className="text-[11px] text-muted-foreground">Cada lançamento de capital registrado.</p>
              </div>
              <span className="text-[11px] text-muted-foreground font-mono">{investorEntries.length} lançamentos</span>
            </div>
            <div className="divide-y divide-border">
              {investorEntries.map((e: any) => {
                const cm = catMeta(e.category);
                return (
                  <div key={e.id} className="flex items-center justify-between p-4 hover:bg-secondary/30 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${cm.color}22`, color: cm.color }}>
                        <Briefcase className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-foreground truncate">{e.description}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {cm.label} · {parseDate(e.paid_date || e.due_date)?.toLocaleDateString("pt-BR")}
                          {e.supplier && ` · ${e.supplier}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${e.status === "paid" ? "bg-primary/15 text-primary" : "bg-warning/15 text-warning"}`}>
                        {e.status === "paid" ? "Aportado" : "Previsto"}
                      </span>
                      <span className="text-[13px] font-mono font-semibold text-primary">{fmt(Number(e.amount))}</span>
                      <button onClick={() => setModal({ data: e })} className="text-muted-foreground hover:text-foreground cursor-pointer"><Edit3 className="w-3.5 h-3.5" /></button>
                      <button onClick={() => setConfirmDel(e.id)} className="text-muted-foreground hover:text-destructive cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* MODAL APORTE */}
      <Dialog open={!!modal} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent className="bg-card border-border max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-primary" />
              {modal?.data?.id ? "Editar aporte" : "Novo aporte de capital"}
            </DialogTitle>
          </DialogHeader>
          {modal && (
            <InvestorForm
              initial={modal.data}
              onSave={save}
              onCancel={() => setModal(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader><DialogTitle className="text-foreground">Remover aporte?</DialogTitle></DialogHeader>
          <p className="text-[13px] text-muted-foreground">Essa ação não pode ser desfeita. O ROI será recalculado.</p>
          <div className="flex justify-end gap-2 mt-3">
            <button onClick={() => setConfirmDel(null)} className="px-3 py-1.5 rounded-lg text-[12px] bg-secondary text-foreground border border-border cursor-pointer">Cancelar</button>
            <button onClick={() => confirmDel && del(confirmDel)} className="px-3 py-1.5 rounded-lg text-[12px] bg-destructive text-destructive-foreground border-none cursor-pointer">Remover</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ icon, label, value, hint, tone }: any) {
  const tones: any = {
    success: "from-success/15 to-success/0 text-success border-success/20",
    danger: "from-destructive/15 to-destructive/0 text-destructive border-destructive/20",
    primary: "from-primary/15 to-primary/0 text-primary border-primary/20",
  };
  return (
    <div className={`relative rounded-2xl border bg-gradient-to-br ${tones[tone] || tones.primary} p-4 overflow-hidden`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</span>
        <span className="opacity-70">{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-mono font-semibold text-foreground tracking-tight">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

function InvestorForm({ initial, onSave, onCancel }: any) {
  const [form, setForm] = useState({
    id: initial.id || null,
    description: initial.description || "",
    category: initial.category || "inv_outros",
    amount: initial.amount?.toString() || "",
    due_date: initial.due_date || new Date().toISOString().slice(0, 10),
    paid_date: initial.paid_date || "",
    status: initial.status || "paid",
    recurrence: initial.recurrence || "none",
    supplier: initial.supplier || "",
    payment_method: initial.payment_method || "",
    notes: initial.notes || "",
  });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2">
        <p className="text-[11px] text-foreground">
          <span className="text-primary font-semibold">Capital de investidor.</span> Não conta como receita nem como despesa. Serve de base para medir o ROI bruto a partir da data do aporte.
        </p>
      </div>
      <div>
        <label className="text-[11px] text-muted-foreground">Descrição *</label>
        <Input value={form.description} onChange={e => set("description", e.target.value)} className="mt-1" placeholder="Ex: Aporte sócio Junho/26" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] text-muted-foreground">Destino do capital</label>
          <select value={form.category} onChange={e => set("category", e.target.value)}
            className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground">
            {INVESTMENT_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground">Valor (R$) *</label>
          <Input type="number" step="0.01" value={form.amount} onChange={e => set("amount", e.target.value)} className="mt-1" placeholder="0,00" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] text-muted-foreground">Data do aporte *</label>
          <Input type="date" value={form.due_date} onChange={e => set("due_date", e.target.value)} className="mt-1" />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground">Investidor / Sócio</label>
          <Input value={form.supplier} onChange={e => set("supplier", e.target.value)} className="mt-1" placeholder="Nome do investidor" />
        </div>
      </div>
      <div>
        <label className="text-[11px] text-muted-foreground">Status</label>
        <div className="flex gap-2 mt-1">
          {[
            { v: "paid", label: "Aportado" },
            { v: "pending", label: "Previsto" },
          ].map(s => (
            <button key={s.v} type="button" onClick={() => set("status", s.v)}
              className={`flex-1 px-3 py-2 rounded-lg text-[12px] font-medium border transition-colors cursor-pointer ${form.status === s.v ? "bg-primary text-primary-foreground border-primary" : "bg-secondary text-muted-foreground border-border"}`}>
              {s.label}
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
          {form.id ? "Salvar" : "Registrar aporte"}
        </button>
      </div>
    </div>
  );
}
