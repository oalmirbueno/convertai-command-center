import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { useBilling } from "@/hooks/useFinancialData";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getProjectBrand, matchesBrandFilter, BrandFilter, BRAND_FILTERS } from "@/lib/brandHelpers";
import { useState, useMemo } from "react";
import { ArrowLeft, Briefcase, TrendingUp, Lightbulb, Users, Zap, Target, BarChart3 } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
const MONTHS_FULL = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export default function AdminProjection() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const { data: clients } = useClients();
  const { data: billing } = useBilling();
  const { data: projectPayments } = useQuery({
    queryKey: ["all-project-payments-projection"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_payments")
        .select("*, project:projects!project_payments_project_id_fkey(name, project_type, status), client:profiles!project_payments_client_id_fkey(full_name, company_name), installments:payment_installments(*)");
      if (error) throw error;
      return data || [];
    },
    enabled: isAdmin,
  });

  const [brandFilter, setBrandFilter] = useState<BrandFilter>("all");

  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();
  const nextMonth = thisMonth === 11 ? 0 : thisMonth + 1;
  const nextYear = thisMonth === 11 ? thisYear + 1 : thisYear;

  const isNextMonth = (d: string) => {
    const date = new Date(d);
    return date.getMonth() === nextMonth && date.getFullYear() === nextYear;
  };

  const activeClients = useMemo(() =>
    (clients || []).filter((c: any) => c.plan_value && c.plan_status === "active"),
    [clients]
  );

  const showMonthly = brandFilter === "all" || brandFilter === "aceleriq";
  const showIndiv = brandFilter === "all" || brandFilter === "sitebolt";

  // Current month revenue (for comparison)
  const currentMonthRevenue = useMemo(() => {
    const billingRev = (billing || [])
      .filter((b: any) => (b.status === "paid" || b.status === "partial") && b.type !== "ads_recharge")
      .filter((b: any) => {
        const d = new Date(b.paid_date || b.due_date);
        return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
      })
      .reduce((s: number, b: any) => s + Number(b.status === "partial" ? (b.paid_amount || 0) : b.amount), 0);

    const instRev = (projectPayments || [])
      .filter((pp: any) => matchesBrandFilter(pp.project?.project_type, brandFilter))
      .reduce((sum: number, pp: any) =>
        sum + (pp.installments || [])
          .filter((i: any) => (i.status === "paid" || i.status === "partial") && (() => {
            const d = new Date(i.paid_date || i.due_date);
            return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
          })())
          .reduce((s: number, i: any) => s + Number(i.status === "partial" ? (i.paid_amount || 0) : i.amount), 0), 0);

    return (showMonthly ? billingRev : 0) + (showIndiv ? instRev : 0);
  }, [billing, projectPayments, brandFilter, showMonthly, showIndiv, thisMonth, thisYear]);

  // Recurring projection
  const recurringItems = useMemo(() =>
    showMonthly ? activeClients.map((c: any) => ({
      id: `rec-${c.id}`,
      label: c.plan_name ? `Renovação — ${c.plan_name}` : "Renovação Mensal",
      client: c.company_name || c.full_name || "—",
      amount: Number(c.plan_value),
      due: c.plan_renewal_date || "",
      brand: "AcelerIQ",
      type: "recurring" as const,
    })) : [],
    [activeClients, showMonthly]
  );

  // Installment projection
  const indivItems = useMemo(() =>
    showIndiv ? (projectPayments || [])
      .filter((pp: any) => matchesBrandFilter(pp.project?.project_type, brandFilter))
      .flatMap((pp: any) =>
        (pp.installments || [])
          .filter((i: any) => i.status === "pending" && isNextMonth(i.due_date))
          .map((i: any) => ({
            id: `inst-${i.id}`,
            label: `${pp.project?.name || "Projeto"} — ${i.installment_number === 0 ? "Entrada" : `Parcela ${i.installment_number}`}`,
            client: pp.client?.company_name || pp.client?.full_name || "—",
            amount: Number(i.amount),
            due: i.due_date,
            brand: getProjectBrand(pp.project?.project_type),
            type: "installment" as const,
          }))
      ) : [],
    [projectPayments, brandFilter, showIndiv, nextMonth, nextYear]
  );

  const allItems = [...recurringItems, ...indivItems].sort((a, b) => a.client.localeCompare(b.client));
  const recurringTotal = recurringItems.reduce((s, i) => s + i.amount, 0);
  const indivTotal = indivItems.reduce((s, i) => s + i.amount, 0);
  const projectedTotal = recurringTotal + indivTotal;
  const doubleTarget = projectedTotal * 2;
  const gap = doubleTarget - projectedTotal;

  // Pie data
  const pieData = [
    ...(recurringTotal > 0 ? [{ name: "Recorrente", value: recurringTotal }] : []),
    ...(indivTotal > 0 ? [{ name: "Projetos", value: indivTotal }] : []),
  ];
  const PIE_COLORS = ["hsl(var(--success))", "hsl(var(--info))"];

  // Comparison chart
  const comparisonData = [
    { name: "Mês Atual", valor: currentMonthRevenue },
    { name: MONTHS_FULL[nextMonth].slice(0, 3), valor: projectedTotal },
    { name: "Meta 2x", valor: doubleTarget },
  ];

  // Smart recommendations
  const recommendations = useMemo(() => {
    const recs: { icon: React.ElementType; title: string; description: string; impact: string; priority: "alta" | "média" | "baixa" }[] = [];

    const avgPlanValue = activeClients.length > 0
      ? activeClients.reduce((s: number, c: any) => s + Number(c.plan_value), 0) / activeClients.length
      : 0;

    const clientsNeededToDouble = avgPlanValue > 0 ? Math.ceil(gap / avgPlanValue) : 0;

    // 1. New clients
    if (clientsNeededToDouble > 0) {
      recs.push({
        icon: Users,
        title: `Conquistar +${clientsNeededToDouble} clientes recorrentes`,
        description: `Com ticket médio de ${fmt(avgPlanValue)}, você precisa de mais ${clientsNeededToDouble} clientes para dobrar a receita recorrente.`,
        impact: fmt(clientsNeededToDouble * avgPlanValue),
        priority: "alta",
      });
    }

    // 2. Upsell
    if (activeClients.length > 0) {
      const upsellTarget = gap / activeClients.length;
      recs.push({
        icon: TrendingUp,
        title: "Upsell nos planos atuais",
        description: `Aumentar o valor médio dos planos em ${fmt(upsellTarget)} por cliente eliminaria a diferença. Considere oferecer serviços adicionais ou upgrade de pacotes.`,
        impact: fmt(gap),
        priority: "alta",
      });
    }

    // 3. Individual projects
    const activeProjectCount = (projectPayments || []).filter((pp: any) => pp.project?.status !== "completed").length;
    const avgProjectValue = activeProjectCount > 0
      ? (projectPayments || []).reduce((s: number, pp: any) => s + Number(pp.total_value), 0) / (projectPayments || []).length
      : 0;
    if (avgProjectValue > 0) {
      const projectsNeeded = Math.ceil(gap / avgProjectValue);
      recs.push({
        icon: Briefcase,
        title: `Fechar +${projectsNeeded} projetos individuais`,
        description: `Com ticket médio de ${fmt(avgProjectValue)} por projeto, ${projectsNeeded} novos projetos cobrem a diferença para dobrar.`,
        impact: fmt(projectsNeeded * avgProjectValue),
        priority: "média",
      });
    }

    // 4. Reduce churn
    if (activeClients.length >= 3) {
      recs.push({
        icon: Target,
        title: "Reduzir churn e inadimplência",
        description: "Clientes inativos ou atrasados representam receita perdida. Reative contratos pausados e negocie pendências para recuperar receita previsível.",
        impact: "Variável",
        priority: "média",
      });
    }

    // 5. Automation
    recs.push({
      icon: Zap,
      title: "Oferecer pacotes de automação",
      description: "Automações têm alta margem e podem ser vendidas como add-on para clientes existentes. Crie pacotes de automação para aumentar o ticket sem aumentar a operação.",
      impact: "Alto potencial",
      priority: "baixa",
    });

    return recs;
  }, [activeClients, gap, projectPayments]);

  const priorityColor = (p: string) => {
    if (p === "alta") return "bg-destructive/10 text-destructive";
    if (p === "média") return "bg-warning/10 text-warning";
    return "bg-info/10 text-info";
  };

  if (!isAdmin) {
    navigate("/financeiro");
    return null;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/financeiro")} className="text-muted-foreground hover:text-foreground transition-colors bg-transparent border-none cursor-pointer">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Projeção — {MONTHS_FULL[nextMonth]} {nextYear}</h1>
            <p className="text-[12px] text-muted-foreground">Receita projetada e recomendações para crescimento</p>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-secondary/50 border border-border rounded-lg p-0.5">
          {BRAND_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setBrandFilter(f.value)}
              className={`text-[11px] px-3 py-1.5 rounded-md transition-colors cursor-pointer border-none ${
                brandFilter === f.value
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground bg-transparent"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-4 h-4 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Mês Atual</span>
          </div>
          <p className="text-lg font-semibold font-mono text-foreground">{fmt(currentMonthRevenue)}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{MONTHS_FULL[thisMonth]}</p>
        </div>
        <div className="bg-card border border-info/30 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Briefcase className="w-4 h-4 text-info" />
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Projeção</span>
          </div>
          <p className="text-lg font-semibold font-mono text-info">{fmt(projectedTotal)}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {showMonthly && showIndiv
              ? `🔄 ${fmt(recurringTotal)} · 📦 ${fmt(indivTotal)}`
              : MONTHS_FULL[nextMonth]}
          </p>
        </div>
        <div className="bg-card border border-success/30 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-4 h-4 text-success" />
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Meta 2x</span>
          </div>
          <p className="text-lg font-semibold font-mono text-success">{fmt(doubleTarget)}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Dobro da projeção atual</p>
        </div>
        <div className="bg-card border border-warning/30 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-warning" />
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Gap</span>
          </div>
          <p className="text-lg font-semibold font-mono text-warning">{fmt(gap)}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Falta para atingir 2x</p>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Comparison bar chart */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-[13px] font-medium text-foreground mb-4">Comparativo de Receita</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={comparisonData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="valor" radius={[6, 6, 0, 0]}>
                {comparisonData.map((_, i) => (
                  <Cell key={i} fill={i === 0 ? "hsl(var(--muted-foreground))" : i === 1 ? "hsl(var(--info))" : "hsl(var(--success))"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Pie chart */}
        {pieData.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-[13px] font-medium text-foreground mb-4">Composição da Projeção</h3>
            <div className="flex items-center gap-6">
              <ResponsiveContainer width="50%" height={200}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" stroke="none">
                    {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-3">
                {pieData.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ background: PIE_COLORS[i] }} />
                    <div>
                      <p className="text-[12px] text-foreground font-medium">{d.name}</p>
                      <p className="text-[11px] text-muted-foreground">{fmt(d.value)} ({((d.value / projectedTotal) * 100).toFixed(0)}%)</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Detailed items */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Briefcase className="w-3.5 h-3.5 text-info" />
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              Itens Projetados ({allItems.length})
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            {showMonthly && <span>🔄 Recorrente: <strong className="text-foreground">{fmt(recurringTotal)}</strong></span>}
            {showIndiv && <span>📦 Parcelas: <strong className="text-foreground">{fmt(indivTotal)}</strong></span>}
          </div>
        </div>
        {allItems.length === 0 ? (
          <div className="px-5 py-8 text-center text-[13px] text-muted-foreground">
            Nenhum item projetado para {MONTHS_FULL[nextMonth]}
          </div>
        ) : (
          <div className="divide-y divide-border max-h-[400px] overflow-y-auto">
            {allItems.map((item) => (
              <div key={item.id} className="flex items-center gap-3 px-5 py-3">
                <div className={`w-2 h-2 rounded-full shrink-0 ${item.type === "recurring" ? "bg-success" : "bg-info"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-foreground truncate">{item.label}</p>
                  <p className="text-[11px] text-muted-foreground">{item.client}</p>
                </div>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground whitespace-nowrap">{item.brand}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-info/10 text-info whitespace-nowrap">
                  {item.type === "recurring" ? "🔄 Recorrente" : "📦 Parcela"}
                </span>
                <p className="text-sm font-mono text-foreground whitespace-nowrap">{fmt(item.amount)}</p>
                {item.due && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground whitespace-nowrap">
                    {new Date(item.due + "T00:00:00").toLocaleDateString("pt-BR")}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recommendations */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <Lightbulb className="w-3.5 h-3.5 text-warning" />
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
            Recomendações para Dobrar o Faturamento
          </span>
        </div>
        <div className="divide-y divide-border">
          {recommendations.map((rec, i) => (
            <div key={i} className="px-5 py-4 flex gap-4">
              <div className="w-10 h-10 rounded-lg bg-secondary/50 flex items-center justify-center shrink-0">
                <rec.icon className="w-5 h-5 text-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-[14px] font-medium text-foreground">{rec.title}</p>
                  <span className={`text-[9px] px-2 py-0.5 rounded-full ${priorityColor(rec.priority)}`}>
                    {rec.priority}
                  </span>
                </div>
                <p className="text-[12px] text-muted-foreground leading-relaxed">{rec.description}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[10px] text-muted-foreground uppercase">Impacto</p>
                <p className="text-[13px] font-mono font-semibold text-success">{rec.impact}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
