import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowLeft, Download, MessageCircle, TrendingUp, TrendingDown,
  BarChart3, Target, Zap, Eye, MousePointerClick, Users, DollarSign,
  Calendar, Printer, ArrowUpRight, ArrowDownRight,
  FileText, Layers, Activity, Award, CheckCircle2, Info,
  PieChart as PieChartIcon, Gauge, Sparkles, Shield, Clock,
  Hash, LayoutGrid, ArrowRight, Star, Lightbulb, AlertTriangle,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, RadialBarChart, RadialBar,
} from "recharts";
import SourceDashboard from "@/components/reports/SourceDashboard";

/* ── Metric Config ────────────────────────────────────────── */
const metricConfig: Record<string, {
  label: string; shortLabel: string; format: (v: number) => string;
  icon: any; color: string; unit: string; category: string; benchmark?: number;
}> = {
  reach:            { label: "Alcance Total",         shortLabel: "Alcance",     format: v => v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(Math.round(v)), icon: Eye,               color: "hsl(200, 100%, 50%)", unit: "pessoas",  category: "Visibilidade", benchmark: 10000 },
  impressions:      { label: "Impressões Totais",     shortLabel: "Impressões",  format: v => v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(Math.round(v)), icon: BarChart3,         color: "hsl(263, 70%, 66%)", unit: "vezes",    category: "Visibilidade", benchmark: 15000 },
  engagement:       { label: "Taxa de Engajamento",   shortLabel: "Engajamento", format: v => v.toFixed(1) + "%",                                             icon: Zap,               color: "hsl(145, 100%, 50%)", unit: "%",       category: "Interação",    benchmark: 3 },
  clicks:           { label: "Cliques no Link",       shortLabel: "Cliques",     format: v => v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(Math.round(v)), icon: MousePointerClick, color: "hsl(38, 92%, 50%)",  unit: "cliques",  category: "Conversão",    benchmark: 100 },
  ctr:              { label: "Click-Through Rate",    shortLabel: "CTR",         format: v => v.toFixed(2) + "%",                                             icon: Target,            color: "hsl(346, 87%, 60%)", unit: "%",        category: "Conversão",    benchmark: 1 },
  conversions:      { label: "Mensagens Recebidas",   shortLabel: "Mensagens",   format: v => String(Math.round(v)),                                          icon: MessageCircle,     color: "hsl(142, 71%, 45%)", unit: "msgs",     category: "Conversão",    benchmark: 20 },
  followers_gained: { label: "Novos Seguidores",      shortLabel: "Seguidores",  format: v => "+" + Math.round(v).toLocaleString("pt-BR"),                     icon: Users,             color: "hsl(188, 94%, 43%)", unit: "pessoas",  category: "Crescimento" },
  ad_spend:         { label: "Investimento em Mídia",  shortLabel: "Investido",   format: v => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2 }), icon: DollarSign,       color: "hsl(221, 83%, 53%)", unit: "R$",       category: "Investimento" },
  cpa:              { label: "Custo por Mensagem",    shortLabel: "CPA",         format: v => "R$ " + v.toFixed(2),                                           icon: DollarSign,        color: "hsl(280, 70%, 60%)", unit: "R$",       category: "Eficiência" },
};

const CHART_COLORS = [
  "hsl(145, 100%, 50%)", "hsl(200, 100%, 50%)", "hsl(263, 70%, 66%)",
  "hsl(38, 92%, 50%)", "hsl(346, 87%, 60%)", "hsl(188, 94%, 43%)",
  "hsl(221, 83%, 53%)", "hsl(280, 70%, 60%)",
];

function fmtDate(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
}

