import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useProjects, useClients } from "@/hooks/useSupabaseData";
import { Plus, FileText, Eye, Send, Edit, Folder, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { groupReports, getClientName, PERIOD_ORDER } from "@/lib/reportGrouping";

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
        <GroupedReports
          reports={reports}
          metricLabels={metricLabels}
          formatNumber={formatNumber}
          formatDate={formatDate}
          onView={(id) => navigate(`/relatorios/${id}`)}
          onSend={handleSendToClient}
        />
      )}
    </div>
  );
}

function GroupedReports({ reports, metricLabels, formatNumber, formatDate, onView, onSend }: any) {
  const grouped = groupReports(reports as any[], getClientName);
  const clients = Object.keys(grouped).sort();
  const [openClients, setOpenClients] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(clients.map(c => [c, true]))
  );
  const [openModels, setOpenModels] = useState<Record<string, boolean>>({});

  const toggleClient = (c: string) => setOpenClients(s => ({ ...s, [c]: !s[c] }));
  const toggleModel = (k: string) => setOpenModels(s => ({ ...s, [k]: s[k] === false ? true : false }));

  return (
    <div className="space-y-3">
      {clients.map((client) => {
        const models = grouped[client];
        const modelKeys = PERIOD_ORDER.filter(p => models[p]);
        const totalCount = modelKeys.reduce((acc, k) => acc + models[k].length, 0);
        const isOpen = openClients[client] !== false;
        return (
          <div key={client} className="bg-card border border-border rounded-2xl overflow-hidden">
            <button
              onClick={() => toggleClient(client)}
              className="w-full flex items-center justify-between gap-3 px-5 py-4 hover:bg-secondary/30 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Folder className="w-4 h-4 text-primary shrink-0" />
                <p className="text-sm font-semibold text-foreground truncate">{client}</p>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">{totalCount}</span>
              </div>
              <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
            </button>
            {isOpen && (
              <div className="border-t border-border/60 divide-y divide-border/40">
                {modelKeys.map((model) => {
                  const list = models[model];
                  const key = `${client}::${model}`;
                  const modelOpen = openModels[key] !== false;
                  return (
                    <div key={model} className="bg-background/40">
                      <button
                        onClick={() => toggleModel(key)}
                        className="w-full flex items-center justify-between gap-3 px-5 py-3 hover:bg-secondary/20 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Folder className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <p className="text-[12px] font-medium text-foreground">{model}</p>
                          <span className="text-[10px] text-muted-foreground">({list.length})</span>
                        </div>
                        <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${modelOpen ? "rotate-90" : ""}`} />
                      </button>
                      {modelOpen && (
                        <div className="px-5 pb-4 space-y-2">
                          {list.map((r: any) => {
                            const m = (r.metrics || {}) as Record<string, any>;
                            const visibleMetrics = Object.entries(m)
                              .filter(([k]) => k !== "custom" && metricLabels[k] && m[k] !== undefined)
                              .slice(0, 4);
                            return (
                              <div key={r.id} className="bg-card border border-border rounded-xl p-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="text-[13px] font-semibold text-foreground truncate">📊 {r.title}</p>
                                    <p className="text-[11px] text-muted-foreground mt-0.5">
                                      {r.project?.name}
                                      {r.period_start && r.period_end && ` • ${formatDate(r.period_start)}-${formatDate(r.period_end)}`}
                                    </p>
                                  </div>
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${r.status === "published" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                                    {r.status === "published" ? "Publicado" : "Rascunho"}
                                  </span>
                                </div>
                                {visibleMetrics.length > 0 && (
                                  <div className="flex flex-wrap gap-3 mt-3">
                                    {visibleMetrics.map(([key, val]) => (
                                      <div key={key} className="min-w-[70px]">
                                        <p className="text-sm font-mono text-foreground">
                                          {key === "engagement" || key === "ctr" ? val + "%" : formatNumber(val as number)}
                                        </p>
                                        <p className="text-[9px] uppercase text-muted-foreground">{metricLabels[key]}</p>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <div className="flex gap-3 mt-3">
                                  <button onClick={() => onView(r.id)} className="text-[12px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1">
                                    <Eye className="w-3 h-3" /> Ver
                                  </button>
                                  <button onClick={() => onSend(r)} className="text-[12px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1">
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
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
