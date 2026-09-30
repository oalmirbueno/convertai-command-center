import { memo, useState, useEffect, useMemo, useRef, type DragEvent, type MouseEvent as EventoDeMouse } from "react";
import { useSearchParams } from "react-router-dom";
import { useTasks, useTeamMembers, useProjects } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { notifyOpsMilestone, notifyOpsUpdate } from "@/lib/opsSync";
import { notifyOpsTaskUpdated } from "@/lib/opsTaskSync";
import { excluirTarefa } from "@/lib/taskDelete";
import { notifyUser } from "@/lib/notifyHelpers";
import { sendTaskAttachmentsToApproval } from "@/lib/reviewToApproval";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Clock, Plus, X, Paperclip, CalendarIcon, Trash2, MoreVertical, ArrowRight, SlidersHorizontal } from "lucide-react";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import CreateTaskModal from "@/components/admin/CreateTaskModal";
import TaskDetailDrawer from "@/components/admin/TaskDetailDrawer";
import { toast } from "sonner";
import { MenuDeContexto, type ItemDeMenu } from "@/components/ui/menu-de-contexto";
import { useCelular } from "@/hooks/useCelular";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  requestIdFromTaskSource,
  syncClientRequestStatusForTask,
} from "@/lib/requestTaskWorkflow";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  canonicalTaskStatus,
  isEditorialTask,
} from "@/lib/taskWorkstreams";
import {
  TASK_DELIVERY_TYPE_LABELS,
  TASK_DELIVERY_TYPE_OPTIONS,
  type TaskDeliveryType,
} from "@/lib/taskDeliveryTypes";
import {
  AreaDeTrabalho,
  CabecalhoDePagina,
  Carregando,
  EstadoVazio,
  Etapas,
  RegiaoRolavel,
  botao,
  campo,
  etiqueta,
  foco,
  juntar,
  texto,
  useEstadoDaTela,
  lerEstadoDaTela,
  gravarEstadoDaTela,
} from "@/components/sistema";

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

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

const statusLabels: Record<string, string> = {
  backlog: "Backlog",
  doing: "Em Andamento",
  review: "Revisão",
  done: "Concluído",
};

interface KanbanProjectOption {
  id: string;
  name: string;
  client_id: string;
  client?: {
    full_name?: string | null;
    company_name?: string | null;
  } | null;
}

/** Filtros lembrados ao sair e voltar (docs/design/SISTEMA.md, "Estado que não se perde"). */
interface FiltrosGuardados {
  cliente: string;
  projeto: string;
  area: string;
  tipo: string;
  responsavel: string;
  prioridade: string;
  de: string;
  ate: string;
  ordem: string;
}
const ORDENS = ["manual", "title_asc", "title_desc", "due_asc", "due_desc", "priority"];
const filtrosValidos = (v: unknown) => !!v && typeof v === "object" && typeof (v as FiltrosGuardados).cliente === "string";
const dataGuardada = (iso?: string) => {
  if (!iso) return undefined;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? undefined : d;
};

function taskDeliveryTypeLabel(task: {
  delivery_type?: string | null;
}): string | null {
  const deliveryType = task.delivery_type as TaskDeliveryType | null;
  if (!deliveryType || deliveryType === "unspecified") return null;
  return TASK_DELIVERY_TYPE_LABELS[deliveryType] || null;
}

/** Ações do cartão: sempre as do desenho mais recente da página, com identidade fixa. */
type AcoesDoCartao = {
  comecarArrasto: (taskId: string) => void;
  terminarArrasto: () => void;
  passarPorCima: (e: DragEvent<HTMLElement>, taskId: string) => void;
  soltar: (e: DragEvent<HTMLElement>, taskId: string, colId: string) => void;
  abrir: (task: any) => void;
  menu: (e: EventoDeMouse<HTMLElement>, task: any) => void;
  mover: (task: any, colId: string) => void;
  excluir: (task: any) => void;
};

