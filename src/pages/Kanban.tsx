import { useState } from "react";
import { useTasks, useTeamMembers, useProjects } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { notifyUser } from "@/lib/notifyHelpers";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Clock, Plus, Filter, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import CreateTaskModal from "@/components/admin/CreateTaskModal";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";

const columns = [
  { id: "backlog", title: "Backlog", dotColor: "bg-muted-foreground" },
  { id: "doing", title: "Em Andamento", dotColor: "bg-info" },
  { id: "review", title: "Revisão", dotColor: "bg-warning" },
  { id: "done", title: "Concluído", dotColor: "bg-success" },
];

const priorityBorderColors: Record<string, string> = {
  urgent: "border-l-destructive",
  high: "border-l-warning",
  medium: "border-l-muted-foreground",
  low: "border-l-border",
};

const priorityLabels: Record<string, string> = {
  urgent: "Urgente",
  high: "Alta",
  medium: "Média",
  low: "Baixa",
};

const statusLabels: Record<string, string> = {
  backlog: "Backlog",
  doing: "Em Andamento",
  review: "Revisão",
  done: "Concluído",
};

export default function Kanban() {
  const { data: tasks, isLoading } = useTasks();
  const { data: teamMembers } = useTeamMembers();
  const { data: projects } = useProjects();
  const { profile } = useAuth();
  const [draggedTask, setDraggedTask] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState("backlog");
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const isClient = profile?.role === "client";

  // Modals
  const [createStatus, setCreateStatus] = useState<string | null>(null);
  const [editTask, setEditTask] = useState<any>(null);
  const [viewTask, setViewTask] = useState<any>(null);

  // Filters
  const [filterProject, setFilterProject] = useState("");
  const [filterAssignee, setFilterAssignee] = useState("");
  const [filterPriority, setFilterPriority] = useState("");

  const hasFilters = filterProject || filterAssignee || filterPriority;

  const filteredTasks = (tasks || []).filter((t: any) => {
    if (filterProject && t.project_id !== filterProject) return false;
    if (filterAssignee && t.assigned_to !== filterAssignee) return false;
    if (filterPriority && t.priority !== filterPriority) return false;
    return true;
  });

  const handleDragStart = (taskId: string) => {
    if (isClient) return;
    setDraggedTask(taskId);
  };

  const handleDrop = async (column: string) => {
    if (isClient || !draggedTask) return;
    const task = (tasks || []).find((t: any) => t.id === draggedTask);
    await supabase.from("tasks").update({ status: column }).eq("id", draggedTask);

    if (column === "review" && task?.project_id) {
      const { data: project } = await supabase.from("projects").select("client_id, name").eq("id", task.project_id).maybeSingle();
      if (project?.client_id) {
        await notifyUser(project.client_id, `Tarefa "${task.title}" enviada para revisão`, "task", "/dashboard");
      }
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        await supabase.from("updates").insert({
          project_id: task.project_id, author_id: authUser.id,
          message: `Task "${task.title}" em revisão`, update_type: "task",
        });
      }
    }
    if (column === "done" && task?.project_id) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("updates").insert({
          project_id: task.project_id,
          author_id: user.id,
          message: `"${task.title}" concluída`,
          update_type: "task",
        });
      }
    }

    setDraggedTask(null);
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };

  const formatDate = (d: string) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  };

  const handleCardClick = (task: any) => {
    if (isClient) {
      setViewTask(task);
    } else {
      setEditTask(task);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <p className="heading-page text-[16px] md:text-[14px]">Kanban</p>

      {/* Filters */}
      <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-2 scrollbar-hidden md:flex-wrap md:gap-3 md:overflow-visible md:pb-0">
        <Filter className="w-3.5 h-3.5 text-muted-foreground" />
        <select value={filterProject} onChange={(e) => setFilterProject(e.target.value)}
          className="bg-secondary border border-border rounded-[10px] px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-primary/50 transition-colors flex-shrink-0">
          <option value="">Todos projetos</option>
          {(projects || []).map((p: any) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {!isClient && (
          <select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}
            className="bg-secondary border border-border rounded-[10px] px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-primary/50 transition-colors flex-shrink-0">
            <option value="">Todos os responsáveis</option>
            {(teamMembers || []).map((m: any) => (
              <option key={m.id} value={m.id}>{m.full_name}</option>
            ))}
          </select>
        )}
        <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}
          className="bg-secondary border border-border rounded-[10px] px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-primary/50 transition-colors flex-shrink-0">
          <option value="">Todas prioridades</option>
          <option value="urgent">Urgente</option>
          <option value="high">Alta</option>
          <option value="medium">Média</option>
          <option value="low">Baixa</option>
        </select>
        {hasFilters && (
          <button onClick={() => { setFilterProject(""); setFilterAssignee(""); setFilterPriority(""); }}
            className="text-[12px] text-muted-foreground hover:text-foreground flex items-center gap-1 cursor-pointer bg-transparent border-none">
            <X className="w-3 h-3" /> Limpar
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Carregando...</div>
      ) : (tasks || []).length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Nenhuma tarefa encontrada.</div>
      ) : isMobile ? (
        /* ═══ MOBILE: Tabs layout ═══ */
        <div>
          <div className="flex overflow-x-auto border-b border-border mb-4 scrollbar-hidden -mx-4 px-4">
            {columns.map(col => {
              const count = filteredTasks.filter((t: any) => t.status === col.id).length;
              return (
                <button
                  key={col.id}
                  onClick={() => setMobileTab(col.id)}
                  className={`flex-shrink-0 px-4 py-3 text-[13px] font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer bg-transparent ${
                    mobileTab === col.id
                      ? "text-foreground border-primary"
                      : "text-muted-foreground border-transparent hover:text-foreground"
                  }`}
                >
                  {col.title} ({count})
                </button>
              );
            })}
          </div>
          <div className="space-y-2">
            {filteredTasks.filter((t: any) => t.status === mobileTab).map((task: any) => (
              <div
                key={task.id}
                onClick={() => handleCardClick(task)}
                className={`bg-card border border-border rounded-[10px] border-l-[3px] ${priorityBorderColors[task.priority] || "border-l-border"} cursor-pointer hover:border-muted-foreground/30 transition-all`}
              >
                <div className="p-3.5 space-y-2.5">
                  <div>
                    <p className="text-[13px] font-medium text-foreground leading-snug">{task.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{task.project?.name}</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      {formatDate(task.due_date)}
                    </div>
                    <Avatar className="w-6 h-6">
                      <AvatarFallback className="text-[9px] bg-secondary text-muted-foreground font-medium">
                        {task.assignee?.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2) || "?"}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                </div>
              </div>
            ))}
            {filteredTasks.filter((t: any) => t.status === mobileTab).length === 0 && (
              <p className="text-sm text-muted-foreground py-8 text-center">Nenhuma tarefa nesta coluna.</p>
            )}
          </div>
        </div>
      ) : (
        /* ═══ DESKTOP: Columns layout ═══ */
        <div className="flex gap-6 overflow-x-auto pb-4" style={{ scrollSnapType: 'x mandatory' }}>
          {columns.map((col) => {
            const colTasks = filteredTasks.filter((t: any) => t.status === col.id);
            return (
              <div
                key={col.id}
                className="min-w-[300px] max-w-[320px] flex-shrink-0 space-y-3"
                style={{ scrollSnapAlign: 'start' }}
                onDragOver={isClient ? undefined : (e) => e.preventDefault()}
                onDrop={isClient ? undefined : () => handleDrop(col.id)}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${col.dotColor}`} />
                  <span className="label-sm">{col.title}</span>
                  <span className="text-[10px] font-mono text-muted-foreground bg-secondary px-1.5 py-0.5 rounded ml-auto">{colTasks.length}</span>
                  {!isClient && (
                    <button onClick={() => setCreateStatus(col.id)}
                      className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none p-0.5 rounded hover:bg-secondary">
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="space-y-2 min-h-[200px] overflow-y-auto" style={{ maxHeight: "calc(100vh - 280px)", scrollbarWidth: "none" }}>
                  {colTasks.map((task: any) => (
                    <div
                      key={task.id}
                      draggable={!isClient}
                      onDragStart={isClient ? undefined : () => handleDragStart(task.id)}
                      onClick={() => handleCardClick(task)}
                      className={`bg-card border border-border rounded-[10px] border-l-[3px] ${priorityBorderColors[task.priority] || "border-l-border"} ${isClient ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"} hover:border-muted-foreground/30 hover:-translate-y-px transition-all`}
                    >
                      <div className="p-3.5 space-y-2.5">
                        <div>
                          <p className="text-[13px] font-medium text-foreground leading-snug">{task.title}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{task.project?.name}</p>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            {formatDate(task.due_date)}
                          </div>
                          <Avatar className="w-6 h-6">
                            <AvatarFallback className="text-[9px] bg-secondary text-muted-foreground font-medium">
                              {task.assignee?.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2) || "?"}
                            </AvatarFallback>
                          </Avatar>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* View-only modal for clients */}
      {viewTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setViewTask(null)} />
          <div className="relative bg-card border border-border rounded-2xl w-full max-w-md p-6 mx-4 animate-in fade-in zoom-in-95 duration-200">
            <button onClick={() => setViewTask(null)} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border-none p-1">
              <X className="w-4 h-4" />
            </button>
            <div className="space-y-4">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Título</p>
                <p className="text-sm font-medium text-foreground mt-1">{viewTask.title}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Descrição</p>
                <p className="text-sm text-muted-foreground mt-1">{viewTask.description || "—"}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Prioridade</p>
                  <span className={`inline-block mt-1 text-[11px] px-2 py-0.5 rounded-full ${
                    viewTask.priority === "urgent" ? "bg-destructive/10 text-destructive" :
                    viewTask.priority === "high" ? "bg-warning/10 text-warning" :
                    "bg-secondary text-muted-foreground"
                  }`}>
                    {priorityLabels[viewTask.priority] || viewTask.priority}
                  </span>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</p>
                  <span className="inline-block mt-1 text-[11px] px-2 py-0.5 rounded-full bg-secondary text-foreground">
                    {statusLabels[viewTask.status] || viewTask.status}
                  </span>
                </div>
              </div>
              {viewTask.due_date && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Prazo</p>
                  <p className="text-sm text-foreground mt-1">{new Date(viewTask.due_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}</p>
                </div>
              )}
              {viewTask.assignee?.full_name && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Responsável</p>
                  <p className="text-sm text-foreground mt-1">{viewTask.assignee.full_name}</p>
                </div>
              )}
              {viewTask.project?.name && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Projeto</p>
                  <p className="text-sm text-foreground mt-1">{viewTask.project.name}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {!isClient && (
        <>
          <CreateTaskModal
            open={!!createStatus}
            onClose={() => setCreateStatus(null)}
            defaultStatus={createStatus || "backlog"}
            teamMembers={teamMembers || []}
          />
          <CreateTaskModal
            open={!!editTask}
            onClose={() => setEditTask(null)}
            editTask={editTask}
            teamMembers={teamMembers || []}
          />
        </>
      )}
    </div>
  );
}
