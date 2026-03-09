import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowLeft, Download, MessageCircle, TrendingUp, TrendingDown,
  BarChart3, Target, Zap, Eye, MousePointerClick, Users, DollarSign,
  Calendar, Printer, ArrowUpRight, ArrowDownRight, Minus,
  FileText, Layers, Activity, Award, CheckCircle2, Info,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell,
} from "recharts";

/* ── Metric Config ────────────────────────────────────────── */
const metricConfig: Record<string, { label: string; shortLabel: string; format: (v: number) => string; icon: any; color: string; unit: string }> = {
  reach:            { label: "Alcance Total",    shortLabel: "Alcance",     format: v => v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(v), icon: Eye,               color: "hsl(200, 100%, 50%)", unit: "pessoas" },
  impressions:      { label: "Impressões",       shortLabel: "Impressões",  format: v => v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(v), icon: BarChart3,         color: "hsl(263, 70%, 66%)", unit: "vezes" },
  engagement:       { label: "Taxa de Engajamento", shortLabel: "Engaj.",   format: v => v.toFixed(1) + "%",                                  icon: Zap,               color: "hsl(145, 100%, 50%)", unit: "%" },
  clicks:           { label: "Cliques no Link",  shortLabel: "Cliques",     format: v => v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(v), icon: MousePointerClick, color: "hsl(38, 92%, 50%)",  unit: "cliques" },
  ctr:              { label: "Click-Through Rate", shortLabel: "CTR",       format: v => v.toFixed(2) + "%",                                  icon: Target,            color: "hsl(346, 87%, 60%)", unit: "%" },
  conversions:      { label: "Mensagens Recebidas", shortLabel: "Mensagens", format: v => String(v),                                          icon: MessageCircle,     color: "hsl(142, 71%, 45%)", unit: "msgs" },
  followers_gained: { label: "Novos Seguidores", shortLabel: "Seguidores",  format: v => "+" + v.toLocaleString("pt-BR"),                     icon: Users,             color: "hsl(188, 94%, 43%)", unit: "pessoas" },
  ad_spend:         { label: "Investimento em Mídia", shortLabel: "Investido", format: v => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2 }), icon: DollarSign, color: "hsl(221, 83%, 53%)", unit: "R$" },
  cpa:              { label: "Custo por Ação",   shortLabel: "CPA",         format: v => "R$ " + v.toFixed(2),                                icon: DollarSign,        color: "hsl(280, 70%, 60%)", unit: "R$" },
};

function formatDateLong(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
}

function formatDateShort(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function daysBetween(a: string, b: string) {
  return Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));
}

const CHART_COLORS = [
  "hsl(145, 100%, 50%)", "hsl(200, 100%, 50%)", "hsl(263, 70%, 66%)",
  "hsl(38, 92%, 50%)", "hsl(346, 87%, 60%)", "hsl(188, 94%, 43%)",
];