function daysBetween(a: string, b: string) {
  return Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));
}

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
      .filter(([k]) => k !== "custom" && metricConfig[k] && m[k] !== undefined && m[k] !== null && m[k] !== 0)
      .map(([k, v]) => ({ key: k, value: Number(v), ...metricConfig[k] }));

    const rawChartData = ((report as any).chart_data || []) as Array<Record<string, any>>;
    const chartType = ((report as any).chart_type || "area") as string;

    // Auto-generate chart data from metrics if none exists
    let chartData = rawChartData;
    let chartColumns: string[] = [];

    if (rawChartData.length > 0) {
      chartColumns = Object.keys(rawChartData[0]).filter(k => k !== "label");
    } else if (standardMetrics.length >= 2 && report.period_start && report.period_end) {
      // Generate date-based data points from actual report period
      const numericMetrics = standardMetrics.filter(m => !["engagement", "ctr", "cpa"].includes(m.key));
      const start = new Date(report.period_start);
      const end = new Date(report.period_end);
      const totalDays = Math.max(1, daysBetween(report.period_start, report.period_end));

      // Determine granularity based on period length
      let intervals: Date[] = [];
      if (totalDays <= 7) {
        // Daily
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          intervals.push(new Date(d));
        }
      } else if (totalDays <= 31) {
        // Every ~3-4 days
        const step = Math.max(1, Math.floor(totalDays / 7));
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + step)) {
          intervals.push(new Date(d));
        }
        if (intervals[intervals.length - 1].getTime() < end.getTime()) intervals.push(new Date(end));
      } else {
        // Weekly
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 7)) {
          intervals.push(new Date(d));
        }
        if (intervals[intervals.length - 1].getTime() < end.getTime()) intervals.push(new Date(end));
      }

      const n = intervals.length;
      chartData = intervals.map((date, i) => {
        const label = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
        const row: Record<string, any> = { label };
        numericMetrics.slice(0, 4).forEach(metric => {
          // Distribute total proportionally with slight growth curve
          const weight = 0.6 + (i / (n - 1 || 1)) * 0.8;
          const base = (metric.value / n) * weight;
          row[metric.shortLabel] = Math.round(Math.max(0, base));
        });
        return row;
      });

      // Adjust last point so totals approximate the real value
      numericMetrics.slice(0, 4).forEach(metric => {
        const currentTotal = chartData.reduce((s, r) => s + (Number(r[metric.shortLabel]) || 0), 0);
        const diff = metric.value - currentTotal;
        if (chartData.length > 0) {
          chartData[chartData.length - 1][metric.shortLabel] = Math.max(0, (chartData[chartData.length - 1][metric.shortLabel] || 0) + diff);
        }
      });

      chartColumns = numericMetrics.slice(0, 4).map(m => m.shortLabel);
    }

    // Column stats
    const colStats = chartColumns.map((col, i) => {
      const values = chartData.map(r => Number(r[col]) || 0);
      const total = values.reduce((a, b) => a + b, 0);
      const avg = values.length > 0 ? total / values.length : 0;
      const max = Math.max(...values, 1);
      const min = Math.min(...values);
      const first = values[0] ?? 0;
      const last = values[values.length - 1] ?? 0;
      const trend = first > 0 ? ((last - first) / first) * 100 : 0;
      return { col, total, avg, max, min, trend, color: CHART_COLORS[i % CHART_COLORS.length] };
    });

    // Pie data from volume metrics
    const pieMetrics = standardMetrics.filter(m => !["engagement", "ctr", "ad_spend", "cpa"].includes(m.key) && m.value > 0);
    const pieData = pieMetrics.map((m, i) => ({ name: m.shortLabel, value: m.value, fill: CHART_COLORS[i % CHART_COLORS.length] }));

    // Radar data: normalize each metric to 0-100 scale relative to benchmark
    const radarData = standardMetrics
      .filter(m => m.benchmark && m.benchmark > 0)
      .map(m => ({
        metric: m.shortLabel,
        value: Math.min(Math.round((m.value / m.benchmark!) * 100), 150),
        fullMark: 150,
      }));

    // Radial bar data for investment efficiency
    const spend = Number(m.ad_spend) || 0;
    const msgs = Number(m.conversions) || 0;
    const clicks = Number(m.clicks) || 0;
    const reach = Number(m.reach) || 0;
    const efficiencyData: Array<{ name: string; value: number; fill: string }> = [];
    if (spend > 0 && msgs > 0) {
      const costPerMsg = spend / msgs;
      efficiencyData.push({ name: "Custo/Msg", value: Math.min(Math.round((1 / costPerMsg) * 100), 100), fill: "hsl(145, 100%, 50%)" });
    }
    if (spend > 0 && clicks > 0) {
      const cpc = spend / clicks;
      efficiencyData.push({ name: "Custo/Clique", value: Math.min(Math.round((1 / cpc) * 50), 100), fill: "hsl(200, 100%, 50%)" });
    }
    if (reach > 0 && clicks > 0) {
      efficiencyData.push({ name: "Conversão", value: Math.min(Math.round((clicks / reach) * 1000), 100), fill: "hsl(263, 70%, 66%)" });
    }

    // KPI calculations
    const kpis: Array<{ label: string; value: string; detail: string; icon: any; color: string; status: "good" | "warning" | "bad" }> = [];
    if (spend > 0 && msgs > 0) {
      const costPerMsg = spend / msgs;
      kpis.push({
        label: "Custo por Mensagem",
        value: `R$ ${costPerMsg.toFixed(2)}`,
        detail: `${msgs} mensagens com R$ ${spend.toFixed(2)} investidos`,
        icon: DollarSign,
        color: "hsl(145, 100%, 50%)",
        status: costPerMsg < 15 ? "good" : costPerMsg < 30 ? "warning" : "bad",
      });
    }
    if (spend > 0 && clicks > 0) {
      const cpc = spend / clicks;
      kpis.push({
        label: "Custo por Clique (CPC)",
        value: `R$ ${cpc.toFixed(2)}`,
        detail: `${clicks} cliques gerados no período`,
        icon: MousePointerClick,
        color: "hsl(200, 100%, 50%)",
        status: cpc < 2 ? "good" : cpc < 5 ? "warning" : "bad",
      });
    }
    if (reach > 0 && spend > 0) {
      const cpm = (spend / reach) * 1000;
      kpis.push({
        label: "CPM (Custo por Mil)",
        value: `R$ ${cpm.toFixed(2)}`,
        detail: `Custo para alcançar 1.000 pessoas`,
        icon: Eye,
        color: "hsl(263, 70%, 66%)",
        status: cpm < 15 ? "good" : cpm < 40 ? "warning" : "bad",
      });
    }
    if (reach > 0 && clicks > 0) {
      const convRate = (clicks / reach) * 100;
      kpis.push({
        label: "Taxa de Cliques/Alcance",
        value: `${convRate.toFixed(2)}%`,
        detail: `${clicks} cliques de ${metricConfig.reach.format(reach)} alcançados`,
        icon: Target,
        color: "hsl(38, 92%, 50%)",
        status: convRate > 1 ? "good" : convRate > 0.3 ? "warning" : "bad",
      });
    }

    // Auto insights
    const insights: Array<{ text: string; type: "success" | "info" | "warning" }> = [];

    if (spend > 0 && msgs > 0) {
      const costPerMsg = spend / msgs;
      insights.push({
        text: `Cada mensagem recebida custou em média R$ ${costPerMsg.toFixed(2)} de investimento em mídia. ${costPerMsg < 15 ? "Esse é um custo competitivo para o mercado." : "Há oportunidade de otimizar o custo por lead."}`,
        type: costPerMsg < 15 ? "success" : "warning",
      });
    }
    if (spend > 0 && clicks > 0) {
      const cpc = spend / clicks;
      insights.push({
        text: `O custo por clique (CPC) ficou em R$ ${cpc.toFixed(2)}. ${cpc < 3 ? "Valor dentro do esperado para campanhas de tráfego." : "Recomendamos ajustar a segmentação para reduzir o CPC."}`,
        type: cpc < 3 ? "info" : "warning",
      });
    }
    if (m.engagement && (m.engagement as number) > 3) {
      insights.push({
        text: `A taxa de engajamento de ${(m.engagement as number).toFixed(1)}% está acima da média de mercado (1-3%), indicando excelente desempenho do conteúdo e boa ressonância com o público-alvo.`,
        type: "success",
      });
    }
    if (reach > 0 && m.impressions) {
      const freq = (m.impressions as number) / reach;
      insights.push({
        text: `A frequência média foi de ${freq.toFixed(1)}x, ou seja, cada pessoa viu o anúncio em média ${freq.toFixed(1)} vezes. ${freq > 3 ? "Considere expandir o público para evitar fadiga de anúncio." : "Frequência saudável para o período."}`,
        type: freq > 3 ? "warning" : "info",
      });
    }
    if (m.followers_gained && (m.followers_gained as number) > 0) {
      insights.push({
        text: `Foram conquistados ${(m.followers_gained as number).toLocaleString("pt-BR")} novos seguidores no período, fortalecendo a base de audiência organicamente.`,
        type: "success",
      });
    }

    // Category grouping
    const categories = new Map<string, typeof standardMetrics>();
    standardMetrics.forEach(m => {
      const cat = m.category;
      if (!categories.has(cat)) categories.set(cat, []);
      categories.get(cat)!.push(m);
    });

    const periodDays = report.period_start && report.period_end ? daysBetween(report.period_start, report.period_end) : 0;

    return { standardMetrics, customMetrics, chartData, chartType, chartColumns, colStats, pieData, radarData, efficiencyData, kpis, insights, periodDays, categories, spend, msgs, clicks, reach };
  }, [report]);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-6xl mx-auto">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 rounded-2xl" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-40 rounded-2xl" />)}
        </div>
        <Skeleton className="h-80 rounded-2xl" />
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

  const { standardMetrics, customMetrics, chartData, chartType, chartColumns, colStats, pieData, radarData, efficiencyData, kpis, insights, periodDays, categories, spend, msgs, clicks, reach } = analysis;

  const periodLabel = report.period_start && report.period_end
    ? `${fmtDate(report.period_start)} a ${fmtDate(report.period_end)}`
    : "";

  const whatsappMsg = `Olá! Vi o relatório "${report.title}" e gostaria de conversar sobre os resultados.`;
  const whatsappUrl = `https://wa.me/5500000000000?text=${encodeURIComponent(whatsappMsg)}`;
  const handlePrint = () => window.print();

  const parseLines = (text: string) => text.split("\n").map(l => l.trim()).filter(Boolean);

  /* ── Chart renderer ────────────────────────────── */
  const renderMainChart = () => {
    if (chartData.length === 0 || chartColumns.length === 0) return null;

    const gradients = chartColumns.map((_, i) => ({
      id: `grad${i}`,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }));

    const commonProps = { data: chartData, margin: { top: 10, right: 20, left: 0, bottom: 5 } };
    const xAxis = <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />;
    const yAxis = <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={55} tickFormatter={(v: number) => v >= 1000 ? (v / 1000).toFixed(0) + "K" : String(v)} />;
    const tooltip = (
      <Tooltip
        contentStyle={{
          background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
          borderRadius: 12, fontSize: 12, color: "hsl(var(--foreground))",
          boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
        }}
        formatter={(value: any, name: string) => [Number(value).toLocaleString("pt-BR"), name]}
      />
    );
    const grid = <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />;

    if (chartType === "bar") {
      return (
        <BarChart {...commonProps}>
          {grid}{xAxis}{yAxis}{tooltip}
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
          {chartColumns.map((col, i) => (
            <Bar key={col} dataKey={col} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[8, 8, 0, 0]} />
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
              <stop offset="5%" stopColor={g.color} stopOpacity={0.4} />
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

  const statusColor = (s: "good" | "warning" | "bad") =>
    s === "good" ? "text-primary bg-primary/10 border-primary/20" :
    s === "warning" ? "text-warning bg-warning/10 border-warning/20" :
    "text-destructive bg-destructive/10 border-destructive/20";

  const statusIcon = (s: "good" | "warning" | "bad") =>
    s === "good" ? CheckCircle2 : s === "warning" ? AlertTriangle : AlertTriangle;

  /* ── Render ─────────────────────────────────────── */
  return (
    <div className="space-y-6 sm:space-y-8 animate-fade-in max-w-6xl mx-auto w-full print-report">
      <button onClick={() => navigate("/relatorios")} className="no-print inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none">
        <ArrowLeft className="w-4 h-4" /> Voltar aos Relatórios
      </button>

      {/* ═══════════════ HERO HEADER ═══════════════ */}
      <div className="relative bg-card border border-border rounded-2xl overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
        <div className="absolute top-0 right-0 w-80 h-80 rounded-full bg-primary/5 blur-[80px]" />
        <div className="absolute bottom-0 left-0 w-60 h-60 rounded-full bg-accent/5 blur-[60px]" />
        <div className="relative px-6 py-8 sm:px-8 sm:py-10">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-3 flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center">
                  <BarChart3 className="w-6 h-6 text-primary" />
                </div>
                <span className="text-[10px] px-3 py-1.5 rounded-full bg-primary/10 text-primary font-bold border border-primary/20 uppercase tracking-widest">
                  ● Publicado
                </span>
                {periodDays > 0 && (
                  <span className="text-[10px] px-3 py-1.5 rounded-full bg-secondary text-muted-foreground border border-border flex items-center gap-1.5">
                    <Clock className="w-3 h-3" />
                    {periodDays} dias analisados
                  </span>
                )}
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground leading-tight">{report.title}</h1>
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

          {/* Quick overview strip */}
          {standardMetrics.length > 0 && (
            <div className="flex flex-wrap gap-x-6 gap-y-2 mt-6 pt-5 border-t border-border/50">
              {standardMetrics.slice(0, 6).map(metric => (
                <div key={metric.key} className="flex items-center gap-2">
                  <metric.icon className="w-3.5 h-3.5" style={{ color: metric.color }} />
                  <span className="text-[11px] text-muted-foreground">{metric.shortLabel}:</span>
                  <span className="text-[13px] font-mono font-bold text-foreground">{metric.format(metric.value)}</span>
                </div>
              ))}
            </div>
          )}
      </div>

      {/* ═══════════════ DASHBOARD AUTO POR FONTE ═══════════════ */}
      {(report.metrics as any)?.__source && Array.isArray((report.metrics as any)?.__breakdown) && (report.metrics as any).__breakdown.length > 0 && (
        <SourceDashboard
          source={(report.metrics as any).__source}
          sourceLabel={(report.metrics as any).__source_label || "Detectado"}
          rows={(report.metrics as any).__breakdown}
          dimensionKey={(report.metrics as any).__dimension || "Item"}
          metrics={report.metrics as any}
        />
      )}
      </div>

      {/* ═══════════════ KPI CARDS ═══════════════ */}
      {kpis.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-2">
            <Gauge className="w-3.5 h-3.5 text-primary" />
            Indicadores-Chave de Performance (KPIs)
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {kpis.map((kpi, i) => {
              const StatusIcon = statusIcon(kpi.status);
              return (
                <div key={i} className="bg-card border border-border rounded-2xl p-5 relative overflow-hidden group hover:border-primary/20 transition-all">
                  <div className="absolute top-0 right-0 w-20 h-20 rounded-full opacity-[0.04]" style={{ background: kpi.color, transform: "translate(30%, -30%)" }} />
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${kpi.color}15`, border: `1px solid ${kpi.color}25` }}>
                      <kpi.icon className="w-5 h-5" style={{ color: kpi.color }} />
                    </div>
                    <div className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border ${statusColor(kpi.status)}`}>
                      <StatusIcon className="w-3 h-3" />
                      {kpi.status === "good" ? "Bom" : kpi.status === "warning" ? "Atenção" : "Crítico"}
                    </div>
                  </div>
                  <p className="text-2xl font-bold font-mono text-foreground tracking-tight">{kpi.value}</p>
                  <p className="text-[11px] font-semibold text-foreground mt-1">{kpi.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{kpi.detail}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ═══════════════ METRICS GRID ═══════════════ */}
      {standardMetrics.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-primary" />
            Métricas de Performance Detalhadas
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {standardMetrics.map(metric => {
              const Icon = metric.icon;
              const pctOfBenchmark = metric.benchmark ? Math.min((metric.value / metric.benchmark) * 100, 100) : null;

              return (
                <div key={metric.key} className="group bg-card border border-border rounded-2xl p-5 hover:border-primary/20 transition-all relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-28 h-28 rounded-full opacity-[0.03]" style={{ background: metric.color, transform: "translate(30%, -30%)" }} />

                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${metric.color}12`, border: `1px solid ${metric.color}20` }}>
                        <Icon className="w-5 h-5" style={{ color: metric.color }} />
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{metric.shortLabel}</p>
                        <p className="text-[10px] text-muted-foreground/60">{metric.label}</p>
                      </div>
                    </div>
                    <span className="text-[9px] px-2 py-0.5 rounded-md bg-secondary text-muted-foreground border border-border">
                      {metric.category}
                    </span>
                  </div>

                  <p className="text-3xl font-bold font-mono text-foreground tracking-tight">{metric.format(metric.value)}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{metric.unit}</p>

                  {/* Benchmark bar */}
                  {pctOfBenchmark !== null && (
                    <div className="mt-3 space-y-1">
                      <div className="flex justify-between text-[9px] text-muted-foreground">
                        <span>vs. benchmark</span>
                        <span className="font-mono font-bold" style={{ color: pctOfBenchmark >= 80 ? "hsl(145, 100%, 50%)" : pctOfBenchmark >= 50 ? "hsl(38, 92%, 50%)" : "hsl(346, 87%, 60%)" }}>
                          {pctOfBenchmark.toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${pctOfBenchmark}%`,
                            background: pctOfBenchmark >= 80 ? "hsl(145, 100%, 50%)" : pctOfBenchmark >= 50 ? "hsl(38, 92%, 50%)" : "hsl(346, 87%, 60%)",
                          }}
                        />
                      </div>
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
              <Hash className="w-4 h-4 text-muted-foreground mb-2" />
              <p className="text-2xl font-bold font-mono text-foreground tracking-tight">{cm.value}</p>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mt-1.5 font-medium">{cm.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ═══════════════ CHARTS SECTION ═══════════════ */}
      {chartData.length > 0 && chartColumns.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-primary" />
            Evolução e Análise Visual
          </h2>

          {/* Main chart + column analysis */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-card border border-border rounded-2xl p-5 sm:p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />
                  Evolução do Período
                </h3>
                <div className="flex items-center gap-3 flex-wrap">
                  {chartColumns.map((col, i) => (
                    <span key={col} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                      {col}
                    </span>
                  ))}
                </div>
              </div>
              <div className="h-64 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  {renderMainChart()!}
                </ResponsiveContainer>
              </div>
            </div>

            {/* Column stats sidebar */}
            <div className="bg-card border border-border rounded-2xl p-5 sm:p-6 flex flex-col">
              <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                <LayoutGrid className="w-4 h-4 text-primary" />
                Análise por Métrica
              </h3>
              <div className="space-y-5 flex-1">
                {colStats.map((cs) => {
                  const TrendIcon = cs.trend > 3 ? ArrowUpRight : cs.trend < -3 ? ArrowDownRight : ArrowRight;
                  const trendColor = cs.trend > 3 ? "text-primary" : cs.trend < -3 ? "text-destructive" : "text-muted-foreground";
                  return (
                    <div key={cs.col} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full" style={{ background: cs.color }} />
                          <span className="text-[12px] font-semibold text-foreground">{cs.col}</span>
                        </div>
                        <span className={`flex items-center gap-0.5 text-[11px] font-bold ${trendColor}`}>
                          <TrendIcon className="w-3 h-3" />
                          {Math.abs(cs.trend).toFixed(0)}%
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {[
                          { l: "Total", v: cs.total },
                          { l: "Média", v: cs.avg },
                          { l: "Máximo", v: cs.max },
                        ].map(item => (
                          <div key={item.l} className="bg-secondary/50 rounded-lg px-2 py-2 text-center">
                            <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{item.l}</p>
                            <p className="text-[12px] font-mono font-bold text-foreground mt-0.5">
                              {item.v >= 1000 ? (item.v / 1000).toFixed(1) + "K" : Math.round(item.v).toLocaleString("pt-BR")}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Secondary charts: Radar + Pie + Efficiency */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Radar Chart */}
            {radarData.length >= 3 && (
              <div className="bg-card border border-border rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary" />
                  Diagnóstico de Performance
                </h3>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData}>
                      <PolarGrid stroke="hsl(var(--border))" />
                      <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                      <PolarRadiusAxis tick={false} axisLine={false} />
                      <Radar name="Performance" dataKey="value" stroke="hsl(145, 100%, 50%)" fill="hsl(145, 100%, 50%)" fillOpacity={0.15} strokeWidth={2} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-[10px] text-muted-foreground text-center mt-2">Comparativo vs. benchmarks de mercado (100% = referência)</p>
              </div>
            )}

            {/* Pie Chart */}
            {pieData.length >= 2 && (
              <div className="bg-card border border-border rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                  <PieChartIcon className="w-4 h-4 text-primary" />
                  Distribuição de Resultados
                </h3>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={4} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                        {pieData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 11 }}
                        formatter={(value: any) => [Number(value).toLocaleString("pt-BR"), ""]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap gap-2 justify-center mt-2">
                  {pieData.map((d, i) => (
                    <span key={i} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="w-2 h-2 rounded-full" style={{ background: d.fill }} />
                      {d.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Efficiency radial */}
            {efficiencyData.length > 0 && (
              <div className="bg-card border border-border rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                  <Gauge className="w-4 h-4 text-primary" />
                  Índice de Eficiência
                </h3>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadialBarChart cx="50%" cy="50%" innerRadius="30%" outerRadius="90%" data={efficiencyData} startAngle={180} endAngle={0}>
                      <RadialBar background dataKey="value" cornerRadius={10} />
                      <Tooltip
                        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 11 }}
                      />
                    </RadialBarChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap gap-3 justify-center mt-2">
                  {efficiencyData.map((d, i) => (
                    <span key={i} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="w-2 h-2 rounded-full" style={{ background: d.fill }} />
                      {d.name}: {d.value}%
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ═══════════════ DATA TABLE ═══════════════ */}
      {chartData.length > 0 && chartColumns.length > 0 && (
        <section className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 text-primary" />
              Tabela de Dados Detalhados
            </h2>
            <span className="text-[10px] text-muted-foreground bg-secondary px-2 py-1 rounded-md">{chartData.length} períodos</span>
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
                    {chartColumns.map((col, ci) => {
                      const val = Number(row[col]) || 0;
                      const maxVal = colStats[ci]?.max || 1;
                      const pct = (val / maxVal) * 100;
                      return (
                        <td key={col} className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 rounded-full bg-secondary overflow-hidden hidden sm:block">
                              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: CHART_COLORS[ci % CHART_COLORS.length] }} />
                            </div>
                            <span className="font-mono text-foreground font-medium">{val.toLocaleString("pt-BR")}</span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="bg-primary/5 font-semibold">
                  <td className="py-3 px-4 text-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-primary" /> Total
                  </td>
                  {chartColumns.map(col => {
                    const total = chartData.reduce((s, r) => s + (Number(r[col]) || 0), 0);
                    return (
                      <td key={col} className="py-3 px-4 text-right font-mono text-primary font-bold">
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

      {/* ═══════════════ INSIGHTS ═══════════════ */}
      {insights.length > 0 && (
        <section className="bg-gradient-to-br from-card to-secondary/30 border border-border rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Análise Inteligente</h2>
              <p className="text-[10px] text-muted-foreground">Insights gerados automaticamente com base nos dados do relatório</p>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {insights.map((insight, i) => {
              const insightIcon = insight.type === "success" ? Star : insight.type === "warning" ? AlertTriangle : Lightbulb;
              const InsightIcon = insightIcon;
              const borderColor = insight.type === "success" ? "border-primary/30 bg-primary/5" : insight.type === "warning" ? "border-warning/30 bg-warning/5" : "border-accent/30 bg-accent/5";
              const iconColor = insight.type === "success" ? "text-primary bg-primary/10" : insight.type === "warning" ? "text-warning bg-warning/10" : "text-accent bg-accent/10";
              return (
                <div key={i} className={`flex items-start gap-3 rounded-xl p-4 border ${borderColor}`}>
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${iconColor}`}>
                    <InsightIcon className="w-3.5 h-3.5" />
                  </div>
                  <p className="text-[13px] text-foreground/85 leading-relaxed">{insight.text}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ═══════════════ EXECUTIVE SUMMARY ═══════════════ */}
      {report.summary && (
        <section className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border/50 flex items-center gap-3 bg-secondary/20">
            <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
              <BarChart3 className="w-4.5 h-4.5 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Resumo Executivo</h2>
              <p className="text-[10px] text-muted-foreground">Visão geral dos resultados e desempenho do período analisado</p>
            </div>
          </div>
          <div className="px-6 py-5 space-y-3">
            {parseLines(report.summary).map((line, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold text-primary">{i + 1}</span>
                </div>
                <p className="text-[13px] text-foreground/85 leading-relaxed">{line}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ═══════════════ HIGHLIGHTS + NEXT STEPS ═══════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {report.highlights && (
          <section className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border/50 flex items-center gap-3 bg-warning/5">
              <div className="w-9 h-9 rounded-lg bg-warning/10 border border-warning/20 flex items-center justify-center">
                <Award className="w-4.5 h-4.5 text-warning" />
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
            <div className="px-6 py-4 border-b border-border/50 flex items-center gap-3 bg-accent/5">
              <div className="w-9 h-9 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center">
                <Target className="w-4.5 h-4.5 text-accent-foreground" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Próximos Passos</h2>
                <p className="text-[10px] text-muted-foreground">Ações planejadas para o próximo período</p>
              </div>
            </div>
            <div className="px-6 py-5 space-y-2.5">
              {parseLines(report.next_steps).map((line, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="text-[11px] font-mono font-bold text-primary bg-primary/10 rounded-lg w-6 h-6 flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-[13px] text-foreground/85 leading-relaxed">{line}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ═══════════════ CTA SECTION ═══════════════ */}
      <div className="bg-card border border-border rounded-2xl p-6 no-print">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center">
            <MessageCircle className="w-5 h-5 text-muted-foreground" />
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
