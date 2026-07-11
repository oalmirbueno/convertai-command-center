import { useEffect, useState } from "react";
import { useTeamMembers, useTasks, useClients } from "@/hooks/useSupabaseData";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { UserPlus, X, Loader2, Trash2, Edit3, AlertTriangle, Check, Search } from "lucide-react";
import { toast } from "sonner";

const roleBadge: Record<string, { cls: string; label: string }> = {
  admin: { cls: "bg-primary/10 text-primary", label: "Admin" },
  design: { cls: "bg-info/10 text-info", label: "Design" },
  traffic: { cls: "bg-warning/10 text-warning", label: "Tráfego" },
  manager: { cls: "bg-success/10 text-success", label: "Manager" },
};

export default function Team() {
  const { data: members, isLoading } = useTeamMembers();
  const { data: allTasks } = useTasks();
  const { data: clients } = useClients();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editMember, setEditMember] = useState<any>(null);
  const [removeMember, setRemoveMember] = useState<any>(null);
  const [removing, setRemoving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("design");
  const [assignedClientIds, setAssignedClientIds] = useState<string[]>([]);
  const [initialAssignedIds, setInitialAssignedIds] = useState<string[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});

  const taskCountFor = (userId: string) => (allTasks || []).filter((t: any) => t.assigned_to === userId && t.status !== "done").length;

  // Load assignments map for all team members (badge counts on list)
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("team_client_assignments").select("user_id, client_id");
      const map: Record<string, string[]> = {};
      (data || []).forEach((r: any) => {
        (map[r.user_id] ||= []).push(r.client_id);
      });
      setAssignments(map);
    })();
  }, [members]);

  const callManageTeam = async (body: any) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Não autenticado");

    const res = await supabase.functions.invoke("manage-team", {
      body,
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (res.error || res.data?.error) throw new Error(res.data?.error || res.error?.message || "Erro");
    return res.data;
  };

  const persistAssignments = async (userId: string) => {
    if (role === "admin") return; // admin sees everything
    const toRemove = initialAssignedIds.filter((id) => !assignedClientIds.includes(id));
    const toAdd = assignedClientIds.filter((id) => !initialAssignedIds.includes(id));
    if (toRemove.length) {
      await supabase.from("team_client_assignments").delete().eq("user_id", userId).in("client_id", toRemove);
    }
    if (toAdd.length) {
      await supabase.from("team_client_assignments").insert(toAdd.map((cid) => ({ user_id: userId, client_id: cid })));
    }
  };

  const handleCreate = async () => {
    if (!name.trim() || !email.trim()) { toast.error("Preencha nome e email"); return; }
    if (password && password.length < 6) { toast.error("Senha deve ter no mínimo 6 caracteres"); return; }
    setSaving(true);
    try {
      const res = await callManageTeam({ action: "create", email: email.trim(), full_name: name.trim(), role, password: password || undefined });
      const newUserId = res?.user_id || res?.user?.id;
      if (newUserId && role !== "admin" && assignedClientIds.length) {
        await supabase.from("team_client_assignments").insert(
          assignedClientIds.map((cid) => ({ user_id: newUserId, client_id: cid }))
        );
      }
      toast.success(password ? "Membro criado com a senha definida!" : "Membro criado! Senha temporária: Temp@2026!");
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
      setCreateOpen(false);
      resetForm();
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar membro");
    }
    setSaving(false);
  };

  const handleEdit = async () => {
    if (!editMember || !name.trim()) { toast.error("Preencha o nome"); return; }
    if (password && password.length < 6) { toast.error("Senha deve ter no mínimo 6 caracteres"); return; }
    setSaving(true);
    try {
      await supabase.from("profiles").update({ full_name: name.trim() }).eq("id", editMember.id);

      if (role !== editMember.role) {
        await supabase.from("user_roles").update({ role: role as any }).eq("user_id", editMember.id);
      }

      if (password) {
        await callManageTeam({ action: "update_password", user_id: editMember.id, password });
      }

      await persistAssignments(editMember.id);

      toast.success("Membro atualizado!");
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setEditMember(null);
      resetForm();
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar");
    }
    setSaving(false);
  };

  const handleRemove = async () => {
    if (!removeMember) return;
    setRemoving(true);
    try {
      await callManageTeam({ action: "delete", user_id: removeMember.id });
      toast.success("Membro removido com sucesso");
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
      setRemoveMember(null);
    } catch (err: any) {
      toast.error(err.message || "Erro ao remover");
    }
    setRemoving(false);
  };

  const openEdit = (m: any) => {
    setEditMember(m);
    setName(m.full_name || "");
    setEmail(m.email || "");
    setRole(m.role || "design");
    const current = assignments[m.id] || [];
    setAssignedClientIds(current);
    setInitialAssignedIds(current);
    setClientSearch("");
  };

  const resetForm = () => {
    setName(""); setEmail(""); setPassword(""); setRole("design");
    setAssignedClientIds([]); setInitialAssignedIds([]); setClientSearch("");
  };

  const closeModal = () => {
    setCreateOpen(false);
    setEditMember(null);
    resetForm();
  };

  const toggleClient = (id: string) => {
    setAssignedClientIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const isModalOpen = createOpen || !!editMember;
  const showClientPicker = role !== "admin";
  const filteredClients = (clients || []).filter((c: any) => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return true;
    return (c.full_name || "").toLowerCase().includes(q) || (c.company_name || "").toLowerCase().includes(q);
  });


  return (
    <div className="-mx-4 flex h-full min-h-0 flex-col animate-fade-in md:mx-0 md:block md:h-auto md:space-y-6">
      <div className="shrink-0 border-b border-border/60 bg-background/95 px-4 pb-3 backdrop-blur-sm md:border-b-0 md:bg-transparent md:px-0 md:pb-0 md:backdrop-blur-none">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="heading-page">Equipe</p>
        <button onClick={() => { closeModal(); setCreateOpen(true); }}
          className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full text-[12px] sm:text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer">
          <UserPlus className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Novo</span> Membro
        </button>
      </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-4 md:overflow-visible md:px-0 md:pt-0 md:pb-0">
      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Carregando...</div>
      ) : (members || []).length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Nenhum membro encontrado.</div>
      ) : (
        <div className="space-y-2 stagger-children">
          {(members || []).map((m: any) => {
            const badge = roleBadge[m.role] || roleBadge.admin;
            return (
              <div key={m.id} className="bg-card border border-border rounded-xl px-4 sm:px-5 py-3 sm:py-4 flex items-center gap-3 sm:gap-4 flex-wrap">
                <Avatar className="w-10 h-10 shrink-0">
                  <AvatarFallback className="bg-primary/15 text-primary text-sm font-semibold">
                    {m.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{m.full_name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{m.email}</p>
                  {m.role !== "admin" && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {(assignments[m.id]?.length || 0)} {assignments[m.id]?.length === 1 ? "cliente" : "clientes"}
                    </p>
                  )}
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
                    <button onClick={() => setRemoveMember(m)}
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
      </div>

      {/* Create / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeModal} />
          <div className="relative bg-card border border-border rounded-2xl w-full max-w-[420px] mx-4 animate-in fade-in zoom-in-[0.96] duration-200 max-h-[95vh] overflow-y-auto" style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
            <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">{editMember ? "Editar Membro" : "Novo Membro"}</h2>
              <button onClick={closeModal} className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none p-1"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 sm:px-6 py-5 space-y-4">
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
                  <option value="admin">Admin</option>
                  <option value="design">Design</option>
                  <option value="traffic">Tráfego</option>
                  <option value="manager">Manager</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {editMember ? "Nova Senha" : "Senha Inicial"}
                </label>
                <input value={password} onChange={e => setPassword(e.target.value)} type="password"
                  placeholder={editMember ? "Deixe vazio para manter atual" : "Deixe vazio para padrão (Temp@2026!)"}
                  className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors" />
              </div>
            </div>
            <div className="px-5 sm:px-6 py-4 border-t border-border flex flex-col sm:flex-row justify-end gap-2 sm:gap-3">
              <button onClick={closeModal} className="px-4 py-2 rounded-[10px] text-[13px] text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border border-border">Cancelar</button>
              <button onClick={editMember ? handleEdit : handleCreate} disabled={saving} className="px-5 py-2 rounded-[10px] text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 cursor-pointer disabled:opacity-50 flex items-center gap-2">
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {saving ? "Salvando..." : editMember ? "Salvar" : "Criar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove Confirmation Modal */}
      {removeMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !removing && setRemoveMember(null)} />
          <div className="relative bg-card border border-border rounded-2xl w-full max-w-[400px] mx-4 animate-in fade-in zoom-in-[0.96] duration-200" style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
            <div className="px-5 sm:px-6 pt-6 pb-4 text-center space-y-3">
              <div className="mx-auto w-12 h-12 rounded-full bg-destructive/15 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-destructive" />
              </div>
              <h2 className="text-[15px] font-semibold text-foreground">Remover membro</h2>
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                Tem certeza que deseja remover <span className="font-medium text-foreground">{removeMember.full_name}</span> da equipe?
                Essa ação é <span className="text-destructive font-medium">permanente</span> e excluirá o usuário e todos os dados associados.
              </p>
            </div>
            <div className="px-5 sm:px-6 py-4 border-t border-border flex flex-col sm:flex-row justify-end gap-2 sm:gap-3">
              <button
                onClick={() => setRemoveMember(null)}
                disabled={removing}
                className="px-4 py-2 rounded-[10px] text-[13px] text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border border-border disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleRemove}
                disabled={removing}
                className="px-5 py-2 rounded-[10px] text-[13px] font-medium bg-destructive text-destructive-foreground hover:opacity-90 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {removing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {removing ? "Removendo..." : "Sim, remover"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
