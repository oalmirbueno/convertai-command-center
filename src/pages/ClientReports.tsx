import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useClientIdentity } from "@/hooks/useClientIdentity";
import {
  FileText, BarChart3, TrendingUp, Calendar, ArrowRight,
  Eye, MousePointerClick, Users, Zap, DollarSign, Target, MessageCircle,
  Folder, ChevronRight,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { getPeriodModel, PERIOD_ORDER } from "@/lib/reportGrouping";
import {
  AreaChart, Area, ResponsiveContainer,
} from "recharts";

const metricConfig: Record<string, { label: string; format: (v: number) => string; icon: any; color: string }> = {
  reach:            { label: "Alcance",      format: v => v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(v), icon: Eye,               color: "hsl(200, 100%, 50%)" },
  impressions:      { label: "Impressões",   format: v => v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(v), icon: BarChart3,         color: "hsl(263, 70%, 66%)" },
  engagement:       { label: "Engaj.",       format: v => v.toFixed(1) + "%",                                  icon: Zap,               color: "hsl(145, 100%, 50%)" },
  clicks:           { label: "Cliques",      format: v => v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(v), icon: MousePointerClick, color: "hsl(38, 92%, 50%)" },
  ctr:              { label: "CTR",          format: v => v.toFixed(2) + "%",                                  icon: Target,            color: "hsl(346, 87%, 60%)" },
  conversions:      { label: "Mensagens",    format: v => String(v),                                           icon: MessageCircle,     color: "hsl(142, 71%, 45%)" },
  followers_gained: { label: "Seguidores",   format: v => "+" + v,                                             icon: Users,             color: "hsl(188, 94%, 43%)" },
  ad_spend:         { label: "Investido",    format: v => "R$" + v.toLocaleString("pt-BR"),                    icon: DollarSign,        color: "hsl(221, 83%, 53%)" },
};

function formatDateShort(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function ClientReports() {
  const { user } = useAuth();
  const { clientId } = useClientIdentity();
  const navigate = useNavigate();

  const { data: reports, isLoading } = useQuery({
    queryKey: ["reports-client", clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from("reports")
        .select("*, project:projects(name)")
        .eq("client_id", clientId!)
        .eq("status", "published")
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!user,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        {[1, 2].map(i => <Skeleton key={i} className="h-56 w-full rounded-2xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <BarChart3 className="w-4 h-4 text-primary" />
          </div>
          Relatórios
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5">Acompanhe os resultados dos seus projetos com dados detalhados.</p>
      </div>

      {(!reports || reports.length === 0) ? (
        <div className="text-center py-20 bg-card border border-border rounded-2xl">
          <div className="w-16 h-16 rounded-2xl bg-secondary mx-auto mb-4 flex items-center justify-center">
            <FileText className="w-7 h-7 text-muted-foreground/30" />
          </div>
          <p className="text-sm text-muted-foreground">Seus relatórios aparecerão aqui quando publicados.</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Você será notificado assim que um novo relatório estiver disponível.</p>
        </div>
      ) : (
        <ClientReportsGrouped reports={reports} navigate={navigate} />
      )}
    </div>
  );
}

function ClientReportsGrouped({ reports, navigate }: { reports: any[]; navigate: any }) {
  const groups: Record<string, any[]> = {};
  for (const r of reports) {
    const m = getPeriodModel(r.period_start, r.period_end);
    (groups[m] ||= []).push(r);
  }
  const modelKeys = PERIOD_ORDER.filter(p => groups[p]);
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(modelKeys.map(k => [k, true]))
  );
  const toggle = (k: string) => setOpen(s => ({ ...s, [k]: !s[k] }));

  return (
    <div className="space-y-4">
      {modelKeys.map((model) => (
        <div key={model} className="space-y-3">
          <button
            onClick={() => toggle(model)}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-card border border-border hover:border-primary/30 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <Folder className="w-4 h-4 text-primary" />
              <p className="text-sm font-semibold text-foreground">{model}</p>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">{groups[model].length}</span>
            </div>
            <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${open[model] ? "rotate-90" : ""}`} />
          </button>
          {open[model] && (
            <div className="space-y-5 pl-2">
              {groups[model].map((r: any) => {
            const m = (r.metrics || {}) as Record<string, any>;
            const visibleMetrics = Object.entries(m)
              .filter(([k]) => k !== "custom" && metricConfig[k] && m[k] !== undefined && m[k] !== 0)
              .map(([k, v]) => ({ key: k, value: v as number, ...metricConfig[k] }));

            const chartData = ((r.chart_data || []) as Array<Record<string, any>>);
            const chartColumns = chartData.length > 0
              ? Object.keys(chartData[0]).filter(k => k !== "label")
              : [];

            // Mini sparkline data
            const sparklineData = chartData.length > 0 && chartColumns.length > 0
              ? chartData.map(row => ({ v: Number(row[chartColumns[0]]) || 0 }))
              : null;

            return (
              <div
                key={r.id}
                className="bg-card border border-border rounded-2xl overflow-hidden hover:border-primary/30 transition-all group cursor-pointer"
                onClick={() => navigate(`/relatorios/${r.id}`)}
              >
                {/* Header */}
                <div className="px-6 py-5 flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 mb-1.5">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                        <TrendingUp className="w-4 h-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{r.title}</p>
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                          {(r as any).project?.name}
                          {r.period_start && r.period_end && (
                            <>
                              <span className="w-1 h-1 rounded-full bg-muted-foreground/40 inline-block" />
                              <Calendar className="w-3 h-3" />
                              {formatDateShort(r.period_start)} a {formatDateShort(r.period_end)}
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium border border-primary/20">
                      Publicado
                    </span>
                    {sparklineData && (
                      <div className="w-20 h-8 hidden sm:block">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={sparklineData}>
                            <defs>
                              <linearGradient id={`spark-${r.id}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="hsl(145, 100%, 50%)" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="hsl(145, 100%, 50%)" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <Area type="monotone" dataKey="v" stroke="hsl(145, 100%, 50%)" fill={`url(#spark-${r.id})`} strokeWidth={1.5} dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                </div>

                {/* Metrics */}
                {visibleMetrics.length > 0 && (
                  <div className="px-6 pb-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {visibleMetrics.slice(0, 4).map(metric => {
                        const Icon = metric.icon;
                        return (
                          <div key={metric.key} className="bg-secondary/40 rounded-xl p-3 flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${metric.color}12` }}>
                              <Icon className="w-3.5 h-3.5" style={{ color: metric.color }} />
                            </div>
                            <div className="min-w-0">
                              <p className="text-base font-mono font-bold text-foreground leading-none">{metric.format(metric.value)}</p>
                              <p className="text-[9px] uppercase text-muted-foreground mt-0.5 tracking-wider">{metric.label}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {visibleMetrics.length > 4 && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-2.5">
                        {visibleMetrics.slice(4, 8).map(metric => {
                          const Icon = metric.icon;
                          return (
                            <div key={metric.key} className="bg-secondary/40 rounded-xl p-3 flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${metric.color}12` }}>
                                <Icon className="w-3.5 h-3.5" style={{ color: metric.color }} />
                              </div>
                              <div className="min-w-0">
                                <p className="text-base font-mono font-bold text-foreground leading-none">{metric.format(metric.value)}</p>
                                <p className="text-[9px] uppercase text-muted-foreground mt-0.5 tracking-wider">{metric.label}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Summary preview */}
                {r.summary && (
                  <div className="px-6 pb-4">
                    <p className="text-[12px] text-muted-foreground line-clamp-2 leading-relaxed">{r.summary}</p>
                  </div>
                )}

                {/* Footer CTA */}
                <div className="px-6 py-3 border-t border-border/50 bg-secondary/20 flex items-center justify-between">
                  <span className="text-[12px] text-muted-foreground">
                    {visibleMetrics.length} métricas disponíveis
                  </span>
                  <span className="text-[12px] text-primary font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                    Ver Relatório Completo <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
              );
            })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

