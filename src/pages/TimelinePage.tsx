import { useState, Fragment } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { notifyOpsMilestone, notifyOpsUpdate } from "@/lib/opsSync";
import { useProjects, useClients } from "@/hooks/useSupabaseData";
import { notifyUser } from "@/lib/notifyHelpers";
import { sendTaskAttachmentsToApproval } from "@/lib/reviewToApproval";
import { useCelular } from "@/hooks/useCelular";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Check, Plus, GitBranch, Loader2, X, Clock, Circle,
  Calendar, Flag, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Pencil, RefreshCw,
  GripVertical, AlertCircle, ListTodo, Save, Trash2, User,
} from "lucide-react";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AreaDeTrabalho,
  CabecalhoDePagina,
  CampoDeEscolha,
  CampoDeFormulario,
  Carregando,
  EstadoVazio,
  Secao,
  SeletorCompacto,
  botao,
  campo,
  campoTexto,
  etiqueta,
  juntar,
  lista,
  superficie,
  texto,
  useEstadoDaTela,
} from "@/components/sistema";



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
  social_media: "Social Media",
  site: "Site",
  event: "Evento",
  automation: "Automação",
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
  const isMobile = useCelular();
  const isAdmin = profile?.role === "admin";
  const { data: projects, isLoading: loadingProjects } = useProjects();
  const { data: clients } = useClients();

  // Fetch team members for assignment (only non-client roles)
  const { data: teamMembers } = useQuery({
    queryKey: ["team-members-timeline"],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .neq("role", "client");
      const userIds = roles?.map((r: any) => r.user_id) || [];
      if (userIds.length === 0) return [];
      const { data } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
      return data || [];
    },
    enabled: !!user,
  });

  // Filtro, projetos abertos, marcos abertos e página de cada linha do tempo:
  // lembrados ao sair e voltar (docs/design/SISTEMA.md, "Estado que não se perde").
  const listaDeTexto = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");
  const [filterProject, setFilterProject] = useEstadoDaTela("filtro:projeto", "all", { validar: (v) => typeof v === "string" });
  const [expanded, setExpanded] = useEstadoDaTela<string[]>("abertos", [], { validar: listaDeTexto });
  const [expandedMilestones, setExpandedMilestones] = useEstadoDaTela<string[]>("marcos-abertos", [], { validar: listaDeTexto });
  const [milestonePageIndex, setMilestonePageIndex] = useEstadoDaTela<Record<string, number>>("paginas", {}, {
    validar: (v) => !!v && typeof v === "object" && !Array.isArray(v),
  });
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
  const [editTaskAssignedTo, setEditTaskAssignedTo] = useState("");
  const [editTaskDueDate, setEditTaskDueDate] = useState("");
  const [savingTask, setSavingTask] = useState(false);

  // Drag state
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // Delete milestone state
  const [deleteMilestone, setDeleteMilestone] = useState<any>(null);
  // Delete task state
  const [deleteTask, setDeleteTask] = useState<any>(null);
  // Add task inline state
  const [addTaskMilestone, setAddTaskMilestone] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState("medium");
  const [newTaskAssignedTo, setNewTaskAssignedTo] = useState("");
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [savingNewTask, setSavingNewTask] = useState(false);

  const filteredProjects = filterProject === "all"
    ? (projects || [])
    : (projects || []).filter((p: any) => p.id === filterProject);

  const { data: allMilestones, isLoading: loadingMilestones } = useQuery({
    queryKey: ["milestones-all"],
    queryFn: async () => {
      const { data } = await supabase
        .from("milestones")
        .select("*")
        .is("deleted_at", null)
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
        .is("deleted_at", null)
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
      const { data: upd } = await supabase.from("updates").insert({
        project_id: milestone.project_id, author_id: authUser.id,
        message: `Milestone "${milestone.title}" alterado para ${statusLabels[next]}${project ? ` (${project.name})` : ""}`,
        update_type: "progress",
      }).select().single();
      notifyOpsUpdate(upd);
    }
    queryClient.invalidateQueries({ queryKey: ["milestones-all"] });
    queryClient.invalidateQueries({ queryKey: ["tasks-timeline"] });
    toast.success("Status: " + statusLabels[next]);
    setSelectedMilestone(null);
  };

  const handleChangeTaskStatus = async (task: any, newStatus: string) => {
    await supabase.from("tasks").update({ status: newStatus }).eq("id", task.id);
    const { data: { user } } = await supabase.auth.getUser();
    if (["review", "done"].includes(newStatus) && task.status !== newStatus && task.project_id && user) {
      await sendTaskAttachmentsToApproval(task.id, task.project_id, task.title, user.id);
      queryClient.invalidateQueries({ queryKey: ["all-files"] });
      queryClient.invalidateQueries({ queryKey: ["files"] });
    }
    queryClient.invalidateQueries({ queryKey: ["tasks-timeline"] });
    queryClient.invalidateQueries({ queryKey: ["milestones-all"] });
    toast.success(`Tarefa alterada para ${taskStatusLabels[newStatus]}`);
  };

  const openEditTask = (t: any) => {
    setEditingTask(t);
    setEditTaskTitle(t.title);
    setEditTaskDesc(t.description || "");
    setEditTaskPriority(t.priority || "medium");
    setEditTaskAssignedTo(t.assigned_to || "");
    setEditTaskDueDate(t.due_date || "");
  };

  const handleSaveTask = async () => {
    if (!editTaskTitle.trim()) return;
    setSavingTask(true);
    try {
      const previousAssignedTo = editingTask.assigned_to;
      await supabase.from("tasks").update({
        title: editTaskTitle.trim(),
        description: editTaskDesc.trim() || null,
        priority: editTaskPriority,
        assigned_to: editTaskAssignedTo || null,
        due_date: editTaskDueDate || null,
      }).eq("id", editingTask.id);
      // Notify new assignee if changed
      if (editTaskAssignedTo && editTaskAssignedTo !== previousAssignedTo) {
        const project = (projects || []).find((p: any) => p.id === editingTask.project_id);
        await notifyUser(
          editTaskAssignedTo,
          `Nova tarefa atribuída: "${editTaskTitle.trim()}"${project ? ` no projeto ${project.name}` : ""}`,
          "task",
          "/kanban"
        );
      }
      queryClient.invalidateQueries({ queryKey: ["tasks-timeline"] });
      toast.success("Tarefa atualizada!");
      setEditingTask(null);
    } catch (err: any) { toast.error(err.message); }
    finally { setSavingTask(false); }
  };

  const handleOpenAddMilestone = (projectId: string) => {
    setAddMilestoneProject(projectId);
    setNewOrder(null);
  };

  const handleAddMilestone = async () => {
    if (!newTitle.trim() || !newDate) { toast.error("Preencha título e data"); return; }
    const existing = (allMilestones || []).filter((m: any) => m.project_id === addMilestoneProject);
    setSaving(true);
    try {
      const insertOrder = newOrder !== null ? newOrder : existing.length + 1;
      if (newOrder !== null) {
        const toShift = existing.filter((m: any) => (m.milestone_order || 0) >= insertOrder);
        for (const m of toShift) {
          await supabase.from("milestones").update({ milestone_order: (m.milestone_order || 0) + 1 }).eq("id", m.id);
        }
      }

      const { data: newMs } = await supabase.from("milestones").insert({
        project_id: addMilestoneProject,
        title: newTitle,
        target_date: newDate,
        description: newDesc || null,
        status: newStatus,
        milestone_order: insertOrder,
      }).select().single();
      notifyOpsMilestone(newMs);
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const proj = (projects || []).find((p: any) => p.id === addMilestoneProject);
      if (authUser && addMilestoneProject) {
        const { data: upd } = await supabase.from("updates").insert({
          project_id: addMilestoneProject, author_id: authUser.id,
          message: `Novo milestone criado: ${newTitle}${proj ? ` (${proj.name})` : ""}`,
          update_type: "progress",
        }).select().single();
        notifyOpsUpdate(upd);
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
    const ms = deleteMilestone;
    // Delete tasks associated with this milestone first
    await supabase.from("tasks").delete().eq("milestone_id", ms.id);
    await supabase.from("milestones").delete().eq("id", ms.id);
    const { notifyOpsDelete } = await import("@/lib/opsSync");
    notifyOpsDelete("milestone", ms.id, { ops_milestone_id: ms.ops_milestone_id ?? null });
    queryClient.invalidateQueries({ queryKey: ["milestones-all"] });
    queryClient.invalidateQueries({ queryKey: ["tasks-timeline"] });
    toast.success("Milestone excluído!");
    setDeleteMilestone(null);
  };

  const handleDeleteTask = async () => {
    if (!deleteTask) return;
    const t = deleteTask;
    // As mesmas guardas do Kanban: aqui a tarefa de pedido do cliente
    // passava batida e sumia sem ninguém responder o pedido.
    const { excluirTarefa } = await import("@/lib/taskDelete");
    const r = await excluirTarefa(t);
    if (!r.ok) {
      toast.error(r.mensagem);
      setDeleteTask(null);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["tasks-timeline"] });
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    toast.success("Tarefa excluída!");
    setDeleteTask(null);
  };

  const handleAddTask = async (milestoneId: string, projectId: string) => {
    if (!newTaskTitle.trim()) { toast.error("Informe o título da tarefa"); return; }
    setSavingNewTask(true);
    try {
      const existingTasks = (allTasks || []).filter((t: any) => t.milestone_id === milestoneId);
      await supabase.from("tasks").insert({
        project_id: projectId,
        milestone_id: milestoneId,
        title: newTaskTitle.trim(),
        priority: newTaskPriority,
        assigned_to: newTaskAssignedTo || null,
        due_date: newTaskDueDate || null,
        status: "backlog",
        task_order: existingTasks.length + 1,
      });
      // Notify assignee
      if (newTaskAssignedTo) {
        const project = (projects || []).find((p: any) => p.id === projectId);
        await notifyUser(
          newTaskAssignedTo,
          `Nova tarefa atribuída: "${newTaskTitle.trim()}"${project ? ` no projeto ${project.name}` : ""}`,
          "task",
          "/kanban"
        );
      }
      queryClient.invalidateQueries({ queryKey: ["tasks-timeline"] });
      queryClient.invalidateQueries({ queryKey: ["milestones-all"] });
      toast.success("Tarefa criada!");
      setNewTaskTitle("");
      setNewTaskPriority("medium");
      setNewTaskAssignedTo("");
      setNewTaskDueDate("");
      setAddTaskMilestone(null);
    } catch (err: any) { toast.error(err.message); }
    finally { setSavingNewTask(false); }
  };

  const handleDragEnd = () => { setDragId(null); setDragOverId(null); };

  const carregando = loadingProjects || loadingMilestones;
  // Botão de ícone pequeno das linhas (28 px), sempre com nome.
  const iconeDaLinha = juntar(botao.icone, "h-7 w-7");
  // Seletor pequeno dentro da linha (status da tarefa).
  const seletorDaLinha = juntar(campo, "h-7 w-auto cursor-pointer px-2 text-[12px]");
  const corDoStatusDoMarco = (status: string) =>
    status === "completed" ? "bg-success/10 text-success" : status === "in_progress" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground";
  const existingMilestones = addMilestoneProject ? (allMilestones || []).filter((m: any) => m.project_id === addMilestoneProject) : [];

  return (
    <div className="min-w-0">
      <CabecalhoDePagina
        titulo="Timeline"
        ajuda="Os marcos de cada projeto em ordem, com as tarefas de cada marco. Abra um projeto para ver detalhes, reordenar marcos (arrastando) e criar tarefas."
        descricao={carregando ? undefined : `${filteredProjects.length} ${filteredProjects.length === 1 ? "projeto" : "projetos"}`}
        acoes={
          <SeletorCompacto
            rotulo="Projeto"
            modo="lista"
            icone={<GitBranch className="h-3.5 w-3.5" />}
            opcoes={[
              { valor: "all", rotulo: "Todos os projetos" },
              ...(projects || []).map((p: any) => ({ valor: p.id, rotulo: p.name })),
            ]}
            valor={filterProject}
            onEscolher={setFilterProject}
            className="max-w-[240px]"
          />
        }
      />

      <AreaDeTrabalho className="mt-4" rotuloDoPrincipal="Projetos na linha do tempo" memoriaDaRolagem="timeline:lista">
      {carregando ? (
        <Carregando rotulo="Carregando a linha do tempo" linhas={4} />
      ) : filteredProjects.length === 0 ? (
        <EstadoVazio icone={<GitBranch className="h-5 w-5" />} titulo="Nenhum projeto encontrado" />
      ) : (
      <div className="space-y-6">
      {/* Um projeto por seção ABERTA (sem caixa), separadas por uma linha
          fina; cada uma recolhe pelo título (SISTEMA.md 4.1 e 4.3). */}
      {filteredProjects.map((project: any, indice: number) => {
        const milestones = (allMilestones || []).filter((m: any) => m.project_id === project.id);
        const projectTasks = (allTasks || []).filter((t: any) => t.project_id === project.id);
        const doneTasks = projectTasks.filter((t: any) => t.status === "done").length;
        const clientProfile = (clients || []).find((c: any) => c.id === project.client_id);
        const isExpanded = expanded.includes(project.id);
        const INITIAL_MILESTONES = 4;
        const pageIdx = milestonePageIndex[project.id] || 0;
        const visibleMilestones = milestones.slice(pageIdx, pageIdx + INITIAL_MILESTONES);
        const canGoPrev = pageIdx > 0;
        const canGoNext = pageIdx + INITIAL_MILESTONES < milestones.length;
        const estado = [
          typeLabels[project.project_type] || project.project_type,
          statusProjectLabel[project.status] || project.status,
          `${project.progress}% concluído`,
          isAdmin ? `${milestones.length} marcos` : null,
        ].filter(Boolean).join(" · ");

        return (
          <Secao
            key={project.id}
            titulo={project.name}
            recolher={`timeline:projeto:${project.id}`}
            descricao={estado}
            divisoria={indice > 0}
            corpoClassName="space-y-4"
            acao={
              <>
                <div className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-muted sm:block" aria-hidden="true">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${project.progress}%` }} />
                </div>
                {milestones.length > INITIAL_MILESTONES && (
                  <div className="flex items-center">
                    <button
                      type="button"
                      disabled={!canGoPrev}
                      onClick={() => setMilestonePageIndex(prev => ({ ...prev, [project.id]: Math.max(0, pageIdx - INITIAL_MILESTONES) }))}
                      className={juntar(botao.icone, "disabled:opacity-30")}
                      aria-label="Marcos anteriores"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="mx-1 hidden text-[11px] tabular-nums text-muted-foreground sm:inline">
                      {pageIdx + 1}–{Math.min(pageIdx + INITIAL_MILESTONES, milestones.length)} de {milestones.length}
                    </span>
                    <button
                      type="button"
                      disabled={!canGoNext}
                      onClick={() => setMilestonePageIndex(prev => ({ ...prev, [project.id]: pageIdx + INITIAL_MILESTONES }))}
                      className={juntar(botao.icone, "disabled:opacity-30")}
                      aria-label="Próximos marcos"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => handleOpenAddMilestone(project.id)}
                    className={juntar(botao.secundario, "h-8 px-2.5 text-[12px]")}
                    aria-label="Novo marco"
                  >
                    <Plus className="h-3.5 w-3.5 sm:mr-1" aria-hidden="true" />
                    <span className="hidden sm:inline">Marco</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => toggleExpand(project.id)}
                  aria-expanded={isExpanded}
                  aria-label={isExpanded ? "Recolher detalhes" : "Abrir detalhes"}
                  title={isExpanded ? "Recolher" : "Detalhes"}
                  className={botao.icone}
                >
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
              </>
            }
          >
            {/* Timeline */}
            {milestones.length === 0 ? (
              <div className="flex items-center">
                <p className={texto.auxiliar}>Nenhum milestone cadastrado</p>
                {isAdmin && (
                  <button type="button" onClick={() => handleOpenAddMilestone(project.id)} className={juntar(botao.discreto, "ml-2 h-7 px-2 text-[12px] text-primary")}>
                    <Plus className="mr-1 h-3 w-3" aria-hidden="true" /> Adicionar
                  </button>
                )}
              </div>
            ) : isMobile ? (
              /* Mobile vertical timeline */
              <div className="relative space-y-0 border-l-2 border-border pl-5">
                {visibleMilestones.map((m: any) => {
                  const mTasks = (allTasks || []).filter((t: any) => t.milestone_id === m.id);
                  const mDone = mTasks.filter((t: any) => t.status === "done").length;
                  const days = daysUntilDate(m.target_date);

                  return (
                    <button
                      type="button"
                      key={m.id}
                      onClick={() => setSelectedMilestone(m)}
                      className="relative flex w-full cursor-pointer border-none bg-transparent p-0 pb-5 pl-4 text-left"
                    >
                      <div className={`absolute -left-[9px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full ${
                        m.status === "completed" ? "bg-primary" :
                        m.status === "in_progress" ? "border-[2.5px] border-primary bg-card" : "bg-muted"
                      }`}>
                        {m.status === "completed" && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={juntar(texto.corpo, "truncate font-medium")}>{m.title}</p>
                        <p className="mt-0.5 truncate text-[11px] tabular-nums text-muted-foreground">
                          {formatDateShort(m.target_date)}
                          {mTasks.length > 0 && <> · {mDone}/{mTasks.length} tarefas</>}
                          {m.status !== "completed" && days < 0 && <span className="text-destructive"> · Atrasado</span>}
                        </p>
                        {mTasks.length > 0 && (
                          <div className="mt-1.5 h-1 w-20 overflow-hidden rounded-full bg-muted">
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
              <div className="scrollbar-hidden overflow-x-auto pb-2">
                <div className="flex min-w-max items-start px-2 py-4">
                  {visibleMilestones.map((m: any, i: number) => {
                    const mTasks = (allTasks || []).filter((t: any) => t.milestone_id === m.id);
                    const mDone = mTasks.filter((t: any) => t.status === "done").length;
                    const days = daysUntilDate(m.target_date);

                    return (
                      <Fragment key={m.id}>
                        {i > 0 && (
                          <div className={`mt-[14px] h-[3px] w-32 rounded-full transition-colors ${
                            milestones[i - 1].status === "completed" ? "bg-primary" : "bg-muted"
                          }`} />
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedMilestone(m)}
                          className="group relative flex cursor-pointer flex-col items-center border-none bg-transparent p-0"
                          style={{ minWidth: 140 }}
                        >
                          <div className={`mb-2 flex h-8 w-8 items-center justify-center rounded-full transition-transform group-hover:scale-110 ${
                            m.status === "completed"
                              ? "bg-primary text-primary-foreground"
                              : m.status === "in_progress"
                                ? "border-[3px] border-primary bg-transparent"
                                : "bg-muted"
                          }`}>
                            {m.status === "completed" && <Check className="h-4 w-4" />}
                            {m.status === "in_progress" && <div className="h-2 w-2 rounded-full bg-primary" />}
                          </div>
                          <div className="text-center">
                            <p className="whitespace-nowrap text-[12px] font-medium text-foreground">{m.title}</p>
                            <p className="text-[11px] tabular-nums text-muted-foreground">{formatDateShort(m.target_date)}</p>
                            {mTasks.length > 0 && (
                              <p className="mt-0.5 text-[11px] text-muted-foreground">{mDone}/{mTasks.length} tarefas</p>
                            )}
                            {m.status !== "completed" && days < 0 && (
                              <span className="mt-0.5 flex items-center justify-center text-[11px] text-destructive">
                                <AlertCircle className="mr-0.5 h-2.5 w-2.5" aria-hidden="true" /> Atrasado
                              </span>
                            )}
                            {mTasks.length > 0 && (
                              <div className="mx-auto mt-1 h-1 w-16 overflow-hidden rounded-full bg-muted">
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

            {/* Expanded details */}
            {isExpanded && (
              <div className="space-y-5 border-t border-border pt-4">
                {/* Project info grid */}
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div className="min-w-0">
                    <dt className={texto.rotulo}>Cliente</dt>
                    <dd className={juntar(texto.corpo, "mt-0.5 truncate")}>{clientProfile?.company_name || clientProfile?.full_name || "-"}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className={texto.rotulo}>Início</dt>
                    <dd className={juntar(texto.corpo, "mt-0.5 tabular-nums")}>{formatDate(project.start_date)}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className={texto.rotulo}>Prazo</dt>
                    <dd className={juntar(texto.corpo, "mt-0.5 tabular-nums")}>{formatDate(project.deadline)}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className={texto.rotulo}>Tarefas</dt>
                    <dd className={juntar(texto.corpo, "mt-0.5 tabular-nums")}>{doneTasks}/{projectTasks.length} concluídas</dd>
                  </div>
                </dl>

                {/* Milestone detail list with drag & drop + tasks */}
                {milestones.length > 0 && (
                  <Secao
                    titulo="Milestones e tarefas"
                    nivel={3}
                    recolher={`timeline:marcos:${project.id}`}
                    ajuda={isAdmin ? "Arraste um marco para reordenar." : undefined}
                  >
                    <ul className={lista.aberta}>
                    {milestones.map((m: any) => {
                      const mTasks = (allTasks || []).filter((t: any) => t.milestone_id === m.id);
                      const mDone = mTasks.filter((t: any) => t.status === "done").length;
                      const days = daysUntilDate(m.target_date);
                      const isDragOver = dragOverId === m.id;
                      const isMilestoneExpanded = expandedMilestones.includes(m.id);

                      return (
                        <li key={m.id} className="min-w-0">
                          <div
                            draggable={isAdmin}
                            onDragStart={() => handleDragStart(m.id)}
                            onDragOver={(e) => handleDragOver(e, m.id)}
                            onDrop={(e) => handleDrop(e, m, milestones)}
                            onDragEnd={handleDragEnd}
                            className={juntar(
                              "flex min-w-0 items-start rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/40",
                              isAdmin && "cursor-grab active:cursor-grabbing",
                              isDragOver && "bg-primary/5 ring-2 ring-primary/50",
                              dragId === m.id && "opacity-50",
                            )}
                          >
                            {isAdmin && (
                              <div className="mr-2 mt-1 shrink-0 text-muted-foreground/50" aria-hidden="true">
                                <GripVertical className="h-4 w-4" />
                              </div>
                            )}
                            <div className={`mr-3 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                              m.status === "completed" ? "bg-success text-white" :
                              m.status === "in_progress" ? "border-2 border-primary" : "bg-muted"
                            }`}>
                              {m.status === "completed" && <Check className="h-3 w-3" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className={juntar(texto.corpo, "truncate font-medium")}>{m.title}</p>
                              <p className="mt-0.5 truncate text-[11px] tabular-nums text-muted-foreground">
                                {new Date(m.target_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
                                {mTasks.length > 0 && <> · {mDone}/{mTasks.length} tarefas</>}
                                {m.status !== "completed" && days < 0 && <span className="text-destructive"> · {Math.abs(days)}d atrasado</span>}
                                {m.status !== "completed" && days > 0 && days <= 3 && <span className="text-warning"> · {days}d restantes</span>}
                              </p>
                              {m.description && <p className={juntar(texto.auxiliar, "mt-1 truncate")} title={m.description}>{m.description}</p>}
                              {mTasks.length > 0 && (
                                <div className="mt-2 h-1.5 w-full max-w-[180px] overflow-hidden rounded-full bg-muted">
                                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(mDone / mTasks.length) * 100}%` }} />
                                </div>
                              )}
                            </div>
                            <div className="ml-2 flex shrink-0 items-center [&>*+*]:ml-0.5">
                              <span className={juntar(etiqueta, "mr-1 rounded-full", corDoStatusDoMarco(m.status))}>
                                {statusLabels[m.status]}
                              </span>
                              {(mTasks.length > 0 || isAdmin) && (
                                <button
                                  type="button"
                                  onClick={() => toggleMilestoneExpand(m.id)}
                                  className={iconeDaLinha}
                                  aria-expanded={isMilestoneExpanded}
                                  aria-label={mTasks.length > 0 ? "Ver tarefas" : "Adicionar tarefas"}
                                  title={mTasks.length > 0 ? "Ver tarefas" : "Adicionar tarefas"}
                                >
                                  <ListTodo className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {isAdmin && (
                                <>
                                  <button type="button" onClick={() => openEdit(m)} className={iconeDaLinha} title="Editar" aria-label="Editar marco">
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button type="button" onClick={() => handleCycleMilestoneStatus(m)} className={iconeDaLinha} title="Alterar status" aria-label="Alterar status do marco">
                                    <RefreshCw className="h-3.5 w-3.5" />
                                  </button>
                                  <button type="button" onClick={() => setDeleteMilestone(m)} className={juntar(iconeDaLinha, "hover:bg-destructive/10 hover:text-destructive")} title="Excluir" aria-label="Excluir marco">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Expanded tasks for this milestone */}
                          {isMilestoneExpanded && (
                            <div className="space-y-1 pb-2 pl-3 pr-1 pt-1 sm:pl-12">
                              {mTasks.map((t: any) => (
                                <div key={t.id} className="group flex min-w-0 items-center rounded-md px-2 py-2 transition-colors hover:bg-muted/60">
                                  <div className={`mr-2.5 h-2.5 w-2.5 shrink-0 rounded-full ${taskStatusDot[t.status] || "bg-muted-foreground"}`} />
                                  <div className="mr-2 min-w-0 flex-1">
                                    <p className="truncate text-[12px] text-foreground">{t.title}</p>
                                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                      {t.assignee?.full_name ? <>{t.assignee.full_name} · </> : null}
                                      <span className={priorityColors[t.priority] || "text-muted-foreground"}>{priorityLabels[t.priority] || t.priority}</span>
                                    </p>
                                  </div>
                                  {isAdmin ? (
                                    <select
                                      value={t.status}
                                      onChange={(e) => handleChangeTaskStatus(t, e.target.value)}
                                      className={seletorDaLinha}
                                      aria-label={`Status de ${t.title}`}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {taskStatusOrder.map(s => (
                                        <option key={s} value={s}>{taskStatusLabels[s]}</option>
                                      ))}
                                    </select>
                                  ) : (
                                    <span className="shrink-0 text-[11px] text-muted-foreground">
                                      {taskStatusLabels[t.status] || t.status}
                                    </span>
                                  )}
                                  {isAdmin && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => openEditTask(t)}
                                        className={juntar(iconeDaLinha, "ml-1 sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover:opacity-100")}
                                        title="Editar"
                                        aria-label={`Editar ${t.title}`}
                                      >
                                        <Pencil className="h-3 w-3" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setDeleteTask(t)}
                                        className={juntar(iconeDaLinha, "hover:bg-destructive/10 hover:text-destructive sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover:opacity-100")}
                                        title="Excluir tarefa"
                                        aria-label={`Excluir ${t.title}`}
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </>
                                  )}
                                </div>
                              ))}

                              {/* Add task inline: um poço (sem caixa com borda). */}
                              {isAdmin && addTaskMilestone === m.id ? (
                                <div className={juntar(superficie.poco, "space-y-2 p-3")}>
                                  <input
                                    autoFocus
                                    value={newTaskTitle}
                                    onChange={(e) => setNewTaskTitle(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Escape") setAddTaskMilestone(null); }}
                                    placeholder="Nome da tarefa..."
                                    aria-label="Nome da nova tarefa"
                                    className={juntar(campo, "h-8 text-[12px]")}
                                  />
                                  <div className="-m-1 flex flex-wrap items-center [&>*]:m-1">
                                    <select
                                      value={newTaskPriority}
                                      onChange={(e) => setNewTaskPriority(e.target.value)}
                                      aria-label="Prioridade"
                                      className={seletorDaLinha}
                                    >
                                      <option value="low">Baixa</option>
                                      <option value="medium">Média</option>
                                      <option value="high">Alta</option>
                                      <option value="urgent">Urgente</option>
                                    </select>
                                    <select
                                      value={newTaskAssignedTo}
                                      onChange={(e) => setNewTaskAssignedTo(e.target.value)}
                                      aria-label="Responsável"
                                      className={juntar(seletorDaLinha, "min-w-[100px]")}
                                    >
                                      <option value="">Sem responsável</option>
                                      {(teamMembers || []).map((m: any) => (
                                        <option key={m.id} value={m.id}>{m.full_name}</option>
                                      ))}
                                    </select>
                                    <input
                                      type="date"
                                      value={newTaskDueDate}
                                      onChange={(e) => setNewTaskDueDate(e.target.value)}
                                      aria-label="Prazo"
                                      className={seletorDaLinha}
                                      placeholder="Prazo"
                                    />
                                    <div className="ml-auto flex items-center [&>*+*]:ml-1">
                                      <button
                                        type="button"
                                        onClick={() => handleAddTask(m.id, project.id)}
                                        disabled={savingNewTask}
                                        aria-label="Criar tarefa"
                                        className={juntar(botao.primario, "h-7 w-7 px-0")}
                                      >
                                        {savingNewTask ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => { setAddTaskMilestone(null); setNewTaskTitle(""); setNewTaskAssignedTo(""); setNewTaskDueDate(""); }}
                                        aria-label="Cancelar"
                                        className={iconeDaLinha}
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ) : isAdmin ? (
                                <button
                                  type="button"
                                  onClick={() => { setAddTaskMilestone(m.id); setNewTaskTitle(""); setNewTaskPriority("medium"); setNewTaskAssignedTo(""); setNewTaskDueDate(""); }}
                                  className="flex w-full cursor-pointer items-center justify-center rounded-md border border-dashed border-border bg-transparent py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                                >
                                  <Plus className="mr-1 h-3 w-3" aria-hidden="true" /> Adicionar tarefa
                                </button>
                              ) : null}
                            </div>
                          )}
                        </li>
                      );
                    })}
                    </ul>
                  </Secao>
                )}

                {/* Description */}
                {project.description && (
                  <div className="min-w-0">
                    <p className={texto.rotulo}>Descrição</p>
                    <p className={juntar(texto.corpo, "mt-1 text-muted-foreground")}>{project.description}</p>
                  </div>
                )}

                {/* Links */}
                <div className="-ml-2 flex items-center [&>*+*]:ml-1">
                  <button type="button" onClick={() => navigate(`/kanban?project=${project.id}`)} className={juntar(botao.discreto, "h-8 px-2 text-[12px] text-primary")}>
                    Ver tarefas no Kanban
                  </button>
                  <button type="button" onClick={() => navigate("/relatorios")} className={juntar(botao.discreto, "h-8 px-2 text-[12px] text-primary")}>
                    Ver relatórios
                  </button>
                </div>
              </div>
            )}
          </Secao>
        );
      })}

      </div>
      )}
      </AreaDeTrabalho>

      {/* ========== MILESTONE DETAIL MODAL ========== */}
      <Dialog open={!!selectedMilestone} onOpenChange={(v) => !v && setSelectedMilestone(null)}>
        {selectedMilestone && (() => {
          const mTasks = (allTasks || []).filter((t: any) => t.milestone_id === selectedMilestone.id);
          const mDone = mTasks.filter((t: any) => t.status === "done").length;
          const days = daysUntilDate(selectedMilestone.target_date);

          return (
            <DialogContent className="flex max-h-[85vh] max-w-sm flex-col overflow-hidden border-border bg-card p-0">
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
                <DialogHeader className="text-left">
                  <div className="flex min-w-0 items-center pr-8">
                    <span className={`mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                      selectedMilestone.status === "completed" ? "bg-success text-white" :
                      selectedMilestone.status === "in_progress" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                    }`} aria-hidden="true">
                      {selectedMilestone.status === "completed" ? <Check className="h-4 w-4" /> :
                       selectedMilestone.status === "in_progress" ? <Clock className="h-4 w-4" /> :
                       <Circle className="h-4 w-4" />}
                    </span>
                    <DialogTitle className={juntar(texto.tituloSecao, "min-w-0 truncate")} title={selectedMilestone.title}>{selectedMilestone.title}</DialogTitle>
                  </div>
                </DialogHeader>

                <div className="mt-4 space-y-3">
                  <div className="flex items-center">
                    <Calendar className="mr-3 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <p className={juntar(texto.corpo, "tabular-nums")}>
                      {new Date(selectedMilestone.target_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
                      <span className="text-muted-foreground"> · {days > 0 ? `faltam ${days} dias` : days === 0 ? "hoje" : `${Math.abs(days)} dias atrás`}</span>
                    </p>
                  </div>
                  <div className="flex items-center">
                    <Flag className="mr-3 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className={juntar("rounded-full px-2.5 py-1 text-[12px]", corDoStatusDoMarco(selectedMilestone.status))}>
                      {statusLabels[selectedMilestone.status] || "Pendente"}
                    </span>
                  </div>
                  {selectedMilestone.description && (
                    <div>
                      <p className={texto.rotulo}>Descrição</p>
                      <p className={juntar(texto.corpo, "mt-1 text-muted-foreground")}>{selectedMilestone.description}</p>
                    </div>
                  )}
                  {/* Tasks list in modal */}
                  {mTasks.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className={texto.rotulo}>Tarefas</p>
                        <p className="text-[11px] font-medium tabular-nums text-foreground">{mDone}/{mTasks.length}</p>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(mDone / mTasks.length) * 100}%` }} />
                      </div>
                      <ul className="divide-y divide-border">
                        {mTasks.map((t: any) => (
                          <li key={t.id} className="flex min-w-0 items-center py-2">
                            <div className={`mr-2 h-2 w-2 shrink-0 rounded-full ${taskStatusDot[t.status] || "bg-muted-foreground"}`} />
                            <p className="mr-2 min-w-0 flex-1 truncate text-[12px] text-foreground">{t.title}</p>
                            {isAdmin ? (
                              <select
                                value={t.status}
                                onChange={(e) => handleChangeTaskStatus(t, e.target.value)}
                                aria-label={`Status de ${t.title}`}
                                className={seletorDaLinha}
                              >
                                {taskStatusOrder.map(s => (
                                  <option key={s} value={s}>{taskStatusLabels[s]}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="shrink-0 text-[11px] text-muted-foreground">{taskStatusLabels[t.status]}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {isAdmin && (
                <div className="flex shrink-0 items-center justify-end border-t border-border px-5 py-3 [&>*+*]:ml-2">
                  <button type="button" onClick={() => openEdit(selectedMilestone)} className={botao.secundario}>
                    Editar
                  </button>
                  <button type="button" onClick={() => handleCycleMilestoneStatus(selectedMilestone)} className={botao.primario}>
                    Alterar Status
                  </button>
                </div>
              )}
            </DialogContent>
          );
        })()}
      </Dialog>

      {/* ========== ADD MILESTONE MODAL ========== */}
      <Dialog open={!!addMilestoneProject} onOpenChange={(v) => !v && setAddMilestoneProject(null)}>
        <DialogContent className="flex max-h-[85vh] max-w-md flex-col overflow-hidden border-border bg-card p-0">
          <DialogHeader className="border-b border-border px-5 py-4 text-left">
            <DialogTitle className={juntar(texto.tituloSecao, "truncate pr-8")}>Novo Milestone</DialogTitle>
            <p className={texto.auxiliar}>{existingMilestones.length} milestones existentes</p>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-5">
            <CampoDeFormulario rotulo="Título">
              <input value={newTitle} onChange={e => setNewTitle(e.target.value)} className={campo} placeholder="Ex: Entrega Final" />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Data alvo">
              <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className={campo} />
            </CampoDeFormulario>
            {/* Posição: um seletor em vez de uma fileira de pílulas. */}
            {existingMilestones.length > 0 && (
              <CampoDeEscolha rotulo="Posição na timeline">
                <SeletorCompacto
                  rotulo="Posição na timeline"
                  modo="lista"
                  larguraTotal
                  opcoes={[
                    { valor: "fim", rotulo: "No final" },
                    ...existingMilestones.map((m: any, i: number) => ({ valor: String(m.milestone_order || i + 1), rotulo: `Antes de "${m.title}"` })),
                  ]}
                  valor={newOrder === null ? "fim" : String(newOrder)}
                  onEscolher={(v) => setNewOrder(v === "fim" ? null : Number(v))}
                />
              </CampoDeEscolha>
            )}
            <CampoDeFormulario rotulo="Descrição (opcional)">
              <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} rows={3} className={juntar(campoTexto, "resize-none")} placeholder="Descreva este marco..." />
            </CampoDeFormulario>
            <CampoDeEscolha rotulo="Status">
              <SeletorCompacto
                rotulo="Status do marco"
                modo="segmentado"
                larguraTotal
                opcoes={(["pending", "in_progress", "completed"] as const).map((s) => ({ valor: s, rotulo: statusLabels[s] }))}
                valor={newStatus}
                onEscolher={setNewStatus}
              />
            </CampoDeEscolha>
          </div>
          <div className="flex shrink-0 items-center justify-end border-t border-border px-5 py-3 [&>*+*]:ml-2">
            <button type="button" onClick={() => setAddMilestoneProject(null)} className={botao.secundario}>
              Cancelar
            </button>
            <button type="button" onClick={handleAddMilestone} disabled={saving || !newTitle || !newDate} className={botao.primario}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Salvando" /> : "Criar Milestone"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ========== EDIT MILESTONE MODAL ========== */}
      <Dialog open={!!editingMilestone} onOpenChange={(v) => !v && setEditingMilestone(null)}>
        <DialogContent className="flex max-h-[85vh] max-w-md flex-col overflow-hidden border-border bg-card p-0">
          <DialogHeader className="border-b border-border px-5 py-4 text-left">
            <DialogTitle className={juntar(texto.tituloSecao, "truncate pr-8")}>Editar Milestone</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-5">
            <CampoDeFormulario rotulo="Título">
              <input value={editTitle} onChange={e => setEditTitle(e.target.value)} className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Data alvo">
              <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Descrição">
              <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={3} className={juntar(campoTexto, "resize-none")} />
            </CampoDeFormulario>
          </div>
          <div className="flex shrink-0 items-center justify-end border-t border-border px-5 py-3 [&>*+*]:ml-2">
            <button type="button" onClick={() => setEditingMilestone(null)} className={botao.secundario}>
              Cancelar
            </button>
            <button type="button" onClick={handleSaveEdit} disabled={saving || !editTitle || !editDate} className={botao.primario}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Salvando" /> : "Salvar"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ========== EDIT TASK MODAL ========== */}
      <Dialog open={!!editingTask} onOpenChange={(v) => !v && setEditingTask(null)}>
        {editingTask && (
          <DialogContent className="flex max-h-[85vh] max-w-md flex-col overflow-hidden border-border bg-card p-0">
            <DialogHeader className="border-b border-border px-5 py-4 text-left">
              <DialogTitle className={juntar(texto.tituloSecao, "truncate pr-8")}>Editar Tarefa</DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-5">
              <CampoDeFormulario rotulo="Título">
                <input value={editTaskTitle} onChange={e => setEditTaskTitle(e.target.value)} className={campo} placeholder="Título da tarefa" />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Descrição">
                <textarea value={editTaskDesc} onChange={e => setEditTaskDesc(e.target.value)} rows={3} className={juntar(campoTexto, "resize-none")} placeholder="Detalhes da tarefa..." />
              </CampoDeFormulario>
              <div className="grid grid-cols-2 gap-4">
                <CampoDeFormulario rotulo="Prioridade">
                  <select value={editTaskPriority} onChange={e => setEditTaskPriority(e.target.value)} className={juntar(campo, "cursor-pointer")}>
                    <option value="low">Baixa</option>
                    <option value="medium">Média</option>
                    <option value="high">Alta</option>
                    <option value="urgent">Urgente</option>
                  </select>
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Status">
                  <select
                    value={editingTask.status}
                    onChange={(e) => {
                      handleChangeTaskStatus(editingTask, e.target.value);
                      setEditingTask({ ...editingTask, status: e.target.value });
                    }}
                    className={juntar(campo, "cursor-pointer")}
                  >
                    {taskStatusOrder.map(s => (
                      <option key={s} value={s}>{taskStatusLabels[s]}</option>
                    ))}
                  </select>
                </CampoDeFormulario>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <CampoDeFormulario rotulo="Responsável">
                  <select value={editTaskAssignedTo} onChange={e => setEditTaskAssignedTo(e.target.value)} className={juntar(campo, "cursor-pointer")}>
                    <option value="">Sem responsável</option>
                    {(teamMembers || []).map((m: any) => (
                      <option key={m.id} value={m.id}>{m.full_name}</option>
                    ))}
                  </select>
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Prazo">
                  <input type="date" value={editTaskDueDate} onChange={e => setEditTaskDueDate(e.target.value)} className={campo} />
                </CampoDeFormulario>
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-end border-t border-border px-5 py-3 [&>*+*]:ml-2">
              <button type="button" onClick={() => setEditingTask(null)} className={botao.secundario}>
                Cancelar
              </button>
              <button type="button" onClick={handleSaveTask} disabled={savingTask || !editTaskTitle} className={botao.primario}>
                {savingTask ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                {savingTask ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </DialogContent>
        )}
      </Dialog>

      {/* ========== DELETE MILESTONE CONFIRM ========== */}
      <ConfirmModal
        open={!!deleteMilestone}
        title="Excluir Milestone"
        description={`Tem certeza que deseja excluir "${deleteMilestone?.title}"? Todas as tarefas associadas também serão removidas.`}
        confirmLabel="Excluir Milestone"
        onConfirm={handleDeleteMilestone}
        onCancel={() => setDeleteMilestone(null)}
      />

      {/* ========== DELETE TASK CONFIRM ========== */}
      <ConfirmModal
        open={!!deleteTask}
        title="Excluir Tarefa"
        description={`Tem certeza que deseja excluir a tarefa "${deleteTask?.title}"?`}
        confirmLabel="Excluir Tarefa"
        onConfirm={handleDeleteTask}
        onCancel={() => setDeleteTask(null)}
      />
    </div>
  );
}
