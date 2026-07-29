import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDraggable } from "@dnd-kit/core";
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  CircleDot,
  ExternalLink,
  Flag,
  GripVertical,
  Palette,
  Plus,
  Search,
  UserRound,
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
  workstream?: string | null;
  source?: string | null;
}

export type EditorialTaskScope = "design" | "all";

interface EditorialTaskInboxProps {
  tasks: EditorialInboxTask[];
  totalTasks: number;
  scope: EditorialTaskScope;
  onScopeChange: (scope: EditorialTaskScope) => void;
  projectScopeNames: Map<string, string>;
  responsibleNames: Map<string, string>;
  loading?: boolean;
  error?: boolean;
  disabled?: boolean;
  onCreateFromTask: (task: EditorialInboxTask) => void;
  kanbanHref: string;
}

const statusLabels: Record<string, string> = {
  backlog: "Backlog",
  todo: "A fazer",
  doing: "Em andamento",
  in_progress: "Em andamento",
  review: "Revisão",
  approved: "Aprovado",
  blocked: "Bloqueado",
  done: "Concluído",
};

const priorityConfig: Record<
  string,
  { label: string; className: string }
> = {
  urgent: {
    label: "Urgente",
    className: "border-destructive/30 bg-destructive/10",
  },
  high: {
    label: "Alta",
    className: "border-warning/30 bg-warning/10",
  },
  medium: {
    label: "Média",
    className: "border-info/25 bg-info/10",
  },
  low: {
    label: "Baixa",
    className: "border-border bg-secondary/60",
  },
};

const defaultPriority = {
  label: "Sem prioridade",
  className: "border-border bg-secondary/60",
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
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function TaskCard({
  task,
  projectScopeName,
  responsibleName,
  disabled,
  onCreate,
}: {
  task: EditorialInboxTask;
  projectScopeName: string;
  responsibleName: string;
  disabled: boolean;
  onCreate: () => void;
}) {
  const instructionsId = useId();
  const priority =
    priorityConfig[task.priority || ""] || defaultPriority;
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
      role="listitem"
      style={
        transform
          ? {
              transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
            }
          : undefined
      }
      className={cn(
        "relative flex min-h-64 w-[min(86vw,22rem)] shrink-0 snap-start flex-col rounded-xl border border-border bg-background p-4 shadow-sm transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none sm:w-[22rem]",
        "hover:border-primary/30 hover:shadow-md",
        isDragging && "z-20 border-primary/45 opacity-55 shadow-lg",
      )}
    >
      <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-primary">
        <Palette className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate" title={projectScopeName}>
          {projectScopeName}
        </span>
      </div>

      <h3
        className="mt-3 min-h-10 line-clamp-2 text-[15px] font-semibold leading-5 text-foreground"
        title={task.title}
      >
        {task.title}
      </h3>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[11px]">
        <div className="min-w-0">
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
            Responsável
          </dt>
          <dd
            className="mt-1 truncate font-medium text-foreground"
            title={responsibleName}
          >
            {responsibleName}
          </dd>
        </div>

        <div className="min-w-0">
          <dt className="text-muted-foreground">Status</dt>
          <dd className="mt-1">
            <Badge
              variant="secondary"
              className="h-6 max-w-full rounded-md px-2 text-[10px] font-medium"
            >
              <span className="truncate">
                {statusLabels[task.status] || task.status}
              </span>
            </Badge>
          </dd>
        </div>

        <div className="min-w-0">
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
            Prazo
          </dt>
          <dd className="mt-1 font-medium text-foreground">
            {dueDateLabel(task.due_date)}
          </dd>
        </div>

        <div className="min-w-0">
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <Flag className="h-3.5 w-3.5" aria-hidden="true" />
            Prioridade
          </dt>
          <dd className="mt-1">
            <span
              className={cn(
                "inline-flex h-6 items-center rounded-md border px-2 text-[10px] font-medium text-foreground",
                priority.className,
              )}
            >
              {priority.label}
            </span>
          </dd>
        </div>
      </dl>

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3">
        <span id={instructionsId} className="sr-only">
          Arraste esta tarefa para uma data ou etapa do calendário. Se
          preferir, use o botão Criar conteúdo.
        </span>
        <button
          type="button"
          className="inline-flex h-11 min-w-11 touch-none cursor-grab items-center justify-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/35 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`Arrastar tarefa ${task.title}`}
          disabled={disabled}
          {...listeners}
          {...attributes}
          aria-describedby={instructionsId}
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
          <span className="hidden min-[390px]:inline">Arrastar</span>
        </button>

        <Button
          type="button"
          onClick={onCreate}
          disabled={disabled}
          className="h-11 flex-1 px-3 text-xs sm:flex-none"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Criar conteúdo
        </Button>
      </div>
    </article>
  );
}

