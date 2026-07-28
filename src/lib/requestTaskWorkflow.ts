import type { AppRole } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export const REQUEST_TASK_SOURCE_PREFIX = "client_request:";

const SIGNED_SOURCE_PATTERN =
  /^client_request:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([0-9a-f]{64})$/i;

export type RequestTaskPriority = "low" | "medium" | "high" | "urgent";
export type RequestTaskResolution =
  | "created"
  | "existing"
  | "concurrent_recovered";

export interface RequestTaskInput {
  requestId: string;
  title: string;
  description: string | null;
  projectId: string;
  assignedTo: string | null;
  priority: RequestTaskPriority;
  dueDate: string | null;
}

export interface RequestTaskResult {
  task: {
    id: string;
    project_id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    assigned_to: string | null;
    due_date: string | null;
    source: string | null;
    created_at: string;
  };
  resolution: RequestTaskResolution;
}

export function canMutateClientRequests(role: AppRole | string | null | undefined) {
  return role === "admin" || role === "manager";
}

export function requestTaskSource(requestId: string, signature: string) {
  return `${REQUEST_TASK_SOURCE_PREFIX}${requestId}:${signature}`;
}

export function requestIdFromTaskSource(source: string | null | undefined) {
  const match = SIGNED_SOURCE_PATTERN.exec(source || "");
  return match?.[1] || null;
}

export function requestPriorityToTaskPriority(
  priority: string | null | undefined,
): RequestTaskPriority {
  const normalized = priority?.trim().toLowerCase();
  if (normalized === "urgent" || normalized === "urgente") return "urgent";
  if (normalized === "high" || normalized === "alta") return "high";
  if (normalized === "low" || normalized === "baixa") return "low";
  return "medium";
}

export function clientRequestStatusForTaskStatus(taskStatus: string) {
  return taskStatus === "done" ? "completed" : "in_progress";
}

export function requestTaskKanbanPath(projectId: string, taskId: string) {
  const params = new URLSearchParams({ project: projectId, task: taskId });
  return `/kanban?${params.toString()}`;
}

export async function projectHasLinkedRequestTasks(projectId: string) {
  const { data, error } = await supabase
    .from("tasks")
    .select("source")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .like("source", `${REQUEST_TASK_SOURCE_PREFIX}%`);
  if (error) {
    throw new Error(
      "Não foi possível verificar os pedidos vinculados. O projeto não foi excluído.",
    );
  }
  return (data || []).some((task) =>
    Boolean(requestIdFromTaskSource(task.source)),
  );
}

export async function createOrRecoverRequestTask(
  input: RequestTaskInput,
  options: { allowCreate?: boolean } = {},
): Promise<RequestTaskResult> {
  const retryDelays = [0, 200, 500];
  let lastError: unknown = null;

  for (const delay of retryDelays) {
    if (delay > 0) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, delay));
    }
    const { data, error, response } = await supabase.functions.invoke(
      "request-task-workflow",
      {
        body: {
          action: "create_request_task",
          requestId: input.requestId,
          projectId: input.projectId,
          assignedTo: input.assignedTo,
          priority: input.priority,
          dueDate: input.dueDate,
          allowCreate: options.allowCreate !== false,
        },
      },
    );
    if (!error && data?.ok && data.task && data.resolution) {
      return {
        task: data.task,
        resolution: data.resolution as RequestTaskResolution,
      };
    }
    if (error && response?.status && response.status >= 400 && response.status < 500) {
      throw error;
    }
    if (!error) {
      throw new Error(data?.error || "Não foi possível criar a tarefa do pedido.");
    }
    lastError = error;
  }

  throw lastError || new Error("Não foi possível criar a tarefa do pedido.");
}

export async function syncClientRequestStatusForTask({
  taskId,
  projectId,
  source,
  taskStatus,
}: {
  taskId: string;
  projectId: string;
  source: string | null | undefined;
  taskStatus: string;
}) {
  const requestId = requestIdFromTaskSource(source);
  if (!requestId) {
    return { synced: false as const, reason: "source" as const };
  }

  const expectedStatus = clientRequestStatusForTaskStatus(taskStatus);
  const retryDelays = [0, 200, 500];
  let lastError: unknown = null;

  for (const delay of retryDelays) {
    if (delay > 0) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, delay));
    }

    const { data, error, response } = await supabase.functions.invoke(
      "request-task-workflow",
      {
        body: {
          action: "sync_request_status",
          taskId,
          taskStatus,
        },
      },
    );

    if (!error && data?.ok && data.synced === true) {
      return {
        synced: true as const,
        requestId: data.requestId || requestId,
        status: data.status || expectedStatus,
      };
    }

    if (error && response?.status && response.status >= 400 && response.status < 500) {
      throw error;
    }
    if (!error) {
      throw new Error(
        data?.error
        || "O vínculo entre pedido e tarefa mudou durante a sincronização.",
      );
    }

    lastError =
      error;
  }

  // If the function committed but its response was lost, a direct read keeps
  // the retry idempotent and prevents an unnecessary task rollback.
  const [
    { data: confirmedRequest, error: requestConfirmationError },
    { data: confirmedTask, error: taskConfirmationError },
  ] = await Promise.all([
    supabase
      .from("client_requests")
      .select("id, status")
      .eq("id", requestId)
      .maybeSingle(),
    supabase
      .from("tasks")
      .select("id, project_id, source, status, deleted_at")
      .eq("id", taskId)
      .maybeSingle(),
  ]);
  if (
    !requestConfirmationError
    && !taskConfirmationError
    && confirmedRequest?.status === expectedStatus
    && confirmedTask
    && !confirmedTask.deleted_at
    && confirmedTask.project_id === projectId
    && confirmedTask.source === source
    && confirmedTask.status === taskStatus
  ) {
    return {
      synced: true as const,
      requestId,
      status: expectedStatus,
    };
  }

  throw (
    lastError
    || requestConfirmationError
    || taskConfirmationError
    || new Error("O pedido vinculado não pôde ser sincronizado.")
  );
}
