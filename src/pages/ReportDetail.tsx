import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Download, MessageCircle, TrendingUp, TrendingDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

const metricConfig: Record<string, { label: string; format: (v: number) => string }> = {
  reach: { label: "Alcance", format: v => v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(v) },
  impressions: { label: "Impressões", format: v => v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(v) },
  engagement: { label: "Engajamento", format: v => v + "%" },
  clicks: { label: "Cliques", format: v => v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(v) },
  ctr: { label: "CTR", format: v => v + "%" },
  conversions: { label: "Conversões", format: v => String(v) },
  followers_gained: { label: "Novos Seguidores", format: v => "+" + v },
  ad_spend: { label: "Investimento", format: v => "R$ " + v.toLocaleString("pt-BR") },
  cpa: { label: "CPA", format: v => "R$ " + v },
};

function formatDateLong(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
}

const CHART_COLORS = [
  "hsl(263, 70%, 66%)", "hsl(188, 94%, 43%)", "hsl(142, 71%, 45%)",
  "hsl(38, 92%, 50%)", "hsl(346, 87%, 60%)", "hsl(221, 83%, 53%)",
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
      <div className="space-y-6 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
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

  const renderChart = () => {
    if (chartData.length === 0 || chartColumns.length === 0) return null;

    const gradients = chartColumns.map((_, i) => ({
      id: `grad${i}`,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }));

    const commonProps = {
      data: chartData,
      margin: { top: 5, right: 10, left: 0, bottom: 5 },
    };

    const xAxis = (
      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
    );
    const yAxis = (
      <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={50}
        tickFormatter={(v: number) => v >= 1000 ? (v / 1000).toFixed(0) + "K" : String(v)} />
    );
    const tooltip = (
      <Tooltip
        contentStyle={{
          background: "hsl(var(--card))",
          border: "1px solid hsl(var(--border))",
          borderRadius: 12,
          fontSize: 12,
          color: "hsl(var(--foreground))",
        }}
      />
    );
    const grid = <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />;

    if (chartType === "bar") {
      return (
        <BarChart {...commonProps}>
          {grid}{xAxis}{yAxis}{tooltip}
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {chartColumns.map((col, i) => (
            <Bar key={col} dataKey={col} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[4, 4, 0, 0]} />
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
            <Line key={col} type="monotone" dataKey={col} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={{ r: 4 }} />
          ))}
        </LineChart>
      );
    }

    // Default: area
    return (
      <AreaChart {...commonProps}>
        <defs>
          {gradients.map(g => (
            <linearGradient key={g.id} id={g.id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={g.color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={g.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {grid}{xAxis}{yAxis}{tooltip}
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {chartColumns.map((col, i) => (
          <Area key={col} type="monotone" dataKey={col} stroke={gradients[i].color} fill={`url(#${gradients[i].id})`} strokeWidth={2} />
        ))}
      </AreaChart>
    );
  };

  return (
    <div className="space-y-8 animate-fade-in max-w-4xl mx-auto w-full print-report">
      <button onClick={() => navigate("/relatorios")} className="no-print inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none">
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>

      {/* HEADER */}
      <div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">📊 {report.title}</h1>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-success/10 text-success">Publicado</span>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          {(report as any).project?.name}{periodLabel && ` • ${periodLabel}`}
        </p>
      </div>

      {/* METRICS GRID */}
      {standardMetrics.length > 0 && (
        <section>
          <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-4">Métricas Principais</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {standardMetrics.map(metric => (
              <div key={metric.key} className="bg-card border border-border rounded-2xl p-5">
                <p className="text-2xl font-mono font-light text-foreground">{metric.format(metric.value)}</p>
                <p className="text-[10px] uppercase text-muted-foreground mt-1">{metric.label}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* CUSTOM METRICS */}
      {customMetrics.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {customMetrics.map((cm, i) => (
            <div key={i} className="bg-card border border-border rounded-2xl p-5">
              <p className="text-2xl font-mono font-light text-foreground">{cm.value}</p>
              <p className="text-[10px] uppercase text-muted-foreground mt-1">{cm.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* CHART — Real data */}
      {chartData.length > 0 && chartColumns.length > 0 && (
        <section className="bg-card border border-border rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-foreground mb-4">📈 Evolução</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              {renderChart()!}
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* DATA TABLE */}
      {chartData.length > 0 && chartColumns.length > 0 && (
        <section className="bg-card border border-border rounded-2xl p-6">
          <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-4">Dados Detalhados</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">Período</th>
                  {chartColumns.map(col => (
                    <th key={col} className="text-right py-2 px-3 text-muted-foreground font-medium">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chartData.map((row, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-2 px-3 text-foreground font-medium">{row.label}</td>
                    {chartColumns.map(col => (
                      <td key={col} className="py-2 px-3 text-right font-mono text-foreground">
                        {typeof row[col] === "number" ? (row[col] as number).toLocaleString("pt-BR") : row[col]}
                      </td>
                    ))}
                  </tr>
                ))}
                {/* Totals row */}
                <tr className="bg-secondary/30 font-medium">
                  <td className="py-2 px-3 text-foreground">Total</td>
                  {chartColumns.map(col => {
                    const total = chartData.reduce((s, r) => s + (Number(r[col]) || 0), 0);
                    return (
                      <td key={col} className="py-2 px-3 text-right font-mono text-foreground">
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
      {report.summary && (
        <section className="bg-card border border-border rounded-2xl p-6">
          <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">Resumo Executivo</h2>
          <p className="text-[13px] text-foreground/80 leading-relaxed whitespace-pre-line">{report.summary}</p>
        </section>
      )}

      {report.highlights && (
        <section className="bg-card border border-border rounded-2xl p-6">
          <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">Destaques do Período</h2>
          <p className="text-[13px] text-foreground/80 leading-relaxed whitespace-pre-line">{report.highlights}</p>
        </section>
      )}

      {report.next_steps && (
        <section className="bg-card border border-border rounded-2xl p-6">
          <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">Próximos Passos</h2>
          <p className="text-[13px] text-foreground/80 leading-relaxed whitespace-pre-line">{report.next_steps}</p>
        </section>
      )}

      {/* ACTIONS */}
      <div className="flex flex-wrap gap-3 no-print pb-8">
        {report.file_url ? (
          <a href={report.file_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-[13px] bg-primary text-primary-foreground hover:opacity-90 transition-opacity font-medium">
            <Download className="w-4 h-4" /> Baixar Relatório em PDF
          </a>
        ) : (
          <button onClick={handlePrint} className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-[13px] bg-primary text-primary-foreground hover:opacity-90 transition-opacity font-medium cursor-pointer border-none">
            <Download className="w-4 h-4" /> Baixar Relatório em PDF
          </button>
        )}
        <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-[13px] bg-secondary text-foreground hover:bg-secondary/80 transition-colors font-medium">
          <MessageCircle className="w-4 h-4" /> Falar sobre resultados
        </a>
      </div>
    </div>
  );
}
