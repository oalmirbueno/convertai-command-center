import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useTasks, useTeamMembers, useProjects } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { notifyOpsMilestone, notifyOpsUpdate } from "@/lib/opsSync";
import { notifyOpsTaskUpdated, notifyOpsTaskDeleted } from "@/lib/opsTaskSync";
import { notifyUser } from "@/lib/notifyHelpers";
import { sendTaskAttachmentsToApproval } from "@/lib/reviewToApproval";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Clock, Plus, Filter, X, Paperclip, CalendarIcon, Trash2, ChevronUp, ChevronDown, MoreVertical, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import CreateTaskModal from "@/components/admin/CreateTaskModal";
import TaskDetailDrawer from "@/components/admin/TaskDetailDrawer";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
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

interface KanbanProjectOption {
  id: string;
  name: string;
  client_id: string;
  client?: {
    full_name?: string | null;
    company_name?: string | null;
  } | null;
}

function taskDeliveryTypeLabel(task: {
  delivery_type?: string | null;
}): string | null {
  const deliveryType = task.delivery_type as TaskDeliveryType | null;
  if (!deliveryType || deliveryType === "unspecified") return null;
  return TASK_DELIVERY_TYPE_LABELS[deliveryType] || null;
}

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
  const [mobileTab, setMobileTab] = useState("backlog");
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const isClient = profile?.role === "client";

  // ── Realtime subscription (Ops pull is server-side only) ────────────────
  useEffect(() => {
    // Periodic refetch as a safety net for the tasks query
    const poll = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    }, 30000);

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
      clearInterval(poll);
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

  const handleDeleteTask = async () => {
    if (!deleteTask) return;
    if (requestIdFromTaskSource(deleteTask.source)) {
      toast.error(
        "Tarefas vinculadas a pedidos não podem ser excluídas sem desvincular e reabrir o pedido.",
      );
      setDeleteTask(null);
      return;
    }
    const { error } = await supabase.from("tasks").delete().eq("id", deleteTask.id);
    if (error) {
      toast.error("Erro ao excluir tarefa");
      return;
    }
    if (!requestIdFromTaskSource(deleteTask.source)) {
      notifyOpsTaskDeleted(deleteTask.id, deleteTask.ops_node_id);
    }
    toast.success("Tarefa excluída");
    setDeleteTask(null);
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };

  // Filters
  const [searchParams] = useSearchParams();
  const openedTaskParamRef = useRef<string | null>(null);
  const [filterClient, setFilterClient] = useState(searchParams.get("client") || "");
  const [filterProject, setFilterProject] = useState(searchParams.get("project") || "");
  const [filterArea, setFilterArea] = useState(searchParams.get("area") || "");
  const [filterDeliveryType, setFilterDeliveryType] = useState(
    searchParams.get("type") || "",
  );
  const [filterAssignee, setFilterAssignee] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState<Date | undefined>(undefined);
  const [filterDateTo, setFilterDateTo] = useState<Date | undefined>(undefined);
  const [sortBy, setSortBy] = useState<"manual" | "title_asc" | "title_desc" | "due_asc" | "due_desc" | "priority">("manual");

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
  const projectClientById = new Map(
    projectRows.map((project) => [project.id, project.client_id]),
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
  const designMemberIds = new Set(
    (teamMembers || [])
      .filter(
        (member: { role?: string | null }) =>
          member.role === "design",
      )
      .map((member: { id: string }) => member.id),
  );

  const priorityRank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

  const filteredTasks = (tasks || []).filter((t: any) => {
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
      return (priorityRank[a.priority] ?? 99) - (priorityRank[b.priority] ?? 99);
    }
    // manual: task_order then due_date
    const ao = a.task_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.task_order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
  });

  // Drag-over indicator: which task and which side
  const [dragOver, setDragOver] = useState<{ id: string; position: "top" | "bottom" } | null>(null);

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

  const formatDate = (d: string) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  };

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

  // Mobile: carousel refs para permitir tap na aba mover o carrossel horizontalmente
  const mobileScrollerRef = useRef<HTMLDivElement | null>(null);
  const colRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const mobileScrollRaf = useRef<number | null>(null);
  const scrollToCol = (colId: string) => {
    const el = colRefs.current[colId];
    setMobileTab(colId);
    if (el) el.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  };
  const stepMobileColumn = (dir: -1 | 1) => {
    const idx = Math.max(0, columns.findIndex(c => c.id === mobileTab));
    const next = columns[Math.min(columns.length - 1, Math.max(0, idx + dir))];
    if (next) scrollToCol(next.id);
  };

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
      <ConfirmModal
        open={!!deleteTask}
        title="Excluir tarefa"
        description={`Tem certeza que deseja excluir "${deleteTask?.title}"? Esta ação removerá comentários, checklists e anexos vinculados.`}
        onConfirm={handleDeleteTask}
        onCancel={() => setDeleteTask(null)}
      />
    </>
  );

  // Filtros: extraído em variável para reuso mobile/desktop
  const FiltersBar = (
    <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-2 scrollbar-hidden md:flex-wrap md:gap-3 md:overflow-visible md:pb-0">
      <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <select
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
        className="bg-secondary border border-border rounded-[10px] px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-primary/50 transition-colors flex-shrink-0"
      >
        <option value="">Todos os clientes</option>
        {clientOptions.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>
      <select value={filterProject} onChange={(e) => setFilterProject(e.target.value)}
        className="bg-secondary border border-border rounded-[10px] px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-primary/50 transition-colors flex-shrink-0">
        <option value="">Todos projetos</option>
        {visibleProjectOptions.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      {!isClient && (
        <select
          value={filterArea}
          onChange={(e) => setFilterArea(e.target.value)}
          className="bg-secondary border border-border rounded-[10px] px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-primary/50 transition-colors flex-shrink-0"
          title="Filtrar por área"
        >
          <option value="">Todas as áreas</option>
          <option value="editorial">Design e conteúdo</option>
          <option value="traffic">Tráfego</option>
          <option value="development">Desenvolvimento</option>
          <option value="operations">Operações</option>
          <option value="general">Geral</option>
        </select>
      )}
      {!isClient && (
        <select
          value={filterDeliveryType}
          onChange={(event) => setFilterDeliveryType(event.target.value)}
          className="bg-secondary border border-border rounded-[10px] px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-primary/50 transition-colors flex-shrink-0"
          title="Filtrar por tipo de entrega"
        >
          <option value="">Todos os tipos</option>
          {TASK_DELIVERY_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
      {!isClient && (
        <select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}
          className="bg-secondary border border-border rounded-[10px] px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-primary/50 transition-colors flex-shrink-0">
          <option value="">Todos os responsáveis</option>
          {(teamMembers || []).map((m: any) => (<option key={m.id} value={m.id}>{m.full_name}</option>))}
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
      <Popover>
        <PopoverTrigger asChild>
          <button className={cn("bg-secondary border border-border rounded-[10px] px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-primary/50 transition-colors flex-shrink-0 flex items-center gap-1.5", !filterDateFrom && "text-muted-foreground")}>
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
          <button className={cn("bg-secondary border border-border rounded-[10px] px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-primary/50 transition-colors flex-shrink-0 flex items-center gap-1.5", !filterDateTo && "text-muted-foreground")}>
            <CalendarIcon className="w-3 h-3" />
            {filterDateTo ? format(filterDateTo, "dd/MM") : "Até"}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={filterDateTo} onSelect={setFilterDateTo} className={cn("p-3 pointer-events-auto")} />
        </PopoverContent>
      </Popover>
      <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}
        className="bg-secondary border border-border rounded-[10px] px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-primary/50 transition-colors flex-shrink-0" title="Ordenar">
        <option value="manual">Ordem manual</option>
        <option value="title_asc">Título A-Z</option>
        <option value="title_desc">Título Z-A</option>
        <option value="due_asc">Prazo ↑</option>
        <option value="due_desc">Prazo ↓</option>
        <option value="priority">Prioridade</option>
      </select>
      {hasFilters && (
        <button onClick={() => { setFilterClient(""); setFilterProject(""); setFilterArea(""); setFilterDeliveryType(""); setFilterAssignee(""); setFilterPriority(""); setFilterDateFrom(undefined); setFilterDateTo(undefined); setSortBy("manual"); }}
          className="text-[12px] text-muted-foreground hover:text-foreground flex items-center gap-1 cursor-pointer bg-transparent border-none shrink-0">
          <X className="w-3 h-3" /> Limpar
        </button>
      )}
    </div>
  );

  // ═══ MOBILE: layout app-like — header/abas fixos, carrossel horizontal de colunas ═══
  if (isMobile) {
    return (
      <div
        className="flex h-full min-h-0 flex-col animate-fade-in -mx-4 overflow-hidden"
      >
        {/* Header fixo */}
        <div className="shrink-0 px-4 pt-1 pb-2 bg-background/95 backdrop-blur-sm border-b border-border/50">
          <h1 className="heading-page mb-2" data-tour="kanban-create-btn">Kanban</h1>
          {FiltersBar}
          {/* Tabs indicadoras */}
          <div className="mt-1 flex items-center gap-1 overflow-hidden">
            <button
              type="button"
              onClick={() => stepMobileColumn(-1)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground disabled:opacity-30"
              disabled={mobileTab === columns[0].id}
              aria-label="Coluna anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex min-w-0 flex-1 overflow-x-auto scrollbar-hidden overscroll-x-contain" style={{ touchAction: "pan-x" }}>
              {columns.map(col => {
                const count = filteredTasks.filter(
                  (t: any) => canonicalTaskStatus(t.status) === col.id,
                ).length;
                const active = mobileTab === col.id;
                return (
                  <button
                    key={col.id}
                    onClick={() => scrollToCol(col.id)}
                    className={cn(
                      "flex-shrink-0 px-3 py-2.5 text-[13px] font-semibold whitespace-nowrap border-b-2 transition-colors bg-transparent",
                      active ? "text-foreground border-primary" : "text-muted-foreground border-transparent"
                    )}
                  >
                    {col.title} <span className="text-[10px] font-mono opacity-70 ml-1">({count})</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => stepMobileColumn(1)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground disabled:opacity-30"
              disabled={mobileTab === columns[columns.length - 1].id}
              aria-label="Próxima coluna"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Carrossel de colunas com snap horizontal */}
        <div
          ref={mobileScrollerRef}
          className="flex-1 min-h-0 flex overflow-x-auto overflow-y-hidden snap-x snap-mandatory scrollbar-hidden overscroll-x-contain"
          style={{ overscrollBehavior: "contain", WebkitOverflowScrolling: "touch", touchAction: "pan-x" }}
          onScroll={(e) => {
            const scroller = e.currentTarget;
            if (mobileScrollRaf.current) return;
            mobileScrollRaf.current = window.requestAnimationFrame(() => {
              mobileScrollRaf.current = null;
              const center = scroller.scrollLeft + scroller.clientWidth / 2;
              let closest = columns[0].id;
              let bestDist = Infinity;
              columns.forEach(col => {
                const el = colRefs.current[col.id];
                if (!el) return;
                const mid = el.offsetLeft + el.offsetWidth / 2;
                const d = Math.abs(mid - center);
                if (d < bestDist) { bestDist = d; closest = col.id; }
              });
              setMobileTab(prev => prev === closest ? prev : closest);
            });
          }}
        >
          {isLoading ? (
            <div className="text-sm text-muted-foreground py-8 text-center w-full">Carregando...</div>
          ) : (
            columns.map(col => {
              const colTasks = filteredTasks.filter(
                (t: any) => canonicalTaskStatus(t.status) === col.id,
              );
              return (
                <div
                  key={col.id}
                  ref={(el) => { colRefs.current[col.id] = el; }}
                   className="snap-start shrink-0 w-full px-4 flex flex-col min-h-0"
                  onDragOver={isClient ? undefined : (e) => e.preventDefault()}
                  onDrop={isClient ? undefined : () => handleDrop(col.id)}
                >
                  {/* Header da coluna (sticky dentro do próprio card) */}
                  <div className="flex items-center gap-2 px-1 pt-3 pb-2 shrink-0">
                    <div className={`w-1.5 h-1.5 rounded-full ${col.dotColor}`} />
                    <span className="label-sm">{col.title}</span>
                    <span className="text-[10px] font-mono text-muted-foreground bg-secondary px-1.5 py-0.5 rounded ml-auto">{colTasks.length}</span>
                    {!isClient && (
                      <button onClick={() => setCreateStatus(col.id)}
                        className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-secondary">
                        <Plus className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {/* Lista scrollável da coluna */}
                  <div
                    className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 pb-4"
                    style={{ overscrollBehavior: "contain", WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}
                  >
                    {colTasks.length === 0 && (
                      <p className="text-[12px] text-muted-foreground py-8 text-center">Sem tarefas.</p>
                    )}
                    {colTasks.map((task: any) => (
                      <div
                        key={task.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Abrir tarefa ${task.title}`}
                        draggable={!isClient && !dragBlockedByFilters && !dropSaving}
                        onDragStart={isClient || dragBlockedByFilters || dropSaving ? undefined : (e) => { e.stopPropagation(); handleDragStart(task.id); }}
                        onDragEnd={isClient ? undefined : () => { setDraggedTask(null); draggedTaskRef.current = null; setDragOver(null); }}
                        onClick={() => handleCardClick(task)}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleCardClick(task);
                          }
                        }}
                        className={cn(
                          "bg-card border border-border rounded-[10px] border-l-[3px] cursor-pointer active:scale-[0.99] transition-transform",
                          !isClient && !dragBlockedByFilters && !dropSaving && "cursor-grab active:cursor-grabbing",
                          draggedTask === task.id && "opacity-40",
                          priorityBorderColors[task.priority] || "border-l-border"
                        )}
                      >
                        <div className="p-3 space-y-2">
                          <div>
                            <p className="text-[13px] font-medium text-foreground leading-snug">{task.title}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{task.project?.name}</p>
                            {taskDeliveryTypeLabel(task) ? (
                              <span className="mt-1 inline-flex rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-medium text-violet-500">
                                {taskDeliveryTypeLabel(task)}
                              </span>
                            ) : isEditorialTask(task, designMemberIds) && (
                              <span className="mt-1 inline-flex rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-medium text-violet-500">
                                Design e conteúdo
                              </span>
                            )}
                            {task.status === "blocked" && (
                              <span className="ml-1 mt-1 inline-flex rounded-full bg-warning/10 px-1.5 py-0.5 text-[9px] font-medium text-warning">
                                Bloqueada
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                              <Clock className="w-3 h-3" />
                              <span className="font-mono">{formatDate(task.due_date)}</span>
                              {(attachmentCounts || {})[task.id] > 0 && (
                                <span className="flex items-center gap-0.5"><Paperclip className="w-3 h-3" />{(attachmentCounts || {})[task.id]}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <Avatar className="w-6 h-6">
                                <AvatarFallback className="text-[9px] bg-secondary text-muted-foreground font-medium">
                                  {task.assignee?.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2) || "?"}
                                </AvatarFallback>
                              </Avatar>
                              {!isClient && (
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button
                                      onClick={(e) => e.stopPropagation()}
                                      className="p-1.5 rounded hover:bg-secondary text-muted-foreground"
                                      title="Mover"
                                    >
                                      <MoreVertical className="w-4 h-4" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent align="end" className="w-48 p-1" onClick={(e) => e.stopPropagation()}>
                                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1.5">Mover para</p>
                                    {columns.filter(
                                      (c) =>
                                        c.id !== canonicalTaskStatus(task.status),
                                    ).map(c => (
                                      <button
                                        key={c.id}
                                        onClick={(e) => { e.stopPropagation(); changeStatus(task, c.id); }}
                                        className="w-full flex items-center gap-2 px-2 py-2 rounded text-[13px] hover:bg-secondary text-foreground"
                                      >
                                        <span className={`w-1.5 h-1.5 rounded-full ${c.dotColor}`} />
                                        {c.title}
                                        <ArrowRight className="w-3 h-3 ml-auto text-muted-foreground" />
                                      </button>
                                    ))}
                                    {!requestIdFromTaskSource(task.source) && (
                                      <>
                                        <div className="border-t border-border my-1" />
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setDeleteTask(task); }}
                                          className="w-full flex items-center gap-2 px-2 py-2 rounded text-[13px] hover:bg-destructive/10 text-destructive"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" /> Excluir
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
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
        {Modals}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="heading-page" data-tour="kanban-create-btn">Kanban</h1>

      {/* Filters */}
      {FiltersBar}

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Carregando...</div>
      ) : (tasks || []).length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Nenhuma tarefa encontrada.</div>
      ) : (
        /* ═══ DESKTOP: Columns layout ═══ */
        <div className="flex gap-6 overflow-x-auto pb-4" data-tour="kanban-board" style={{ scrollSnapType: 'x mandatory' }}>
          {columns.map((col) => {
            const colTasks = filteredTasks.filter(
              (t: any) => canonicalTaskStatus(t.status) === col.id,
            );
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
                  {colTasks.map((task: any, idx: number) => {
                    const showTopLine = dragOver?.id === task.id && dragOver.position === "top";
                    const showBottomLine = dragOver?.id === task.id && dragOver.position === "bottom";
                    return (
                      <div key={task.id} className="relative">
                        {showTopLine && <div className="h-0.5 bg-primary rounded-full mb-1 animate-fade-in" />}
                        <div
                          role="button"
                          tabIndex={0}
                          aria-label={`Abrir tarefa ${task.title}`}
                          draggable={!isClient && !dragBlockedByFilters && !dropSaving}
                          onDragStart={isClient || dragBlockedByFilters || dropSaving ? undefined : (e) => { e.stopPropagation(); handleDragStart(task.id); }}
                          onDragEnd={isClient ? undefined : () => { setDraggedTask(null); draggedTaskRef.current = null; setDragOver(null); }}
                          onDragOver={isClient ? undefined : (e) => {
                            e.preventDefault();
                            const active = draggedTaskRef.current || draggedTask;
                            if (!active || active === task.id) return;
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            const position = e.clientY < rect.top + rect.height / 2 ? "top" : "bottom";
                            setDragOver((prev) => (prev?.id === task.id && prev.position === position ? prev : { id: task.id, position }));
                          }}
                          onDragLeave={isClient ? undefined : (e) => {
                            e.stopPropagation();
                          }}
                          onDrop={isClient ? undefined : (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const position = dragOver?.id === task.id ? dragOver.position : "bottom";
                            const others = colTasks.filter((t: any) => t.id !== (draggedTaskRef.current || draggedTask));
                            const targetIdx = others.findIndex((t: any) => t.id === task.id);
                            const insertAt = position === "top" ? targetIdx : targetIdx + 1;
                            handleDrop(col.id, insertAt);
                          }}
                          onClick={() => handleCardClick(task)}
                          onKeyDown={(event) => {
                            if (event.target !== event.currentTarget) return;
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              handleCardClick(task);
                            }
                          }}
                          className={`bg-card border border-border rounded-[10px] border-l-[3px] ${priorityBorderColors[task.priority] || "border-l-border"} ${isClient || dragBlockedByFilters || dropSaving ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"} ${draggedTask === task.id ? "opacity-40" : ""} hover:border-muted-foreground/30 hover:-translate-y-px transition-all`}
                        >
                          <div className="p-3.5 space-y-2.5">
                            <div>
                              <p className="text-[13px] font-medium text-foreground leading-snug">{task.title}</p>
                              <p className="text-[11px] text-muted-foreground mt-0.5">{task.project?.name}</p>
                              {taskDeliveryTypeLabel(task) ? (
                                <span className="mt-1 inline-flex rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-medium text-violet-500">
                                  {taskDeliveryTypeLabel(task)}
                                </span>
                              ) : isEditorialTask(task, designMemberIds) && (
                                <span className="mt-1 inline-flex rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-medium text-violet-500">
                                  Design e conteúdo
                                </span>
                              )}
                              {task.status === "blocked" && (
                                <span className="ml-1 mt-1 inline-flex rounded-full bg-warning/10 px-1.5 py-0.5 text-[9px] font-medium text-warning">
                                  Bloqueada
                                </span>
                              )}
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
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <button
                                        onClick={(event) =>
                                          event.stopPropagation()
                                        }
                                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                                        title="Ações da tarefa"
                                      >
                                        <MoreVertical className="h-4 w-4" />
                                      </button>
                                    </PopoverTrigger>
                                    <PopoverContent
                                      align="end"
                                      className="w-48 p-1"
                                      onClick={(event) =>
                                        event.stopPropagation()
                                      }
                                    >
                                      <p className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                                        Mover para
                                      </p>
                                      {columns
                                        .filter(
                                          (column) =>
                                            column.id !==
                                            canonicalTaskStatus(task.status),
                                        )
                                        .map((column) => (
                                          <button
                                            key={column.id}
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              void changeStatus(
                                                task,
                                                column.id,
                                              );
                                            }}
                                            className="flex w-full items-center gap-2 rounded px-2 py-2 text-[13px] text-foreground hover:bg-secondary"
                                          >
                                            <span
                                              className={`h-1.5 w-1.5 rounded-full ${column.dotColor}`}
                                            />
                                            {column.title}
                                            <ArrowRight className="ml-auto h-3 w-3 text-muted-foreground" />
                                          </button>
                                        ))}
                                      {!requestIdFromTaskSource(task.source) && (
                                        <>
                                          <div className="my-1 border-t border-border" />
                                          <button
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              setDeleteTask(task);
                                            }}
                                            className="flex w-full items-center gap-2 rounded px-2 py-2 text-[13px] text-destructive hover:bg-destructive/10"
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
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
                        {showBottomLine && <div className="h-0.5 bg-primary rounded-full mt-1 animate-fade-in" />}
                      </div>
                    );
                  })}
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

      <ConfirmModal
        open={!!deleteTask}
        title="Excluir tarefa"
        description={`Tem certeza que deseja excluir "${deleteTask?.title}"? Esta ação removerá comentários, checklists e anexos vinculados.`}
        onConfirm={handleDeleteTask}
        onCancel={() => setDeleteTask(null)}
      />
    </div>
  );
}
