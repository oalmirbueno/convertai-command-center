import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bootstrap = readFileSync(
  "supabase/bootstrap/legacy_prerequisites.sql",
  "utf8",
);

describe("fresh database legacy bootstrap", () => {
  it("contains the production quiz contract instead of the old CI stub", () => {
    for (const requiredColumn of [
      "token text NOT NULL UNIQUE",
      "lead_email text",
      "icp_fit_score integer",
      "recommended_plan text",
      "updated_at timestamptz",
    ]) {
      expect(bootstrap).toContain(requiredColumn);
    }

    expect(bootstrap).toContain("trg_quiz_submissions_touch");
    expect(bootstrap).toContain("email_queue_dispatch");
    expect(bootstrap).toContain("email_queue_wake");
  });

  it("keeps deployment-specific URLs and secret values out of source", () => {
    expect(bootstrap).not.toMatch(/https:\/\/[a-z0-9]+\.supabase\.co/i);
    expect(bootstrap).toContain("email_queue_function_url");
    expect(bootstrap).toContain("email_queue_service_role_key");
  });
});
