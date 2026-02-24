import { useState, Fragment } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useProjects, useClients } from "@/hooks/useSupabaseData";
import { useIsMobile } from "@/hooks/use-mobile";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Check, Plus, GitBranch, Loader2, X, Clock, Circle,
  Calendar, Flag, ChevronDown, ChevronUp, Pencil, RefreshCw,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const statusLabels: Record<string, string> = {
  completed: "Concluído",
  in_progress: "Em andamento",
  pending: "Pendente",
};

const typeLabels: Record<string, string> = {
  social_media: "📱 Social Media",
  site: "🌐 Site",
  event: "🎪 Evento",
  automation: "⚙️ Automação",
};

const statusBadge: Record<string, string> = {
  active: "bg-success/10 text-success",
  planning: "bg-warning/10 text-warning",
  review: "bg-accent/10 text-accent",
  completed: "bg-muted text-muted-foreground",
};

const statusProjectLabel: Record<string, string> = {
  active: "Ativo",
  planning: "Planejamento",
  review: "Em Revisão",
  completed: "Concluído",
};

function formatDate(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateShort(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function daysUntilDate(d: string) {
  const target = new Date(d);
  const today = new Date();
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
}

export default function TimelinePage() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const isAdmin = profile?.role === "admin";
  const { data: projects, isLoading: loadingProjects } = useProjects();
  const { data: clients } = useClients();

  const [filterProject, setFilterProject] = useState("all");
  const [expanded, setExpanded] = useState<string[]>([]);
  const [selectedMilestone, setSelectedMilestone] = useState<any>(null);

  // Add milestone state
  const [addMilestoneProject, setAddMilestoneProject] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newStatus, setNewStatus] = useState("pending");
  const [saving, setSaving] = useState(false);

  // Edit milestone state
  const [editingMilestone, setEditingMilestone] = useState<any>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editDesc, setEditDesc] = useState("");

  const filteredProjects = filterProject === "all"
    ? (projects || [])
    : (projects || []).filter((p: any) => p.id === filterProject);

  const { data: allMilestones, isLoading: loadingMilestones } = useQuery({
    queryKey: ["milestones-all"],
    queryFn: async () => {
      const { data } = await supabase
        .from("milestones")
        .select("*")
        .order("milestone_order", { ascending: true });
      return data || [];
    },
    enabled: !!user,
  });

  const { data: allTasks } = useQuery({
    queryKey: ["tasks-timeline"],
    queryFn: async () => {
      const { data } = await supabase.from("tasks").select("id, project_id, status");
      return data || [];
    },
    enabled: !!user,
  });

  const toggleExpand = (id: string) => {
    setExpanded(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleCycleMilestoneStatus = async (milestone: any) => {
    const cycle: Record<string, string> = { pending: "in_progress", in_progress: "completed", completed: "pending" };
    const next = cycle[milestone.status] || "pending";
    await supabase.from("milestones").update({ status: next }).eq("id", milestone.id);
    queryClient.invalidateQueries({ queryKey: ["milestones-all"] });
    toast.success("Status: " + statusLabels[next]);
    setSelectedMilestone(null);
  };

  const handleAddMilestone = async () => {
    if (!newTitle.trim() || !newDate) { toast.error("Preencha título e data"); return; }
    setSaving(true);
    try {
      const existing = (allMilestones || []).filter((m: any) => m.project_id === addMilestoneProject);
      const maxOrder = existing.reduce((max: number, m: any) => Math.max(max, m.milestone_order || 0), 0);
      await supabase.from("milestones").insert({
        project_id: addMilestoneProject,
        title: newTitle,
        target_date: newDate,
        description: newDesc || null,
        status: newStatus,
        milestone_order: maxOrder + 1,
      });
      queryClient.invalidateQueries({ queryKey: ["milestones-all"] });
      toast.success("Milestone criado!");
      setAddMilestoneProject(null);
      setNewTitle(""); setNewDate(""); setNewDesc(""); setNewStatus("pending");
    } catch (err: any) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const openEdit = (m: any) => {
    setEditingMilestone(m);
    setEditTitle(m.title);
    setEditDate(m.target_date);
    setEditDesc(m.description || "");
    setSelectedMilestone(null);
  };

  const handleSaveEdit = async () => {
    if (!editTitle.trim() || !editDate) return;
    setSaving(true);
    try {
      await supabase.from("milestones").update({
        title: editTitle,
        target_date: editDate,
        description: editDesc || null,
      }).eq("id", editingMilestone.id);
      queryClient.invalidateQueries({ queryKey: ["milestones-all"] });
      toast.success("Milestone atualizado!");
      setEditingMilestone(null);
    } catch (err: any) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  if (loadingProjects || loadingMilestones) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        {[1, 2].map(i => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold text-foreground">Timeline dos Projetos</h1>
        <Select value={filterProject} onValueChange={setFilterProject}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Todos os projetos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os projetos</SelectItem>
            {(projects || []).map((p: any) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filteredProjects.length === 0 && (
        <div className="text-center py-16">
          <GitBranch className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhum projeto encontrado</p>
        </div>
      )}

      {/* Project cards */}
      {filteredProjects.map((project: any) => {
        const milestones = (allMilestones || []).filter((m: any) => m.project_id === project.id);
        const projectTasks = (allTasks || []).filter((t: any) => t.project_id === project.id);
        const doneTasks = projectTasks.filter((t: any) => t.status === "done").length;
        const clientProfile = (clients || []).find((c: any) => c.id === project.client_id);
        const isExpanded = expanded.includes(project.id);

        return (
          <div key={project.id} className="bg-card border border-border rounded-2xl p-6 space-y-5">
            {/* Project header */}
            <div className="flex items-start justify-between">
              <div>
                <p className="text-base font-semibold text-foreground">{project.name}</p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    {typeLabels[project.project_type] || project.project_type}
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${statusBadge[project.status] || "bg-muted text-muted-foreground"}`}>
                    {statusProjectLabel[project.status] || project.status}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{project.progress}% concluído</span>
                </div>
              </div>
              <div className="w-24 h-2 rounded-full bg-secondary overflow-hidden shrink-0 mt-2">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${project.progress}%` }} />
              </div>
            </div>

            {/* Timeline */}
            {milestones.length === 0 ? (
              <div className="flex items-center gap-3">
                <p className="text-xs text-muted-foreground">Nenhum milestone cadastrado</p>
                {isAdmin && (
                  <button onClick={() => setAddMilestoneProject(project.id)} className="text-[12px] text-primary hover:text-primary/80 cursor-pointer bg-transparent border-none p-0 flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Adicionar
                  </button>
                )}
              </div>
            ) : isMobile ? (
              /* Mobile vertical timeline */
              <div className="space-y-0 pl-5 border-l-2 border-border relative">
                {milestones.map((m: any) => (
                  <button
                    key={m.id}
                    onClick={() => setSelectedMilestone(m)}
                    className="relative flex gap-3 pb-5 w-full text-left cursor-pointer bg-transparent border-none p-0 pl-4"
                  >
                    <div className={`absolute -left-[9px] top-0.5 w-4 h-4 rounded-full flex items-center justify-center ${
                      m.status === "completed" ? "bg-primary" :
                      m.status === "in_progress" ? "border-[2.5px] border-primary bg-card milestone-pulse" : "bg-secondary"
                    }`}>
                      {m.status === "completed" && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                    </div>
                    <div>
                      <p className="text-[13px] font-medium text-foreground">{m.title}</p>
                      <p className="text-[10px] text-muted-foreground">{formatDateShort(m.target_date)}</p>
                    </div>
                  </button>
                ))}
                {isAdmin && (
                  <button onClick={() => setAddMilestoneProject(project.id)} className="relative pl-4 text-[12px] text-muted-foreground hover:text-primary cursor-pointer bg-transparent border-none p-0 flex items-center gap-1">
                    <div className="absolute -left-[9px] w-4 h-4 rounded-full border-2 border-dashed border-muted-foreground flex items-center justify-center">
                      <Plus className="w-2.5 h-2.5" />
                    </div>
                    <span className="ml-4">Adicionar</span>
                  </button>
                )}
              </div>
            ) : (
              /* Desktop horizontal timeline */
              <div className="overflow-x-auto pb-2 scrollbar-hidden">
                <div className="flex items-start min-w-max px-2 py-4">
                  {milestones.map((m: any, i: number) => (
                    <Fragment key={m.id}>
                      {i > 0 && (
                        <div className={`h-[3px] w-32 mt-[14px] rounded-full transition-colors ${
                          milestones[i - 1].status === "completed" ? "bg-primary" : "bg-secondary"
                        }`} />
                      )}
                      <button
                        onClick={() => setSelectedMilestone(m)}
                        className="relative flex flex-col items-center gap-2 group cursor-pointer bg-transparent border-none p-0"
                        style={{ minWidth: 120 }}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-transform group-hover:scale-110 ${
                          m.status === "completed"
                            ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30"
                            : m.status === "in_progress"
                              ? "border-[3px] border-primary bg-transparent milestone-pulse"
                              : "bg-secondary"
                        }`}>
                          {m.status === "completed" && <Check className="w-4 h-4" />}
                          {m.status === "in_progress" && <div className="w-2 h-2 rounded-full bg-primary" />}
                        </div>
                        <div className="text-center">
                          <p className="text-[12px] font-medium text-foreground whitespace-nowrap">{m.title}</p>
                          <p className="text-[10px] text-muted-foreground">{formatDateShort(m.target_date)}</p>
                        </div>
                      </button>
                    </Fragment>
                  ))}
                  {isAdmin && (
                    <>
                      <div className="h-[3px] w-16 mt-[14px] bg-border rounded-full" />
                      <div className="flex flex-col items-center gap-2">
                        <button
                          onClick={() => setAddMilestoneProject(project.id)}
                          className="w-8 h-8 rounded-full border-2 border-dashed border-muted-foreground flex items-center justify-center text-muted-foreground hover:border-primary hover:text-primary transition-colors cursor-pointer bg-transparent"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                        <p className="text-[10px] text-muted-foreground">Adicionar</p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Expand toggle */}
            <button
              onClick={() => toggleExpand(project.id)}
              className="text-[12px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer bg-transparent border-none p-0"
            >
              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {isExpanded ? "Recolher" : "Expandir Detalhes"}
            </button>

            {/* Expanded details */}
            {isExpanded && (
              <div className="space-y-5 pt-3 border-t border-border animate-in slide-in-from-top-2 duration-200">
                {/* Project info grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Cliente</p>
                    <p className="text-[13px] text-foreground mt-0.5">{clientProfile?.company_name || clientProfile?.full_name || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Início</p>
                    <p className="text-[13px] text-foreground mt-0.5">{formatDate(project.start_date)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Prazo</p>
                    <p className="text-[13px] text-foreground mt-0.5">{formatDate(project.deadline)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Tarefas</p>
                    <p className="text-[13px] text-foreground mt-0.5">{doneTasks}/{projectTasks.length} concluídas</p>
                  </div>
                </div>

                {/* Milestone detail list */}
                {milestones.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Detalhes dos Milestones</p>
                    {milestones.map((m: any) => (
                      <div key={m.id} className="flex items-start gap-3 p-3 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-colors">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                          m.status === "completed" ? "bg-success text-white" :
                          m.status === "in_progress" ? "border-2 border-primary" : "bg-secondary"
                        }`}>
                          {m.status === "completed" && <Check className="w-3 h-3" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-foreground">{m.title}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {new Date(m.target_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
                          </p>
                          {m.description && <p className="text-[12px] text-muted-foreground mt-1">{m.description}</p>}
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${
                          m.status === "completed" ? "bg-success/10 text-success" :
                          m.status === "in_progress" ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"
                        }`}>
                          {statusLabels[m.status]}
                        </span>
                        {isAdmin && (
                          <div className="flex gap-1 shrink-0">
                            <button onClick={() => openEdit(m)} className="p-1 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleCycleMilestoneStatus(m)} className="p-1 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none" title="Alterar status">
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Description */}
                {project.description && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Descrição</p>
                    <p className="text-[13px] text-muted-foreground mt-1">{project.description}</p>
                  </div>
                )}

                {/* Links */}
                <div className="flex gap-3 pt-1">
                  <button onClick={() => navigate("/kanban")} className="text-[12px] text-primary hover:underline cursor-pointer bg-transparent border-none p-0">
                    Ver tarefas no Kanban →
                  </button>
                  <button onClick={() => navigate("/relatorios")} className="text-[12px] text-primary hover:underline cursor-pointer bg-transparent border-none p-0">
                    Ver relatórios →
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* ========== MILESTONE DETAIL MODAL ========== */}
      {selectedMilestone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setSelectedMilestone(null)} />
          <div className="relative bg-card border border-border rounded-2xl w-full max-w-sm p-6 animate-in fade-in zoom-in-95 duration-200 mx-4">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${
              selectedMilestone.status === "completed" ? "bg-success text-white" :
              selectedMilestone.status === "in_progress" ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground"
            }`}>
              {selectedMilestone.status === "completed" ? <Check className="w-6 h-6" /> :
               selectedMilestone.status === "in_progress" ? <Clock className="w-6 h-6" /> :
               <Circle className="w-6 h-6" />}
            </div>

            <p className="text-lg font-semibold text-foreground">{selectedMilestone.title}</p>

            <div className="space-y-3 mt-4">
              <div className="flex items-center gap-3">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <p className="text-[13px] text-foreground">
                  {new Date(selectedMilestone.target_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Flag className="w-4 h-4 text-muted-foreground" />
                <span className={`text-[12px] px-2.5 py-1 rounded-full ${
                  selectedMilestone.status === "completed" ? "bg-success/10 text-success" :
                  selectedMilestone.status === "in_progress" ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"
                }`}>
                  {selectedMilestone.status === "completed" ? "✅ Concluído" :
                   selectedMilestone.status === "in_progress" ? "🔵 Em andamento" : "⬜ Pendente"}
                </span>
              </div>
              {selectedMilestone.description && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Descrição</p>
                  <p className="text-[13px] text-muted-foreground mt-1">{selectedMilestone.description}</p>
                </div>
              )}
              <div className="bg-secondary/30 rounded-xl p-3">
                {(() => {
                  const days = daysUntilDate(selectedMilestone.target_date);
                  return (
                    <p className="text-[11px] text-muted-foreground">
                      {days > 0 ? `Faltam ${days} dias` : days === 0 ? "Hoje!" : `${Math.abs(days)} dias atrás`}
                    </p>
                  );
                })()}
              </div>
            </div>

            {isAdmin && (
              <div className="flex gap-2 mt-5 pt-4 border-t border-border">
                <button onClick={() => handleCycleMilestoneStatus(selectedMilestone)}
                  className="flex-1 py-2 rounded-xl text-[12px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none">
                  Alterar Status
                </button>
                <button onClick={() => openEdit(selectedMilestone)}
                  className="flex-1 py-2 rounded-xl text-[12px] text-foreground border border-border hover:bg-secondary transition-colors cursor-pointer bg-transparent">
                  Editar
                </button>
              </div>
            )}

            <button onClick={() => setSelectedMilestone(null)}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border-none p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ========== ADD MILESTONE MODAL ========== */}
      {addMilestoneProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setAddMilestoneProject(null)} />
          <div className="relative bg-card border border-border rounded-2xl w-full max-w-md p-6 mx-4">
            <p className="text-base font-semibold text-foreground mb-4">Novo Milestone</p>
            <div className="space-y-4">
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground block mb-1">Título</label>
                <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50"
                  placeholder="Ex: Entrega Final" />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground block mb-1">Data Alvo</label>
                <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50" />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground block mb-1">Descrição (opcional)</label>
                <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} rows={3}
                  className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:border-primary/50 resize-none"
                  placeholder="Descreva este marco..." />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground block mb-2">Status</label>
                <div className="flex gap-2">
                  {(["pending", "in_progress", "completed"] as const).map(s => (
                    <button key={s} onClick={() => setNewStatus(s)}
                      className={`px-3 py-1.5 rounded-lg text-[12px] cursor-pointer border transition-colors ${
                        newStatus === s
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-transparent border-border text-muted-foreground hover:text-foreground"
                      }`}>
                      {statusLabels[s]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setAddMilestoneProject(null)}
                className="flex-1 py-2.5 rounded-xl text-[13px] text-muted-foreground border border-border hover:text-foreground transition-colors cursor-pointer bg-transparent">
                Cancelar
              </button>
              <button onClick={handleAddMilestone} disabled={saving || !newTitle || !newDate}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Criar Milestone"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== EDIT MILESTONE MODAL ========== */}
      {editingMilestone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setEditingMilestone(null)} />
          <div className="relative bg-card border border-border rounded-2xl w-full max-w-md p-6 mx-4">
            <p className="text-base font-semibold text-foreground mb-4">Editar Milestone</p>
            <div className="space-y-4">
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground block mb-1">Título</label>
                <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50" />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground block mb-1">Data Alvo</label>
                <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50" />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground block mb-1">Descrição</label>
                <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={3}
                  className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:border-primary/50 resize-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setEditingMilestone(null)}
                className="flex-1 py-2.5 rounded-xl text-[13px] text-muted-foreground border border-border hover:text-foreground transition-colors cursor-pointer bg-transparent">
                Cancelar
              </button>
              <button onClick={handleSaveEdit} disabled={saving || !editTitle || !editDate}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
