// @vitest-environment node
import { describe, expect, it } from "vitest";
import { postconditionDiagnostic } from "../../scripts/seed-ci-e2e.mjs";

const flags = () => ({
  hooks_restored: true,
  seeded: true,
  http_sequence_changed: true,
  vault_metadata_changed: false,
  http_queue_count: 0,
  render_connected_count: 0,
  hook_mismatch_count: 0,
});
const stderr = (detail: unknown) =>
  `ERROR: E2E_HTTP_OR_HOOK_POSTCONDITION_FAILED\nDETAIL: E2E_POSTCONDITION_FLAGS: ${JSON.stringify(detail)}\nCONTEXT: private SQL body must stay hidden`;

describe("sanitized E2E postcondition diagnostics", () => {
  it("reports only reviewed booleans and counts even when psql stderr contains private context", () => {
    const result = postconditionDiagnostic(stderr(flags()));
    expect(result).toEqual(flags());
    expect(JSON.stringify(result)).not.toContain("private SQL");
    expect(Object.keys(result)).toHaveLength(7);
  });

  it.each([
    { ...flags(), url: "https://private.invalid/never-print" },
    { ...flags(), vault_state: { synthetic_private_metadata: "never-print" } },
    { ...flags(), http_queue_count: "0" },
    { ...flags(), http_queue_count: -1 },
    { ...flags(), http_queue_count: 0.5 },
    { ...flags(), http_queue_count: Number.MAX_SAFE_INTEGER + 1 },
    { ...flags(), hooks_restored: "true" },
    { hooks_restored: true },
    [],
    null,
  ])("rejects missing, extra or non-scalar diagnostic fields %#", (detail) => {
    expect(postconditionDiagnostic(stderr(detail))).toBeNull();
  });

  it("does not parse another guard, malformed detail or a diagnostic embedded in SQL context", () => {
    expect(postconditionDiagnostic(stderr(flags()).replace("E2E_HTTP_OR_HOOK_POSTCONDITION_FAILED", "E2E_BACKGROUND_JOB_STATE_CHANGED"))).toBeNull();
    expect(postconditionDiagnostic("ERROR: E2E_HTTP_OR_HOOK_POSTCONDITION_FAILED\nDETAIL: E2E_POSTCONDITION_FLAGS: {" )).toBeNull();
    expect(postconditionDiagnostic(`ERROR: E2E_HTTP_OR_HOOK_POSTCONDITION_FAILED\nCONTEXT: DETAIL: E2E_POSTCONDITION_FLAGS: ${JSON.stringify(flags())}`)).toBeNull();
  });
});
