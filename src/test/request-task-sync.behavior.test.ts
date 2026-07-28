import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  maybeSingle: vi.fn(),
  from: vi.fn(),
  queryResponses: [] as Array<{ data: unknown; error: unknown }>,
}));

vi.mock("@/integrations/supabase/client", () => {
  supabaseMocks.from.mockImplementation(() => {
    const query: Record<string, unknown> = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.is = vi.fn(() => query);
    query.order = vi.fn(() => query);
    query.limit = vi.fn(() => query);
    query.insert = vi.fn(() => query);
    query.update = vi.fn(() => query);
    query.maybeSingle = supabaseMocks.maybeSingle;
    query.single = vi.fn(async () =>
      supabaseMocks.queryResponses.shift()
      || { data: null, error: new Error("missing mock response") }
    );
    query.then = (
      resolve: (value: unknown) => unknown,
      reject: (reason: unknown) => unknown,
    ) =>
      Promise.resolve(
        supabaseMocks.queryResponses.shift()
        || { data: null, error: new Error("missing mock response") },
      ).then(resolve, reject);
    return query;
  });

  return {
    supabase: {
      functions: { invoke: supabaseMocks.invoke },
      from: supabaseMocks.from,
    },
  };
});

import {
  createOrRecoverRequestTask,
  syncClientRequestStatusForTask,
} from "@/lib/requestTaskWorkflow";

const REQUEST_ID = "55f1864a-c9d7-4db1-9a46-054949cc65c3";
const TASK_ID = "559c532a-1a33-4a21-b1ec-547497431790";
const PROJECT_ID = "7c754a85-bcc0-4f2d-99f6-e6ad8ef1c101";
const SIGNED_SOURCE = `client_request:${REQUEST_ID}:${"a".repeat(64)}`;

describe("request task status synchronization", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    supabaseMocks.invoke.mockReset();
    supabaseMocks.maybeSingle.mockReset();
    supabaseMocks.from.mockClear();
    supabaseMocks.queryResponses.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries a transient failure and returns the confirmed status", async () => {
    supabaseMocks.invoke
      .mockResolvedValueOnce({ data: null, error: new Error("timeout") })
      .mockResolvedValueOnce({
        data: {
          ok: true,
          synced: true,
          requestId: REQUEST_ID,
          status: "completed",
        },
        error: null,
      });

    const pending = syncClientRequestStatusForTask({
      taskId: TASK_ID,
      projectId: PROJECT_ID,
      source: SIGNED_SOURCE,
      taskStatus: "done",
    });
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({
      synced: true,
      requestId: REQUEST_ID,
      status: "completed",
    });
    expect(supabaseMocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("treats a matching read as success after a lost function response", async () => {
    supabaseMocks.invoke.mockResolvedValue({
      data: null,
      error: new Error("response lost"),
    });
    supabaseMocks.maybeSingle
      .mockResolvedValueOnce({
        data: { id: REQUEST_ID, status: "completed" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: TASK_ID,
          project_id: PROJECT_ID,
          source: SIGNED_SOURCE,
          status: "done",
          deleted_at: null,
        },
        error: null,
      });

    const pending = syncClientRequestStatusForTask({
      taskId: TASK_ID,
      projectId: PROJECT_ID,
      source: SIGNED_SOURCE,
      taskStatus: "done",
    });
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toMatchObject({
      synced: true,
      requestId: REQUEST_ID,
      status: "completed",
    });
    expect(supabaseMocks.invoke).toHaveBeenCalledTimes(3);
    expect(supabaseMocks.from).toHaveBeenCalledWith("client_requests");
  });

  it("fails after bounded retries when neither write nor confirmation succeeds", async () => {
    supabaseMocks.invoke.mockResolvedValue({
      data: null,
      error: new Error("service unavailable"),
    });
    supabaseMocks.maybeSingle.mockResolvedValue({
      data: { id: REQUEST_ID, status: "in_progress" },
      error: null,
    });

    const pending = syncClientRequestStatusForTask({
      taskId: TASK_ID,
      projectId: PROJECT_ID,
      source: SIGNED_SOURCE,
      taskStatus: "done",
    });
    const assertion = expect(pending).rejects.toThrow("service unavailable");
    await vi.runAllTimersAsync();

    await assertion;
    expect(supabaseMocks.invoke).toHaveBeenCalledTimes(3);
  });

  it("does not mask an explicit 409 even if the request status already matches", async () => {
    const conflict = new Error("conflict");
    supabaseMocks.invoke.mockResolvedValue({
      data: null,
      error: conflict,
      response: { status: 409 },
    });
    supabaseMocks.maybeSingle.mockResolvedValue({
      data: { id: REQUEST_ID, status: "in_progress" },
      error: null,
    });

    await expect(
      syncClientRequestStatusForTask({
        taskId: TASK_ID,
        projectId: PROJECT_ID,
        source: SIGNED_SOURCE,
        taskStatus: "doing",
      }),
    ).rejects.toThrow("conflict");
    expect(supabaseMocks.invoke).toHaveBeenCalledTimes(1);
    expect(supabaseMocks.from).not.toHaveBeenCalled();
  });

  it("does not call the endpoint for an unrelated task", async () => {
    await expect(
      syncClientRequestStatusForTask({
        taskId: TASK_ID,
        projectId: PROJECT_ID,
        source: "manual",
        taskStatus: "done",
      }),
    ).resolves.toEqual({ synced: false, reason: "source" });
    expect(supabaseMocks.invoke).not.toHaveBeenCalled();
  });
});