function formatDate(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

/**
 * O cartão da tarefa: o MESMO nos dois layouts (colunas no computador e
 * uma coluna por vez no celular). Arrastar, botão direito, teclado e o
 * menu de três pontos moram aqui, num lugar só.
 *
 * Com memo e props simples (EX-09, 30/09): ao arrastar, só os cartões cuja
 * linha de destino aparece ou some redesenham. Antes, cada troca da posição
 * sob o mouse redesenhava todos os cartões da página.
 */
const CartaoDaTarefa = memo(function CartaoDaTarefa({
  task,
  colId,
  isClient,
  draggable,
  arrastado,
  linhaEmCima,
  linhaEmBaixo,
  anexos,
  editorial,
  acoes,
}: {
  task: any;
  colId: string;
  isClient: boolean;
  draggable: boolean;
  arrastado: boolean;
  linhaEmCima: boolean;
  linhaEmBaixo: boolean;
  anexos: number;
  editorial: boolean;
  acoes: AcoesDoCartao;
}) {
  const podeArrastar = draggable;
  return (
      <div className="relative" data-cartao-da-tarefa={task.id}>
        {linhaEmCima && <div className="mb-1 h-0.5 rounded-full bg-primary" />}
        <div
          role="button"
          tabIndex={0}
          aria-label={`Abrir tarefa ${task.title}`}
          draggable={draggable}
          onDragStart={podeArrastar ? (e) => { e.stopPropagation(); acoes.comecarArrasto(task.id); } : undefined}
          onDragEnd={isClient ? undefined : acoes.terminarArrasto}
          onDragOver={isClient ? undefined : (e) => acoes.passarPorCima(e, task.id)}
          onDragLeave={isClient ? undefined : (e) => {
            e.stopPropagation();
          }}
          onDrop={isClient ? undefined : (e) => acoes.soltar(e, task.id, colId)}
          onClick={() => acoes.abrir(task)}
          onContextMenu={(e) => acoes.menu(e, task)}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              acoes.abrir(task);
            }
          }}
          className={cn(
            "rounded-md border border-border border-l-[3px] bg-card transition-colors hover:border-muted-foreground/30",
            priorityBorderColors[task.priority] || "border-l-border",
            podeArrastar ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
            arrastado && "opacity-40",
            foco,
          )}
        >
          <div className="p-3">
            <p className="text-[13px] font-medium leading-snug text-foreground">{task.title}</p>
            {task.project?.name && <p className={juntar(texto.auxiliar, "mt-0.5 truncate")}>{task.project.name}</p>}
            {(taskDeliveryTypeLabel(task) || editorial || task.status === "blocked" || task.milestone?.title) && (
              <div className="mt-1.5 flex flex-wrap">
                {taskDeliveryTypeLabel(task) ? (
                  <span className={juntar(etiqueta, "mb-1 mr-1 bg-violet-500/10 text-violet-500")}>
                    {taskDeliveryTypeLabel(task)}
                  </span>
                ) : editorial && (
                  <span className={juntar(etiqueta, "mb-1 mr-1 bg-violet-500/10 text-violet-500")}>
                    Design e conteúdo
                  </span>
                )}
                {task.status === "blocked" && (
                  <span className={juntar(etiqueta, "mb-1 mr-1 bg-warning/10 text-warning")}>
                    Bloqueada
                  </span>
                )}
                {task.milestone?.title && (
                  <span className={juntar(etiqueta, "mb-1 mr-1 max-w-full truncate bg-primary/10 text-primary")}>
                    {task.milestone.title}
                  </span>
                )}
              </div>
            )}
            <div className="mt-2 flex items-center justify-between">
              <div className="flex min-w-0 items-center text-[11px] tabular-nums text-muted-foreground">
                {task.due_date && (
                  <span className="mr-2 flex items-center">
                    <Clock className="mr-1 h-3 w-3" aria-hidden="true" />
                    {formatDate(task.due_date)}
                  </span>
                )}
                {anexos > 0 && (
                  <span className="flex items-center" aria-label={`${anexos} anexos`}>
                    <Paperclip className="mr-0.5 h-3 w-3" aria-hidden="true" />
                    {anexos}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center">
                <Avatar className="h-6 w-6" title={task.assignee?.full_name || "Sem responsável"}>
                  <AvatarFallback className="bg-muted text-[11px] font-medium text-muted-foreground">
                    {task.assignee?.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2) || "?"}
                  </AvatarFallback>
                </Avatar>
                {!isClient && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                        className={juntar(botao.icone, "ml-1 h-7 w-7")}
                        aria-label={`Ações da tarefa ${task.title}`}
                        title="Ações da tarefa"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="w-48 p-1"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <p className={juntar(texto.rotulo, "px-2 py-1.5")}>Mover para</p>
                      {columns
                        .filter(
                          (column) =>
                            column.id !== canonicalTaskStatus(task.status),
                        )
                        .map((column) => (
                          <button
                            key={column.id}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              acoes.mover(task, column.id);
                            }}
                            className={juntar("flex w-full items-center rounded px-2 py-2 text-left text-[13px] text-foreground hover:bg-muted", foco)}
                          >
                            <span className={`mr-2 h-1.5 w-1.5 rounded-full ${column.dotColor}`} aria-hidden="true" />
                            {column.title}
                            <ArrowRight className="ml-auto h-3 w-3 text-muted-foreground" aria-hidden="true" />
                          </button>
                        ))}
                      {!requestIdFromTaskSource(task.source) && (
                        <>
                          <div className="my-1 border-t border-border" />
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              acoes.excluir(task);
                            }}
                            className={juntar("flex w-full items-center rounded px-2 py-2 text-left text-[13px] text-destructive hover:bg-destructive/10", foco)}
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                            Excluir
                          </button>
                        </>
                      )}
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            </div>
          </div>
        </div>
        {linhaEmBaixo && <div className="mt-1 h-0.5 rounded-full bg-primary" />}
      </div>
  );
});

