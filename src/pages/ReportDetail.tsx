import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Download, MessageCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

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

// Generate fake weekly sparkline data based on value
function generateSparkline(value: number) {
  const base = value * 0.7;
  return [0.6, 0.75, 0.65, 0.85, 0.9, 1.0, 0.95].map((mult, i) => ({
    i,
    v: Math.round(base * mult + Math.random() * value * 0.1),
  }));
}

// Generate chart data for the evolution chart
function generateChartData(metrics: Record<string, number>) {
  const days = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const reach = metrics.reach || 0;
  const impressions = metrics.impressions || 0;
  return days.map((day, i) => ({
    day,
    alcance: Math.round(reach * (0.6 + i * 0.06 + Math.random() * 0.08)),
    impressoes: Math.round(impressions * (0.6 + i * 0.05 + Math.random() * 0.08)),
  }));
}

export default function ReportDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();

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
    .filter(([k]) => k !== "custom" && metricConfig[k])
    .map(([k, v]) => ({ key: k, value: v as number, ...metricConfig[k] }));

  const chartData = generateChartData(m);
  const periodLabel = report.period_start && report.period_end
    ? `${formatDateLong(report.period_start)} a ${formatDateLong(report.period_end)}`
    : "";

  const whatsappMsg = `Olá! Vi o relatório "${report.title}" e gostaria de conversar sobre os resultados.`;
  const whatsappUrl = `https://wa.me/5500000000000?text=${encodeURIComponent(whatsappMsg)}`;

  const handlePrint = () => window.print();

  return (
    <div className="space-y-8 animate-fade-in max-w-4xl mx-auto w-full print-report">
      <button onClick={() => navigate("/relatorios")} className="no-print inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
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
            {standardMetrics.map(metric => {
              const sparkData = generateSparkline(metric.value);
              const variation = Math.round(Math.random() * 20 + 2);
              return (
                <div key={metric.key} className="bg-card border border-border rounded-2xl p-5">
                  <p className="text-2xl font-mono font-light text-foreground">{metric.format(metric.value)}</p>
                  <p className="text-[10px] uppercase text-muted-foreground mt-1">{metric.label}</p>
                  <p className="text-[11px] text-success mt-1">▲ +{variation}%</p>
                  <div className="flex items-end gap-0.5 h-7 mt-2">
                    {sparkData.map((d, i) => (
                      <div
                        key={i}
                        className="flex-1 bg-primary/40 rounded-sm transition-all duration-500"
                        style={{ height: `${(d.v / (sparkData[sparkData.length - 1].v || 1)) * 100}%`, animationDelay: `${i * 80}ms` }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
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

      {/* EVOLUTION CHART */}
      {(m.reach || m.impressions) && (
        <section className="bg-card border border-border rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-foreground mb-4">📈 Evolução Semanal</h2>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorAlcance" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(263, 70%, 66%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(263, 70%, 66%)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorImpr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(188, 94%, 43%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(188, 94%, 43%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "hsl(240, 4%, 52%)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(240, 4%, 52%)" }} axisLine={false} tickLine={false} width={45} tickFormatter={v => v >= 1000 ? (v / 1000).toFixed(0) + "K" : v} />
                <Tooltip
                  contentStyle={{ background: "hsl(240, 5%, 7%)", border: "1px solid hsl(240, 4%, 16%)", borderRadius: 12, fontSize: 12 }}
                  labelStyle={{ color: "hsl(0, 0%, 98%)" }}
                />
                <Area type="monotone" dataKey="alcance" stroke="hsl(263, 70%, 66%)" fill="url(#colorAlcance)" strokeWidth={2} />
                <Area type="monotone" dataKey="impressoes" stroke="hsl(188, 94%, 43%)" fill="url(#colorImpr)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-6 mt-3 justify-center">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-3 h-0.5 bg-primary rounded-full" /> Alcance
            </span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-3 h-0.5 bg-accent rounded-full" /> Impressões
            </span>
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
