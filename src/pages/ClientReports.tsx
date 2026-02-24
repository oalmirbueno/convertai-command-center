import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { FileText } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";

const metricConfig: Record<string, { label: string; format: (v: number) => string }> = {
  reach: { label: "Alcance", format: v => v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(v) },
  impressions: { label: "Impressões", format: v => v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(v) },
  engagement: { label: "Engaj.", format: v => v + "%" },
  clicks: { label: "Cliques", format: v => v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(v) },
  ctr: { label: "CTR", format: v => v + "%" },
  conversions: { label: "Conversões", format: v => String(v) },
  followers_gained: { label: "Seguidores", format: v => "+" + v },
  ad_spend: { label: "Investido", format: v => "R$" + v.toLocaleString("pt-BR") },
};

function formatDateShort(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function ClientReports() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: reports, isLoading } = useQuery({
    queryKey: ["reports-client", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("reports")
        .select("*, project:projects(name)")
        .eq("client_id", user!.id)
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
        {[1, 2].map(i => <Skeleton key={i} className="h-48 w-full rounded-2xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Relatórios</h1>
        <p className="text-sm text-muted-foreground mt-1">Acompanhe os resultados dos seus projetos.</p>
      </div>

      {(!reports || reports.length === 0) ? (
        <div className="text-center py-16">
          <FileText className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Seus relatórios aparecerão aqui quando publicados.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {reports.map((r: any) => {
            const m = (r.metrics || {}) as Record<string, any>;
            const visibleMetrics = Object.entries(m)
              .filter(([k]) => k !== "custom" && metricConfig[k])
              .map(([k, v]) => ({ key: k, value: v as number, ...metricConfig[k] }));

            return (
              <div key={r.id} className="bg-card border border-border rounded-2xl p-6 hover:border-primary/30 transition-colors">
                {/* Header */}
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-foreground">📊 {r.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {(r as any).project?.name}
                      {r.period_start && r.period_end && ` • ${formatDateShort(r.period_start)} a ${formatDateShort(r.period_end)}`}
                    </p>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-success/10 text-success shrink-0">Publicado</span>
                </div>

                {/* Metrics grid */}
                {visibleMetrics.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
                    {visibleMetrics.slice(0, 8).map(metric => (
                      <div key={metric.key} className="bg-secondary/40 rounded-xl p-3">
                        <p className="text-lg font-mono font-medium text-foreground">{metric.format(metric.value)}</p>
                        <p className="text-[10px] uppercase text-muted-foreground">{metric.label}</p>
                        <div className="flex items-end gap-0.5 h-6 mt-2">
                          {[40, 65, 50, 80, 70].map((v, i) => (
                            <div key={i} className="flex-1 bg-primary/40 rounded-sm" style={{ height: `${v}%` }} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Summary preview */}
                {r.summary && (
                  <p className="text-[13px] text-muted-foreground mt-4 italic line-clamp-2">"{r.summary}"</p>
                )}

                {/* CTA */}
                <div className="flex gap-3 mt-4">
                  <button
                    onClick={() => navigate(`/relatorios/${r.id}`)}
                    className="px-4 py-2 rounded-xl text-[13px] bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none font-medium"
                  >
                    Ver Relatório Completo
                  </button>
                  {r.file_url && (
                    <a href={r.file_url} target="_blank" rel="noopener noreferrer" className="px-4 py-2 rounded-xl text-[13px] bg-secondary text-foreground hover:bg-secondary/80 transition-colors inline-flex items-center gap-1">
                      📥 Baixar PDF
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