export default function Kanban() {
  const { data: tasks, isLoading } = useTasks();
  const { data: teamMembers } = useTeamMembers();
  const { data: projects } = useProjects();
  const { profile } = useAuth();
  const [draggedTask, setDraggedTask] = useState<string | null>(null);
  const draggedTaskRef = useRef<string | null>(null);
  const suppressRealtimeUntilRef = useRef<number>(0);
  const dropInFlightRef = useRef(false);
  const [dropSaving, setDropSaving] = useState(false);
  // Coluna aberta no celular: lembrada ao sair e voltar.
  const [mobileTab, setMobileTab] = useEstadoDaTela("coluna", "backlog", {
    validar: (v) => columns.some((c) => c.id === v),
  });
  const queryClient = useQueryClient();
  const isMobile = useCelular();

  const isClient = profile?.role === "client";

  // ── Realtime subscription (Ops pull is server-side only) ────────────────
  useEffect(() => {
    // A rede de segurança é o refetchInterval de 15 s do useTasks. Um
    // setInterval de 30 s aqui invalidava ["tasks"] de novo e dobrava as
    // releituras da lista inteira (frente PERF-banco, B09).

    // Realtime: any change on tasks table refreshes the board instantly
    const channel = supabase
      .channel("kanban-tasks-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks" },
        () => {
          if (Date.now() < suppressRealtimeUntilRef.current) return;
          queryClient.invalidateQueries({ queryKey: ["tasks"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

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

  // Um caminho só para excluir (guardas + limpeza + aviso ao Ops): o mesmo
  // da Timeline, do modal de edição e do detalhe da tarefa.
  const handleDeleteTask = async () => {
    if (!deleteTask) return;
    const r = await excluirTarefa(deleteTask);
    if (!r.ok) {
      toast.error(r.mensagem);
      setDeleteTask(null);
      return;
    }
    toast.success("Tarefa excluída");
    setDeleteTask(null);
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    queryClient.invalidateQueries({ queryKey: ["ciclo-situacao"] });
  };

  // Filters
  const [searchParams] = useSearchParams();
  const openedTaskParamRef = useRef<string | null>(null);
  // Link com filtro (?client, ?project, ?area, ?type) manda; sem ele, volta o
  // que a pessoa tinha escolhido da última vez.
  const [guardado] = useState<FiltrosGuardados | null>(() =>
    ["client", "project", "area", "type", "task"].some((k) => searchParams.get(k))
      ? null
      : lerEstadoDaTela<FiltrosGuardados | null>("filtros", null, filtrosValidos),
  );
  const [filterClient, setFilterClient] = useState(searchParams.get("client") || guardado?.cliente || "");
  const [filterProject, setFilterProject] = useState(searchParams.get("project") || guardado?.projeto || "");
  const [filterArea, setFilterArea] = useState(searchParams.get("area") || guardado?.area || "");
  const [filterDeliveryType, setFilterDeliveryType] = useState(
    searchParams.get("type") || guardado?.tipo || "",
  );
  const [filterAssignee, setFilterAssignee] = useState(guardado?.responsavel || "");
  const [filterPriority, setFilterPriority] = useState(guardado?.prioridade || "");
  const [filterDateFrom, setFilterDateFrom] = useState<Date | undefined>(dataGuardada(guardado?.de));
  const [filterDateTo, setFilterDateTo] = useState<Date | undefined>(dataGuardada(guardado?.ate));
  const [sortBy, setSortBy] = useState<"manual" | "title_asc" | "title_desc" | "due_asc" | "due_desc" | "priority">(
    guardado && ORDENS.indexOf(guardado.ordem) >= 0 ? (guardado.ordem as "manual") : "manual",
  );
  useEffect(() => {
    gravarEstadoDaTela<FiltrosGuardados>("filtros", {
      cliente: filterClient,
      projeto: filterProject,
      area: filterArea,
      tipo: filterDeliveryType,
      responsavel: filterAssignee,
      prioridade: filterPriority,
      de: filterDateFrom ? filterDateFrom.toISOString() : "",
      ate: filterDateTo ? filterDateTo.toISOString() : "",
      ordem: sortBy,
    });
  }, [filterClient, filterProject, filterArea, filterDeliveryType, filterAssignee, filterPriority, filterDateFrom, filterDateTo, sortBy]);

  useEffect(() => {
    const requestedTaskId = searchParams.get("task");
    if (!requestedTaskId) {
      openedTaskParamRef.current = null;
      return;
    }
    if (openedTaskParamRef.current === requestedTaskId || !tasks) {
      return;
    }

    const requestedTask = tasks.find(
      (task: any) => task.id === requestedTaskId,
    );
    if (!requestedTask) return;

    openedTaskParamRef.current = requestedTaskId;
    setFilterProject(requestedTask.project_id || "");
    setDetailTask(requestedTask);
  }, [searchParams, tasks]);

  const projectRows = useMemo(
    () => (projects || []) as KanbanProjectOption[],
    [projects],
  );
  const clientOptions = useMemo(
    () =>
      Array.from(
        new Map(
          projectRows.map((project) => [
            project.client_id,
            project.client?.company_name ||
              project.client?.full_name ||
              "Cliente",
          ]),
        ),
      )
        .map(([id, name]) => ({ id, name }))
        .sort((left, right) =>
          left.name.localeCompare(right.name, "pt-BR"),
        ),
    [projectRows],
  );
  const visibleProjectOptions = filterClient
    ? projectRows.filter((project) => project.client_id === filterClient)
    : projectRows;
  const projectClientById = useMemo(
    () => new Map(projectRows.map((project) => [project.id, project.client_id])),
    [projectRows],
  );
  const hasFilters = filterClient || filterProject || filterArea || filterDeliveryType || filterAssignee || filterPriority || filterDateFrom || filterDateTo || sortBy !== "manual";
  const dragBlockedByFilters = Boolean(
    filterClient ||
      filterProject ||
      filterArea ||
      filterDeliveryType ||
      filterAssignee ||
      filterPriority ||
      filterDateFrom ||
      filterDateTo ||
      sortBy !== "manual",
  );
  const designMemberIds = useMemo(
    () =>
      new Set(
        (teamMembers || [])
          .filter(
            (member: { role?: string | null }) =>
              member.role === "design",
          )
          .map((member: { id: string }) => member.id),
      ),
    [teamMembers],
  );

  // Refiltrar 1.290 tarefas só quando a lista ou um filtro muda (e não a
  // cada troca da posição sob o mouse durante o arrasto).
  const filteredTasks = useMemo(() => (tasks || []).filter((t: any) => {
    if (
      filterClient &&
      projectClientById.get(t.project_id) !== filterClient
    ) {
      return false;
    }
    if (filterProject && t.project_id !== filterProject) return false;
    if (
      filterDeliveryType
      && t.delivery_type !== filterDeliveryType
    ) {
      return false;
    }
    if (
      filterArea === "editorial" &&
      !isEditorialTask(t, designMemberIds)
    ) {
      return false;
    }
    if (
      filterArea &&
      filterArea !== "editorial" &&
      t.workstream !== filterArea
    ) {
      return false;
    }
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
    if (sortBy === "title_asc") return (a.title || "").localeCompare(b.title || "", "pt-BR");
    if (sortBy === "title_desc") return (b.title || "").localeCompare(a.title || "", "pt-BR");
    if (sortBy === "due_asc" || sortBy === "due_desc") {
      const av = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER;
      const bv = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER;
      return sortBy === "due_asc" ? av - bv : bv - av;
    }
    if (sortBy === "priority") {
      return (PRIORITY_RANK[a.priority] ?? 99) - (PRIORITY_RANK[b.priority] ?? 99);
    }
    // manual: task_order then due_date
    const ao = a.task_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.task_order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
  }), [tasks, filterClient, filterProject, filterDeliveryType, filterArea, filterAssignee, filterPriority, filterDateFrom, filterDateTo, sortBy, projectClientById, designMemberIds]);

  // Drag-over indicator: which task and which side
  const [dragOver, setDragOver] = useState<{ id: string; position: "top" | "bottom" } | null>(null);
  const acoesRef = useRef<AcoesDoCartao | null>(null);
  const acoesDoCartao = useMemo<AcoesDoCartao>(
    () => ({
      comecarArrasto: (taskId) => acoesRef.current?.comecarArrasto(taskId),
      terminarArrasto: () => acoesRef.current?.terminarArrasto(),
      passarPorCima: (e, taskId) => acoesRef.current?.passarPorCima(e, taskId),
      soltar: (e, taskId, colId) => acoesRef.current?.soltar(e, taskId, colId),
      abrir: (task) => acoesRef.current?.abrir(task),
      menu: (e, task) => acoesRef.current?.menu(e, task),
      mover: (task, colId) => acoesRef.current?.mover(task, colId),
      excluir: (task) => acoesRef.current?.excluir(task),
    }),
    [],
  );

  const persistColumnOrder = async (
    columnId: string,
    orderedIds: string[],
    statusOverrides: Record<string, string> = {},
  ) => {
    const taskStatusById = new Map(
      (tasks || []).map(
        (task: { id: string; status: string }) => [
          task.id,
          task.status,
        ],
      ),
    );
    const results = await Promise.all(
      orderedIds.map(async (id, i) => {
        const expectedStatus =
          statusOverrides[id] || taskStatusById.get(id);
        if (
          !expectedStatus ||
          canonicalTaskStatus(expectedStatus) !== columnId
        ) {
          throw new Error(
            "A coluna da tarefa mudou em outra sessão. Atualize o Kanban.",
          );
        }
        return supabase
          .from("tasks")
          .update({ task_order: (i + 1) * 10 })
          .eq("id", id)
          .eq("status", expectedStatus)
          .select("id")
          .maybeSingle();
      }),
    );
    const failed = results.find((result) => result.error || !result.data);
    if (failed?.error) throw failed.error;
    if (failed && !failed.data) {
      throw new Error("Uma tarefa não foi encontrada ou não pode ser alterada.");
    }
  };

  const persistTaskStatus = async (
    taskId: string,
    taskStatus: string,
    nextStatus: string,
    taskOrder: number | null | undefined,
  ) => {
    const { data, error } = await supabase
      .from("tasks")
      .update({
        status: nextStatus,
        task_order: taskOrder ?? null,
      })
      .eq("id", taskId)
      .eq("status", taskStatus)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new Error(
        "A tarefa mudou em outra sessão. Atualize o Kanban antes de continuar.",
      );
    }
  };

  const syncLinkedRequest = async (
    task: any,
    taskStatus: string,
  ) => {
    try {
      const result = await syncClientRequestStatusForTask({
        taskId: task.id,
        projectId: task.project_id,
        source: task.source,
        taskStatus,
      });
      if (result.synced) {
        queryClient.invalidateQueries({ queryKey: ["client-requests"] });
      }
      return true;
    } catch (error) {
      console.error("Client request sync failed", error);
      return false;
    }
  };

  const handleDragStart = (taskId: string) => {
    if (isClient) return;
    if (dropInFlightRef.current) {
      toast.info("Aguarde a movimentação anterior terminar.");
      return;
    }
    if (dragBlockedByFilters) {
      toast.info("Limpe os filtros e use a ordem manual para arrastar tarefas.");
      return;
    }
    draggedTaskRef.current = taskId;
    setDraggedTask(taskId);
  };

  const handleDrop = async (column: string, dropIndex?: number) => {
    const activeDragId = draggedTaskRef.current || draggedTask;
    if (isClient || !activeDragId) return;
    const task = (tasks || []).find((t: any) => t.id === activeDragId);
    if (!task) return;
    if (dropInFlightRef.current || dragBlockedByFilters) {
      setDraggedTask(null);
      draggedTaskRef.current = null;
      return;
    }
    dropInFlightRef.current = true;
    setDropSaving(true);
    const previousStatus = task.status;
    const previousColumn = canonicalTaskStatus(previousStatus);
    const movedAcrossColumns = previousColumn !== column;
    const originalSourceIds = filteredTasks
      .filter(
        (candidate: any) =>
          canonicalTaskStatus(candidate.status) === previousColumn,
      )
      .map((candidate: any) => candidate.id);
    const originalDestinationIds = !movedAcrossColumns
      ? originalSourceIds
      : filteredTasks
        .filter(
          (candidate: any) =>
            canonicalTaskStatus(candidate.status) === column,
        )
        .map((candidate: any) => candidate.id);
    const linkedRequestId = requestIdFromTaskSource(task.source);

    // Rebuild destination column ordering
    const destTasks = filteredTasks.filter(
      (t: any) =>
        canonicalTaskStatus(t.status) === column &&
        t.id !== activeDragId,
    );
    const insertAt = dropIndex == null ? destTasks.length : Math.min(Math.max(dropIndex, 0), destTasks.length);
    const newDestIds = [
      ...destTasks.slice(0, insertAt).map((t: any) => t.id),
      activeDragId,
      ...destTasks.slice(insertAt).map((t: any) => t.id),
    ];
    const srcIds = filteredTasks
      .filter(
        (t: any) =>
          canonicalTaskStatus(t.status) === previousColumn &&
          t.id !== activeDragId,
      )
      .map((t: any) => t.id);
    const restoreOriginalColumnOrders = async () => {
      if (movedAcrossColumns) {
        await persistTaskStatus(
          activeDragId,
          column,
          previousStatus,
          task.task_order,
        );
      }
      await persistColumnOrder(previousColumn, originalSourceIds);
      if (movedAcrossColumns) {
        await persistColumnOrder(column, originalDestinationIds);
      }
    };

    setDragOver(null);
    setDraggedTask(null);
    draggedTaskRef.current = null;

    // ── Optimistic update: reorder the cache immediately so UI is instant ──
    const destOrder: Record<string, number> = {};
    newDestIds.forEach((id, i) => { destOrder[id] = (i + 1) * 10; });
    const srcOrder: Record<string, number> = {};
    srcIds.forEach((id, i) => { srcOrder[id] = (i + 1) * 10; });

    queryClient.setQueriesData({ queryKey: ["tasks"] }, (old: any) => {
      if (!Array.isArray(old)) return old;
      return old.map((t: any) => {
        if (t.id === activeDragId) {
          return {
            ...t,
            status: movedAcrossColumns ? column : t.status,
            task_order: destOrder[t.id],
          };
        }
        if (destOrder[t.id] != null) return { ...t, task_order: destOrder[t.id] };
        if (movedAcrossColumns && srcOrder[t.id] != null) return { ...t, task_order: srcOrder[t.id] };
        return t;
      });
    });

    // ── Persist in background (fire-and-forget) ──
    suppressRealtimeUntilRef.current = Date.now() + 2500;
    (async () => {
      try {
        let rollbackNeeded = !movedAcrossColumns;
        try {
          if (!movedAcrossColumns) {
            await persistColumnOrder(column, newDestIds);
          } else {
            await persistTaskStatus(
              activeDragId,
              previousStatus,
              column,
              destOrder[activeDragId],
            );
            rollbackNeeded = true;
            await persistColumnOrder(column, newDestIds, {
              [activeDragId]: column,
            });
            await persistColumnOrder(previousColumn, srcIds);
          }

          if (movedAcrossColumns) {
            const requestSyncOk = await syncLinkedRequest(task, column);
            if (!requestSyncOk) {
              throw new Error("REQUEST_SYNC_FAILED");
            }
          }
        } catch (coreError) {
          console.error("Drop persist failed", coreError);
          let taskRollbackSucceeded = !rollbackNeeded;
          if (rollbackNeeded) {
            try {
              await restoreOriginalColumnOrders();
              taskRollbackSucceeded = true;
              toast.error(
                coreError instanceof Error
                  && coreError.message === "REQUEST_SYNC_FAILED"
                  ? "O pedido não pôde ser sincronizado; a movimentação da tarefa foi revertida."
                  : "Erro ao salvar; a movimentação foi revertida.",
              );
            } catch (rollbackError) {
              console.error("Drop rollback failed", rollbackError);
              toast.error(
                "Falha crítica ao salvar e reverter a movimentação. Atualize a tela.",
              );
            }
          } else {
            toast.error(
              coreError instanceof Error
                ? coreError.message
                : "Não foi possível salvar a movimentação.",
            );
          }
          if (
            taskRollbackSucceeded
            && linkedRequestId
            && movedAcrossColumns
          ) {
            try {
              await syncClientRequestStatusForTask({
                taskId: task.id,
                projectId: task.project_id,
                source: task.source,
                taskStatus: previousStatus,
              });
              queryClient.invalidateQueries({ queryKey: ["client-requests"] });
            } catch (requestRollbackError) {
              console.error("Client request rollback failed", requestRollbackError);
              toast.error(
                "A tarefa voltou, mas o pedido precisa ser reconciliado. Atualize a tela antes de continuar.",
              );
            }
          }
          queryClient.invalidateQueries({ queryKey: ["tasks"] });
          return;
        }

        try {
          if (!linkedRequestId) {
            notifyOpsTaskUpdated(activeDragId);
          }

          const { data: { user: authUser } } = await supabase.auth.getUser();

          if (["review", "done"].includes(column) && task.project_id && authUser && movedAcrossColumns) {
            await sendTaskAttachmentsToApproval(task.id, task.project_id, task.title, authUser.id);
            queryClient.invalidateQueries({ queryKey: ["all-files"] });
            queryClient.invalidateQueries({ queryKey: ["files"] });
          }

          if (column === "done" && movedAcrossColumns && task.project_id) {
            if (authUser) {
              const { data: upd } = await supabase.from("updates").insert({
                project_id: task.project_id, author_id: authUser.id,
                message: `"${task.title}" concluída`, update_type: "task",
              }).select().single();
              if (!linkedRequestId) notifyOpsUpdate(upd);
            }
            if (task.assigned_to && authUser && task.assigned_to !== authUser.id) {
              await notifyUser(task.assigned_to, `Tarefa "${task.title}" marcada como concluída`, "task", "/kanban");
            }
            const { notifyAdmin } = await import("@/lib/notifyHelpers");
            if (authUser) {
              await notifyAdmin(`Tarefa "${task.title}" concluída por ${profile?.full_name || "equipe"}`, "task", "/kanban");
            }
          }

          if (movedAcrossColumns && column !== "done") {
            const { notifyAdmin } = await import("@/lib/notifyHelpers");
            if (authUser && !profile?.role?.includes("admin")) {
              await notifyAdmin(`${profile?.full_name || "Membro"} moveu "${task.title}" para ${columns.find(c => c.id === column)?.title || column}`, "task", "/kanban");
            }
          }

          if (task.assigned_to && authUser && task.assigned_to !== authUser.id && movedAcrossColumns) {
            await notifyUser(task.assigned_to, `Tarefa "${task.title}" movida para ${columns.find(c => c.id === column)?.title || column}`, "task", "/kanban");
          }

          if (movedAcrossColumns) {
            queryClient.invalidateQueries({ queryKey: ["milestones"] });
            queryClient.invalidateQueries({ queryKey: ["milestones-all"] });
            queryClient.invalidateQueries({ queryKey: ["projects"] });
          }
        } catch (sideEffectError) {
          console.error("Post-move side effects failed", sideEffectError);
          toast.error(
            "A tarefa foi movida, mas uma etapa auxiliar falhou. Atualize a tela antes de repetir qualquer ação.",
          );
        }
      } finally {
        dropInFlightRef.current = false;
        setDropSaving(false);
      }
    })();
  };



  /**
   * Botão direito no cartão: as MESMAS ações do menu de três pontos, mais
   * o copiar. Mover chama changeStatus e excluir passa pela mesma
   * confirmação — menu paralelo com lógica própria divergiria do
   * principal no primeiro conserto.
   */
  const [menuTarefa, setMenuTarefa] = useState<{ x: number; y: number; task: any } | null>(null);

  function itensDaTarefa(task: any): ItemDeMenu[] {
    const itens: ItemDeMenu[] = [
      { rotulo: "Abrir tarefa", acao: () => handleCardClick(task) },
      {
        rotulo: "Copiar título",
        acao: () => {
          void navigator.clipboard
            .writeText([task.title, task.project?.name].filter(Boolean).join(" — "))
            .then(() => toast.success("Título copiado."))
            .catch(() => toast.error("Não foi possível copiar."));
        },
      },
    ];
    if (!isClient) {
      itens.push({ separador: true });
      for (const c of columns) {
        if (c.id === canonicalTaskStatus(task.status)) continue;
        itens.push({ rotulo: `Mover para ${c.title}`, acao: () => void changeStatus(task, c.id) });
      }
      if (!requestIdFromTaskSource(task.source)) {
        itens.push({ separador: true });
        itens.push({ rotulo: "Excluir", destrutivo: true, acao: () => setDeleteTask(task) });
      }
    }
    return itens;
  }

  const handleCardClick = (task: any) => {
    setDetailTask(task);
  };

  const changeStatus = async (task: any, newStatus: string) => {
    if (canonicalTaskStatus(task.status) === newStatus) return;
    if (dropInFlightRef.current) {
      toast.info("Aguarde a movimentação anterior terminar.");
      return;
    }
    dropInFlightRef.current = true;
    setDropSaving(true);
    try {
      const { data: updatedTask, error } = await supabase
        .from("tasks")
        .update({ status: newStatus })
        .eq("id", task.id)
        .eq("status", task.status)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!updatedTask) {
        throw new Error("A tarefa não foi encontrada ou não pode ser alterada.");
      }
      const requestSyncOk = await syncLinkedRequest(
        task,
        newStatus,
      );
      suppressRealtimeUntilRef.current = Date.now() + 2000;
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      if (requestSyncOk) {
        toast.success(`Movido para ${statusLabels[newStatus] || newStatus}`);
      } else {
        try {
          await persistTaskStatus(
            task.id,
            newStatus,
            task.status,
            task.task_order,
          );
          queryClient.invalidateQueries({ queryKey: ["tasks"] });
          toast.error(
            "O pedido não pôde ser sincronizado; a movimentação da tarefa foi revertida.",
          );
        } catch (rollbackError) {
          console.error("Task status rollback failed", rollbackError);
          toast.error(
            "Falha crítica ao sincronizar o pedido e reverter a tarefa. Atualize a tela antes de continuar.",
          );
        }
      }
    } catch (e) {
      console.error(e);
      toast.error("Erro ao mover tarefa");
    } finally {
      dropInFlightRef.current = false;
      setDropSaving(false);
    }
  };

  // Celular: uma coluna por vez (Etapas no topo) e a página rola normal. O
  // deslize para o lado troca de coluna, como no carrossel antigo, sem caixa
  // com rolagem própria prendendo o dedo.
  const toqueInicial = useRef<{ x: number; y: number } | null>(null);
  const stepMobileColumn = (dir: -1 | 1) => {
    const idx = Math.max(0, columns.findIndex(c => c.id === mobileTab));
    const next = columns[Math.min(columns.length - 1, Math.max(0, idx + dir))];
    if (next) setMobileTab(next.id);
  };

  const tarefasPorColuna = useMemo(() => {
    const porColuna: Record<string, any[]> = {};
    filteredTasks.forEach((t: any) => {
      const colId = canonicalTaskStatus(t.status);
      (porColuna[colId] = porColuna[colId] || []).push(t);
    });
    return porColuna;
  }, [filteredTasks]);
  const tarefasDaColuna = (colId: string): any[] => tarefasPorColuna[colId] || [];

  const Modals = (
    <>
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
      {menuTarefa && (
        <MenuDeContexto
          x={menuTarefa.x}
          y={menuTarefa.y}
          itens={itensDaTarefa(menuTarefa.task)}
          aoFechar={() => setMenuTarefa(null)}
        />
      )}
      <ConfirmModal
        open={!!deleteTask}
        title="Excluir tarefa"
        description={`Tem certeza que deseja excluir "${deleteTask?.title}"? Esta ação removerá comentários, checklists e anexos vinculados.`}
        onConfirm={handleDeleteTask}
        onCancel={() => setDeleteTask(null)}
      />
    </>
  );

  const limparFiltros = () => {
    setFilterClient(""); setFilterProject(""); setFilterArea(""); setFilterDeliveryType(""); setFilterAssignee(""); setFilterPriority(""); setFilterDateFrom(undefined); setFilterDateTo(undefined); setSortBy("manual");
  };
  const filtrosExtras = [filterArea, filterDeliveryType, filterAssignee, filterPriority, filterDateFrom, filterDateTo, sortBy !== "manual" ? sortBy : ""].filter(Boolean).length;
  const campoDoFiltro = juntar(campo, "h-9 pr-8");

  // Filtros: cliente e projeto à vista; o resto num seletor "Filtros" (mais de 4 opções vira seletor).
  const FiltersBar = (
    <div className="flex min-w-0 items-center" role="group" aria-label="Filtros do Kanban">
      <select
        aria-label="Cliente"
        value={filterClient}
        onChange={(e) => {
          const nextClientId = e.target.value;
          setFilterClient(nextClientId);
          if (
            filterProject &&
            projectClientById.get(filterProject) !== nextClientId
          ) {
            setFilterProject("");
          }
        }}
        className={juntar(campoDoFiltro, "mr-2 min-w-0 flex-1 sm:w-[200px] sm:flex-none")}
      >
        <option value="">Clientes</option>
        {clientOptions.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Projeto"
        value={filterProject}
        onChange={(e) => setFilterProject(e.target.value)}
        className={juntar(campoDoFiltro, "mr-2 min-w-0 flex-1 sm:w-[200px] sm:flex-none")}
      >
        <option value="">Projetos</option>
        {visibleProjectOptions.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={juntar(botao.secundario, "px-2.5")}
            aria-label={`Mais filtros, ${filtrosExtras} ${filtrosExtras === 1 ? "ativo" : "ativos"}`}
          >
            <SlidersHorizontal className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Filtros</span>
            {filtrosExtras > 0 && (
              <span className="ml-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold tabular-nums text-primary-foreground">
                {filtrosExtras}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[calc(100vw-24px)] max-w-[360px] p-3">
          <div className="mb-3 flex items-center justify-between">
            <p className={texto.tituloSecao}>Filtros</p>
            <button type="button" onClick={limparFiltros} disabled={!hasFilters} className={juntar(botao.discreto, "h-8 px-2 text-[12px]")}>
              <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Limpar
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {!isClient && (
              <label className="col-span-2 block min-w-0 sm:col-span-1">
                <span className={juntar(texto.rotulo, "mb-1 block")}>Área</span>
                <select
                  value={filterArea}
                  onChange={(e) => setFilterArea(e.target.value)}
                  className={campoDoFiltro}
                  title="Filtrar por área"
                >
                  <option value="">Todas as áreas</option>
                  <option value="editorial">Design e conteúdo</option>
                  <option value="traffic">Tráfego</option>
                  <option value="development">Desenvolvimento</option>
                  <option value="operations">Operações</option>
                  <option value="general">Geral</option>
                </select>
              </label>
            )}
            {!isClient && (
              <label className="col-span-2 block min-w-0 sm:col-span-1">
                <span className={juntar(texto.rotulo, "mb-1 block")}>Tipo de entrega</span>
                <select
                  value={filterDeliveryType}
                  onChange={(event) => setFilterDeliveryType(event.target.value)}
                  className={campoDoFiltro}
                  title="Filtrar por tipo de entrega"
                >
                  <option value="">Todos os tipos</option>
                  {TASK_DELIVERY_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!isClient && (
              <label className="col-span-2 block min-w-0 sm:col-span-1">
                <span className={juntar(texto.rotulo, "mb-1 block")}>Responsável</span>
                <select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)} className={campoDoFiltro}>
                  <option value="">Todos os responsáveis</option>
                  {(teamMembers || []).map((m: any) => (<option key={m.id} value={m.id}>{m.full_name}</option>))}
                </select>
              </label>
            )}
            <label className="col-span-2 block min-w-0 sm:col-span-1">
              <span className={juntar(texto.rotulo, "mb-1 block")}>Prioridade</span>
              <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} className={campoDoFiltro}>
                <option value="">Todas prioridades</option>
                <option value="urgent">Urgente</option>
                <option value="high">Alta</option>
                <option value="medium">Média</option>
                <option value="low">Baixa</option>
              </select>
            </label>
            <div className="min-w-0">
              <span className={juntar(texto.rotulo, "mb-1 block")}>Prazo de</span>
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className={juntar(campo, "flex items-center text-left", !filterDateFrom && "text-muted-foreground")}>
                    <CalendarIcon className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {filterDateFrom ? format(filterDateFrom, "dd/MM") : "De"}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={filterDateFrom} onSelect={setFilterDateFrom} className={cn("p-3 pointer-events-auto")} />
                </PopoverContent>
              </Popover>
            </div>
            <div className="min-w-0">
              <span className={juntar(texto.rotulo, "mb-1 block")}>até</span>
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className={juntar(campo, "flex items-center text-left", !filterDateTo && "text-muted-foreground")}>
                    <CalendarIcon className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {filterDateTo ? format(filterDateTo, "dd/MM") : "Até"}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={filterDateTo} onSelect={setFilterDateTo} className={cn("p-3 pointer-events-auto")} />
                </PopoverContent>
              </Popover>
            </div>
            <label className="col-span-2 block min-w-0">
              <span className={juntar(texto.rotulo, "mb-1 block")}>Ordem</span>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className={campoDoFiltro} title="Ordenar">
                <option value="manual">Ordem manual</option>
                <option value="title_asc">Título A-Z</option>
                <option value="title_desc">Título Z-A</option>
                <option value="due_asc">Prazo ↑</option>
                <option value="due_desc">Prazo ↓</option>
                <option value="priority">Prioridade</option>
              </select>
            </label>
          </div>
        </PopoverContent>
      </Popover>
      {hasFilters && (
        <button type="button" onClick={limparFiltros} className={juntar(botao.icone, "ml-1")} aria-label="Limpar filtros" title="Limpar filtros">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  /** O cartão (CartaoDaTarefa, fora da página) com as props que mudam o desenho dele. */
  const renderCartao = (task: any, col: (typeof columns)[number], colTasks: any[]) => (
    <CartaoDaTarefa
      key={task.id}
      task={task}
      colId={col.id}
      isClient={isClient}
      draggable={!isClient && !dragBlockedByFilters && !dropSaving}
      arrastado={draggedTask === task.id}
      linhaEmCima={dragOver?.id === task.id && dragOver.position === "top"}
      linhaEmBaixo={dragOver?.id === task.id && dragOver.position === "bottom"}
      anexos={(attachmentCounts || {})[task.id] || 0}
      editorial={isEditorialTask(task, designMemberIds)}
      acoes={acoesDoCartao}
    />
  );

  // Refeitas a cada desenho (enxergam o estado atual); o cartão chama por
  // acoesDoCartao, que não muda, e por isso não redesenha à toa.
  acoesRef.current = {
    comecarArrasto: (taskId) => handleDragStart(taskId),
    terminarArrasto: () => { setDraggedTask(null); draggedTaskRef.current = null; setDragOver(null); },
    passarPorCima: (e, taskId) => {
      e.preventDefault();
      const active = draggedTaskRef.current || draggedTask;
      if (!active || active === taskId) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const position = e.clientY < rect.top + rect.height / 2 ? "top" : "bottom";
      setDragOver((prev) => (prev?.id === taskId && prev.position === position ? prev : { id: taskId, position }));
    },
    soltar: (e, taskId, colId) => {
      e.preventDefault();
      e.stopPropagation();
      const position = dragOver?.id === taskId ? dragOver.position : "bottom";
      const others = tarefasDaColuna(colId).filter((t: any) => t.id !== (draggedTaskRef.current || draggedTask));
      const targetIdx = others.findIndex((t: any) => t.id === taskId);
      const insertAt = position === "top" ? targetIdx : targetIdx + 1;
      handleDrop(colId, insertAt);
    },
    abrir: (task) => handleCardClick(task),
    menu: (e, task) => { e.preventDefault(); setMenuTarefa({ x: e.clientX, y: e.clientY, task }); },
    mover: (task, colId) => void changeStatus(task, colId),
    excluir: (task) => setDeleteTask(task),
  };

  const cabecalho = (
    <CabecalhoDePagina
      titulo="Kanban"
      ajuda="Todas as tarefas da equipe por etapa. Arraste o cartão para mudar de coluna ou de ordem (com os filtros limpos e a ordem manual). Botão direito no cartão abre o menu."
      descricao={isLoading ? undefined : `${filteredTasks.length} ${filteredTasks.length === 1 ? "tarefa" : "tarefas"}${hasFilters ? " com filtros" : ""}${dropSaving ? " · salvando" : ""}`}
      acoes={
        // No computador os filtros sobem para a linha do título (uma linha a
        // menos); no celular ficam na linha de baixo, que é a largura toda.
        !isClient || !isMobile ? (
          <>
            {!isMobile && FiltersBar}
            {!isClient && (
              <button
                type="button"
                data-tour="kanban-create-btn"
                onClick={() => setCreateStatus(isMobile ? mobileTab : "backlog")}
                className={botao.primario}
                aria-label="Nova tarefa"
              >
                <Plus className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                <span className="hidden sm:inline">Nova tarefa</span>
              </button>
            )}
          </>
        ) : undefined
      }
    />
  );

  // ═══ CELULAR: uma coluna por vez, a página rola normal ═══
  if (isMobile) {
    const col = columns.find((c) => c.id === mobileTab) || columns[0];
    const colTasks = tarefasDaColuna(col.id);
    return (
      <div className="min-w-0">
        {cabecalho}
        <div className="mt-3">{FiltersBar}</div>
        <Etapas
          className="mt-3 border-b border-border"
          rotulo="Colunas do Kanban"
          itens={columns.map((c) => ({ valor: c.id, rotulo: c.title, contador: isLoading ? null : tarefasDaColuna(c.id).length }))}
          valor={col.id}
          onEscolher={setMobileTab}
        />
        <div
          className="mt-3 min-h-[50vh] space-y-2 pb-4"
          onTouchStart={(e) => {
            const t = e.touches[0];
            toqueInicial.current = t ? { x: t.clientX, y: t.clientY } : null;
          }}
          onTouchEnd={(e) => {
            const inicio = toqueInicial.current;
            const t = e.changedTouches[0];
            toqueInicial.current = null;
            if (!inicio || !t) return;
            const dx = t.clientX - inicio.x;
            const dy = t.clientY - inicio.y;
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) stepMobileColumn(dx < 0 ? 1 : -1);
          }}
          onDragOver={isClient ? undefined : (e) => e.preventDefault()}
          onDrop={isClient ? undefined : () => handleDrop(col.id)}
        >
          {isLoading ? (
            <Carregando rotulo="Carregando tarefas" linhas={4} />
          ) : colTasks.length === 0 ? (
            <EstadoVazio
              compacto
              titulo="Sem tarefas nesta coluna."
              acao={!isClient ? (
                <button type="button" onClick={() => setCreateStatus(col.id)} className={botao.discreto} aria-label={`Nova tarefa em ${col.title}`}>
                  <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Nova
                </button>
              ) : undefined}
            />
          ) : (
            colTasks.map((task: any) => renderCartao(task, col, colTasks))
          )}
        </div>
        {Modals}
      </div>
    );
  }

  // ═══ COMPUTADOR: quatro colunas; cada uma rola sozinha de 1024 px para cima ═══
  return (
    <div className="min-w-0">
      {cabecalho}

      <AreaDeTrabalho principalRolavel={false} className="mt-4">
        {!isLoading && (tasks || []).length === 0 ? (
          <EstadoVazio
            titulo="Nenhuma tarefa ainda."
            acao={!isClient ? (
              <button type="button" onClick={() => setCreateStatus("backlog")} className={botao.primario}>Nova tarefa</button>
            ) : undefined}
          />
        ) : (
          <div
            className="grid min-w-0 gap-4 md:grid-cols-2 lg:h-full lg:min-h-0 lg:grid-cols-4 lg:grid-rows-[minmax(0,1fr)]"
            data-tour="kanban-board"
          >
            {columns.map((col) => {
              const colTasks = tarefasDaColuna(col.id);
              return (
                <section
                  key={col.id}
                  aria-label={col.title}
                  className="flex min-w-0 flex-col lg:min-h-0"
                  onDragOver={isClient ? undefined : (e) => e.preventDefault()}
                  onDrop={isClient ? undefined : () => handleDrop(col.id)}
                >
                  <div className="mb-2 flex h-8 shrink-0 items-center px-0.5">
                    <span aria-hidden="true" className={`mr-2 h-1.5 w-1.5 rounded-full ${col.dotColor}`} />
                    <h2 className={juntar(texto.rotulo, "text-foreground")}>{col.title}</h2>
                    <span className="ml-2 text-[11px] tabular-nums text-muted-foreground">{isLoading ? "" : colTasks.length}</span>
                    {!isClient && (
                      <button
                        type="button"
                        onClick={() => setCreateStatus(col.id)}
                        className={juntar(botao.icone, "ml-auto h-7 w-7")}
                        aria-label={`Nova tarefa em ${col.title}`}
                        title={`Nova tarefa em ${col.title}`}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <RegiaoRolavel
                    rotulo={`Tarefas em ${col.title}`}
                    memoria={`kanban:coluna:${col.id}`}
                    className="min-h-[120px] space-y-2 pb-16 lg:pr-1"
                  >
                    {isLoading ? (
                      <Carregando rotulo={`Carregando ${col.title}`} linhas={3} />
                    ) : colTasks.length === 0 ? (
                      <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-border px-3 text-center">
                        <p className={texto.auxiliar}>{isClient ? "Sem tarefas." : "Sem tarefas. Arraste para cá."}</p>
                      </div>
                    ) : (
                      colTasks.map((task: any) => renderCartao(task, col, colTasks))
                    )}
                  </RegiaoRolavel>
                </section>
              );
            })}
          </div>
        )}
      </AreaDeTrabalho>

      {Modals}
    </div>
  );
}
