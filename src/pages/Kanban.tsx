import { useState } from "react";
import { useTasks } from "@/hooks/useSupabaseData";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Clock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

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
  const [draggedTask, setDraggedTask] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const handleDragStart = (taskId: string) => setDraggedTask(taskId);

  const handleDrop = async (column: string) => {
    if (!draggedTask) return;
    await supabase.from("tasks").update({ status: column }).eq("id", draggedTask);
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

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Carregando...</div>
      ) : (tasks || []).length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Nenhuma tarefa encontrada. Use a página Seed para popular dados demo.</div>
      ) : (
        <div className="flex gap-6 overflow-x-auto pb-4" style={{ scrollSnapType: 'x mandatory' }}>
          {columns.map((col) => {
            const colTasks = (tasks || []).filter((t: any) => t.status === col.id);
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
                </div>
                <div className="space-y-2 min-h-[200px]">
                  {colTasks.map((task: any) => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={() => handleDragStart(task.id)}
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
    </div>
  );
}
