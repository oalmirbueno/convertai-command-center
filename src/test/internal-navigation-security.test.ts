import { describe, expect, it } from "vitest";
import { safeInternalPath } from "@/lib/internalNavigation";

describe("internal navigation boundaries", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/relatorios?id=1#item", "/relatorios?id=1#item"],
    ["//evil.example", null],
    ["/\\evil.example", null],
    ["/%5cevil.example", null],
    ["https://evil.example", null],
    ["javascript:alert(1)", null],
    ["/safe\nheader", null],
  ])("normalizes %s", (input, expected) => {
    expect(safeInternalPath(input)).toBe(expected);
  });
});
