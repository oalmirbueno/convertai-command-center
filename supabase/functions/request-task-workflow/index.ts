import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const StaffRoles = new Set(["admin", "manager", "design", "traffic"]);
const RequestSourcePattern =
  /^client_request:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([0-9a-f]{64})$/i;
const TaskStatusSchema = z.enum([
  "backlog",
  "doing",
  "review",
  "approved",
  "done",
]);
const TaskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
const TaskSelect =
  "id, project_id, title, description, status, priority, assigned_to, due_date, source, created_at, updated_at, deleted_at";

const BodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list_assignees"),
    clientId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("create_request_task"),
    requestId: z.string().uuid(),
    projectId: z.string().uuid(),
    assignedTo: z.string().uuid().nullable(),
    priority: TaskPrioritySchema,
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    allowCreate: z.boolean(),
  }),
  z.object({
    action: z.literal("sync_request_status"),
    taskId: z.string().uuid(),
    taskStatus: TaskStatusSchema,
  }),
]);

type TaskRow = {
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
  updated_at: string;
  deleted_at: string | null;
};

type RequestRow = {
  id: string;
  client_id: string;
  title: string;
  description: string | null;
  status: string;
};

class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function taskLinkPayload(taskId: string, requestId: string, projectId: string) {
  return `${taskId}:${requestId}:${projectId}`;
}

async function signingKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(value: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

async function signedTaskSource(
  secret: string,
  taskId: string,
  requestId: string,
  projectId: string,
) {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret),
    new TextEncoder().encode(taskLinkPayload(taskId, requestId, projectId)),
  );
  return `client_request:${requestId}:${bytesToHex(new Uint8Array(signature))}`;
}

async function verifiedRequestId(
  secret: string,
  task: Pick<TaskRow, "id" | "project_id" | "source">,
) {
  const match = RequestSourcePattern.exec(task.source || "");
  if (!match) return null;
  const signature = hexToBytes(match[2]);
  if (!signature) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(secret),
    signature,
    new TextEncoder().encode(
      taskLinkPayload(task.id, match[1], task.project_id),
    ),
  );
  return valid ? match[1] : null;
}

async function callerRoles(admin: any, callerId: string) {
  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", callerId);
  if (error) throw error;
  return new Set<string>((data || []).map((row: any) => row.role));
}

