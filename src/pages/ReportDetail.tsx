import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowLeft, Download, MessageCircle, TrendingUp, TrendingDown,
  BarChart3, Target, Zap, Eye, MousePointerClick, Users, DollarSign,
  Calendar, Share2, Printer,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell, RadialBarChart, RadialBar,
} from "recharts";

const metricConfig: Record<string, { label: string; format: (v: number) => string; icon: any; color: string }> = {
  reach:            { label: "Alcance",          format: v => v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(v), icon: Eye,               color: "hsl(200, 100%, 50%)" },
  impressions:      { label: "Impressões",       format: v => v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(v), icon: BarChart3,         color: "hsl(263, 70%, 66%)" },
  engagement:       { label: "Engajamento",      format: v => v.toFixed(1) + "%",                                  icon: Zap,               color: "hsl(145, 100%, 50%)" },
  clicks:           { label: "Cliques",          format: v => v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(v), icon: MousePointerClick, color: "hsl(38, 92%, 50%)" },
  ctr:              { label: "CTR",              format: v => v.toFixed(2) + "%",                                  icon: Target,            color: "hsl(346, 87%, 60%)" },
  conversions:      { label: "Conversões",       format: v => String(v),                                           icon: Target,            color: "hsl(142, 71%, 45%)" },
  followers_gained: { label: "Novos Seguidores", format: v => "+" + v.toLocaleString("pt-BR"),                     icon: Users,             color: "hsl(188, 94%, 43%)" },
  ad_spend:         { label: "Investimento",     format: v => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2 }), icon: DollarSign, color: "hsl(221, 83%, 53%)" },
  cpa:              { label: "CPA",              format: v => "R$ " + v.toFixed(2),                                icon: DollarSign,        color: "hsl(280, 70%, 60%)" },
};

function formatDateLong(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
}

