import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const edge = read("supabase/functions/request-task-workflow/index.ts");
const config = read("supabase/config.toml");
const requests = read("src/pages/AdminRequests.tsx");
const workflow = read("src/lib/requestTaskWorkflow.ts");
const kanban = read("src/pages/Kanban.tsx");
const drawer = read("src/components/admin/TaskDetailDrawer.tsx");

describe("request task edge authorization contract", () => {
  it("requires a verified user and limits both actions by role and client", () => {
    expect(config).toMatch(
      /\[functions\.request-task-workflow\]\s+verify_jwt = true/,
    );
    expect(edge).toContain("admin.auth.getUser(token)");
    expect(edge).toContain(
      'const StaffRoles = new Set(["admin", "manager", "design", "traffic"])',
    );
    expect(edge).toContain("await assertCanManageClient");
    expect(edge).toContain("callerIsAssignedToClient");
    expect(edge).toContain('action: z.literal("create_request_task")');
  });

  it("builds the assignee list from admins and direct client assignments", () => {
    expect(edge).toContain('.from("team_client_assignments")');
    expect(edge).toContain('.eq("client_id", clientId)');
    expect(edge).toContain('.eq("role", "admin")');
    expect(edge).not.toContain('.select("assigned_to")');
    expect(requests).toContain('"request-task-workflow"');
    expect(requests).toContain('action: "list_assignees"');
    expect(requests).not.toContain('.from("team_client_assignments")');
  });

  it("re-reads the task and verifies status, source, client, and caller before updating", () => {
    expect(edge).toContain("verifiedRequestId(secret");
    expect(edge).toContain("task.status !== taskStatus");
    expect(edge).toContain("RequestSourcePattern.exec");
    expect(edge).toContain("request.client_id !== project.client_id");
    expect(edge).not.toContain("task.assigned_to === callerId");
    expect(edge).toContain(
      "await callerIsAssignedToClient(admin, callerId, request.client_id)",
    );
    expect(edge).toContain('.eq("client_id", request.client_id)');
    expect(edge).toContain('.eq("status", request.status)');
    expect(edge).toContain("taskStayedStable");
    expect(edge).toContain("syncRequestFromStableTask");
    expect(edge).toContain(
      "A tarefa mudou durante a recuperação; tente novamente",
    );
  });

  it("creates deterministic tasks with a server-signed, non-forgeable link", () => {
    expect(edge).toContain("crypto.subtle.sign");
    expect(edge).toContain("crypto.subtle.verify");
    expect(edge).toContain("const taskId = input.requestId");
    expect(edge).toContain("await assertCanManageClient");
    expect(edge).toContain("await assertAssigneeCanAccessClient");
    expect(edge).toContain(".like(\"source\", `client_request:${requestId}:%`)");
  });
});

describe("request task frontend consistency contract", () => {
  it("uses bounded retries and confirmation after a possible lost response", () => {
    expect(workflow).toContain("const retryDelays = [0, 200, 500]");
    expect(workflow).toContain('supabase.functions.invoke(');
    expect(workflow).toContain("response.status >= 400");
    expect(workflow).toContain('.from("client_requests")');
    expect(workflow).toContain(
      "confirmedRequest?.status === expectedStatus",
    );
  });

  it("passes the task id in every sync path and conditionally rolls back failures", () => {
    expect(requests).toContain("taskId: result.task.id");
    expect(kanban).toContain("taskId: task.id");
    expect(drawer).toContain("taskId: task.id");
    expect(kanban).toContain('.eq("status", taskStatus)');
    expect(drawer).toContain('.eq("status", status)');
    expect(kanban).toContain(
      "a movimentação da tarefa foi revertida",
    );
    expect(kanban).toContain("restoreOriginalColumnOrders");
    expect(kanban).toContain("Client request rollback failed");
    expect(kanban).toContain("taskStatus: previousStatus");
    expect(drawer).toContain("linkedRequestStatusRolledBack");
  });

  it("serializes manual drops and disables unsafe filtered reordering", () => {
    expect(kanban).toContain("dropInFlightRef");
    expect(kanban).toContain("setDropSaving(true)");
    expect(kanban).toContain(
      "draggable={!isClient && !dragBlockedByFilters && !dropSaving}",
    );
    expect(kanban).toContain("const dragBlockedByFilters");
    expect(kanban).toContain('.eq("status", task.status)');
  });

  it("keeps concurrent reorders from overwriting task status and isolates auxiliary failures", () => {
    const orderStart = kanban.indexOf("const persistColumnOrder");
    const orderEnd = kanban.indexOf("const persistTaskStatus", orderStart);
    const orderPersistence = kanban.slice(orderStart, orderEnd);
    const auxiliaryFailure = kanban.indexOf(
      'console.error("Post-move side effects failed"',
    );
    const coreRollback = kanban.indexOf(
      'console.error("Drop persist failed"',
    );

    expect(orderPersistence).toContain(".update({ task_order:");
    expect(orderPersistence).toContain('.eq("status", expectedStatus)');
    expect(orderPersistence).toContain(
      "canonicalTaskStatus(expectedStatus) !== columnId",
    );
    expect(orderPersistence).not.toContain("status: columnId");
    expect(kanban).toContain('.eq("status", taskStatus)');
    expect(kanban).toContain(
      "await persistColumnOrder(column, newDestIds);",
    );
    expect(kanban).not.toContain(
      "newDestIds.filter((id) => id !== activeDragId)",
    );
    expect(auxiliaryFailure).toBeGreaterThan(coreRollback);
    expect(kanban).toContain(
      "A tarefa foi movida, mas uma etapa auxiliar falhou.",
    );
  });

  it("shows task subresource read failures and limits linked assignees", () => {
    expect(drawer).toContain("attachmentsReadFailed");
    expect(drawer).toContain("commentsReadFailed");
    expect(drawer).toContain("checklistReadFailed");
    expect(drawer).toContain('action: "list_assignees"');
    expect(drawer).toContain(
      "O responsável não está autorizado para o cliente desta tarefa.",
    );
  });

  it("routes manual status changes for linked requests back to Kanban", () => {
    expect(requests).toContain('queryKey: ["request-linked-task"');
    expect(requests).toContain("if (linkedRequestTask)");
    expect(requests).toContain(
      "Altere o status pelo Kanban",
    );
  });

  it("does not reactivate legacy Ops for request-linked tasks", () => {
    expect(requests).toContain("notifyLegacyOps = true");
    expect(requests).toContain("result.task.project_id,\n          false");
    expect(kanban).toContain(
      "if (!requestIdFromTaskSource(deleteTask.source))",
    );
    expect(kanban).toContain("if (!linkedRequestId)");
    expect(drawer).toContain(
      "if (!requestIdFromTaskSource(task.source))",
    );
  });

  it("blocks unsafe legacy duplication and deletion of linked tasks", () => {
    expect(requests).toContain(
      '{ allowCreate: selected.status !== "in_progress" }',
    );
    expect(workflow).toContain("allowCreate: options.allowCreate !== false");
    expect(kanban).toContain(
      "if (requestIdFromTaskSource(deleteTask.source))",
    );
    expect(kanban).toContain(
      "!requestIdFromTaskSource(task.source)",
    );
  });
});
