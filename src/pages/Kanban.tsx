import { useState } from "react";
import { kanbanTasks, KanbanTask } from "@/data/mockData";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Clock } from "lucide-react";

const columns = [
  { id: "backlog" as const, title: "Backlog", dotColor: "bg-muted-foreground" },
  { id: "andamento" as const, title: "Em Andamento", dotColor: "bg-info" },
  { id: "revisao" as const, title: "Revisão", dotColor: "bg-warning" },
  { id: "concluido" as const, title: "Concluído", dotColor: "bg-success" },
];

const priorityBorderColors: Record<string, string> = {
  alta: "border-l-destructive",
  média: "border-l-warning",
  baixa: "border-l-muted-foreground",
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
      <p className="heading-page">Kanban</p>

      <div className="flex gap-6 overflow-x-auto pb-4" style={{ scrollSnapType: 'x mandatory' }}>
        {columns.map((col) => {
          const colTasks = tasks.filter((t) => t.column === col.id);
          return (
            <div
              key={col.id}
              className="min-w-[300px] max-w-[320px] flex-shrink-0 space-y-3"
              style={{ scrollSnapAlign: 'start' }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(col.id)}
            >
              {/* Column header */}
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-1.5 h-1.5 rounded-full ${col.dotColor}`} />
                <span className="label-sm">{col.title}</span>
                <span className="text-[10px] font-mono text-muted-foreground bg-secondary px-1.5 py-0.5 rounded ml-auto">{colTasks.length}</span>
              </div>

              {/* Cards */}
              <div className="space-y-2 min-h-[200px]">
                {colTasks.map((task) => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={() => handleDragStart(task.id)}
                    className={`bg-card border border-border rounded-[10px] border-l-[3px] ${priorityBorderColors[task.priority]} cursor-grab active:cursor-grabbing hover:border-muted-foreground/30 hover:-translate-y-px transition-all`}
                  >
                    <div className="p-3.5 space-y-2.5">
                      <div>
                        <p className="text-[13px] font-medium text-foreground leading-snug">{task.title}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{task.project}</p>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          {task.deadline}
                        </div>
                        <Avatar className="w-6 h-6">
                          <AvatarFallback className="text-[9px] bg-secondary text-muted-foreground font-medium">
                            {task.assigneeAvatar}
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
    </div>
  );
}
