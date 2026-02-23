import { useTasks } from "@/hooks/useSupabaseData";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const columns = [
  { id: "backlog", title: "Backlog", dotColor: "bg-muted-foreground" },
  { id: "doing", title: "Em Andamento", dotColor: "bg-info" },
  { id: "review", title: "Revisão", dotColor: "bg-warning" },
  { id: "approved", title: "Aprovado", dotColor: "bg-primary" },
  { id: "done", title: "Concluído", dotColor: "bg-success" },
];

const priorityBorderColors: Record<string, string> = {
  urgent: "border-l-destructive",
  high: "border-l-warning",
  medium: "border-l-muted-foreground",
  low: "border-l-border",
};

export default function TabKanban({ projectId }: { projectId: string }) {
  const { data: tasks, isLoading } = useTasks(projectId);

  const formatDate = (d: string) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  };

  if (isLoading) {
    return (
      <div className="flex gap-5 overflow-x-auto pb-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="min-w-[260px] space-y-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-4">Acompanhe o andamento das tarefas do seu projeto</p>
      
      {!tasks?.length ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Nenhuma tarefa encontrada.</p>
      ) : (
        <div className="flex gap-5 overflow-x-auto pb-4">
          {columns.map(col => {
            const colTasks = tasks.filter((t: any) => t.status === col.id);
            if (colTasks.length === 0 && col.id !== "backlog" && col.id !== "doing") return null;
            return (
              <div key={col.id} className="min-w-[260px] max-w-[280px] flex-shrink-0 space-y-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${col.dotColor}`} />
                  <span className="label-sm">{col.title}</span>
                  <span className="text-[10px] font-mono text-muted-foreground bg-secondary px-1.5 py-0.5 rounded ml-auto">{colTasks.length}</span>
                </div>
                <div className="space-y-2 min-h-[100px]">
                  {colTasks.map((task: any) => (
                    <div
                      key={task.id}
                      className={`bg-card border border-border rounded-[10px] border-l-[3px] ${priorityBorderColors[task.priority] || "border-l-border"} cursor-default hover:border-muted-foreground/30 transition-colors`}
                    >
                      <div className="p-3.5 space-y-2.5">
                        <p className="text-[13px] font-medium text-foreground leading-snug">{task.title}</p>
                        <div className="flex items-center justify-between">
                          {task.due_date && (
                            <div className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground">
                              <Clock className="w-3 h-3" />
                              {formatDate(task.due_date)}
                            </div>
                          )}
                          {task.assignee && (
                            <Avatar className="w-6 h-6">
                              <AvatarFallback className="text-[9px] bg-secondary text-muted-foreground font-medium">
                                {task.assignee.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                              </AvatarFallback>
                            </Avatar>
                          )}
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