const CHART_COLORS = [
  "hsl(145, 100%, 50%)", "hsl(200, 100%, 50%)", "hsl(263, 70%, 66%)",
  "hsl(38, 92%, 50%)", "hsl(346, 87%, 60%)", "hsl(188, 94%, 43%)",
];

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

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Relatório não encontrado.</p>
      </div>
    );
  }

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

  const periodLabel = report.period_start && report.period_end
    ? `${formatDateLong(report.period_start)} a ${formatDateLong(report.period_end)}`
    : "";

  const whatsappMsg = `Olá! Vi o relatório "${report.title}" e gostaria de conversar sobre os resultados.`;
  const whatsappUrl = `https://wa.me/5500000000000?text=${encodeURIComponent(whatsappMsg)}`;

  const handlePrint = () => window.print();

  // Build pie data from standard metrics (excluding percentages and money)
  const pieMetrics = standardMetrics.filter(m => !["engagement", "ctr", "ad_spend", "cpa"].includes(m.key));
  const pieData = pieMetrics.map((m, i) => ({ name: m.label, value: m.value, fill: CHART_COLORS[i % CHART_COLORS.length] }));

  // Compute totals for chart columns
  const columnTotals = chartColumns.map(col => ({
    col,
    total: chartData.reduce((s, r) => s + (Number(r[col]) || 0), 0),
  }));

  const renderChart = () => {
    if (chartData.length === 0 || chartColumns.length === 0) return null;

    const gradients = chartColumns.map((_, i) => ({
      id: `grad${i}`,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }));

    const commonProps = {
      data: chartData,
      margin: { top: 10, right: 10, left: 0, bottom: 5 },
    };

    const xAxis = <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(0, 0%, 40%)" }} axisLine={false} tickLine={false} />;
    const yAxis = <YAxis tick={{ fontSize: 10, fill: "hsl(0, 0%, 40%)" }} axisLine={false} tickLine={false} width={50} tickFormatter={(v: number) => v >= 1000 ? (v / 1000).toFixed(0) + "K" : String(v)} />;
    const tooltip = (
      <Tooltip
        contentStyle={{
          background: "hsl(0, 0%, 10%)",
          border: "1px solid hsl(0, 0%, 17%)",
          borderRadius: 12,
          fontSize: 12,
          color: "hsl(0, 0%, 100%)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}
      />
    );
    const grid = <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 17%)" opacity={0.5} />;

    if (chartType === "bar") {
      return (
        <BarChart {...commonProps}>
          {grid}{xAxis}{yAxis}{tooltip}
          <Legend wrapperStyle={{ fontSize: 11 }} />
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
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {chartColumns.map((col, i) => (
            <Line key={col} type="monotone" dataKey={col} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2.5} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
          ))}
        </LineChart>
      );
    }

    return (
      <AreaChart {...commonProps}>
        <defs>
          {gradients.map(g => (
            <linearGradient key={g.id} id={g.id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={g.color} stopOpacity={0.4} />
              <stop offset="95%" stopColor={g.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {grid}{xAxis}{yAxis}{tooltip}
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {chartColumns.map((col, i) => (
          <Area key={col} type="monotone" dataKey={col} stroke={gradients[i].color} fill={`url(#${gradients[i].id})`} strokeWidth={2.5} />
        ))}
      </AreaChart>
    );
  };

  // Parse text sections into bullet points
  const parseTextSection = (text: string) => {
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    return lines;
  };

  return (
    <div className="space-y-6 sm:space-y-8 animate-fade-in max-w-5xl mx-auto w-full print-report">
      <button onClick={() => navigate("/relatorios")} className="no-print inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none">
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>

      {/* HERO HEADER */}
      <div className="relative bg-card border border-border rounded-2xl overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/10" />
        <div className="relative px-6 py-8 sm:px-8 sm:py-10">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-primary" />
                </div>
                <span className="text-[10px] px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium border border-primary/20">
                  Publicado
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">{report.title}</h1>
              <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                <span>{(report as any).project?.name}</span>
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
            <div className="flex gap-2 no-print">
              <button onClick={handlePrint} className="p-2.5 rounded-xl bg-secondary hover:bg-secondary/80 text-foreground transition-colors cursor-pointer border border-border" title="Imprimir">
                <Printer className="w-4 h-4" />
              </button>
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="p-2.5 rounded-xl bg-secondary hover:bg-secondary/80 text-foreground transition-colors border border-border" title="WhatsApp">
                <MessageCircle className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* METRICS GRID */}
      {standardMetrics.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-primary" />
            Métricas Principais
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {standardMetrics.map(metric => {
              const Icon = metric.icon;
              return (
                <div key={metric.key} className="group bg-card border border-border rounded-2xl p-5 hover:border-primary/30 transition-all relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-20 h-20 rounded-full opacity-5" style={{ background: metric.color, transform: "translate(30%, -30%)" }} />
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${metric.color}15`, border: `1px solid ${metric.color}25` }}>
                      <Icon className="w-4 h-4" style={{ color: metric.color }} />
                    </div>
                  </div>
                  <p className="text-2xl sm:text-3xl font-bold font-mono text-foreground tracking-tight">{metric.format(metric.value)}</p>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground mt-1.5 font-medium">{metric.label}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* CUSTOM METRICS */}
      {customMetrics.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {customMetrics.map((cm, i) => (
            <div key={i} className="bg-card border border-border rounded-2xl p-5 hover:border-primary/30 transition-all">
              <p className="text-2xl sm:text-3xl font-bold font-mono text-foreground tracking-tight">{cm.value}</p>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mt-1.5 font-medium">{cm.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* CHARTS SECTION */}
      {chartData.length > 0 && chartColumns.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Main chart */}
          <section className="lg:col-span-2 bg-card border border-border rounded-2xl p-5 sm:p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                Evolução do Período
              </h2>
              <span className="text-[10px] px-2 py-1 rounded-lg bg-secondary text-muted-foreground">
                {chartData.length} períodos
              </span>
            </div>
            <div className="h-56 sm:h-72">
              <ResponsiveContainer width="100%" height="100%">
                {renderChart()!}
              </ResponsiveContainer>
            </div>
          </section>

          {/* Summary sidebar with totals or pie */}
          <section className="bg-card border border-border rounded-2xl p-5 sm:p-6 flex flex-col">
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              Totais do Período
            </h2>
            <div className="space-y-3 flex-1">
              {columnTotals.map((ct, i) => (
                <div key={ct.col} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                    <span className="text-[12px] text-muted-foreground">{ct.col}</span>
                  </div>
                  <span className="text-sm font-mono font-semibold text-foreground">{ct.total.toLocaleString("pt-BR")}</span>
                </div>
              ))}
            </div>
            {pieData.length >= 2 && (
              <div className="h-36 mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={3} dataKey="value">
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "hsl(0, 0%, 10%)",
                        border: "1px solid hsl(0, 0%, 17%)",
                        borderRadius: 12,
                        fontSize: 12,
                        color: "hsl(0, 0%, 100%)",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>
        </div>
      )}

      {/* DATA TABLE */}
      {chartData.length > 0 && chartColumns.length > 0 && (
        <section className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Dados Detalhados</h2>
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
                {chartData.map((row, i) => (
                  <tr key={i} className="border-b border-border/30 hover:bg-secondary/20 transition-colors">
                    <td className="py-3 px-4 text-foreground font-medium">{row.label}</td>
                    {chartColumns.map(col => (
                      <td key={col} className="py-3 px-4 text-right font-mono text-foreground">
                        {typeof row[col] === "number" ? (row[col] as number).toLocaleString("pt-BR") : row[col]}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="bg-primary/5 font-semibold">
                  <td className="py-3 px-4 text-foreground">Total</td>
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

      {/* TEXT SECTIONS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {report.summary && (
          <section className="bg-card border border-border rounded-2xl p-6 lg:col-span-2">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-primary" />
              </div>
              <h2 className="text-sm font-semibold text-foreground">Resumo Executivo</h2>
            </div>
            <div className="space-y-2">
              {parseTextSection(report.summary).map((line, i) => (
                <p key={i} className="text-[13px] text-foreground/80 leading-relaxed flex items-start gap-2">
                  {parseTextSection(report.summary).length > 1 && (
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0 mt-1.5" />
                  )}
                  {line}
                </p>
              ))}
            </div>
          </section>
        )}

        {report.highlights && (
          <section className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-lg bg-warning/10 border border-warning/20 flex items-center justify-center">
                <Zap className="w-4 h-4 text-warning" />
              </div>
              <h2 className="text-sm font-semibold text-foreground">Destaques</h2>
            </div>
            <div className="space-y-2">
              {parseTextSection(report.highlights).map((line, i) => (
                <p key={i} className="text-[13px] text-foreground/80 leading-relaxed flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-warning/60 shrink-0 mt-1.5" />
                  {line}
                </p>
              ))}
            </div>
          </section>
        )}

        {report.next_steps && (
          <section className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-lg bg-info/10 border border-info/20 flex items-center justify-center">
                <Target className="w-4 h-4 text-info" />
              </div>
              <h2 className="text-sm font-semibold text-foreground">Próximos Passos</h2>
            </div>
            <div className="space-y-2">
              {parseTextSection(report.next_steps).map((line, i) => (
                <p key={i} className="text-[13px] text-foreground/80 leading-relaxed flex items-start gap-2">
                  <span className="text-sm text-info/70 font-mono shrink-0">{String(i + 1).padStart(2, "0")}.</span>
                  {line}
                </p>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ACTIONS */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-3 no-print pb-8">
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
  );
}
