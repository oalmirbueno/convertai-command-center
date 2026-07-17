import { describe, expect, it } from "vitest";
import {
  normalizeTaskStatus,
  sanitizeProfileSearch,
  taskStatusFilter,
  TASK_STATUS_VALUES,
} from "@/lib/mcp/compat";

describe("MCP compatibility helpers", () => {
  it("maps the legacy todo status to the current backlog column", () => {
    expect(normalizeTaskStatus()).toBe("backlog");
    expect(normalizeTaskStatus("todo")).toBe("backlog");
    expect(normalizeTaskStatus("doing")).toBe("doing");
  });

  it("keeps every status currently read by the portal", () => {
    expect(TASK_STATUS_VALUES).toEqual([
      "backlog",
      "todo",
      "doing",
      "review",
      "approved",
      "blocked",
      "done",
    ]);
  });

  it("includes legacy todo rows when filtering the backlog", () => {
    expect(taskStatusFilter("backlog")).toEqual(["backlog", "todo"]);
    expect(taskStatusFilter("todo")).toEqual(["backlog", "todo"]);
    expect(taskStatusFilter("review")).toEqual(["review"]);
  });

  it("removes PostgREST control characters from profile search", () => {
    expect(sanitizeProfileSearch("  Alfa, (Beta)%  ")).toBe("Alfa Beta");
  });
});
