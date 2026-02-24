import { useState } from "react";
import { useClientRequests, useClients, useProjects } from "@/hooks/useSupabaseData";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { X, Loader2 } from "lucide-react";

const statusOptions = [
  { value: "new", label: "Novo", cls: "bg-info/10 text-info" },
  { value: "analyzing", label: "Em Análise", cls: "bg-warning/10 text-warning" },
  { value: "in_progress", label: "Em Andamento", cls: "bg-primary/10 text-primary" },
  { value: "completed", label: "Concluído", cls: "bg-success/10 text-success" },
];

const priorityBadge: Record<string, { cls: string; label: string }> = {
  low: { cls: "bg-muted text-muted-foreground", label: "Baixa" },
  normal: { cls: "bg-secondary text-foreground", label: "Normal" },
  high: { cls: "bg-warning/10 text-warning", label: "Alta" },
  urgent: { cls: "bg-destructive/10 text-destructive", label: "Urgente" },
};

export default function AdminRequests() {
  const { data: requests, isLoading } = useClientRequests();
  const { data: clients } = useClients();
  const { data: projects } = useProjects();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("all");

  const filters = [
    { value: "all", label: "Todos" },
    { value: "new", label: "Novos" },
    { value: "in_progress", label: "Em Andamento" },
    { value: "completed", label: "Concluídos" },
  ];

  const filteredRequests = (requests || []).filter((r: any) => filter === "all" || r.status === filter);

  const getClient = (id: string) => (clients || []).find((c: any) => c.id === id);
  const getProject = (id: string) => (projects || []).find((p: any) => p.id === id);

  const handleStatusChange = async (status: string) => {
    if (!selected) return;
    await supabase.from("client_requests").update({ status }).eq("id", selected.id);
    // Create update if project exists
    if (selected.project_id) {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        const label = statusOptions.find(s => s.value === status)?.label || status;
        await supabase.from("updates").insert({
          project_id: selected.project_id, author_id: authUser.id,
          message: `Pedido "${selected.title}": status → ${label}`, update_type: "request",
        });
      }
    }
    queryClient.invalidateQueries({ queryKey: ["client-requests"] });
    setSelected({ ...selected, status });
    toast.success("Status atualizado");
  };

  const handleCreateTask = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const priorityMap: Record<string, string> = { normal: "medium", alta: "high", urgente: "urgent", low: "low" };
      await supabase.from("tasks").insert({
        title: selected.title,
        description: selected.description,
        project_id: selected.project_id,
        status: "backlog",
        priority: priorityMap[selected.priority] || "medium",
      });
      await supabase.from("client_requests").update({ status: "in_progress" }).eq("id", selected.id);
      // Create update
      if (selected.project_id) {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (authUser) {
          await supabase.from("updates").insert({
            project_id: selected.project_id, author_id: authUser.id,
            message: `Pedido "${selected.title}" transformado em tarefa`, update_type: "task",
          });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["client-requests"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setSelected({ ...selected, status: "in_progress" });
      toast.success("Tarefa criada a partir do pedido");
    } catch (err: any) {
      toast.error(err.message || "Erro");
    }
    setSaving(false);
  };

  const handleComplete = async () => {
    if (!selected) return;
    await supabase.from("client_requests").update({ status: "completed" }).eq("id", selected.id);
    if (selected.project_id) {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        await supabase.from("updates").insert({
          project_id: selected.project_id, author_id: authUser.id,
          message: `Pedido "${selected.title}" concluído`, update_type: "request",
        });
      }
    }
    queryClient.invalidateQueries({ queryKey: ["client-requests"] });
    setSelected({ ...selected, status: "completed" });
    toast.success("Pedido concluído");
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="heading-page">Pedidos de Clientes</p>
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hidden">
          {filters.map((f) => (
            <button key={f.value} onClick={() => setFilter(f.value)}
              className={`px-3 py-1.5 rounded-full text-[12px] transition-colors cursor-pointer border flex-shrink-0 whitespace-nowrap ${filter === f.value ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground bg-transparent"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : (requests || []).length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Nenhum pedido recebido.</div>
      ) : (
        <div className="space-y-2 stagger-children">
          {filteredRequests.map((r: any) => {
            const client = getClient(r.client_id);
            const project = getProject(r.project_id);
            const status = statusOptions.find(s => s.value === r.status) || statusOptions[0];
            const pBadge = priorityBadge[r.priority] || priorityBadge.normal;
            return (
              <div key={r.id} onClick={() => setSelected(r)}
                className="bg-card border border-border rounded-xl px-5 py-4 cursor-pointer hover:border-muted-foreground/30 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{r.title}</p>
                    <p className="text-[13px] text-muted-foreground mt-0.5 line-clamp-1">{r.description}</p>
                    <div className="flex items-center gap-2 mt-1.5 text-[11px] text-muted-foreground">
                      <span>{client?.company_name || client?.full_name || "—"}</span>
                      <span>•</span>
                      <span>{project?.name || "—"}</span>
                      <span>•</span>
                      <span className="font-mono">{formatDate(r.created_at)}</span>
                    </div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${pBadge.cls}`}>{pBadge.label}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${status.cls}`}>{status.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail Modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSelected(null)} />
          <div className="relative bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full max-w-[520px] sm:mx-4 animate-in fade-in zoom-in-[0.96] duration-200 max-h-[95vh] overflow-hidden" style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">Detalhes do Pedido</h2>
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Título</label>
                <p className="text-sm text-foreground mt-1">{selected.title}</p>
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Descrição</label>
                <p className="text-sm text-foreground mt-1 whitespace-pre-wrap">{selected.description}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Cliente</label>
                  <p className="text-sm text-foreground mt-1">{getClient(selected.client_id)?.full_name || "—"}</p>
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Projeto</label>
                  <p className="text-sm text-foreground mt-1">{getProject(selected.project_id)?.name || "—"}</p>
                </div>
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 block">Status</label>
                <div className="flex flex-wrap gap-1">
                  {statusOptions.map(s => (
                    <button key={s.value} onClick={() => handleStatusChange(s.value)}
                      className={`text-[11px] px-3 py-1 rounded-full border cursor-pointer transition-colors ${selected.status === s.value ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground bg-transparent"}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-5 sm:px-6 py-4 border-t border-border flex flex-col sm:flex-row justify-end gap-2 sm:gap-3">
              {selected.status !== "completed" && (
                <>
                  <button onClick={handleCreateTask} disabled={saving}
                    className="px-4 py-2 rounded-[10px] text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 flex items-center gap-2">
                    {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Transformar em Tarefa
                  </button>
                  <button onClick={handleComplete}
                    className="px-4 py-2 rounded-[10px] text-[13px] text-success border border-success/30 hover:bg-success/10 transition-colors cursor-pointer bg-transparent">
                    Marcar como Concluído
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
