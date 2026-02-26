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
  GripVertical, AlertCircle, ListTodo, Save, Trash2,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import ConfirmModal from "@/components/ui/ConfirmModal";

const MAX_MILESTONES = 4;

const statusLabels: Record<string, string> = {
  completed: "Concluído",
  in_progress: "Em andamento",
  pending: "Pendente",
};

const taskStatusLabels: Record<string, string> = {
  backlog: "Backlog",
  doing: "Em Andamento",
  review: "Revisão",
  approved: "Aprovado",
  done: "Concluído",
};

const taskStatusDot: Record<string, string> = {
  backlog: "bg-muted-foreground",
  doing: "bg-blue-500",
  review: "bg-yellow-500",
  approved: "bg-primary",
  done: "bg-success",
};

const taskStatusOrder = ["backlog", "doing", "review", "approved", "done"];

const priorityLabels: Record<string, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  urgent: "Urgente",
};

const priorityColors: Record<string, string> = {
  low: "text-muted-foreground",
  medium: "text-blue-500",
  high: "text-warning",
  urgent: "text-destructive",
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
  const [expandedMilestones, setExpandedMilestones] = useState<string[]>([]);
  const [selectedMilestone, setSelectedMilestone] = useState<any>(null);

  // Add milestone state
  const [addMilestoneProject, setAddMilestoneProject] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newStatus, setNewStatus] = useState("pending");
  const [newOrder, setNewOrder] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Edit milestone state
  const [editingMilestone, setEditingMilestone] = useState<any>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editDesc, setEditDesc] = useState("");

  // Edit task state
  const [editingTask, setEditingTask] = useState<any>(null);
  const [editTaskTitle, setEditTaskTitle] = useState("");
  const [editTaskDesc, setEditTaskDesc] = useState("");
  const [editTaskPriority, setEditTaskPriority] = useState("medium");
  const [savingTask, setSavingTask] = useState(false);

  // Drag state
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // Delete milestone state
  const [deleteMilestone, setDeleteMilestone] = useState<any>(null);

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
      const { data } = await supabase
        .from("tasks")
        .select("*, assignee:profiles!tasks_assigned_to_fkey(full_name)")
        .order("task_order", { ascending: true });
      return data || [];
    },
    enabled: !!user,
  });

  const toggleExpand = (id: string) => {
    setExpanded(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleMilestoneExpand = (id: string) => {
    setExpandedMilestones(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleCycleMilestoneStatus = async (milestone: any) => {
    const cycle: Record<string, string> = { pending: "in_progress", in_progress: "completed", completed: "pending" };
    const next = cycle[milestone.status] || "pending";
    await supabase.from("milestones").update({ status: next }).eq("id", milestone.id);
    const project = (projects || []).find((p: any) => p.id === milestone.project_id);
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (authUser && milestone.project_id) {
      await supabase.from("updates").insert({
        project_id: milestone.project_id, author_id: authUser.id,
        message: `Milestone "${milestone.title}" → ${statusLabels[next]}${project ? ` (${project.name})` : ""}`,
        update_type: "progress",
      });
    }
    queryClient.invalidateQueries({ queryKey: ["milestones-all"] });
    queryClient.invalidateQueries({ queryKey: ["tasks-timeline"] });
    toast.success("Status: " + statusLabels[next]);
    setSelectedMilestone(null);
  };

  const handleChangeTaskStatus = async (task: any, newStatus: string) => {
    await supabase.from("tasks").update({ status: newStatus }).eq("id", task.id);
    queryClient.invalidateQueries({ queryKey: ["tasks-timeline"] });
    queryClient.invalidateQueries({ queryKey: ["milestones-all"] });
    toast.success(`Tarefa → ${taskStatusLabels[newStatus]}`);
  };

  const openEditTask = (t: any) => {
    setEditingTask(t);
    setEditTaskTitle(t.title);
    setEditTaskDesc(t.description || "");
    setEditTaskPriority(t.priority || "medium");
  };

  const handleSaveTask = async () => {
    if (!editTaskTitle.trim()) return;
    setSavingTask(true);
    try {
      await supabase.from("tasks").update({
        title: editTaskTitle.trim(),
        description: editTaskDesc.trim() || null,
        priority: editTaskPriority,
      }).eq("id", editingTask.id);
      queryClient.invalidateQueries({ queryKey: ["tasks-timeline"] });
      toast.success("Tarefa atualizada!");
      setEditingTask(null);
    } catch (err: any) { toast.error(err.message); }
    finally { setSavingTask(false); }
  };

  const handleOpenAddMilestone = (projectId: string) => {
    const existing = (allMilestones || []).filter((m: any) => m.project_id === projectId);
    if (existing.length >= MAX_MILESTONES) {
      toast.error(`Máximo de ${MAX_MILESTONES} milestones por projeto`);
      return;
    }
    setAddMilestoneProject(projectId);
    setNewOrder(null);
  };

  const handleAddMilestone = async () => {
    if (!newTitle.trim() || !newDate) { toast.error("Preencha título e data"); return; }
    const existing = (allMilestones || []).filter((m: any) => m.project_id === addMilestoneProject);
    if (existing.length >= MAX_MILESTONES) {
      toast.error(`Máximo de ${MAX_MILESTONES} milestones atingido`);
      return;
    }
    setSaving(true);
    try {
      const insertOrder = newOrder !== null ? newOrder : existing.length + 1;
      if (newOrder !== null) {
        const toShift = existing.filter((m: any) => (m.milestone_order || 0) >= insertOrder);
        for (const m of toShift) {
          await supabase.from("milestones").update({ milestone_order: (m.milestone_order || 0) + 1 }).eq("id", m.id);
        }
      }

      await supabase.from("milestones").insert({
        project_id: addMilestoneProject,
        title: newTitle,
        target_date: newDate,
        description: newDesc || null,
        status: newStatus,
        milestone_order: insertOrder,
      });
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const proj = (projects || []).find((p: any) => p.id === addMilestoneProject);
      if (authUser && addMilestoneProject) {
        await supabase.from("updates").insert({
          project_id: addMilestoneProject, author_id: authUser.id,
          message: `Novo milestone criado: ${newTitle}${proj ? ` (${proj.name})` : ""}`,
          update_type: "progress",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["milestones-all"] });
      toast.success("Milestone criado!");
      setAddMilestoneProject(null);
      setNewTitle(""); setNewDate(""); setNewDesc(""); setNewStatus("pending"); setNewOrder(null);
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

  // Drag and drop handlers
  const handleDragStart = (milestoneId: string) => { setDragId(milestoneId); };
  const handleDragOver = (e: React.DragEvent, milestoneId: string) => {
    e.preventDefault();
    if (milestoneId !== dragId) setDragOverId(milestoneId);
  };
  const handleDrop = async (e: React.DragEvent, targetMilestone: any, milestones: any[]) => {
    e.preventDefault();
    if (!dragId || dragId === targetMilestone.id) { setDragId(null); setDragOverId(null); return; }
    const dragIndex = milestones.findIndex((m: any) => m.id === dragId);
    const dropIndex = milestones.findIndex((m: any) => m.id === targetMilestone.id);
    if (dragIndex === -1 || dropIndex === -1) return;
    const reordered = [...milestones];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(dropIndex, 0, moved);
    await Promise.all(reordered.map((m, i) => supabase.from("milestones").update({ milestone_order: i + 1 }).eq("id", m.id)));
    queryClient.invalidateQueries({ queryKey: ["milestones-all"] });
    toast.success("Ordem atualizada!");
    setDragId(null); setDragOverId(null);
  };
  const handleDeleteMilestone = async () => {
    if (!deleteMilestone) return;
    // Delete tasks associated with this milestone first
    await supabase.from("tasks").delete().eq("milestone_id", deleteMilestone.id);
    await supabase.from("milestones").delete().eq("id", deleteMilestone.id);
    queryClient.invalidateQueries({ queryKey: ["milestones-all"] });
    queryClient.invalidateQueries({ queryKey: ["tasks-timeline"] });
    toast.success("Milestone excluído!");
    setDeleteMilestone(null);
  };

  const handleDragEnd = () => { setDragId(null); setDragOverId(null); };

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
        const canAddMore = milestones.length < MAX_MILESTONES;

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
                  {isAdmin && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                      {milestones.length}/{MAX_MILESTONES} milestones
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0 mt-2">
                {isAdmin && canAddMore && (
                  <button
                    onClick={() => handleOpenAddMilestone(project.id)}
                    className="text-[11px] text-primary hover:text-primary/80 cursor-pointer bg-transparent border border-primary/30 rounded-lg px-2.5 py-1 flex items-center gap-1 hover:bg-primary/5 transition-colors"
                  >
                    <Plus className="w-3 h-3" /> Milestone
                  </button>
                )}
                <div className="w-24 h-2 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${project.progress}%` }} />
                </div>
              </div>
            </div>

            {/* Timeline */}
            {milestones.length === 0 ? (
              <div className="flex items-center gap-3">
                <p className="text-xs text-muted-foreground">Nenhum milestone cadastrado</p>
                {isAdmin && (
                  <button onClick={() => handleOpenAddMilestone(project.id)} className="text-[12px] text-primary hover:text-primary/80 cursor-pointer bg-transparent border-none p-0 flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Adicionar
                  </button>
                )}
              </div>
            ) : isMobile ? (
              /* Mobile vertical timeline */
              <div className="space-y-0 pl-5 border-l-2 border-border relative">
                {milestones.map((m: any) => {
                  const mTasks = (allTasks || []).filter((t: any) => t.milestone_id === m.id);
                  const mDone = mTasks.filter((t: any) => t.status === "done").length;
                  const days = daysUntilDate(m.target_date);

                  return (
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
                      <div className="flex-1">
                        <p className="text-[13px] font-medium text-foreground">{m.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-[10px] text-muted-foreground">{formatDateShort(m.target_date)}</p>
                          {mTasks.length > 0 && (
                            <span className="text-[10px] text-muted-foreground">{mDone}/{mTasks.length} tarefas</span>
                          )}
                          {m.status !== "completed" && days < 0 && (
                            <span className="text-[10px] text-destructive flex items-center gap-0.5">
                              <AlertCircle className="w-2.5 h-2.5" /> Atrasado
                            </span>
                          )}
                        </div>
                        {mTasks.length > 0 && (
                          <div className="h-1 w-20 rounded-full bg-secondary mt-1.5 overflow-hidden">
                            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(mDone / mTasks.length) * 100}%` }} />
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              /* Desktop horizontal timeline */
              <div className="overflow-x-auto pb-2 scrollbar-hidden">
                <div className="flex items-start min-w-max px-2 py-4">
                  {milestones.map((m: any, i: number) => {
                    const mTasks = (allTasks || []).filter((t: any) => t.milestone_id === m.id);
                    const mDone = mTasks.filter((t: any) => t.status === "done").length;
                    const days = daysUntilDate(m.target_date);

                    return (
                      <Fragment key={m.id}>
                        {i > 0 && (
                          <div className={`h-[3px] w-32 mt-[14px] rounded-full transition-colors ${
                            milestones[i - 1].status === "completed" ? "bg-primary" : "bg-secondary"
                          }`} />
                        )}
                        <button
                          onClick={() => setSelectedMilestone(m)}
                          className="relative flex flex-col items-center gap-2 group cursor-pointer bg-transparent border-none p-0"
                          style={{ minWidth: 140 }}
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
                            {mTasks.length > 0 && (
                              <p className="text-[9px] text-muted-foreground mt-0.5">{mDone}/{mTasks.length} tarefas</p>
                            )}
                            {m.status !== "completed" && days < 0 && (
                              <span className="text-[9px] text-destructive flex items-center justify-center gap-0.5 mt-0.5">
                                <AlertCircle className="w-2.5 h-2.5" /> Atrasado
                              </span>
                            )}
                            {mTasks.length > 0 && (
                              <div className="h-1 w-16 rounded-full bg-secondary mt-1 mx-auto overflow-hidden">
                                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(mDone / mTasks.length) * 100}%` }} />
                              </div>
                            )}
                          </div>
                        </button>
                      </Fragment>
                    );
                  })}
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

                {/* Milestone detail list with drag & drop + tasks */}
                {milestones.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Milestones e Tarefas</p>
                      {isAdmin && <p className="text-[10px] text-muted-foreground">Arraste para reordenar</p>}
                    </div>
                    {milestones.map((m: any) => {
                      const mTasks = (allTasks || []).filter((t: any) => t.milestone_id === m.id);
                      const mDone = mTasks.filter((t: any) => t.status === "done").length;
                      const days = daysUntilDate(m.target_date);
                      const isDragOver = dragOverId === m.id;
                      const isMilestoneExpanded = expandedMilestones.includes(m.id);

                      return (
                        <div key={m.id} className="space-y-0">
                          <div
                            draggable={isAdmin}
                            onDragStart={() => handleDragStart(m.id)}
                            onDragOver={(e) => handleDragOver(e, m.id)}
                            onDrop={(e) => handleDrop(e, m, milestones)}
                            onDragEnd={handleDragEnd}
                            className={`flex items-start gap-3 p-3 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-all ${
                              isAdmin ? "cursor-grab active:cursor-grabbing" : ""
                            } ${isDragOver ? "ring-2 ring-primary/50 bg-primary/5" : ""} ${dragId === m.id ? "opacity-50" : ""}
                            ${isMilestoneExpanded ? "rounded-b-none" : ""}`}
                          >
                            {isAdmin && (
                              <div className="shrink-0 mt-1 text-muted-foreground/50">
                                <GripVertical className="w-4 h-4" />
                              </div>
                            )}
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                              m.status === "completed" ? "bg-success text-white" :
                              m.status === "in_progress" ? "border-2 border-primary" : "bg-secondary"
                            }`}>
                              {m.status === "completed" && <Check className="w-3 h-3" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-medium text-foreground">{m.title}</p>
                              <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                                <p className="text-[11px] text-muted-foreground">
                                  {new Date(m.target_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
                                </p>
                                {mTasks.length > 0 && (
                                  <span className="text-[10px] text-muted-foreground">{mDone}/{mTasks.length} tarefas</span>
                                )}
                                {m.status !== "completed" && days < 0 && (
                                  <span className="text-[10px] text-destructive flex items-center gap-0.5">
                                    <AlertCircle className="w-3 h-3" /> {Math.abs(days)}d atrasado
                                  </span>
                                )}
                                {m.status !== "completed" && days > 0 && days <= 3 && (
                                  <span className="text-[10px] text-warning flex items-center gap-0.5">
                                    <Clock className="w-3 h-3" /> {days}d restantes
                                  </span>
                                )}
                              </div>
                              {m.description && <p className="text-[12px] text-muted-foreground mt-1">{m.description}</p>}
                              {mTasks.length > 0 && (
                                <div className="h-1.5 w-full max-w-[180px] rounded-full bg-secondary mt-2 overflow-hidden">
                                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(mDone / mTasks.length) * 100}%` }} />
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                                m.status === "completed" ? "bg-success/10 text-success" :
                                m.status === "in_progress" ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"
                              }`}>
                                {statusLabels[m.status]}
                              </span>
                              {mTasks.length > 0 && (
                                <button
                                  onClick={() => toggleMilestoneExpand(m.id)}
                                  className="p-1 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none"
                                  title="Ver tarefas"
                                >
                                  <ListTodo className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {isAdmin && (
                                <>
                                  <button onClick={() => openEdit(m)} className="p-1 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none" title="Editar">
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => handleCycleMilestoneStatus(m)} className="p-1 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none" title="Alterar status">
                                    <RefreshCw className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => setDeleteMilestone(m)} className="p-1 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors cursor-pointer bg-transparent border-none" title="Excluir">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Expanded tasks for this milestone */}
                          {isMilestoneExpanded && mTasks.length > 0 && (
                            <div className="border border-t-0 border-border rounded-b-xl bg-card p-3 space-y-2 animate-in slide-in-from-top-1 duration-150">
                              {mTasks.map((t: any) => (
                                <div key={t.id} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors group">
                                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${taskStatusDot[t.status] || "bg-muted-foreground"}`} />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[12px] text-foreground truncate">{t.title}</p>
                                    <div className="flex items-center gap-2 mt-0.5">
                                      {t.assignee?.full_name && (
                                        <span className="text-[10px] text-muted-foreground">{t.assignee.full_name}</span>
                                      )}
                                      <span className={`text-[10px] ${priorityColors[t.priority] || "text-muted-foreground"}`}>
                                        {priorityLabels[t.priority] || t.priority}
                                      </span>
                                    </div>
                                  </div>
                                  {/* Status selector */}
                                  {isAdmin ? (
                                    <select
                                      value={t.status}
                                      onChange={(e) => handleChangeTaskStatus(t, e.target.value)}
                                      className="text-[10px] bg-secondary border border-border rounded-lg px-2 py-1 text-foreground focus:outline-none focus:border-primary/50 cursor-pointer"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {taskStatusOrder.map(s => (
                                        <option key={s} value={s}>{taskStatusLabels[s]}</option>
                                      ))}
                                    </select>
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground shrink-0">
                                      {taskStatusLabels[t.status] || t.status}
                                    </span>
                                  )}
                                  {isAdmin && (
                                    <button
                                      onClick={() => openEditTask(t)}
                                      className="p-1 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none opacity-0 group-hover:opacity-100"
                                    >
                                      <Pencil className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
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
                  <button onClick={() => navigate(`/kanban?project=${project.id}`)} className="text-[12px] text-primary hover:underline cursor-pointer bg-transparent border-none p-0">
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
      {selectedMilestone && (() => {
        const mTasks = (allTasks || []).filter((t: any) => t.milestone_id === selectedMilestone.id);
        const mDone = mTasks.filter((t: any) => t.status === "done").length;
        const days = daysUntilDate(selectedMilestone.target_date);

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setSelectedMilestone(null)} />
            <div className="relative bg-card border border-border rounded-2xl w-full max-w-sm p-6 animate-in fade-in zoom-in-95 duration-200 mx-4 max-h-[85vh] overflow-y-auto">
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
                {/* Tasks list in modal */}
                {mTasks.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Tarefas</p>
                      <p className="text-[11px] font-medium text-foreground">{mDone}/{mTasks.length}</p>
                    </div>
                    <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(mDone / mTasks.length) * 100}%` }} />
                    </div>
                    <div className="space-y-1.5 mt-2">
                      {mTasks.map((t: any) => (
                        <div key={t.id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-secondary/30">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${taskStatusDot[t.status] || "bg-muted-foreground"}`} />
                          <p className="text-[11px] text-foreground flex-1 min-w-0 truncate">{t.title}</p>
                          {isAdmin ? (
                            <select
                              value={t.status}
                              onChange={(e) => handleChangeTaskStatus(t, e.target.value)}
                              className="text-[10px] bg-secondary border border-border rounded-lg px-1.5 py-0.5 text-foreground focus:outline-none cursor-pointer"
                            >
                              {taskStatusOrder.map(s => (
                                <option key={s} value={s}>{taskStatusLabels[s]}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-[10px] text-muted-foreground shrink-0">{taskStatusLabels[t.status]}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="bg-secondary/30 rounded-xl p-3">
                  <p className="text-[11px] text-muted-foreground">
                    {days > 0 ? `Faltam ${days} dias` : days === 0 ? "Hoje!" : `${Math.abs(days)} dias atrás`}
                  </p>
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
        );
      })()}

      {/* ========== ADD MILESTONE MODAL ========== */}
      {addMilestoneProject && (() => {
        const existingMilestones = (allMilestones || []).filter((m: any) => m.project_id === addMilestoneProject);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setAddMilestoneProject(null)} />
            <div className="relative bg-card border border-border rounded-2xl w-full max-w-md p-6 mx-4 max-h-[85vh] overflow-y-auto">
              <p className="text-base font-semibold text-foreground mb-1">Novo Milestone</p>
              <p className="text-[11px] text-muted-foreground mb-4">
                {existingMilestones.length}/{MAX_MILESTONES} milestones utilizados
              </p>
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
                {/* Position selector */}
                {existingMilestones.length > 0 && (
                  <div>
                    <label className="text-[11px] uppercase tracking-wider text-muted-foreground block mb-2">Posição na Timeline</label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setNewOrder(null)}
                        className={`px-3 py-1.5 rounded-lg text-[12px] cursor-pointer border transition-colors ${
                          newOrder === null
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-transparent border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        No final
                      </button>
                      {existingMilestones.map((m: any, i: number) => (
                        <button
                          key={m.id}
                          onClick={() => setNewOrder(m.milestone_order || i + 1)}
                          className={`px-3 py-1.5 rounded-lg text-[12px] cursor-pointer border transition-colors ${
                            newOrder === (m.milestone_order || i + 1)
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-transparent border-border text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Antes de "{m.title}"
                        </button>
                      ))}
                    </div>
                  </div>
                )}
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
        );
      })()}

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

      {/* ========== EDIT TASK MODAL ========== */}
      {editingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setEditingTask(null)} />
          <div className="relative bg-card border border-border rounded-2xl w-full max-w-md p-6 mx-4">
            <p className="text-base font-semibold text-foreground mb-4">Editar Tarefa</p>
            <div className="space-y-4">
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground block mb-1">Título</label>
                <input value={editTaskTitle} onChange={e => setEditTaskTitle(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50"
                  placeholder="Título da tarefa" />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground block mb-1">Descrição</label>
                <textarea value={editTaskDesc} onChange={e => setEditTaskDesc(e.target.value)} rows={3}
                  className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:border-primary/50 resize-none"
                  placeholder="Detalhes da tarefa..." />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground block mb-2">Prioridade</label>
                <div className="flex gap-2 flex-wrap">
                  {(["low", "medium", "high", "urgent"] as const).map(p => (
                    <button key={p} onClick={() => setEditTaskPriority(p)}
                      className={`px-3 py-1.5 rounded-lg text-[12px] cursor-pointer border transition-colors ${
                        editTaskPriority === p
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-transparent border-border text-muted-foreground hover:text-foreground"
                      }`}>
                      {priorityLabels[p]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground block mb-2">Status</label>
                <select
                  value={editingTask.status}
                  onChange={(e) => {
                    handleChangeTaskStatus(editingTask, e.target.value);
                    setEditingTask({ ...editingTask, status: e.target.value });
                  }}
                  className="w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 cursor-pointer"
                >
                  {taskStatusOrder.map(s => (
                    <option key={s} value={s}>{taskStatusLabels[s]}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setEditingTask(null)}
                className="flex-1 py-2.5 rounded-xl text-[13px] text-muted-foreground border border-border hover:text-foreground transition-colors cursor-pointer bg-transparent">
                Cancelar
              </button>
              <button onClick={handleSaveTask} disabled={savingTask || !editTaskTitle}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none disabled:opacity-50 flex items-center justify-center gap-2">
                {savingTask ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {savingTask ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== DELETE MILESTONE CONFIRM ========== */}
      <ConfirmModal
        open={!!deleteMilestone}
        title="Excluir Milestone"
        description={`Tem certeza que deseja excluir "${deleteMilestone?.title}"? Todas as tarefas associadas também serão removidas.`}
        confirmLabel="Excluir Milestone"
        onConfirm={handleDeleteMilestone}
        onCancel={() => setDeleteMilestone(null)}
      />
    </div>
  );
}
