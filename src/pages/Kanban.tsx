import { useState } from "react";
import { kanbanTasks, KanbanTask, priorityColors } from "@/data/mockData";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Clock, GripVertical } from "lucide-react";

const columns = [
  { id: "backlog" as const, title: "Backlog", color: "bg-muted-foreground" },
  { id: "andamento" as const, title: "Em Andamento", color: "bg-info" },
  { id: "revisao" as const, title: "Revisão", color: "bg-warning" },
  { id: "concluido" as const, title: "Concluído", color: "bg-success" },
];

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
        <h1 className="text-2xl font-bold text-foreground">Kanban</h1>
        <p className="text-muted-foreground text-sm">Gerencie tarefas arrastando entre colunas.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {columns.map((col) => {
          const colTasks = tasks.filter((t) => t.column === col.id);
          return (
            <div
              key={col.id}
              className="space-y-3"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(col.id)}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-2.5 h-2.5 rounded-full ${col.color}`} />
                <h3 className="text-sm font-semibold text-foreground">{col.title}</h3>
                <span className="text-xs font-mono text-muted-foreground ml-auto">{colTasks.length}</span>
              </div>

              <div className="space-y-2 min-h-[200px] p-2 rounded-xl bg-secondary/20 border border-border/30">
                {colTasks.map((task) => (
                  <Card
                    key={task.id}
                    draggable
                    onDragStart={() => handleDragStart(task.id)}
                    className="bg-card border-border/50 rounded-xl cursor-grab active:cursor-grabbing hover:border-primary/30 transition-colors"
                  >
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <GripVertical className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                        <div className="flex-1 ml-2">
                          <p className="text-sm font-medium text-foreground leading-snug">{task.title}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{task.project}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <Badge className={`${priorityColors[task.priority]} border-0 text-[10px]`}>
                          {task.priority}
                        </Badge>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            {task.deadline}
                          </div>
                          <Avatar className="w-6 h-6">
                            <AvatarFallback className="text-[10px] bg-primary/20 text-primary font-semibold">
                              {task.assigneeAvatar}
                            </AvatarFallback>
                          </Avatar>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
