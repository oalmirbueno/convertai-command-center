import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useProjects, useClients } from "@/hooks/useSupabaseData";
import { Plus, FileText, Eye, Send, Edit } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";

const metricLabels: Record<string, string> = {
  reach: "Alcance", impressions: "Impressões", engagement: "Engaj. %",
  clicks: "Cliques", ctr: "CTR %", conversions: "Mensagens",
  followers_gained: "Seguidores", ad_spend: "Investido", cpa: "CPA",
};

function formatNumber(n: number) {
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

function formatDate(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export default function AdminReports() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: reports, isLoading } = useQuery({
    queryKey: ["reports"],
    queryFn: async () => {
      const { data } = await supabase
        .from("reports")
        .select("*, project:projects(name), client:profiles!reports_client_id_fkey(full_name, company_name)")
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!user,
  });

  const handleSendToClient = async (r: any) => {
    if (r.status !== "published") {
      await supabase.from("reports").update({ status: "published" }).eq("id", r.id);
    }
    await supabase.from("notifications").insert({
      user_id: r.client_id,
      message: `Novo relatório disponível: ${r.title}`,
      notification_type: "report",
      link: "/relatorios",
    });
    queryClient.invalidateQueries({ queryKey: ["reports"] });
    toast.success("Relatório enviado ao cliente!");
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        {[1, 2].map(i => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Relatórios</h1>
        <button onClick={() => navigate("/relatorios/novo")} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-[13px] font-medium hover:opacity-90 transition-opacity cursor-pointer">
          <Plus className="w-4 h-4" /> Novo Relatório
        </button>
      </div>

      {(!reports || reports.length === 0) ? (
        <div className="text-center py-16">
          <FileText className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhum relatório criado ainda</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reports.map((r: any) => {
            const m = (r.metrics || {}) as Record<string, any>;
            const visibleMetrics = Object.entries(m)
              .filter(([k]) => k !== "custom" && metricLabels[k] && m[k] !== undefined)
              .slice(0, 6);

            return (
              <div key={r.id} className="bg-card border border-border rounded-2xl p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-foreground">📊 {r.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {(r as any).client?.company_name || (r as any).client?.full_name} • {(r as any).project?.name}
                      {r.period_start && r.period_end && ` • ${formatDate(r.period_start)}-${formatDate(r.period_end)}`}
                    </p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${r.status === "published" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                    {r.status === "published" ? "Publicado" : "Rascunho"}
                  </span>
                </div>

                {visibleMetrics.length > 0 && (
                  <div className="flex flex-wrap gap-4 mt-4">
                    {visibleMetrics.map(([key, val]) => (
                      <div key={key} className="min-w-[80px]">
                        <p className="text-base font-mono text-foreground">
                          {key === "engagement" || key === "ctr" ? val + "%" : formatNumber(val as number)}
                        </p>
                        <p className="text-[10px] uppercase text-muted-foreground">{metricLabels[key]}</p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 mt-4">
                  <button onClick={() => navigate(`/relatorios/${r.id}`)} className="text-[12px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1">
                    <Eye className="w-3 h-3" /> Ver
                  </button>
                  <button onClick={() => handleSendToClient(r)} className="text-[12px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1">
                    <Send className="w-3 h-3" /> Enviar ao Cliente
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
