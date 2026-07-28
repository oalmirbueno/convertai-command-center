import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canMutateClientRequests,
  clientRequestStatusForTaskStatus,
  requestIdFromTaskSource,
  requestPriorityToTaskPriority,
  requestTaskKanbanPath,
  requestTaskSource,
} from "@/lib/requestTaskWorkflow";

const REQUEST_ID = "55f1864a-c9d7-4db1-9a46-054949cc65c3";
const SIGNATURE = "a".repeat(64);

describe("request to task workflow", () => {
  it("keeps client-request mutation restricted to admin and manager", () => {
    expect(canMutateClientRequests("admin")).toBe(true);
    expect(canMutateClientRequests("manager")).toBe(true);
    expect(canMutateClientRequests("design")).toBe(false);
    expect(canMutateClientRequests("traffic")).toBe(false);
    expect(canMutateClientRequests("client")).toBe(false);
  });

  it("preserves urgent/high/low and maps normal to medium", () => {
    expect(requestPriorityToTaskPriority("urgent")).toBe("urgent");
    expect(requestPriorityToTaskPriority("urgente")).toBe("urgent");
    expect(requestPriorityToTaskPriority("high")).toBe("high");
    expect(requestPriorityToTaskPriority("alta")).toBe("high");
    expect(requestPriorityToTaskPriority("low")).toBe("low");
    expect(requestPriorityToTaskPriority("normal")).toBe("medium");
  });

  it("uses a stable source marker and rejects unrelated task sources", () => {
    const source = requestTaskSource(REQUEST_ID, SIGNATURE);
    expect(source).toBe(`client_request:${REQUEST_ID}:${SIGNATURE}`);
    expect(requestIdFromTaskSource(source)).toBe(REQUEST_ID);
    expect(requestIdFromTaskSource("mcp")).toBeNull();
    expect(requestIdFromTaskSource(`client_request:${REQUEST_ID}`)).toBeNull();
    expect(requestIdFromTaskSource("client_request:not-a-uuid")).toBeNull();
  });

  it("synchronizes completion and reopening to request statuses", () => {
    expect(clientRequestStatusForTaskStatus("done")).toBe("completed");
    expect(clientRequestStatusForTaskStatus("backlog")).toBe("in_progress");
    expect(clientRequestStatusForTaskStatus("doing")).toBe("in_progress");
    expect(clientRequestStatusForTaskStatus("review")).toBe("in_progress");
  });

  it("builds a direct Kanban route for the created task", () => {
    expect(requestTaskKanbanPath("project-id", "task-id")).toBe(
      "/kanban?project=project-id&task=task-id",
    );
  });
});

describe("request to task source contract", () => {
  const read = (path: string) =>
    readFileSync(resolve(process.cwd(), path), "utf8");
  const workflow = read("src/lib/requestTaskWorkflow.ts");
  const requests = read("src/pages/AdminRequests.tsx");
  const clientRequests = read("src/pages/ClientRequests.tsx");
  const kanban = read("src/pages/Kanban.tsx");
  const drawer = read("src/components/admin/TaskDetailDrawer.tsx");
  const dashboard = read("src/pages/AdminDashboard.tsx");
  const projectDrawer = read("src/components/admin/ProjectDrawer.tsx");

  it("delegates idempotent creation to the authenticated workflow endpoint", () => {
    const creationStart = workflow.indexOf(
      "export async function createOrRecoverRequestTask",
    );
    const creationEnd = workflow.indexOf(
      "export async function syncClientRequestStatusForTask",
      creationStart,
    );
    const creation = workflow.slice(creationStart, creationEnd);
    expect(creation).toContain('action: "create_request_task"');
    expect(creation).toContain("allowCreate: options.allowCreate !== false");
    expect(creation).not.toContain('.from("tasks")');
    expect(creation).not.toContain("recoverUnlinkedLegacyTask");
  });

  it("limits project and assignee choices to the selected client context", () => {
    expect(requests).toContain(
      "project.client_id === selected?.client_id",
    );
    expect(requests).toContain(
      'toast.error("O responsável não está autorizado para este cliente.")',
    );
    expect(requests).toContain("canMutateSelected");
  });

  it("blocks direct request status changes until the Kanban link is confirmed", () => {
    expect(requests).toContain("isError: linkedTaskReadFailed");
    expect(requests).toContain(
      "if (checkingLinkedTask || linkedTaskReadFailed)",
    );
    expect(requests).toContain(
      "Não foi possível confirmar o vínculo com o Kanban",
    );
  });

  it("opens the linked task and syncs status in drag, menu, and drawer flows", () => {
    expect(requests).toContain("requestTaskKanbanPath");
    expect(kanban).toContain('searchParams.get("task")');
    expect(kanban.match(/syncLinkedRequest\(/g)?.length).toBeGreaterThanOrEqual(
      2,
    );
    expect(drawer).toContain("syncClientRequestStatusForTask");
    expect(clientRequests).toContain(
      'completed: { cls: "bg-success/10 text-success", label: "Concluído" }',
    );
  });

  it("blocks both project deletion paths when a signed request task exists", () => {
    expect(workflow).toContain(
      "export async function projectHasLinkedRequestTasks",
    );
    expect(workflow).toContain(
      '.like("source", `${REQUEST_TASK_SOURCE_PREFIX}%`)',
    );
    expect(workflow).toContain(
      "Boolean(requestIdFromTaskSource(task.source))",
    );
    expect(dashboard).toContain(
      "await projectHasLinkedRequestTasks(projectId)",
    );
    expect(projectDrawer).toContain(
      "await projectHasLinkedRequestTasks(project.id)",
    );
    expect(dashboard).toContain(
      "possui um Pedido vinculado ao Kanban",
    );
    expect(projectDrawer).toContain(
      "possui um Pedido vinculado ao Kanban",
    );
  });
});
