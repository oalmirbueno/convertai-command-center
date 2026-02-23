import { useState } from "react";
import { useTeamMembers } from "@/hooks/useSupabaseData";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { UserPlus, X, Loader2, Trash2, Edit3 } from "lucide-react";
import { toast } from "sonner";
import { useTasks } from "@/hooks/useSupabaseData";

const roleBadge: Record<string, { cls: string; label: string }> = {
  admin: { cls: "bg-primary/10 text-primary", label: "Admin" },
  design: { cls: "bg-info/10 text-info", label: "Design" },
  traffic: { cls: "bg-warning/10 text-warning", label: "Tráfego" },
  manager: { cls: "bg-success/10 text-success", label: "Manager" },
};

export default function Team() {
  const { data: members, isLoading } = useTeamMembers();
  const { data: allTasks } = useTasks();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editMember, setEditMember] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("design");

  const taskCountFor = (userId: string) => (allTasks || []).filter((t: any) => t.assigned_to === userId && t.status !== "done").length;

  const handleCreate = async () => {
    if (!name.trim() || !email.trim()) { toast.error("Preencha nome e email"); return; }
    setSaving(true);
    try {
      const { data: currentSession } = await supabase.auth.getSession();

      const { error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password: "Temp@2026!",
        options: { data: { full_name: name.trim(), role } },
      });
      if (authError) throw authError;

      // Restore admin session
      if (currentSession?.session) {
        await supabase.auth.setSession({
          access_token: currentSession.session.access_token,
          refresh_token: currentSession.session.refresh_token,
        });
      }

      toast.success("Membro criado! Senha temporária: Temp@2026!");
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
      setCreateOpen(false);
      setName(""); setEmail(""); setRole("design");
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar membro");
    }
    setSaving(false);
  };

  const handleEdit = async () => {
    if (!editMember || !name.trim()) { toast.error("Preencha o nome"); return; }
    setSaving(true);
    try {
      await supabase.from("profiles").update({ full_name: name.trim() }).eq("id", editMember.id);

      // Update role if changed
      if (role !== editMember.role) {
        await supabase.from("user_roles").update({ role: role as any }).eq("user_id", editMember.id);
      }

      toast.success("Membro atualizado!");
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
      setEditMember(null);
      setName(""); setEmail(""); setRole("design");
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar");
    }
    setSaving(false);
  };

  const handleRemove = async (member: any) => {
    if (!confirm(`Remover ${member.full_name} da equipe?`)) return;
    try {
      // We can't delete auth users from client-side, but we can remove their role
      await supabase.from("user_roles").delete().eq("user_id", member.id);
      toast.success("Membro removido da equipe");
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao remover");
    }
  };

  const openEdit = (m: any) => {
    setEditMember(m);
    setName(m.full_name || "");
    setEmail(m.email || "");
    setRole(m.role || "design");
  };

  const closeModal = () => {
    setCreateOpen(false);
    setEditMember(null);
    setName(""); setEmail(""); setRole("design");
  };

  const isModalOpen = createOpen || !!editMember;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <p className="heading-page">Equipe</p>
        <button onClick={() => { closeModal(); setCreateOpen(true); }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer">
          <UserPlus className="w-3.5 h-3.5" /> Novo Membro
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Carregando...</div>
      ) : (members || []).length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Nenhum membro encontrado.</div>
      ) : (
        <div className="space-y-2 stagger-children">
          {(members || []).map((m: any) => {
            const badge = roleBadge[m.role] || roleBadge.admin;
            return (
              <div key={m.id} className="bg-card border border-border rounded-xl px-5 py-4 flex items-center gap-4">
                <Avatar className="w-10 h-10 shrink-0">
                  <AvatarFallback className="bg-primary/15 text-primary text-sm font-semibold">
                    {m.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{m.full_name}</p>
                  <p className="text-[11px] text-muted-foreground">{m.email}</p>
                </div>
                <span className={`text-[10px] px-2.5 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                <div className="text-right hidden md:block">
                  <p className="text-xs font-mono text-foreground">{taskCountFor(m.id)}</p>
                  <p className="text-[10px] text-muted-foreground">tarefas</p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openEdit(m)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer bg-transparent border-none">
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  {m.role !== "admin" && (
                    <button onClick={() => handleRemove(m)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer bg-transparent border-none">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeModal} />
          <div className="relative bg-card border border-border rounded-2xl w-full max-w-[420px] mx-4 animate-in fade-in zoom-in-[0.96] duration-200" style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">{editMember ? "Editar Membro" : "Novo Membro"}</h2>
              <button onClick={closeModal} className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none p-1"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Nome Completo</label>
                <input value={name} onChange={e => setName(e.target.value)} className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Email</label>
                <input value={email} onChange={e => setEmail(e.target.value)} type="email" disabled={!!editMember}
                  className={`w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm focus:outline-none focus:border-primary/50 transition-colors ${editMember ? "text-muted-foreground cursor-not-allowed" : "text-foreground"}`} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Função</label>
                <select value={role} onChange={e => setRole(e.target.value)} className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors">
                  <option value="design">Design</option>
                  <option value="traffic">Tráfego</option>
                  <option value="manager">Manager</option>
                </select>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border flex justify-end gap-3">
              <button onClick={closeModal} className="px-4 py-2 rounded-[10px] text-[13px] text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border border-border">Cancelar</button>
              <button onClick={editMember ? handleEdit : handleCreate} disabled={saving} className="px-5 py-2 rounded-[10px] text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 cursor-pointer disabled:opacity-50 flex items-center gap-2">
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {saving ? "Salvando..." : editMember ? "Salvar" : "Criar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
