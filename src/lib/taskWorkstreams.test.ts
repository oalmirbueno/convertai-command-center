import { describe, expect, it } from "vitest";
import { isDesignTask } from "@/lib/taskWorkstreams";

const designMemberIds = new Set(["designer-1"]);

describe("isDesignTask", () => {
  it("classifica uma tarefa explicitamente marcada como design", () => {
    expect(
      isDesignTask(
        { workstream: "design", assigned_to: null, source: "panel" },
        designMemberIds,
      ),
    ).toBe(true);
  });

  it("respeita uma área explícita diferente de design", () => {
    expect(
      isDesignTask(
        {
          workstream: "general",
          assigned_to: "designer-1",
          source: "panel",
        },
        designMemberIds,
      ),
    ).toBe(false);
  });

  it("usa o responsável como fallback somente em tarefa legada", () => {
    expect(
      isDesignTask(
        { assigned_to: "designer-1", source: "panel" },
        designMemberIds,
      ),
    ).toBe(true);
    expect(
      isDesignTask(
        {
          workstream: null,
          assigned_to: "designer-1",
          source: "panel",
        },
        designMemberIds,
      ),
    ).toBe(true);
    expect(
      isDesignTask(
        { assigned_to: "manager-1", source: "panel" },
        designMemberIds,
      ),
    ).toBe(false);
  });

  it("exclui tarefas originadas de pedidos de cliente", () => {
    expect(
      isDesignTask(
        {
          workstream: "design",
          assigned_to: "designer-1",
          source: "client_request:request-id:signature",
        },
        designMemberIds,
      ),
    ).toBe(false);
    expect(
      isDesignTask(
        {
          assigned_to: "designer-1",
          source: "client_request:request-id:signature",
        },
        designMemberIds,
      ),
    ).toBe(false);
  });
});
