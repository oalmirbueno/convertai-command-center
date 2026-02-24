import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

const statusBadge: Record<string, { cls: string; label: string }> = {
  new: { cls: "bg-info/10 text-info", label: "Aberto" },
  open: { cls: "bg-info/10 text-info", label: "Aberto" },
  in_progress: { cls: "bg-warning/10 text-warning", label: "Em Andamento" },
  done: { cls: "bg-success/10 text-success", label: "Concluído" },
};

const priorityBadge: Record<string, { cls: string; label: string }> = {
  low: { cls: "bg-muted text-muted-foreground", label: "Baixa" },
  normal: { cls: "bg-secondary text-foreground", label: "Normal" },
  medium: { cls: "bg-secondary text-foreground", label: "Média" },
  high: { cls: "bg-warning/10 text-warning", label: "Alta" },
  urgent: { cls: "bg-destructive/10 text-destructive", label: "Urgente" },
};

export default function ClientRequests() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");

  const { data: requests, isLoading } = useQuery({
    queryKey: ["client-requests", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("client_requests")
        .select("*")
        .eq("client_id", user!.id)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!user,
  });

  const handleCreate = async () => {
    if (!title.trim() || !description.trim()) {
      toast.error("Preencha título e descrição");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("client_requests").insert({
        client_id: user!.id,
        title: title.trim(),
        description: description.trim(),
        priority,
      });
      if (error) throw error;

      // Create update
      const { data: projects } = await supabase.from("projects").select("id").eq("client_id", user!.id).limit(1);
      if (projects?.[0]) {
        await supabase.from("updates").insert({
          project_id: projects[0].id,
          author_id: user!.id,
          message: `Novo pedido: "${title.trim()}"`,
          update_type: "system",
        });
      }

      // Notify admin
      const { data: adminId } = await supabase.rpc("get_admin_user_id");
      if (adminId) {
        await supabase.from("notifications").insert({
          user_id: adminId,
          message: `Novo pedido de ${profile?.company_name || profile?.full_name}: ${title.trim()}`,
          notification_type: "request",
          link: "/pedidos",
        });
      }

      toast.success("Pedido enviado!");
      queryClient.invalidateQueries({ queryKey: ["client-requests"] });
      setCreateOpen(false);
      setTitle("");
      setDescription("");
      setPriority("normal");
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar pedido");
    }
    setSaving(false);
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <p className="heading-page">Meus Pedidos</p>
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" /> Novo Pedido
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Carregando...</div>
      ) : (requests || []).length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Nenhum pedido ainda. Crie seu primeiro pedido!</div>
      ) : (
        <div className="space-y-2 stagger-children">
          {(requests || []).map((r: any) => {
            const status = statusBadge[r.status] || statusBadge.new;
            const prio = priorityBadge[r.priority] || priorityBadge.normal;
            return (
              <div key={r.id} className="bg-card border border-border rounded-xl px-5 py-4">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground">{r.title}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${status.cls}`}>{status.label}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${prio.cls}`}>{prio.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{r.description}</p>
                    <p className="text-[11px] text-muted-foreground/60 mt-2">{formatDate(r.created_at)}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setCreateOpen(false)} />
          <div className="relative bg-card border border-border rounded-2xl w-full max-w-[420px] mx-4 animate-in fade-in zoom-in-[0.96] duration-200" style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">Novo Pedido</h2>
              <button onClick={() => setCreateOpen(false)} className="text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border-none p-1"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Título</label>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex: Ajuste na bio do Instagram"
                  className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Descrição</label>
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Descreva o que precisa..."
                  className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors resize-none" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Prioridade</label>
                <select value={priority} onChange={e => setPriority(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors">
                  <option value="low">Baixa</option>
                  <option value="normal">Normal</option>
                  <option value="high">Alta</option>
                  <option value="urgent">Urgente</option>
                </select>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border flex justify-end gap-3">
              <button onClick={() => setCreateOpen(false)} className="px-4 py-2 rounded-[10px] text-[13px] text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border border-border">Cancelar</button>
              <button onClick={handleCreate} disabled={saving} className="px-5 py-2 rounded-[10px] text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 cursor-pointer disabled:opacity-50 flex items-center gap-2">
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {saving ? "Enviando..." : "Enviar Pedido"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
