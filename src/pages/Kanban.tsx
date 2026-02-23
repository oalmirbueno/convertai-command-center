import { useState, useEffect } from "react";
import { useTasks, useTeamMembers, useProjects } from "@/hooks/useSupabaseData";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Clock, Plus, Filter, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import CreateTaskModal from "@/components/admin/CreateTaskModal";
import { toast } from "sonner";

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

export default function Kanban() {
  const { data: tasks, isLoading } = useTasks();
  const { data: teamMembers } = useTeamMembers();
  const { data: projects } = useProjects();
  const [draggedTask, setDraggedTask] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Modals
  const [createStatus, setCreateStatus] = useState<string | null>(null);
  const [editTask, setEditTask] = useState<any>(null);

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

  const handleDragStart = (taskId: string) => setDraggedTask(taskId);

  const handleDrop = async (column: string) => {
    if (!draggedTask) return;
    const task = (tasks || []).find((t: any) => t.id === draggedTask);
    await supabase.from("tasks").update({ status: column }).eq("id", draggedTask);

    // Notifications on status change
    if (column === "review" && task?.project_id) {
      const { data: project } = await supabase.from("projects").select("client_id, name").eq("id", task.project_id).maybeSingle();
      if (project?.client_id) {
        await supabase.from("notifications").insert({
          user_id: project.client_id,
          message: `Tarefa "${task.title}" enviada para revisão`,
          notification_type: "task",
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

  return (
    <div className="space-y-6 animate-fade-in">
      <p className="heading-page">Kanban</p>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Filter className="w-3.5 h-3.5 text-muted-foreground" />
        <select value={filterProject} onChange={(e) => setFilterProject(e.target.value)}
          className="bg-secondary border border-border rounded-[10px] px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-primary/50 transition-colors">
          <option value="">Todos os projetos</option>
          {(projects || []).map((p: any) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}
          className="bg-secondary border border-border rounded-[10px] px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-primary/50 transition-colors">
          <option value="">Todos os responsáveis</option>
          {(teamMembers || []).map((m: any) => (
            <option key={m.id} value={m.id}>{m.full_name}</option>
          ))}
        </select>
        <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}
          className="bg-secondary border border-border rounded-[10px] px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-primary/50 transition-colors">
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
        <div className="text-sm text-muted-foreground py-8 text-center">Nenhuma tarefa encontrada. Use a página Seed para popular dados demo.</div>
      ) : (
        <div className="flex gap-6 overflow-x-auto pb-4" style={{ scrollSnapType: 'x mandatory' }}>
          {columns.map((col) => {
            const colTasks = filteredTasks.filter((t: any) => t.status === col.id);
            return (
              <div
                key={col.id}
                className="min-w-[300px] max-w-[320px] flex-shrink-0 space-y-3"
                style={{ scrollSnapAlign: 'start' }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(col.id)}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${col.dotColor}`} />
                  <span className="label-sm">{col.title}</span>
                  <span className="text-[10px] font-mono text-muted-foreground bg-secondary px-1.5 py-0.5 rounded ml-auto">{colTasks.length}</span>
                  <button onClick={() => setCreateStatus(col.id)}
                    className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none p-0.5 rounded hover:bg-secondary">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="space-y-2 min-h-[200px]">
                  {colTasks.map((task: any) => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={() => handleDragStart(task.id)}
                      onClick={() => setEditTask(task)}
                      className={`bg-card border border-border rounded-[10px] border-l-[3px] ${priorityBorderColors[task.priority] || "border-l-border"} cursor-grab active:cursor-grabbing hover:border-muted-foreground/30 hover:-translate-y-px transition-all`}
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
    </div>
  );
}
