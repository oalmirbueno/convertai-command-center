import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDraggable } from "@dnd-kit/core";
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  CircleDot,
  ExternalLink,
  GripVertical,
  Search,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface EditorialInboxTask {
  id: string;
  project_id: string;
  title: string;
  description?: string | null;
  assigned_to?: string | null;
  status: string;
  priority?: string | null;
  due_date?: string | null;
}

interface EditorialTaskInboxProps {
  tasks: EditorialInboxTask[];
  projectNames: Map<string, string>;
  loading?: boolean;
  error?: boolean;
  disabled?: boolean;
  onCreateFromTask: (task: EditorialInboxTask) => void;
}

const statusLabels: Record<string, string> = {
  backlog: "A fazer",
  todo: "A fazer",
  doing: "Em andamento",
  review: "Revisão",
  approved: "Revisão",
  blocked: "Bloqueado",
};

const priorityClasses: Record<string, string> = {
  urgent: "bg-destructive",
  high: "bg-warning",
  medium: "bg-info",
  low: "bg-muted-foreground",
};

function dueDateLabel(value?: string | null) {
  if (!value) return "Sem prazo";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10));
  const date = new Date(
    dateOnly ? `${value.slice(0, 10)}T12:00:00` : value,
  );
  if (Number.isNaN(date.getTime())) return "Sem prazo";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

function TaskCard({
  task,
  projectName,
  disabled,
  onCreate,
}: {
  task: EditorialInboxTask;
  projectName: string;
  disabled: boolean;
  onCreate: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: `task:${task.id}`,
    disabled,
    data: {
      kind: "task",
      task,
      label: task.title,
    },
  });

  return (
    <article
      ref={setNodeRef}
      style={
        transform
          ? {
              transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
            }
          : undefined
      }
      className={cn(
        "group rounded-xl border border-border bg-background/80 p-3 transition-colors hover:border-primary/35",
        isDragging && "opacity-40",
      )}
    >
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          className="mt-0.5 inline-flex h-8 w-7 shrink-0 cursor-grab items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`Arrastar tarefa ${task.title}`}
          disabled={disabled}
          {...listeners}
          {...attributes}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onCreate}
          disabled={disabled}
          className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-55"
        >
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                priorityClasses[task.priority || ""] ||
                  "bg-muted-foreground",
              )}
            />
            <p className="line-clamp-2 text-xs font-medium leading-5 text-foreground">
              {task.title}
            </p>
          </div>
          <p className="mt-1 truncate text-[10px] text-muted-foreground">
            {projectName}
          </p>
        </button>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2 pl-9">
        <Badge
          variant="secondary"
          className="h-5 rounded-md px-1.5 text-[9px] font-normal"
        >
          {statusLabels[task.status] || task.status}
        </Badge>
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <CalendarClock className="h-3 w-3" />
          {dueDateLabel(task.due_date)}
        </span>
      </div>
    </article>
  );
}

export default function EditorialTaskInbox({
  tasks,
  projectNames,
  loading = false,
  error = false,
  disabled = false,
  onCreateFromTask,
}: EditorialTaskInboxProps) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(true);
  const filteredTasks = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("pt-BR");
    if (!normalized) return tasks;
    return tasks.filter((task) =>
      [
        task.title,
        task.description,
        projectNames.get(task.project_id),
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("pt-BR")
        .includes(normalized),
    );
  }, [projectNames, search, tasks]);

  return (
    <aside className="rounded-2xl border border-border bg-card/75 shadow-sm">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3.5">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              Fila do Kanban
            </h2>
            <Badge
              variant="secondary"
              className="h-5 rounded-md px-1.5 text-[9px]"
            >
              {tasks.length}
            </Badge>
          </div>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Arraste uma tarefa para uma data ou etapa
          </p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 xl:hidden"
          onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? "Recolher fila" : "Expandir fila"}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </Button>
      </header>

      <div className={cn("p-3.5", !expanded && "hidden xl:block")}>
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar tarefa"
            aria-label="Buscar tarefa do Kanban"
            className="h-9 bg-background pl-8 text-xs"
          />
        </div>

        <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((item) => (
                <div
                  key={item}
                  className="h-24 animate-pulse rounded-xl bg-secondary/70"
                />
              ))}
            </div>
          ) : error ? (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-center">
              <p className="text-xs text-muted-foreground">
                Não foi possível carregar as tarefas.
              </p>
            </div>
          ) : filteredTasks.length > 0 ? (
            filteredTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                projectName={
                  projectNames.get(task.project_id) || "Projeto"
                }
                disabled={disabled}
                onCreate={() => onCreateFromTask(task)}
              />
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
              <CircleDot className="mx-auto h-6 w-6 text-muted-foreground/45" />
              <p className="mt-2 text-xs font-medium text-foreground">
                Fila limpa
              </p>
              <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                As tarefas abertas e ainda não vinculadas aparecem aqui.
              </p>
            </div>
          )}
        </div>

        <Link
          to="/kanban"
          className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-background text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/35 hover:text-foreground"
        >
          Abrir Kanban
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </aside>
  );
}
