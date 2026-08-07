import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  dispatchLegacyOpsJson,
  isOpsLegacyBridgeEnabled,
  OpsConfigurationError,
  resolveOpsBaseUrl,
  resolveOpsFunctionUrl,
  resolveOpsReceiveLeadUrl,
  resolveOpsReceivePortalSyncUrl,
  resolvePortalFunctionUrl,
} from "../../supabase/functions/_shared/ops-config.ts";

const read = (file: string) => readFileSync(file, "utf8");

const hardcodedSupabaseProjectUrl = /https:\/\/[a-z0-9]{20}\.supabase\.co/i;

describe("Ops URL configuration", () => {
  it("derives Ops endpoints from the configured functions base", () => {
    const options = { enabled: true, baseUrl: "https://ops.example.com/functions/v1/" };

    expect(resolveOpsBaseUrl(options)).toBe("https://ops.example.com/functions/v1");
    expect(resolveOpsFunctionUrl("client-metrics-public", options))
      .toBe("https://ops.example.com/functions/v1/client-metrics-public");
    expect(resolveOpsReceiveLeadUrl(options))
      .toBe("https://ops.example.com/functions/v1/receive-lead");
    expect(resolveOpsReceivePortalSyncUrl(options))
      .toBe("https://ops.example.com/functions/v1/receive-portal-sync");
  });

  it("gives canonical exact overrides priority and retains the old alias temporarily", () => {
    const baseUrl = "https://ops.example.com/functions/v1";
    const legacyReceivePortalSyncUrl = "https://legacy.example.com/receive";

    expect(resolveOpsReceiveLeadUrl({
      enabled: true,
      baseUrl,
      receiveLeadUrl: "https://lead.example.com/hook?source=portal",
    })).toBe("https://lead.example.com/hook?source=portal");
    expect(resolveOpsReceivePortalSyncUrl({ enabled: true, baseUrl, legacyReceivePortalSyncUrl }))
      .toBe(legacyReceivePortalSyncUrl);
    expect(resolveOpsReceivePortalSyncUrl({
      enabled: true,
      baseUrl,
      legacyReceivePortalSyncUrl,
      receivePortalSyncUrl: "https://sync.example.com/hook",
    })).toBe("https://sync.example.com/hook");
  });

  it("derives Portal Edge Function URLs only from SUPABASE_URL", () => {
    expect(resolvePortalFunctionUrl(
      "portal-to-ops",
      "https://portal.example.com/",
    )).toBe("https://portal.example.com/functions/v1/portal-to-ops");
    expect(() => resolvePortalFunctionUrl("portal-to-ops", ""))
      .toThrow(OpsConfigurationError);
  });

  it("rejects unsafe or ambiguous URL configuration", () => {
    expect(() => resolveOpsBaseUrl({ baseUrl: "https://ops.example.com/functions/v1" })).toThrow(
      "the retired Ops bridge is disabled by default",
    );
    expect(() => resolveOpsBaseUrl({ enabled: true })).toThrow(
      "is required when the retired Ops bridge is enabled",
    );
    expect(() => resolveOpsBaseUrl({ enabled: true, baseUrl: "ftp://ops.example.com/functions/v1" }))
      .toThrow(OpsConfigurationError);
    expect(() => resolveOpsBaseUrl({ enabled: true, baseUrl: "http://ops.example.com/functions/v1" }))
      .toThrow("must use HTTPS outside loopback development");
    expect(resolveOpsBaseUrl({ enabled: true, baseUrl: "http://127.0.0.1:54321/functions/v1" }))
      .toBe("http://127.0.0.1:54321/functions/v1");
    expect(() => resolveOpsBaseUrl({ enabled: true, baseUrl: "https://user:pass@ops.example.com" }))
      .toThrow(OpsConfigurationError);
    expect(() => resolveOpsBaseUrl({ enabled: true, baseUrl: "https://ops.example.com/functions/v1?q=1" }))
      .toThrow(OpsConfigurationError);
    expect(() => resolveOpsFunctionUrl("../receive-lead", {
      enabled: true,
      baseUrl: "https://ops.example.com/functions/v1",
    })).toThrow(OpsConfigurationError);
  });

  it("keeps the retired bridge off by default and performs zero network calls", async () => {
    expect(isOpsLegacyBridgeEnabled()).toBe(false);
    const fetchImpl = vi.fn<typeof fetch>();

    const result = await dispatchLegacyOpsJson({
      url: "https://ops.example.com/functions/v1/receive-lead",
      secret: "test-secret",
      payload: { lead_email: "must-not-leave@example.com" },
      fetchImpl,
    });

    expect(result).toEqual({ attempted: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Portal and Ops project portability contracts", () => {
  it("derives browser calls from VITE_SUPABASE_URL without a Portal project ref", () => {
    for (const file of [
      "src/lib/opsSync.ts",
      "src/lib/opsTaskSync.ts",
      "src/pages/AdminBackfillPage.tsx",
    ]) {
      const source = read(file);
      expect(source).toContain("VITE_SUPABASE_URL");
      expect(source).toContain("/functions/v1/");
      expect(source).not.toMatch(hardcodedSupabaseProjectUrl);
    }
  });

  it("uses the shared resolver in every scoped Edge Function", () => {
    const resolverByFile: Record<string, string> = {
      "supabase/functions/backfill-tasks-to-ops/index.ts": "resolvePortalFunctionUrl",
      "supabase/functions/backfill-to-ops/index.ts": "resolveOpsReceiveLeadUrl",
      "supabase/functions/backfill-clients-to-ops/index.ts": "resolveOpsReceiveLeadUrl",
      "supabase/functions/submit-quiz/index.ts": "resolveOpsReceiveLeadUrl",
      "supabase/functions/portal-to-ops/index.ts": "resolveOpsReceivePortalSyncUrl",
      "supabase/functions/notify-ops/index.ts": "resolveOpsReceivePortalSyncUrl",
      "supabase/functions/sync-to-ops/index.ts": "resolveOpsReceivePortalSyncUrl",
      "supabase/functions/fetch-ops-metrics/index.ts": "resolveOpsFunctionUrl",
      "supabase/functions/pull-ops-nodes/index.ts": "resolveOpsBaseUrl",
    };

    for (const [file, resolver] of Object.entries(resolverByFile)) {
      const source = read(file);
      expect(source).toContain(`../_shared/ops-config.ts`);
      expect(source).toContain(resolver);
      expect(source).not.toMatch(hardcodedSupabaseProjectUrl);
    }
  });

  it("fails closed without a configured bridge and contains no legacy project fallback", () => {
    const source = read("supabase/functions/_shared/ops-config.ts");

    expect(source).toContain("OPS_BASE_URL");
    expect(source).toContain("OPS_LEGACY_BRIDGE_ENABLED");
    expect(source).toContain("OPS_RECEIVE_LEAD_URL");
    expect(source).toContain("OPS_RECEIVE_PORTAL_SYNC_URL");
    expect(source).toContain("OPS_RECEIVE_URL");
    expect(source).toContain("is required when the retired Ops bridge is enabled");
    expect(source).not.toMatch(hardcodedSupabaseProjectUrl);
  });

  it("fails closed when the bulk sync shared secret is absent", () => {
    const source = read("supabase/functions/sync-to-ops/index.ts");
    expect(source).toContain("if (!OPS_SECRET || received !== OPS_SECRET)");
  });

  it("requires the retired bridge kill switch and never uses the invitation bearer as an Ops id", () => {
    const source = read("supabase/functions/submit-quiz/index.ts");

    expect(source).toContain("isOpsLegacyBridgeEnabled");
    expect(source).toContain("enabled: OPS_ENABLED");
    expect(source).toContain('Deno.env.get("OPS_RECEIVE_LEAD_URL")');
    expect(source).toContain('Deno.env.get("OPS_BASE_URL")');
    expect(source).toContain('portal_submission_id: submissionId');
    expect(source).not.toContain('portal_submission_id: token');
    expect(source).not.toContain("const OPS_URL = resolveOpsReceiveLeadUrl();");
  });
});
