import { useState } from "react";
import { kanbanTasks, KanbanTask, priorityColors } from "@/data/mockData";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Clock } from "lucide-react";

const columns = [
  { id: "backlog" as const, title: "Backlog", color: "bg-muted-foreground" },
  { id: "andamento" as const, title: "Em Andamento", color: "bg-cyan" },
  { id: "revisao" as const, title: "Revisão", color: "bg-warning" },
  { id: "concluido" as const, title: "Concluído", color: "bg-success" },
];

const priorityBorderColors: Record<string, string> = {
  alta: "border-l-destructive",
  média: "border-l-warning",
  baixa: "border-l-success",
};

export default function Kanban() {
  const [tasks, setTasks] = useState<KanbanTask[]>(kanbanTasks);
  const [draggedTask, setDraggedTask] = useState<string | null>(null);

  const handleDragStart = (taskId: string) => setDraggedTask(taskId);

  const handleDrop = (column: KanbanTask["column"]) => {
    if (!draggedTask) return;
    setTasks((prev) =>
      prev.map((t) => (t.id === draggedTask ? { ...t, column } : t))
    );
    setDraggedTask(null);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="heading-mc text-foreground">Kanban</h1>
        <p className="text-[13px] text-muted-foreground opacity-40 mt-1">Gerencie tarefas arrastando entre colunas.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        {columns.map((col) => {
          const colTasks = tasks.filter((t) => t.column === col.id);
          return (
            <div
              key={col.id}
              className="space-y-3"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(col.id)}
            >
              {/* Column header */}
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-2 h-2 rounded-full ${col.color}`} />
                <h3 className="label-mc text-foreground">{col.title}</h3>
                <span className="text-[10px] font-mono text-muted-foreground ml-auto">{colTasks.length}</span>
              </div>

              {/* Cards — transparent bg, no column bg */}
              <div className="space-y-2 min-h-[200px]">
                {colTasks.map((task) => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={() => handleDragStart(task.id)}
                    className={`glass-card rounded-xl border-l-4 ${priorityBorderColors[task.priority]} cursor-grab active:cursor-grabbing transition-all hover:shadow-lg hover:shadow-primary/5`}
                  >
                    <div className="p-4 space-y-3">
                      <div>
                        <p className="text-[13px] font-medium text-foreground leading-snug">{task.title}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{task.project}</p>
                      </div>
                      <div className="flex items-center justify-between">
                        <Badge className={`${priorityColors[task.priority]} border-0 text-[10px] rounded-full`}>
                          {task.priority}
                        </Badge>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            {task.deadline}
                          </div>
                          <Avatar className="w-5 h-5">
                            <AvatarFallback className="text-[9px] bg-primary/15 text-primary font-semibold">
                              {task.assigneeAvatar}
                            </AvatarFallback>
                          </Avatar>
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
    </div>
  );
}