export default function EditorialTaskInbox({
  tasks,
  totalTasks,
  scope,
  onScopeChange,
  projectScopeNames,
  responsibleNames,
  loading = false,
  error = false,
  disabled = false,
  onCreateFromTask,
  kanbanHref,
}: EditorialTaskInboxProps) {
  const titleId = useId();
  const contentId = useId();
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(true);
  const isDesignScope = scope === "design";
  const scopeTitle = isDesignScope
    ? "Tarefas de design"
    : "Tarefas do Kanban";
  const filteredTasks = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("pt-BR");
    if (!normalized) return tasks;
    return tasks.filter((task) => {
      const priority =
        priorityConfig[task.priority || ""]?.label || task.priority;
      return [
        task.title,
        task.description,
        projectScopeNames.get(task.project_id),
        responsibleNames.get(task.assigned_to || ""),
        statusLabels[task.status] || task.status,
        priority,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("pt-BR")
        .includes(normalized);
    });
  }, [projectScopeNames, responsibleNames, search, tasks]);

  return (
    <section
      className="w-full min-w-0 overflow-hidden rounded-2xl border border-border bg-card/80 shadow-sm"
      aria-labelledby={titleId}
      aria-busy={loading}
    >
      <header
        className={cn(
          "px-4 py-4 sm:px-5",
          expanded && "border-b border-border",
        )}
      >
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Palette className="h-5 w-5" aria-hidden="true" />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id={titleId}
                className="text-base font-semibold text-foreground"
              >
                {scopeTitle}
              </h2>
              <Badge
                variant="secondary"
                className="h-6 rounded-md px-2 text-[10px] tabular-nums"
                aria-label={`${totalTasks} tarefas no escopo atual`}
              >
                {totalTasks}
              </Badge>
            </div>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
              Vêm do Kanban central e ainda não têm conteúdo vinculado.
              A ordem considera prioridade, etapa e prazo. Arraste para o
              calendário ou crie o conteúdo direto daqui.
            </p>
          </div>

          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-11 w-11 shrink-0"
            onClick={() => setExpanded((value) => !value)}
            aria-label={
              expanded
                ? `Recolher ${scopeTitle.toLocaleLowerCase("pt-BR")}`
                : `Expandir ${scopeTitle.toLocaleLowerCase("pt-BR")}`
            }
            aria-controls={contentId}
            aria-expanded={expanded}
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        </div>

        {expanded && (
          <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
            <div
              className="inline-flex min-h-[52px] w-full shrink-0 items-center rounded-lg border border-border bg-background p-1 sm:w-auto"
              role="group"
              aria-label="Filtrar tarefas por área"
            >
              <button
                type="button"
                onClick={() => onScopeChange("design")}
                aria-pressed={scope === "design"}
                className={cn(
                  "h-11 flex-1 rounded-md px-4 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:flex-none",
                  scope === "design"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                Design
              </button>
              <button
                type="button"
                onClick={() => onScopeChange("all")}
                aria-pressed={scope === "all"}
                className={cn(
                  "h-11 flex-1 rounded-md px-4 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:flex-none",
                  scope === "all"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                Todas
              </button>
            </div>

            <div className="relative min-w-0 flex-1">
              <label htmlFor={searchId} className="sr-only">
                Buscar tarefas
              </label>
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id={searchId}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por tarefa, cliente, projeto ou responsável"
                className="h-11 bg-background pl-10 text-base sm:text-sm"
              />
            </div>

            <Button
              asChild
              variant="outline"
              className="h-11 shrink-0 justify-center px-4 text-xs"
            >
              <Link to={kanbanHref}>
                Abrir Kanban central
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        )}
      </header>

      {expanded && (
        <div id={contentId} className="min-w-0 px-4 py-4 sm:px-5 sm:py-5">
          {loading ? (
            <div
              className="flex gap-3 overflow-hidden"
              role="status"
              aria-label={`Carregando ${scopeTitle.toLocaleLowerCase("pt-BR")}`}
            >
              {[0, 1, 2].map((item) => (
                <div
                  key={item}
                  className="h-64 w-[min(86vw,22rem)] shrink-0 animate-pulse rounded-xl bg-secondary/70 motion-reduce:animate-none sm:w-[22rem]"
                />
              ))}
            </div>
          ) : error ? (
            <div
              className="flex min-h-28 flex-col items-center justify-between gap-4 rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-center sm:flex-row sm:text-left"
              role="alert"
            >
              <div>
                <p className="text-sm font-medium text-foreground">
                  Não foi possível carregar as tarefas
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Abra o Kanban central para continuar ou tente novamente
                  mais tarde.
                </p>
              </div>
              <Button asChild variant="outline" className="h-11 shrink-0">
                <Link to={kanbanHref}>Abrir Kanban central</Link>
              </Button>
            </div>
          ) : filteredTasks.length > 0 ? (
            <div
              className="flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-2 pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [scrollbar-color:hsl(var(--border))_transparent] [scrollbar-width:thin]"
              role="list"
              aria-label={`${filteredTasks.length} tarefas sem conteúdo vinculado`}
              tabIndex={0}
            >
              {filteredTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  projectScopeName={
                    projectScopeNames.get(task.project_id) ||
                    "Cliente / Projeto"
                  }
                  responsibleName={
                    responsibleNames.get(task.assigned_to || "") ||
                    "Sem responsável"
                  }
                  disabled={disabled}
                  onCreate={() => onCreateFromTask(task)}
                />
              ))}
            </div>
          ) : (
            <div className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-border px-4 py-6 text-center">
              <CircleDot
                className="h-6 w-6 text-muted-foreground/50"
                aria-hidden="true"
              />
              <p className="mt-2 text-sm font-medium text-foreground">
                {search ? "Nenhuma tarefa encontrada" : "Tudo organizado"}
              </p>
              <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
                {search
                  ? "Tente buscar por outro nome de tarefa, cliente, projeto ou responsável."
                  : scope === "design"
                    ? "Não há tarefas de design sem conteúdo vinculado neste escopo."
                    : "Não há tarefas do Kanban sem conteúdo vinculado neste escopo."}
              </p>
              {search && (
                <Button
                  type="button"
                  variant="ghost"
                  className="mt-2 h-11 text-xs"
                  onClick={() => setSearch("")}
                >
                  Limpar busca
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
