import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { useBilling } from "@/hooks/useFinancialData";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getProjectBrand, matchesBrandFilter, BrandFilter, BRAND_FILTERS } from "@/lib/brandHelpers";
import { useMemo } from "react";
import { Briefcase, TrendingUp, Users, Zap, Target, BarChart3 } from "lucide-react";
import {
  CabecalhoDePagina, Carregando, EstadoDeErro, EstadoVazio, Painel, RegiaoRolavel, Secao, SeletorCompacto, useEstadoDaTela,
  botao, etiqueta, juntar, superficie, texto,
} from "@/components/sistema";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
const MONTHS_FULL = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const receivedOf = (row: any) => {
  const total = Number(row?.amount) || 0;
  const paid = Number(row?.paid_amount) || 0;
  if (row?.status === "partial") return Math.min(paid, total);
  if (row?.status === "paid") return paid > 0 && paid < total ? paid : total;
  return 0;
};

export default function AdminProjection() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const { data: clients } = useClients();
  const billingQuery = useBilling();
  const { data: billing } = billingQuery;
  const paymentsQuery = useQuery({
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
  const { data: projectPayments } = paymentsQuery;

  // Marca escolhida fica guardada ao sair e voltar.
  const [brandFilter, setBrandFilter] = useEstadoDaTela<BrandFilter>("projecao:marca", "all", {
    validar: (v) => BRAND_FILTERS.some((f) => f.value === v),
  });

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
    (clients || []).filter((c: any) => c.plan_value && c.plan_status === "active" && c.client_type !== "one_off"),
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
      .reduce((s: number, b: any) => s + receivedOf(b), 0);

    const instRev = (projectPayments || [])
      .filter((pp: any) => matchesBrandFilter(pp.project?.project_type, brandFilter))
      .reduce((sum: number, pp: any) =>
        sum + (pp.installments || [])
          .filter((i: any) => (i.status === "paid" || i.status === "partial") && (() => {
            const d = new Date(i.paid_date || i.due_date);
            return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
          })())
          .reduce((s: number, i: any) => s + receivedOf(i), 0), 0);

    return (showMonthly ? billingRev : 0) + (showIndiv ? instRev : 0);
  }, [billing, projectPayments, brandFilter, showMonthly, showIndiv, thisMonth, thisYear]);

  // Recurring projection
  const recurringItems = useMemo(() =>
    showMonthly ? activeClients.map((c: any) => ({
      id: `rec-${c.id}`,
      label: c.plan_name ? `Renovação: ${c.plan_name}` : "Renovação Mensal",
      client: c.company_name || c.full_name || "-",
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
            label: `${pp.project?.name || "Projeto"}: ${i.installment_number === 0 ? "Entrada" : `Parcela ${i.installment_number}`}`,
            client: pp.client?.company_name || pp.client?.full_name || "-",
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
    return <Navigate to="/financeiro" replace />;
  }

  const primeiraCarga = (billingQuery.isLoading && !billing) || (paymentsQuery.isLoading && !projectPayments);
  const erroAoLer = (billingQuery.isError && !billing) || (paymentsQuery.isError && !projectPayments);
  const numeros = [
    { rotulo: "Mês atual", valor: fmt(currentMonthRevenue), sub: MONTHS_FULL[thisMonth], icone: <BarChart3 className="h-3.5 w-3.5" />, cor: "text-foreground", corIcone: "text-muted-foreground" },
    {
      rotulo: "Projeção",
      valor: fmt(projectedTotal),
      sub: showMonthly && showIndiv ? `Recorrente ${fmt(recurringTotal)} · Parcelas ${fmt(indivTotal)}` : MONTHS_FULL[nextMonth],
      icone: <Briefcase className="h-3.5 w-3.5" />,
      cor: "text-info",
      corIcone: "text-info",
    },
    { rotulo: "Meta 2x", valor: fmt(doubleTarget), sub: "Dobro da projeção", icone: <Target className="h-3.5 w-3.5" />, cor: "text-success", corIcone: "text-success" },
    { rotulo: "Diferença", valor: fmt(gap), sub: "Falta para chegar a 2x", icone: <TrendingUp className="h-3.5 w-3.5" />, cor: "text-warning", corIcone: "text-warning" },
  ];

  return (
    <div className="min-w-0 space-y-6 pb-4">
      <CabecalhoDePagina
        titulo={`Projeção de ${MONTHS_FULL[nextMonth]}`}
        descricao={String(nextYear)}
        voltar={{ para: "/financeiro", rotulo: "Financeiro" }}
        ajuda="Receita projetada para o próximo mês (planos ativos e parcelas que vencem) e o que falta para dobrar o faturamento."
        acoes={
          <SeletorCompacto
            opcoes={BRAND_FILTERS.map((f) => ({ valor: f.value, rotulo: f.label }))}
            valor={brandFilter}
            onEscolher={(v) => setBrandFilter(v as BrandFilter)}
            rotulo="Marca"
            className="hidden sm:inline-flex"
          />
        }
      />
      {/* Celular: o filtro de marca desce para a linha de baixo (o título não é cortado). */}
      <SeletorCompacto
        opcoes={BRAND_FILTERS.map((f) => ({ valor: f.value, rotulo: f.label }))}
        valor={brandFilter}
        onEscolher={(v) => setBrandFilter(v as BrandFilter)}
        rotulo="Marca"
        larguraTotal
        className="sm:hidden"
      />

      {erroAoLer && (
        <EstadoDeErro
          titulo="Não foi possível carregar a projeção."
          descricao="Os números podem estar incompletos."
          acao={
            <button type="button" onClick={() => { void billingQuery.refetch(); void paymentsQuery.refetch(); }} className={botao.secundario}>
              Tentar de novo
            </button>
          }
        />
      )}

      {primeiraCarga ? (
        <Carregando forma="aba" rotulo="Carregando projeção" />
      ) : (
        <>
          <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
            {numeros.map((n) => (
              <div key={n.rotulo} className={juntar(superficie.painel, "min-w-0 p-3 sm:p-4")}>
                <div className="flex min-w-0 items-center">
                  <span className={juntar("mr-1.5 inline-flex shrink-0", n.corIcone)} aria-hidden="true">{n.icone}</span>
                  <span className={juntar(texto.rotulo, "min-w-0 truncate")}>{n.rotulo}</span>
                </div>
                <p className={juntar("mt-1.5 truncate text-[17px] font-semibold leading-6 tabular-nums sm:text-[18px]", n.cor)}>{n.valor}</p>
                <p className={juntar(texto.auxiliar, "mt-0.5 truncate")} title={n.sub}>{n.sub}</p>
              </div>
            ))}
          </div>

          <Secao titulo="Receita" divisoria>
            <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
              <Painel titulo="Comparativo" descricao="Mês atual, projeção e meta">
                <div className="h-[220px] min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={comparisonData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="valor" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                        {comparisonData.map((_, i) => (
                          <Cell key={i} fill={i === 0 ? "hsl(var(--muted-foreground))" : i === 1 ? "hsl(var(--info))" : "hsl(var(--success))"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Painel>

              {pieData.length > 0 && (
                <Painel titulo="Composição" descricao={`Projeção de ${MONTHS_FULL[nextMonth]}`}>
                  <div className="flex min-w-0 flex-col items-center sm:flex-row">
                    <div className="h-[180px] w-[180px] shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={78} dataKey="value" stroke="none" isAnimationActive={false}>
                            {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                          </Pie>
                          <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <ul className="mt-3 w-full min-w-0 flex-1 divide-y divide-border sm:ml-5 sm:mt-0">
                      {pieData.map((d, i) => (
                        <li key={d.name} className="flex min-w-0 items-center py-2">
                          <span className="mr-2.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PIE_COLORS[i] }} aria-hidden="true" />
                          <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{d.name}</span>
                          <span className="ml-2 shrink-0 text-[12px] tabular-nums text-muted-foreground">{((d.value / projectedTotal) * 100).toFixed(0)}%</span>
                          <span className="ml-3 shrink-0 text-[13px] tabular-nums text-foreground">{fmt(d.value)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Painel>
              )}
            </div>
          </Secao>

          <Secao
            titulo="Itens projetados"
            descricao={[
              `${allItems.length} ${allItems.length === 1 ? "item" : "itens"}`,
              showMonthly ? `Recorrente ${fmt(recurringTotal)}` : "",
              showIndiv ? `Parcelas ${fmt(indivTotal)}` : "",
            ].filter(Boolean).join(" · ")}
            divisoria
          >
            {allItems.length === 0 ? (
              <EstadoVazio compacto titulo={`Nenhum item projetado para ${MONTHS_FULL[nextMonth]}.`} />
            ) : (
              <div className={juntar(superficie.painel, "overflow-hidden")}>
                <RegiaoRolavel memoria="projecao:itens" rotulo="Itens projetados" sobre="cartao" className="lg:max-h-[60vh]">
                  <ul className="divide-y divide-border">
                    {allItems.map((item) => (
                      <li key={item.id} className="flex min-w-0 items-center px-3 py-2.5 sm:px-4">
                        <span className={juntar("mr-3 h-2 w-2 shrink-0 rounded-full", item.type === "recurring" ? "bg-success" : "bg-info")} aria-hidden="true" />
                        <div className="mr-3 min-w-0 flex-1">
                          <p className={juntar(texto.corpo, "truncate")}>{item.label}</p>
                          <p className={juntar(texto.auxiliar, "truncate")}>
                            {item.client}
                            <span className="hidden sm:inline"> · {item.brand} · {item.type === "recurring" ? "Recorrente" : "Parcela"}</span>
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end">
                          <span className="text-[13px] font-medium tabular-nums text-foreground">{fmt(item.amount)}</span>
                          {item.due && (
                            <span className="text-[11px] tabular-nums text-muted-foreground">{new Date(item.due + "T00:00:00").toLocaleDateString("pt-BR")}</span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </RegiaoRolavel>
              </div>
            )}
          </Secao>

          <Secao titulo="Como dobrar o faturamento" ajuda="Sugestões calculadas com o ticket médio dos planos e dos projetos atuais." divisoria>
            <ul className={juntar(superficie.painel, "divide-y divide-border overflow-hidden")}>
              {recommendations.map((rec, i) => (
                <li key={i} className="flex min-w-0 items-start px-3 py-3 sm:px-4">
                  <span className={juntar(superficie.poco, "mr-3 flex h-8 w-8 shrink-0 items-center justify-center")} aria-hidden="true">
                    <rec.icon className="h-4 w-4 text-foreground" />
                  </span>
                  <div className="mr-3 min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center">
                      <p className={juntar(texto.corpo, "mr-2 min-w-0 font-medium")}>{rec.title}</p>
                      <span className={juntar(etiqueta, priorityColor(rec.priority))}>{rec.priority}</span>
                    </div>
                    <p className={juntar(texto.auxiliar, "mt-0.5 leading-5")}>{rec.description}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={texto.rotulo}>Impacto</p>
                    <p className="text-[13px] font-semibold tabular-nums text-success">{rec.impact}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Secao>
        </>
      )}
    </div>
  );
}
