import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("costly and PII-bearing Edge Functions", () => {
  it("requires an authenticated workspace role before OCR provider use", () => {
    const source = read("supabase/functions/workspace-ocr/index.ts");

    expect(source).toContain("caller.auth.getUser(token)");
    expect(source).toContain('.from("user_roles")');
    expect(source).toContain("ALLOWED_ROLES");
    expect(source.indexOf("requireWorkspaceUser(req)")).toBeLessThan(
      source.indexOf("requestAiChatCompletion(providers"),
    );
    expect(source).toContain("MAX_REQUEST_BYTES");
    expect(source).toMatch(/\^data:image\\\//);
    expect(source).toContain('claim_ai_usage');
    expect(source).toContain('_workload: "workspace-ocr"');
  });

  it("applies an atomic per-user quota before every Workspace AI workload", () => {
    const agent = read("supabase/functions/workspace-agent/index.ts");
    const importer = read("supabase/functions/workspace-agent-import/index.ts");
    const migration = read(
      "supabase/migrations/20260807219000_atomic_ai_usage_quota.sql",
    );

    expect(agent).toContain('_workload: "workspace-agent-editor"');
    expect(agent).toContain('_workload: "workspace-agent-chat"');
    expect(agent).toContain("STAFF_ROLES");
    expect(importer).toContain('_workload: "workspace-agent-import"');
    expect(migration).toContain("ON CONFLICT (user_id, workload, window_start) DO UPDATE");
    expect(migration).toContain("public.ai_usage_hourly.request_count < _limit");
    expect(migration).toMatch(/GRANT EXECUTE[\s\S]*TO authenticated/);
  });

  it("fails closed when the retired Ops bridge secret is absent", () => {
    const quizSource = read("supabase/functions/ops-quiz-list/index.ts");
    const schemaSource = read("supabase/functions/describe-schema/index.ts");

    expect(quizSource).toContain('if (!SECRET || req.headers.get("x-webhook-secret") !== SECRET)');
    expect(quizSource).not.toContain('if (SECRET && req.headers.get("x-webhook-secret") !== SECRET)');
    expect(schemaSource).toContain(
      'if (!EXPECTED_SECRET || req.headers.get("x-webhook-secret") !== EXPECTED_SECRET)',
    );
  });

  it("bounds and rate-limits authenticated notification fanout", () => {
    const source = read("supabase/functions/notify-admin/index.ts");
    const migration = read(
      "supabase/migrations/20260807220000_rate_limit_notification_dispatch.sql",
    );
    expect(source).toContain("MAX_REQUEST_BYTES");
    expect(source).toContain("NOTIFICATION_TYPES");
    expect(source).toContain('rpc("claim_notification_dispatch")');
    expect(source).toContain('link.startsWith("//")');
    expect(source).not.toContain("JSON.stringify({ error: e.message })");
    expect(migration).toContain("ON CONFLICT (user_id, window_start) DO UPDATE");
    expect(migration).toContain("THEN 120 ELSE 10");
  });
});
