import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { FileText } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

const metricFields = [
  { key: "reach", label: "Alcance" },
  { key: "impressions", label: "Impressões" },
  { key: "engagement", label: "Engaj. %" },
  { key: "clicks", label: "Cliques" },
  { key: "ctr", label: "CTR %" },
  { key: "conversions", label: "Conversões" },
];

function formatNumber(n: number) {
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

function formatDate(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateShort(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function MiniBars() {
  const bars = [55, 80, 40, 95, 65];
  return (
    <div className="flex items-end gap-0.5 h-6 mt-2">
      {bars.map((v, i) => (
        <div key={i} className="flex-1 bg-primary/50 rounded-sm" style={{ height: `${v}%` }} />
      ))}
    </div>
  );
}

export default function ClientReports() {
  const { user } = useAuth();
  const [previewReport, setPreviewReport] = useState<any>(null);

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
            const m = (r.metrics || {}) as Record<string, number>;
            const visibleMetrics = metricFields.filter(f => m[f.key] !== undefined);
            return (
              <div key={r.id} className="bg-card border border-border rounded-2xl p-6">
                <p className="text-sm font-semibold text-foreground">📊 {r.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {(r as any).project?.name}
                  {r.period_start && r.period_end && ` • ${formatDateShort(r.period_start)}-${formatDateShort(r.period_end)}`}
                </p>

                {visibleMetrics.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
                    {visibleMetrics.map(f => (
                      <div key={f.key} className="bg-secondary/40 rounded-xl p-3">
                        <p className="text-lg font-mono font-medium text-foreground">
                          {f.key === "engagement" || f.key === "ctr" ? m[f.key] + "%" : formatNumber(m[f.key])}
                        </p>
                        <p className="text-[10px] uppercase text-muted-foreground">{f.label}</p>
                        <MiniBars />
                      </div>
                    ))}
                  </div>
                )}

                {r.summary && (
                  <p className="text-[13px] text-muted-foreground mt-4 italic">"{r.summary}"</p>
                )}

                <div className="flex gap-3 mt-4">
                  <button
                    onClick={() => setPreviewReport(r)}
                    className="px-4 py-2 rounded-xl text-[13px] bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none font-medium"
                  >
                    Ver Relatório Completo
                  </button>
                  {r.file_url && (
                    <a href={r.file_url} target="_blank" rel="noopener noreferrer" className="px-4 py-2 rounded-xl text-[13px] bg-secondary text-foreground hover:bg-secondary/80 transition-colors inline-flex items-center gap-1">
                      📄 Baixar PDF
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Preview Modal */}
      <Dialog open={!!previewReport} onOpenChange={() => setPreviewReport(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {previewReport && (() => {
            const m = (previewReport.metrics || {}) as Record<string, number>;
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="text-lg">{previewReport.title}</DialogTitle>
                  {previewReport.period_start && (
                    <p className="text-xs text-muted-foreground">{formatDate(previewReport.period_start)} — {formatDate(previewReport.period_end)}</p>
                  )}
                </DialogHeader>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4">
                  {metricFields.filter(f => m[f.key] !== undefined).map(f => (
                    <div key={f.key} className="bg-secondary/50 rounded-xl p-4">
                      <p className="text-[10px] uppercase text-muted-foreground">{f.label}</p>
                      <p className="text-2xl font-mono font-light text-foreground mt-1">
                        {f.key === "engagement" || f.key === "ctr" ? m[f.key] + "%" : formatNumber(m[f.key])}
                      </p>
                      <MiniBars />
                    </div>
                  ))}
                </div>
                {previewReport.summary && (
                  <div className="mt-6">
                    <p className="text-[11px] uppercase text-muted-foreground mb-2">Resumo</p>
                    <p className="text-[13px] text-foreground/80 leading-relaxed">{previewReport.summary}</p>
                  </div>
                )}
                {previewReport.file_url && (
                  <a href={previewReport.file_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 mt-4 text-[13px] text-primary hover:underline">
                    📄 Baixar PDF
                  </a>
                )}
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