/* ── Component ────────────────────────────────────────────── */
export default function ReportDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: report, isLoading } = useQuery({
    queryKey: ["report-detail", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("reports")
        .select("*, project:projects(name)")
        .eq("id", id!)
        .single();
      return data;
    },
    enabled: !!id,
  });

  /* ── Derived data ─────────────────────────────── */
  const analysis = useMemo(() => {
    if (!report) return null;

    const m = (report.metrics || {}) as Record<string, any>;
    const customMetrics = (m.custom || []) as Array<{ label: string; value: number }>;
    const standardMetrics = Object.entries(m)
      .filter(([k]) => k !== "custom" && metricConfig[k] && m[k] !== undefined && m[k] !== 0)
      .map(([k, v]) => ({ key: k, value: v as number, ...metricConfig[k] }));

    const chartData = ((report as any).chart_data || []) as Array<Record<string, any>>;
    const chartType = ((report as any).chart_type || "area") as string;
    const chartColumns = chartData.length > 0
      ? Object.keys(chartData[0]).filter(k => k !== "label")
      : [];

    // Compute per-column stats
    const colStats = chartColumns.map((col, i) => {
      const values = chartData.map(r => Number(r[col]) || 0);
      const total = values.reduce((a, b) => a + b, 0);
      const avg = values.length > 0 ? total / values.length : 0;
      const max = Math.max(...values);
      const min = Math.min(...values);
      const first = values[0] ?? 0;
      const last = values[values.length - 1] ?? 0;
      const trend = first > 0 ? ((last - first) / first) * 100 : 0;
      const bestPeriod = values.indexOf(max);
      return { col, total, avg, max, min, trend, bestPeriod, color: CHART_COLORS[i % CHART_COLORS.length] };
    });

    // Compute pie data from numeric non-% metrics
    const pieMetrics = standardMetrics.filter(m => !["engagement", "ctr", "ad_spend", "cpa"].includes(m.key));
    const pieData = pieMetrics.map((m, i) => ({ name: m.shortLabel, value: m.value, fill: CHART_COLORS[i % CHART_COLORS.length] }));

    // Per-metric sparkline data from chart
    const metricSparklines: Record<string, number[]> = {};
    chartColumns.forEach(col => {
      const metricKey = Object.keys(metricConfig).find(k => metricConfig[k].shortLabel.toLowerCase() === col.toLowerCase() || metricConfig[k].label.toLowerCase() === col.toLowerCase());
      if (metricKey) {
        metricSparklines[metricKey] = chartData.map(r => Number(r[col]) || 0);
      }
    });

    // Auto-generated insights
    const insights: string[] = [];

    const spend = m.ad_spend as number | undefined;
    const msgs = m.conversions as number | undefined;
    if (spend && msgs && msgs > 0) {
      const costPerMsg = spend / msgs;
      insights.push(`Cada mensagem recebida custou em média R$ ${costPerMsg.toFixed(2)} de investimento em mídia.`);
    }
    if (spend && m.clicks && (m.clicks as number) > 0) {
      const cpc = spend / (m.clicks as number);
      insights.push(`O custo por clique (CPC) ficou em R$ ${cpc.toFixed(2)}, uma métrica importante para avaliar a eficiência da campanha.`);
    }
    if (m.reach && m.clicks) {
      const clickRate = ((m.clicks as number) / (m.reach as number)) * 100;
      insights.push(`De todas as ${metricConfig.reach.format(m.reach as number)} pessoas alcançadas, ${clickRate.toFixed(2)}% clicaram no conteúdo.`);
    }
    if (m.engagement && (m.engagement as number) > 3) {
      insights.push(`A taxa de engajamento de ${(m.engagement as number).toFixed(1)}% está acima da média de mercado (1-3%), indicando um bom desempenho do conteúdo.`);
    } else if (m.engagement && (m.engagement as number) <= 3) {
      insights.push(`A taxa de engajamento ficou em ${(m.engagement as number).toFixed(1)}%. Podemos trabalhar estratégias para aumentar a interação com o público.`);
    }

    colStats.forEach(cs => {
      if (cs.trend > 15) {
        insights.push(`A métrica "${cs.col}" cresceu ${cs.trend.toFixed(0)}% ao longo do período analisado, mostrando uma tendência positiva.`);
      } else if (cs.trend < -15) {
        insights.push(`A métrica "${cs.col}" teve uma redução de ${Math.abs(cs.trend).toFixed(0)}% no período, o que merece atenção nas próximas ações.`);
      }
    });

    if (m.followers_gained && (m.followers_gained as number) > 0) {
      insights.push(`Foram conquistados ${(m.followers_gained as number).toLocaleString("pt-BR")} novos seguidores no período, fortalecendo a base de audiência.`);
    }

    // Period days
    const periodDays = report.period_start && report.period_end ? daysBetween(report.period_start, report.period_end) : 0;

    return {
      standardMetrics,
      customMetrics,
      chartData,
      chartType,
      chartColumns,
      colStats,
      pieData,
      metricSparklines,
      insights,
      periodDays,
    };
  }, [report]);

  /* ── Loading / Error ───────────────────────────── */
  if (isLoading) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 rounded-2xl" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-36 rounded-2xl" />)}
        </div>
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }

  if (!report || !analysis) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Relatório não encontrado.</p>
      </div>
    );
  }

  const { standardMetrics, customMetrics, chartData, chartType, chartColumns, colStats, pieData, metricSparklines, insights, periodDays } = analysis;

  const periodLabel = report.period_start && report.period_end
    ? `${formatDateLong(report.period_start)} a ${formatDateLong(report.period_end)}`
    : "";

  const whatsappMsg = `Olá! Vi o relatório "${report.title}" e gostaria de conversar sobre os resultados.`;
  const whatsappUrl = `https://wa.me/5500000000000?text=${encodeURIComponent(whatsappMsg)}`;
  const handlePrint = () => window.print();

  /* ── Chart renderer ────────────────────────────── */
  const renderChart = () => {
    if (chartData.length === 0 || chartColumns.length === 0) return null;

    const gradients = chartColumns.map((_, i) => ({
      id: `grad${i}`,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }));

    const commonProps = { data: chartData, margin: { top: 10, right: 10, left: 0, bottom: 5 } };
    const xAxis = <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(0,0%,40%)" }} axisLine={false} tickLine={false} />;
    const yAxis = <YAxis tick={{ fontSize: 10, fill: "hsl(0,0%,40%)" }} axisLine={false} tickLine={false} width={50} tickFormatter={(v: number) => v >= 1000 ? (v / 1000).toFixed(0) + "K" : String(v)} />;
    const tooltip = (
      <Tooltip
        contentStyle={{
          background: "hsl(0,0%,8%)", border: "1px solid hsl(0,0%,20%)",
          borderRadius: 12, fontSize: 12, color: "hsl(0,0%,100%)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.6)", backdropFilter: "blur(8px)",
        }}
        formatter={(value: any, name: string) => [Number(value).toLocaleString("pt-BR"), name]}
      />
    );
    const grid = <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,17%)" opacity={0.4} />;

    if (chartType === "bar") {
      return (
        <BarChart {...commonProps}>
          {grid}{xAxis}{yAxis}{tooltip}
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
          {chartColumns.map((col, i) => (
            <Bar key={col} dataKey={col} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[6, 6, 0, 0]} />
          ))}
        </BarChart>
      );
    }
    if (chartType === "line") {
      return (
        <LineChart {...commonProps}>
          {grid}{xAxis}{yAxis}{tooltip}
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
          {chartColumns.map((col, i) => (
            <Line key={col} type="monotone" dataKey={col} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2.5} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 7 }} />
          ))}
        </LineChart>
      );
    }
    return (
      <AreaChart {...commonProps}>
        <defs>
          {gradients.map(g => (
            <linearGradient key={g.id} id={g.id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={g.color} stopOpacity={0.35} />
              <stop offset="95%" stopColor={g.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {grid}{xAxis}{yAxis}{tooltip}
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
        {chartColumns.map((col, i) => (
          <Area key={col} type="monotone" dataKey={col} stroke={gradients[i].color} fill={`url(#${gradients[i].id})`} strokeWidth={2.5} />
        ))}
      </AreaChart>
    );
  };

  const parseLines = (text: string) => text.split("\n").map(l => l.trim()).filter(Boolean);

  /* ── Render ─────────────────────────────────────── */
  return (
    <div className="space-y-6 sm:space-y-8 animate-fade-in max-w-5xl mx-auto w-full print-report">
      <button onClick={() => navigate("/relatorios")} className="no-print inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none">
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>

      {/* ═══ HERO HEADER ═══ */}
      <div className="relative bg-card border border-border rounded-2xl overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-info/5" />
        <div className="absolute top-0 right-0 w-72 h-72 rounded-full bg-primary/3 blur-3xl" />
        <div className="relative px-6 py-8 sm:px-8 sm:py-10">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-3 flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-primary" />
                </div>
                <span className="text-[10px] px-2.5 py-1 rounded-full bg-primary/10 text-primary font-semibold border border-primary/20 uppercase tracking-wider">
                  Publicado
                </span>
                {periodDays > 0 && (
                  <span className="text-[10px] px-2.5 py-1 rounded-full bg-secondary text-muted-foreground border border-border">
                    {periodDays} dias analisados
                  </span>
                )}
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground leading-tight">{report.title}</h1>
              <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" />
                  {(report as any).project?.name}
                </span>
                {periodLabel && (
                  <>
                    <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
                    <span className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      {periodLabel}
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-2 no-print shrink-0">
              <button onClick={handlePrint} className="p-2.5 rounded-xl bg-secondary hover:bg-secondary/80 text-foreground transition-colors cursor-pointer border border-border" title="Imprimir / PDF">
                <Printer className="w-4 h-4" />
              </button>
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="p-2.5 rounded-xl bg-secondary hover:bg-secondary/80 text-foreground transition-colors border border-border" title="WhatsApp">
                <MessageCircle className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* Quick stats strip */}
          {standardMetrics.length > 0 && (
            <div className="flex flex-wrap gap-4 mt-6 pt-5 border-t border-border/50">
              {standardMetrics.slice(0, 5).map(metric => (
                <div key={metric.key} className="flex items-center gap-2">
                  <metric.icon className="w-3.5 h-3.5" style={{ color: metric.color }} />
                  <span className="text-[12px] text-muted-foreground">{metric.shortLabel}:</span>
                  <span className="text-[13px] font-mono font-bold text-foreground">{metric.format(metric.value)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ═══ METRICS CARDS ═══ */}
      {standardMetrics.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-primary" />
            Performance Detalhada
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {standardMetrics.map(metric => {
              const Icon = metric.icon;
              const sparkline = metricSparklines[metric.key];
              const sparkData = sparkline ? sparkline.map(v => ({ v })) : null;

              // Calculate trend from sparkline
              let trendPct = 0;
              let trendDir: "up" | "down" | "flat" = "flat";
              if (sparkline && sparkline.length >= 2) {
                const first = sparkline[0];
                const last = sparkline[sparkline.length - 1];
                if (first > 0) {
                  trendPct = ((last - first) / first) * 100;
                  trendDir = trendPct > 3 ? "up" : trendPct < -3 ? "down" : "flat";
                }
              }

              return (
                <div key={metric.key} className="group bg-card border border-border rounded-2xl p-5 hover:border-primary/20 transition-all relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 rounded-full opacity-[0.03]" style={{ background: metric.color, transform: "translate(30%, -30%)" }} />

                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${metric.color}12`, border: `1px solid ${metric.color}20` }}>
                        <Icon className="w-4 h-4" style={{ color: metric.color }} />
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{metric.shortLabel}</p>
                        <p className="text-[10px] text-muted-foreground/60">{metric.label}</p>
                      </div>
                    </div>
                    {trendDir !== "flat" && (
                      <div className={`flex items-center gap-0.5 px-2 py-0.5 rounded-lg text-[10px] font-semibold ${trendDir === "up" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>
                        {trendDir === "up" ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                        {Math.abs(trendPct).toFixed(0)}%
                      </div>
                    )}
                  </div>

                  <p className="text-3xl font-bold font-mono text-foreground tracking-tight mb-1">{metric.format(metric.value)}</p>

                  {/* Mini sparkline */}
                  {sparkData && sparkData.length > 1 && (
                    <div className="h-10 mt-2 -mx-1">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={sparkData}>
                          <defs>
                            <linearGradient id={`sp-${metric.key}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={metric.color} stopOpacity={0.25} />
                              <stop offset="95%" stopColor={metric.color} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <Area type="monotone" dataKey="v" stroke={metric.color} fill={`url(#sp-${metric.key})`} strokeWidth={1.5} dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Custom metrics */}
      {customMetrics.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {customMetrics.map((cm, i) => (
            <div key={i} className="bg-card border border-border rounded-2xl p-5 hover:border-primary/20 transition-all">
              <p className="text-2xl font-bold font-mono text-foreground tracking-tight">{cm.value}</p>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mt-1.5 font-medium">{cm.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ═══ CHART + SIDEBAR ═══ */}
      {chartData.length > 0 && chartColumns.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <section className="lg:col-span-2 bg-card border border-border rounded-2xl p-5 sm:p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                Evolução do Período
              </h2>
              <div className="flex items-center gap-2">
                {chartColumns.map((col, i) => (
                  <span key={col} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="w-2 h-2 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                    {col}
                  </span>
                ))}
              </div>
            </div>
            <div className="h-60 sm:h-72">
              <ResponsiveContainer width="100%" height="100%">
                {renderChart()!}
              </ResponsiveContainer>
            </div>
          </section>

          <section className="bg-card border border-border rounded-2xl p-5 sm:p-6 flex flex-col">
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              Análise por Coluna
            </h2>
            <div className="space-y-4 flex-1">
              {colStats.map((cs) => {
                const TrendIcon = cs.trend > 3 ? ArrowUpRight : cs.trend < -3 ? ArrowDownRight : Minus;
                const trendColor = cs.trend > 3 ? "text-primary" : cs.trend < -3 ? "text-destructive" : "text-muted-foreground";
                return (
                  <div key={cs.col} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: cs.color }} />
                        <span className="text-[12px] font-medium text-foreground">{cs.col}</span>
                      </div>
                      <span className={`flex items-center gap-0.5 text-[11px] font-semibold ${trendColor}`}>
                        <TrendIcon className="w-3 h-3" />
                        {Math.abs(cs.trend).toFixed(0)}%
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <div className="bg-secondary/50 rounded-lg px-2 py-1.5 text-center">
                        <p className="text-[10px] text-muted-foreground">Total</p>
                        <p className="text-[12px] font-mono font-bold text-foreground">{cs.total >= 1000 ? (cs.total / 1000).toFixed(1) + "K" : cs.total.toLocaleString("pt-BR")}</p>
                      </div>
                      <div className="bg-secondary/50 rounded-lg px-2 py-1.5 text-center">
                        <p className="text-[10px] text-muted-foreground">Média</p>
                        <p className="text-[12px] font-mono font-bold text-foreground">{cs.avg >= 1000 ? (cs.avg / 1000).toFixed(1) + "K" : cs.avg.toFixed(0)}</p>
                      </div>
                      <div className="bg-secondary/50 rounded-lg px-2 py-1.5 text-center">
                        <p className="text-[10px] text-muted-foreground">Máx</p>
                        <p className="text-[12px] font-mono font-bold text-foreground">{cs.max >= 1000 ? (cs.max / 1000).toFixed(1) + "K" : cs.max.toLocaleString("pt-BR")}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {pieData.length >= 2 && (
              <div className="h-32 mt-4 pt-4 border-t border-border/50">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={30} outerRadius={48} paddingAngle={3} dataKey="value">
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "hsl(0,0%,8%)", border: "1px solid hsl(0,0%,20%)", borderRadius: 12, fontSize: 11, color: "hsl(0,0%,100%)" }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ═══ DATA TABLE ═══ */}
      {chartData.length > 0 && chartColumns.length > 0 && (
        <section className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 text-primary" />
              Dados Detalhados
            </h2>
            <span className="text-[10px] text-muted-foreground">{chartData.length} registros</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-secondary/30">
                  <th className="text-left py-3 px-4 text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">Período</th>
                  {chartColumns.map((col, i) => (
                    <th key={col} className="text-right py-3 px-4 text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full inline-block" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                        {col}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chartData.map((row, i) => {
                  return (
                    <tr key={i} className="border-b border-border/30 hover:bg-secondary/20 transition-colors">
                      <td className="py-3 px-4 text-foreground font-medium">{row.label}</td>
                      {chartColumns.map((col, ci) => {
                        const val = Number(row[col]) || 0;
                        const maxVal = colStats[ci]?.max || 1;
                        const pct = (val / maxVal) * 100;
                        return (
                          <td key={col} className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-12 h-1.5 rounded-full bg-secondary overflow-hidden hidden sm:block">
                                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: CHART_COLORS[ci % CHART_COLORS.length] }} />
                              </div>
                              <span className="font-mono text-foreground">{val.toLocaleString("pt-BR")}</span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                <tr className="bg-primary/5 font-semibold">
                  <td className="py-3 px-4 text-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-primary" /> Total
                  </td>
                  {chartColumns.map(col => {
                    const total = chartData.reduce((s, r) => s + (Number(r[col]) || 0), 0);
                    return (
                      <td key={col} className="py-3 px-4 text-right font-mono text-primary">
                        {total.toLocaleString("pt-BR")}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ═══ AUTO-INSIGHTS ═══ */}
      {insights.length > 0 && (
        <section className="bg-gradient-to-br from-card to-secondary/30 border border-border rounded-2xl p-6">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Zap className="w-4.5 h-4.5 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Análise Inteligente</h2>
              <p className="text-[10px] text-muted-foreground">Insights gerados automaticamente com base nos dados do relatório</p>
            </div>
          </div>
          <div className="space-y-3">
            {insights.map((insight, i) => (
              <div key={i} className="flex items-start gap-3 bg-card/50 rounded-xl p-3.5 border border-border/50">
                <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Info className="w-3 h-3 text-primary" />
                </div>
                <p className="text-[13px] text-foreground/85 leading-relaxed">{insight}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ═══ TEXT SECTIONS ═══ */}
      {report.summary && (
        <section className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border/50 flex items-center gap-2.5 bg-secondary/20">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
              <BarChart3 className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Resumo Executivo</h2>
              <p className="text-[10px] text-muted-foreground">Visão geral dos resultados e desempenho do período</p>
            </div>
          </div>
          <div className="px-6 py-5 space-y-3">
            {parseLines(report.summary).map((line, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[9px] font-bold text-primary">{i + 1}</span>
                </div>
                <p className="text-[13px] text-foreground/85 leading-relaxed">{line}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {report.highlights && (
          <section className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border/50 flex items-center gap-2.5 bg-warning/5">
              <div className="w-8 h-8 rounded-lg bg-warning/10 border border-warning/20 flex items-center justify-center">
                <Award className="w-4 h-4 text-warning" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Destaques do Período</h2>
                <p className="text-[10px] text-muted-foreground">Pontos que merecem atenção especial</p>
              </div>
            </div>
            <div className="px-6 py-5 space-y-2.5">
              {parseLines(report.highlights).map((line, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <Zap className="w-3.5 h-3.5 text-warning shrink-0 mt-1" />
                  <p className="text-[13px] text-foreground/85 leading-relaxed">{line}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {report.next_steps && (
          <section className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border/50 flex items-center gap-2.5 bg-info/5">
              <div className="w-8 h-8 rounded-lg bg-info/10 border border-info/20 flex items-center justify-center">
                <Target className="w-4 h-4 text-info" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Próximos Passos</h2>
                <p className="text-[10px] text-muted-foreground">Ações planejadas para o próximo período</p>
              </div>
            </div>
            <div className="px-6 py-5 space-y-2.5">
              {parseLines(report.next_steps).map((line, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="text-[11px] font-mono font-bold text-info bg-info/10 rounded-md w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-[13px] text-foreground/85 leading-relaxed">{line}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ═══ ACTIONS ═══ */}
      <div className="bg-card border border-border rounded-2xl p-6 no-print">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center">
            <MessageCircle className="w-4 h-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Tem dúvidas sobre os resultados?</p>
            <p className="text-[11px] text-muted-foreground">Entre em contato com a equipe para discutir estratégias e próximos passos.</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row flex-wrap gap-3">
          {report.file_url ? (
            <a href={report.file_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-[13px] bg-primary text-primary-foreground hover:opacity-90 transition-opacity font-semibold w-full sm:w-auto">
              <Download className="w-4 h-4" /> Baixar Relatório em PDF
            </a>
          ) : (
            <button onClick={handlePrint} className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-[13px] bg-primary text-primary-foreground hover:opacity-90 transition-opacity font-semibold cursor-pointer border-none w-full sm:w-auto">
              <Download className="w-4 h-4" /> Baixar Relatório em PDF
            </button>
          )}
          <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-[13px] bg-secondary text-foreground hover:bg-secondary/80 transition-colors font-medium w-full sm:w-auto border border-border">
            <MessageCircle className="w-4 h-4" /> Falar sobre resultados
          </a>
        </div>
      </div>

      <div className="h-6" />
    </div>
  );
}