async function callerIsAssignedToClient(
  admin: any,
  callerId: string,
  clientId: string,
) {
  const { data, error } = await admin
    .from("team_client_assignments")
    .select("user_id")
    .eq("user_id", callerId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

async function assertCanManageClient(
  admin: any,
  callerId: string,
  roles: Set<string>,
  clientId: string,
) {
  if (roles.has("admin")) return;
  if (
    !roles.has("manager")
    || !(await callerIsAssignedToClient(admin, callerId, clientId))
  ) {
    throw new HttpError("Sem permissão para gerenciar este cliente", 403);
  }
}

async function assertAssigneeCanAccessClient(
  admin: any,
  assigneeId: string | null,
  clientId: string,
) {
  if (!assigneeId) return;
  const roles = await callerRoles(admin, assigneeId);
  if (roles.has("admin")) return;
  if (
    ![...roles].some((role) => StaffRoles.has(role))
    || !(await callerIsAssignedToClient(admin, assigneeId, clientId))
  ) {
    throw new HttpError(
      "O responsável não está autorizado para este cliente",
      400,
    );
  }
}

async function listAssignees(
  admin: any,
  callerId: string,
  roles: Set<string>,
  clientId: string,
) {
  await assertCanManageClient(admin, callerId, roles, clientId);

  const [
    { data: assignments, error: assignmentError },
    { data: admins, error: adminRoleError },
  ] = await Promise.all([
    admin
      .from("team_client_assignments")
      .select("user_id")
      .eq("client_id", clientId),
    admin
      .from("user_roles")
      .select("user_id, role")
      .eq("role", "admin"),
  ]);
  if (assignmentError) throw assignmentError;
  if (adminRoleError) throw adminRoleError;

  const assignedIds = Array.from(
    new Set<string>((assignments || []).map((row: any) => row.user_id)),
  );
  const { data: assignedRoles, error: assignedRoleError } = assignedIds.length
    ? await admin
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", assignedIds)
    : { data: [], error: null };
  if (assignedRoleError) throw assignedRoleError;

  const roleByUser = new Map<string, string>();
  for (const row of [...(assignedRoles || []), ...(admins || [])]) {
    if (!StaffRoles.has(row.role)) continue;
    if (row.role === "admin" || !roleByUser.has(row.user_id)) {
      roleByUser.set(row.user_id, row.role);
    }
  }

  const ids = Array.from(roleByUser.keys());
  if (!ids.length) return [];
  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("id, full_name, avatar_url")
    .in("id", ids)
    .is("deleted_at", null);
  if (profileError) throw profileError;

  return (profiles || [])
    .map((profile: any) => ({
      id: profile.id,
      full_name: profile.full_name,
      avatar_url: profile.avatar_url,
      role: roleByUser.get(profile.id),
    }))
    .sort((left: any, right: any) =>
      (left.full_name || "").localeCompare(right.full_name || "", "pt-BR")
    );
}

async function setRequestStatusCas(
  admin: any,
  request: Pick<RequestRow, "id" | "client_id" | "status">,
  status: string,
) {
  if (request.status === status) return false;
  const { data: updated, error } = await admin
    .from("client_requests")
    .update({ status })
    .eq("id", request.id)
    .eq("client_id", request.client_id)
    .eq("status", request.status)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (updated) return true;

  const { data: current, error: currentError } = await admin
    .from("client_requests")
    .select("status")
    .eq("id", request.id)
    .maybeSingle();
  if (currentError) throw currentError;
  if (current?.status === status) return false;
  throw new HttpError("O pedido mudou durante a sincronização", 409);
}

async function findSignedTasks(
  admin: any,
  secret: string,
  requestId: string,
) {
  const { data, error } = await admin
    .from("tasks")
    .select(TaskSelect)
    .like("source", `client_request:${requestId}:%`)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(3);
  if (error) throw error;

  const valid: TaskRow[] = [];
  for (const task of (data || []) as TaskRow[]) {
    if ((await verifiedRequestId(secret, task)) === requestId) valid.push(task);
  }
  return valid;
}

async function syncRequestFromStableTask(
  admin: any,
  request: RequestRow,
  task: TaskRow,
) {
  const requestStatus = task.status === "done" ? "completed" : "in_progress";
  const changedRequest = await setRequestStatusCas(
    admin,
    request,
    requestStatus,
  );
  const { data: currentTask, error: currentTaskError } = await admin
    .from("tasks")
    .select("id, project_id, source, status, updated_at, deleted_at")
    .eq("id", task.id)
    .maybeSingle();
  if (currentTaskError) throw currentTaskError;

  const taskStayedStable =
    !!currentTask
    && !currentTask.deleted_at
    && currentTask.project_id === task.project_id
    && currentTask.source === task.source
    && currentTask.status === task.status
    && currentTask.updated_at === task.updated_at;
  if (taskStayedStable) return;

  if (changedRequest) {
    const { data: rolledBack, error: rollbackError } = await admin
      .from("client_requests")
      .update({ status: request.status })
      .eq("id", request.id)
      .eq("client_id", request.client_id)
      .eq("status", requestStatus)
      .select("id")
      .maybeSingle();
    if (rollbackError || !rolledBack) {
      throw new HttpError(
        "A tarefa mudou e o pedido precisa de reconciliação manual",
        409,
      );
    }
  }
  throw new HttpError(
    "A tarefa mudou durante a recuperação; tente novamente",
    409,
  );
}

async function createRequestTask(
  admin: any,
  secret: string,
  callerId: string,
  roles: Set<string>,
  input: Extract<z.infer<typeof BodySchema>, { action: "create_request_task" }>,
) {
  const [
    { data: request, error: requestError },
    { data: project, error: projectError },
  ] = await Promise.all([
    admin
      .from("client_requests")
      .select("id, client_id, title, description, status")
      .eq("id", input.requestId)
      .maybeSingle(),
    admin
      .from("projects")
      .select("id, client_id")
      .eq("id", input.projectId)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);
  if (requestError) throw requestError;
  if (projectError) throw projectError;
  if (!request) throw new HttpError("Pedido não encontrado", 404);
  if (!project || request.client_id !== project.client_id) {
    throw new HttpError("Selecione um projeto deste cliente", 400);
  }

  await assertCanManageClient(
    admin,
    callerId,
    roles,
    request.client_id,
  );
  await assertAssigneeCanAccessClient(
    admin,
    input.assignedTo,
    request.client_id,
  );

  const linked = await findSignedTasks(admin, secret, input.requestId);
  if (linked.length > 1) {
    throw new HttpError(
      "Há mais de uma tarefa vinculada a este pedido",
      409,
    );
  }
  if (linked.length === 1) {
    await syncRequestFromStableTask(
      admin,
      request as RequestRow,
      linked[0],
    );
    return { task: linked[0], resolution: "existing" };
  }
  if (!input.allowCreate) {
    throw new HttpError(
      "Este pedido já está em andamento, mas não possui vínculo seguro com uma tarefa. Revise a tarefa antiga antes de criar outra.",
      409,
    );
  }

  const taskId = input.requestId;
  const source = await signedTaskSource(
    secret,
    taskId,
    input.requestId,
    input.projectId,
  );
  const { data: idCollision, error: collisionError } = await admin
    .from("tasks")
    .select(TaskSelect)
    .eq("id", taskId)
    .maybeSingle();
  if (collisionError) throw collisionError;
  if (idCollision) {
    const collisionRequestId = await verifiedRequestId(
      secret,
      idCollision as TaskRow,
    );
    if (
      collisionRequestId !== input.requestId
      || idCollision.deleted_at
    ) {
      throw new HttpError(
        "O identificador seguro deste pedido já pertence a outra tarefa",
        409,
      );
    }
    await syncRequestFromStableTask(
      admin,
      request as RequestRow,
      idCollision as TaskRow,
    );
    return { task: idCollision, resolution: "existing" };
  }

  const { data: created, error: createError } = await admin
    .from("tasks")
    .insert({
      id: taskId,
      title: request.title,
      description: request.description,
      project_id: input.projectId,
      status: "backlog",
      priority: input.priority,
      assigned_to: input.assignedTo,
      due_date: input.dueDate,
      source,
    })
    .select(TaskSelect)
    .single();

  let task = created as TaskRow | null;
  let resolution = "created";
  if (createError || !task) {
    const concurrent = await findSignedTasks(admin, secret, input.requestId);
    if (concurrent.length !== 1) {
      throw createError || new Error("Não foi possível criar a tarefa");
    }
    task = concurrent[0];
    resolution = "concurrent_recovered";
  }

  await syncRequestFromStableTask(admin, request as RequestRow, task);
  return { task, resolution };
}

async function syncRequestStatus(
  admin: any,
  secret: string,
  callerId: string,
  roles: Set<string>,
  taskId: string,
  taskStatus: string,
) {
  if (![...roles].some((role) => StaffRoles.has(role))) {
    throw new HttpError("Acesso restrito à equipe", 403);
  }

  const { data: task, error: taskError } = await admin
    .from("tasks")
    .select(TaskSelect)
    .eq("id", taskId)
    .maybeSingle();
  if (taskError) throw taskError;
  if (!task || task.deleted_at) throw new HttpError("Tarefa não encontrada", 404);
  if (task.status !== taskStatus) {
    throw new HttpError("O status da tarefa mudou durante a sincronização", 409);
  }

  const requestId = await verifiedRequestId(secret, task as TaskRow);
  if (!requestId) {
    throw new HttpError("Vínculo de pedido inválido", 409);
  }

  const [
    { data: request, error: requestError },
    { data: project, error: projectError },
  ] = await Promise.all([
    admin
      .from("client_requests")
      .select("id, client_id, title, description, status")
      .eq("id", requestId)
      .maybeSingle(),
    admin
      .from("projects")
      .select("id, client_id")
      .eq("id", task.project_id)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);
  if (requestError) throw requestError;
  if (projectError) throw projectError;
  if (!request || !project || request.client_id !== project.client_id) {
    throw new HttpError("Pedido e tarefa não pertencem ao mesmo cliente", 409);
  }

  const canAccess =
    roles.has("admin")
    || await callerIsAssignedToClient(admin, callerId, request.client_id);
  if (!canAccess) {
    throw new HttpError("Sem acesso à tarefa vinculada", 403);
  }

  const status = taskStatus === "done" ? "completed" : "in_progress";
  const changedRequest = await setRequestStatusCas(
    admin,
    request as RequestRow,
    status,
  );

  const { data: currentTask, error: currentTaskError } = await admin
    .from("tasks")
    .select("id, project_id, source, status, updated_at, deleted_at")
    .eq("id", taskId)
    .maybeSingle();
  if (currentTaskError) throw currentTaskError;
  const taskStayedStable =
    !!currentTask
    && !currentTask.deleted_at
    && currentTask.project_id === task.project_id
    && currentTask.source === task.source
    && currentTask.status === task.status
    && currentTask.updated_at === task.updated_at;
  if (!taskStayedStable) {
    if (changedRequest) {
      const { data: rolledBack, error: rollbackError } = await admin
        .from("client_requests")
        .update({ status: request.status })
        .eq("id", requestId)
        .eq("client_id", request.client_id)
        .eq("status", status)
        .select("id")
        .maybeSingle();
      if (rollbackError || !rolledBack) {
        throw new HttpError(
          "A tarefa mudou e o pedido precisa de reconciliação manual",
          409,
        );
      }
    }
    throw new HttpError(
      "A tarefa mudou durante a sincronização; tente novamente",
      409,
    );
  }

  return {
    synced: true,
    requestId,
    status,
    unchanged: !changedRequest,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Backend não configurado");
    }

    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!token) throw new HttpError("Não autenticado", 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData?.user) {
      throw new HttpError("Sessão inválida", 401);
    }

    const roles = await callerRoles(admin, authData.user.id);
    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return json(
        { error: "Dados inválidos", details: parsed.error.flatten().fieldErrors },
        400,
      );
    }

    if (parsed.data.action === "list_assignees") {
      const assignees = await listAssignees(
        admin,
        authData.user.id,
        roles,
        parsed.data.clientId,
      );
      return json({ ok: true, assignees });
    }
    if (parsed.data.action === "create_request_task") {
      const result = await createRequestTask(
        admin,
        serviceRoleKey,
        authData.user.id,
        roles,
        parsed.data,
      );
      return json({ ok: true, ...result });
    }

    const result = await syncRequestStatus(
      admin,
      serviceRoleKey,
      authData.user.id,
      roles,
      parsed.data.taskId,
      parsed.data.taskStatus,
    );
    return json({ ok: true, ...result });
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    console.error("request-task-workflow failed", {
      status,
      message: error?.message || "Internal error",
    });
    return json(
      { error: status === 500 ? "Erro interno" : error.message },
      status,
    );
  }
});
