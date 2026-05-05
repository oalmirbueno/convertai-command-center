import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useTasks, useTeamMembers, useProjects } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { notifyOpsMilestone, notifyOpsUpdate } from "@/lib/opsSync";
import { notifyOpsTaskUpdated, notifyOpsTaskDeleted } from "@/lib/opsTaskSync";
import { notifyUser } from "@/lib/notifyHelpers";
import { sendTaskAttachmentsToApproval } from "@/lib/reviewToApproval";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Clock, Plus, Filter, X, Paperclip, CalendarIcon, Trash2 } from "lucide-react";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import CreateTaskModal from "@/components/admin/CreateTaskModal";
import TaskDetailDrawer from "@/components/admin/TaskDetailDrawer";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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

  // Fetch attachment counts per task
  const { data: attachmentCounts } = useQuery({
    queryKey: ["task-attachment-counts"],
    queryFn: async () => {
      const { data } = await supabase.from("task_attachments").select("task_id");
      const counts: Record<string, number> = {};
      (data || []).forEach((a: any) => { counts[a.task_id] = (counts[a.task_id] || 0) + 1; });
      return counts;
    },
  });

  // Modals & drawer
  const [createStatus, setCreateStatus] = useState<string | null>(null);
  const [detailTask, setDetailTask] = useState<any>(null);
  const [deleteTask, setDeleteTask] = useState<any>(null);

  const handleDeleteTask = async () => {
    if (!deleteTask) return;
    const { error } = await supabase.from("tasks").delete().eq("id", deleteTask.id);
    if (error) {
      toast.error("Erro ao excluir tarefa");
      return;
    }
    notifyOpsTaskDeleted(deleteTask.id, deleteTask.ops_node_id);
    toast.success("Tarefa excluída");
    setDeleteTask(null);
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };

  // Filters
  const [searchParams] = useSearchParams();
  const [filterProject, setFilterProject] = useState(searchParams.get("project") || "");
  const [filterAssignee, setFilterAssignee] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState<Date | undefined>(undefined);
  const [filterDateTo, setFilterDateTo] = useState<Date | undefined>(undefined);

  const hasFilters = filterProject || filterAssignee || filterPriority || filterDateFrom || filterDateTo;

  const filteredTasks = (tasks || []).filter((t: any) => {
    if (filterProject && t.project_id !== filterProject) return false;
    if (filterAssignee && t.assigned_to !== filterAssignee) return false;
    if (filterPriority && t.priority !== filterPriority) return false;
    if (filterDateFrom && t.due_date) {
      if (new Date(t.due_date) < filterDateFrom) return false;
    }
    if (filterDateTo && t.due_date) {
      if (new Date(t.due_date) > filterDateTo) return false;
    }
    if ((filterDateFrom || filterDateTo) && !t.due_date) return false;
    return true;
  }).sort((a: any, b: any) => {
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
  });

  const handleDragStart = (taskId: string) => {
    if (isClient) return;
    setDraggedTask(taskId);
  };

  const handleDrop = async (column: string) => {
    if (isClient || !draggedTask) return;
    const task = (tasks || []).find((t: any) => t.id === draggedTask);
    if (!task) return;
    const previousStatus = task.status;
    await supabase.from("tasks").update({ status: column }).eq("id", draggedTask);
    notifyOpsTaskUpdated(draggedTask);

    const { data: { user: authUser } } = await supabase.auth.getUser();

    if (["review", "done"].includes(column) && task.project_id && authUser && previousStatus !== column) {
      await sendTaskAttachmentsToApproval(task.id, task.project_id, task.title, authUser.id);
      queryClient.invalidateQueries({ queryKey: ["all-files"] });
      queryClient.invalidateQueries({ queryKey: ["files"] });
    }

    if (column === "done" && task.project_id) {
      if (authUser) {
        const { data: upd } = await supabase.from("updates").insert({
          project_id: task.project_id, author_id: authUser.id,
          message: `"${task.title}" concluída`, update_type: "task",
        }).select().single();
        notifyOpsUpdate(upd);
      }
      // Notify assignee that task is done
      if (task.assigned_to && authUser && task.assigned_to !== authUser.id) {
        await notifyUser(task.assigned_to, `Tarefa "${task.title}" marcada como concluída`, "task", "/kanban");
      }
      // Notify admin about task completion
      const { notifyAdmin } = await import("@/lib/notifyHelpers");
      if (authUser) {
        await notifyAdmin(`Tarefa "${task.title}" concluída por ${profile?.full_name || "equipe"}`, "task", "/kanban");
      }
    }

    // Notify admin about any status change in kanban
    if (previousStatus !== column && column !== "done") {
      const { notifyAdmin } = await import("@/lib/notifyHelpers");
      if (authUser && !profile?.role?.includes("admin")) {
        await notifyAdmin(`${profile?.full_name || "Membro"} moveu "${task.title}" → ${columns.find(c => c.id === column)?.title || column}`, "task", "/kanban");
      }
    }

    // Notify assignee about status change
    if (task.assigned_to && authUser && task.assigned_to !== authUser.id && previousStatus !== column) {
      await notifyUser(task.assigned_to, `Tarefa "${task.title}" movida para ${columns.find(c => c.id === column)?.title || column}`, "task", "/kanban");
    }

    setDraggedTask(null);
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    queryClient.invalidateQueries({ queryKey: ["milestones"] });
    queryClient.invalidateQueries({ queryKey: ["milestones-all"] });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
  };

  const formatDate = (d: string) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  };

  const handleCardClick = (task: any) => {
    setDetailTask(task);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <p className="heading-page text-[16px] md:text-[14px]" data-tour="kanban-create-btn">Kanban</p>

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
        {/* Date range filters */}
        <Popover>
          <PopoverTrigger asChild>
            <button className={cn(
              "bg-secondary border border-border rounded-[10px] px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-primary/50 transition-colors flex-shrink-0 flex items-center gap-1.5",
              !filterDateFrom && "text-muted-foreground"
            )}>
              <CalendarIcon className="w-3 h-3" />
              {filterDateFrom ? format(filterDateFrom, "dd/MM") : "De"}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={filterDateFrom} onSelect={setFilterDateFrom} className={cn("p-3 pointer-events-auto")} />
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <button className={cn(
              "bg-secondary border border-border rounded-[10px] px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-primary/50 transition-colors flex-shrink-0 flex items-center gap-1.5",
              !filterDateTo && "text-muted-foreground"
            )}>
              <CalendarIcon className="w-3 h-3" />
              {filterDateTo ? format(filterDateTo, "dd/MM") : "Até"}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={filterDateTo} onSelect={setFilterDateTo} className={cn("p-3 pointer-events-auto")} />
          </PopoverContent>
        </Popover>
        {hasFilters && (
          <button onClick={() => { setFilterProject(""); setFilterAssignee(""); setFilterPriority(""); setFilterDateFrom(undefined); setFilterDateTo(undefined); }}
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
                    {task.milestone?.title && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary inline-block mt-1">
                        {task.milestone.title}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {formatDate(task.due_date)}
                      </div>
                      {(attachmentCounts || {})[task.id] > 0 && (
                        <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                          <Paperclip className="w-3 h-3" />
                          {(attachmentCounts || {})[task.id]}
                        </div>
                      )}
                    </div>
                    <Avatar className="w-6 h-6">
                      <AvatarFallback className="text-[9px] bg-secondary text-muted-foreground font-medium">
                        {task.assignee?.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2) || "?"}
                      </AvatarFallback>
                    </Avatar>
                    {!isClient && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteTask(task); }}
                        className="text-muted-foreground hover:text-destructive transition-colors cursor-pointer bg-transparent border-none p-1 rounded"
                        title="Excluir tarefa"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
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
        <div className="flex gap-6 overflow-x-auto pb-4" data-tour="kanban-board" style={{ scrollSnapType: 'x mandatory' }}>
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
                          {task.milestone?.title && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary inline-block mt-1">
                              {task.milestone.title}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground">
                              <Clock className="w-3 h-3" />
                              {formatDate(task.due_date)}
                            </div>
                            {(attachmentCounts || {})[task.id] > 0 && (
                              <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                                <Paperclip className="w-3 h-3" />
                                {(attachmentCounts || {})[task.id]}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Avatar className="w-6 h-6">
                              <AvatarFallback className="text-[9px] bg-secondary text-muted-foreground font-medium">
                                {task.assignee?.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2) || "?"}
                              </AvatarFallback>
                            </Avatar>
                            {!isClient && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setDeleteTask(task); }}
                                className="text-muted-foreground hover:text-destructive transition-colors cursor-pointer bg-transparent border-none p-1 rounded"
                                title="Excluir tarefa"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
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

      {/* Task Detail Drawer */}
      {detailTask && (
        <TaskDetailDrawer
          task={detailTask}
          onClose={() => setDetailTask(null)}
          teamMembers={teamMembers || []}
          projects={projects || []}
          readOnly={isClient}
        />
      )}

      {!isClient && (
        <CreateTaskModal
          open={!!createStatus}
          onClose={() => setCreateStatus(null)}
          defaultStatus={createStatus || "backlog"}
          teamMembers={teamMembers || []}
        />
      )}
    </div>
  );
}