describe("request task creation idempotency", () => {
  const input = {
    requestId: REQUEST_ID,
    title: "Novo criativo",
    description: "Campanha de agosto",
    projectId: "7c754a85-bcc0-4f2d-99f6-e6ad8ef1c101",
    assignedTo: null,
    priority: "high" as const,
    dueDate: null,
  };
  const linkedTask = {
    id: REQUEST_ID,
    project_id: input.projectId,
    title: input.title,
    description: input.description,
    status: "backlog",
    priority: "high",
    assigned_to: null,
    due_date: null,
    source: SIGNED_SOURCE,
    created_at: "2026-07-28T12:00:00Z",
  };

  beforeEach(() => {
    vi.useFakeTimers();
    supabaseMocks.invoke.mockReset();
    supabaseMocks.maybeSingle.mockReset();
    supabaseMocks.from.mockClear();
    supabaseMocks.queryResponses.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an existing task resolved by the authenticated endpoint", async () => {
    supabaseMocks.invoke.mockResolvedValue({
      data: {
        ok: true,
        task: linkedTask,
        resolution: "existing",
      },
      error: null,
    });

    await expect(createOrRecoverRequestTask(input)).resolves.toEqual({
      task: linkedTask,
      resolution: "existing",
    });
    expect(supabaseMocks.invoke).toHaveBeenCalledWith(
      "request-task-workflow",
      expect.objectContaining({
        body: expect.objectContaining({
          action: "create_request_task",
          requestId: REQUEST_ID,
        }),
      }),
    );
  });

  it("retries a lost response and recovers the deterministic winner", async () => {
    supabaseMocks.invoke
      .mockResolvedValueOnce({
        data: null,
        error: new Error("response lost"),
      })
      .mockResolvedValueOnce({
        data: {
          ok: true,
          task: linkedTask,
          resolution: "concurrent_recovered",
        },
        error: null,
      });

    const pending = createOrRecoverRequestTask(input);
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual({
      task: linkedTask,
      resolution: "concurrent_recovered",
    });
    expect(supabaseMocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("stops on an explicit server-side linkage conflict", async () => {
    supabaseMocks.invoke.mockResolvedValue({
      data: null,
      error: new Error("mais de uma tarefa vinculada"),
      response: { status: 409 },
    });

    await expect(createOrRecoverRequestTask(input)).rejects.toThrow(
      "mais de uma tarefa vinculada",
    );
  });

  it("blocks a legacy in-progress request when no explicit link exists", async () => {
    supabaseMocks.invoke.mockResolvedValue({
      data: null,
      error: new Error("não possui vínculo seguro"),
      response: { status: 409 },
    });

    await expect(
      createOrRecoverRequestTask(input, { allowCreate: false }),
    ).rejects.toThrow("não possui vínculo seguro");
    expect(supabaseMocks.invoke).toHaveBeenCalledTimes(1);
  });
});
