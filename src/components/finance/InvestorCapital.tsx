import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell,
} from "recharts";
import { Plus, Briefcase, Edit3, Trash2 } from "lucide-react";
import {
  CampoDeFormulario, Carregando, EstadoDeErro, EstadoVazio, GrupoDeCampos, Painel, RegiaoRolavel, Secao, SeletorCompacto,
  botao, campo, campoTexto, juntar, superficie, texto,
} from "@/components/sistema";
import { AcoesDoDialogo, Etiqueta, GradeDeKpis, Kpi } from "@/components/finance/pecasDoFinanceiro";

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

  const { data: allExpenses = [], isLoading, error, refetch } = useQuery({
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
  // Esqueleto só na primeira carga (sem dado ainda).
  const primeiraCarga = isLoading && (allExpenses || []).length === 0;

  return (
    <div className="min-w-0 space-y-6">
      <Secao
        titulo="Capital de investidor"
        descricao={hasData ? `${investorEntries.length} ${investorEntries.length === 1 ? "lançamento" : "lançamentos"}` : undefined}
        ajuda="Aportes de sócios ficam isolados do fluxo operacional: não entram como receita nem como despesa. O ROI bruto é medido a partir da data exata do primeiro aporte."
        acao={
          hasData ? (
            <button type="button" onClick={() => setModal({ data: {} })} className={botao.primario} aria-label="Novo aporte">
              <Plus className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" />
              <span className="hidden sm:inline">Novo aporte</span>
            </button>
          ) : undefined
        }
      >
        {error ? (
          <EstadoDeErro
            titulo="Não consegui ler os aportes."
            acao={<button type="button" onClick={() => refetch()} className={botao.secundario}>Tentar de novo</button>}
          />
        ) : primeiraCarga ? (
          <Carregando forma="aba" rotulo="Carregando capital" />
        ) : !hasData ? (
          <EstadoVazio
            icone={<Briefcase className="h-5 w-5" />}
            titulo="Nenhum capital registrado"
            descricao="Quando um sócio investir, registre aqui. O valor fica fora do DRE e serve de base para medir o retorno."
            acao={
              <button type="button" onClick={() => setModal({ data: {} })} className={botao.primario}>
                <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Registrar primeiro aporte
              </button>
            }
          />
        ) : (
          <GradeDeKpis>
            <Kpi
              rotulo="Total aportado"
              valor={fmt(investor.total)}
              apoio={investor.contributors.length === 1 ? "1 investidor" : `${investor.contributors.length} investidores`}
              tom="primario"
            />
            <Kpi
              rotulo="Aporte deste mês"
              valor={fmt(investor.currentMonth)}
              apoio={investor.firstDate ? `Início ${investor.firstDate.toLocaleDateString("pt-BR")}` : "-"}
            />
            <Kpi
              rotulo={`Retorno bruto${daysSinceInvest ? ` (${daysSinceInvest}d)` : ""}`}
              valor={fmt(returns.net)}
              apoio={`${fmt(returns.receitas)} entradas · ${fmt(returns.despesas)} saídas`}
              tom={returns.net >= 0 ? "sucesso" : "perigo"}
            />
            <Kpi
              rotulo="ROI bruto"
              valor={investor.total > 0 ? `${roiBruto.toFixed(1)}%` : "-"}
              apoio={returns.net >= 0 ? "Antes da divisão de custos" : "Ainda em recuperação"}
              tom={roiBruto >= 0 ? "sucesso" : "perigo"}
            />
          </GradeDeKpis>
        )}
      </Secao>

      {hasData && !error && (
        <>
          {/* Barra de recuperação do capital */}
          <Secao
            divisoria
            titulo="Recuperação do capital"
            ajuda="Quanto do total aportado já voltou pela operação, bruto. ROI bruto = receitas confirmadas menos despesas operacionais pagas, divididas pelo total aportado. Ainda não considera a divisão de custo entre sócios: esse rateio acontece numa etapa posterior."
            acao={<span className="text-[15px] font-semibold tabular-nums text-primary">{recoveryPct.toFixed(1)}%</span>}
          >
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(recoveryPct)} aria-label="Recuperação do capital">
              <div
                className={juntar("h-full", returns.net >= 0 ? "bg-primary" : "bg-destructive")}
                style={{ width: `${Math.max(2, recoveryPct)}%` }}
              />
            </div>
            <div className={juntar(texto.auxiliar, "mt-1.5 flex items-center justify-between tabular-nums")}>
              <span>R$ 0</span>
              <span>{fmt(investor.total)}</span>
            </div>
          </Secao>

          {/* GRÁFICO */}
          <Secao
            divisoria
            titulo="Capital e retorno"
            ajuda="Aporte acumulado e retorno bruto acumulado, mês a mês, desde o primeiro aporte."
            acao={
              <div className={juntar(texto.auxiliar, "hidden items-center sm:flex")}>
                <span className="mr-3 flex items-center"><span className="mr-1.5 h-2.5 w-2.5 rounded-sm bg-primary" /> Aporte</span>
                <span className="flex items-center"><span className="mr-1.5 h-2.5 w-2.5 rounded-sm bg-success" /> Retorno</span>
              </div>
            }
          >
            <Painel>
              <div className="h-[260px]">
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
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 12 }}
                      formatter={(v: any) => fmt(Number(v))}
                    />
                    <Area type="monotone" dataKey="acumAporte" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#aporteGrad)" name="Aporte acumulado" isAnimationActive={false} />
                    <Area type="monotone" dataKey="acumRetorno" stroke="hsl(var(--success))" strokeWidth={2} fill="url(#retornoGrad)" name="Retorno acumulado" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Painel>
          </Secao>

          {/* INVESTIDORES + ALOCAÇÃO */}
          <div className="grid min-w-0 grid-cols-1 gap-6 border-t border-border pt-5 lg:grid-cols-3">
            <Secao titulo="Investidores" ajuda="Participação de cada um no capital total aportado." className="lg:col-span-2">
              <ul className="divide-y divide-border">
                {investor.contributors.map((c, i) => {
                  const pct = investor.total > 0 ? (c.value / investor.total) * 100 : 0;
                  return (
                    <li key={i} className="min-w-0 py-2.5">
                      <div className="mb-1.5 flex min-w-0 items-center">
                        <span className="mr-3 min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{c.name}</span>
                        <span className="mr-3 shrink-0 text-[12px] font-semibold tabular-nums text-primary">{pct.toFixed(1)}%</span>
                        <span className="shrink-0 text-[13px] tabular-nums text-foreground">{fmt(c.value)}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Secao>

            <Secao titulo="Alocação" ajuda="Para onde o capital está sendo direcionado.">
              {investor.allocation.length === 0 ? (
                <EstadoVazio compacto titulo="Sem dados." />
              ) : (
                <>
                  <div className="h-[160px]">
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={investor.allocation} dataKey="value" innerRadius={45} outerRadius={70} paddingAngle={2} isAnimationActive={false}>
                          {investor.allocation.map((d, i) => <Cell key={i} fill={d.color} />)}
                        </Pie>
                        <Tooltip formatter={(v: any) => fmt(Number(v))}
                          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="mt-3 space-y-1.5">
                    {investor.allocation.slice(0, 5).map((c, i) => {
                      const tot = investor.allocation.reduce((a, x) => a + x.value, 0);
                      const pct = tot > 0 ? (c.value / tot) * 100 : 0;
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
          <Secao divisoria titulo="Histórico de aportes" descricao={`${investorEntries.length} ${investorEntries.length === 1 ? "lançamento" : "lançamentos"}`}>
            <RegiaoRolavel memoria="financeiro:capital:aportes" rotulo="Histórico de aportes" className="lg:max-h-[60vh]">
              <ul className="divide-y divide-border">
                {investorEntries.map((e: any) => {
                  const cm = catMeta(e.category);
                  return (
                    <li key={e.id} className="flex min-w-0 flex-wrap items-center py-2.5">
                      <span className="mr-3 h-2 w-2 shrink-0 rounded-full" style={{ background: cm.color }} aria-hidden="true" />
                      <div className="mr-3 min-w-0 flex-1 basis-48">
                        <p className="truncate text-[13px] font-medium text-foreground">{e.description}</p>
                        <p className={juntar(texto.auxiliar, "truncate")}>
                          {cm.label} · {parseDate(e.paid_date || e.due_date)?.toLocaleDateString("pt-BR")}
                          {e.supplier && ` · ${e.supplier}`}
                        </p>
                      </div>
                      <div className="ml-auto flex shrink-0 items-center py-1">
                        <Etiqueta tom={e.status === "paid" ? "primario" : "aviso"} className="mr-3">
                          {e.status === "paid" ? "Aportado" : "Previsto"}
                        </Etiqueta>
                        <span className="mr-1 text-[13px] font-semibold tabular-nums text-primary">{fmt(Number(e.amount))}</span>
                        <button type="button" onClick={() => setModal({ data: e })} className={botao.icone} aria-label={`Editar ${e.description}`} title="Editar">
                          <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button type="button" onClick={() => setConfirmDel(e.id)} className={juntar(botao.icone, "hover:text-destructive")} aria-label={`Remover ${e.description}`} title="Remover">
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </RegiaoRolavel>
          </Secao>
        </>
      )}

      {/* MODAL APORTE */}
      <Dialog open={!!modal} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border-border bg-card">
          <DialogHeader>
            <DialogTitle className="flex items-center text-foreground">
              <Briefcase className="mr-2 h-4 w-4 text-primary" aria-hidden="true" />
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
        <DialogContent className="max-w-sm border-border bg-card">
          <DialogHeader><DialogTitle className="text-foreground">Remover aporte?</DialogTitle></DialogHeader>
          <p className="text-[13px] leading-5 text-muted-foreground">Não dá para desfazer. O ROI é recalculado.</p>
          <AcoesDoDialogo>
            <button type="button" onClick={() => setConfirmDel(null)} className={botao.discreto}>Cancelar</button>
            <button type="button" onClick={() => confirmDel && del(confirmDel)} className={botao.perigo}>Remover</button>
          </AcoesDoDialogo>
        </DialogContent>
      </Dialog>
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
    <div className="space-y-4">
      <p className={juntar(superficie.poco, "px-3 py-2 text-[12px] leading-5 text-muted-foreground")}>
        <span className="font-semibold text-primary">Capital de investidor.</span> Não conta como receita nem como despesa. É a base do ROI bruto a partir da data do aporte.
      </p>
      <GrupoDeCampos>
        <CampoDeFormulario rotulo="Descrição" obrigatorio largo>
          <input value={form.description} onChange={e => set("description", e.target.value)} className={campo} placeholder="Ex.: Aporte sócio junho/26" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Destino do capital">
          <select value={form.category} onChange={e => set("category", e.target.value)} className={campo}>
            {INVESTMENT_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Valor (R$)" obrigatorio>
          <input type="number" step="0.01" inputMode="decimal" value={form.amount} onChange={e => set("amount", e.target.value)} className={campo} placeholder="0,00" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Data do aporte" obrigatorio>
          <input type="date" value={form.due_date} onChange={e => set("due_date", e.target.value)} className={campo} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Investidor / sócio">
          <input value={form.supplier} onChange={e => set("supplier", e.target.value)} className={campo} placeholder="Nome do investidor" />
        </CampoDeFormulario>
        <div className="min-w-0 sm:col-span-full">
          <p className={juntar(texto.rotulo, "mb-1.5")}>Status</p>
          <SeletorCompacto
            opcoes={[{ valor: "paid", rotulo: "Aportado" }, { valor: "pending", rotulo: "Previsto" }]}
            valor={form.status}
            onEscolher={(v) => set("status", v)}
            rotulo="Status do aporte"
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
          {form.id ? "Salvar" : "Registrar aporte"}
        </button>
      </AcoesDoDialogo>
    </div>
  );
}
