import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationNames = [
  "20260505022451_4daa3d28-efa6-4993-b8c8-6fc678fe0f37.sql",
  "20260505022542_b2913727-2ed9-4c6b-adba-24e4e708b78a.sql",
];

const migrations = migrationNames.map((name) => readFileSync(
  resolve(process.cwd(), "supabase/migrations", name),
  "utf8",
));

const hardeningMigrationNames = readdirSync(
  resolve(process.cwd(), "supabase/migrations"),
).filter((name) => /^\d{14}_harden_notify_ops_sync_vault\.sql$/.test(name));
const hardeningMigration = hardeningMigrationNames.length === 1
  ? readFileSync(
      resolve(process.cwd(), "supabase/migrations", hardeningMigrationNames[0]),
      "utf8",
    )
  : "";

describe("retired Ops trigger migrations", () => {
  it("contain no project-specific endpoint or embedded webhook credential", () => {
    for (const source of migrations) {
      expect(source).not.toMatch(/https:\/\/[a-z]{20}\.supabase\.co/i);
      expect(source).not.toMatch(/v_secret\s+text\s*:=\s*'[^']+'/i);
    }
  });

  it("fail closed unless both legacy Vault entries are provisioned", () => {
    for (const source of migrations) {
      expect(source).toContain("ops_receive_portal_sync_url");
      expect(source).toContain("ops_webhook_secret");
      expect(source).toContain("if v_url is null or v_secret is null then");
    }
  });

  it("re-applies the hardened definition in one forward-only migration", () => {
    expect(hardeningMigrationNames).toHaveLength(1);
    expect(Number(hardeningMigrationNames[0].slice(0, 14))).toBeGreaterThan(
      20260807210000,
    );
    expect(hardeningMigration).toContain(
      "CREATE OR REPLACE FUNCTION public.notify_ops_sync()",
    );
    expect(hardeningMigration).toContain("SET search_path TO ''");
    expect(hardeningMigration).toContain("FROM public.projects AS project");
    expect(hardeningMigration).toContain(
      "FROM vault.decrypted_secrets AS secret",
    );
    expect(hardeningMigration).toContain("PERFORM net.http_post(");
    expect(hardeningMigration).toContain("pg_catalog.jsonb_build_object(");
    expect(hardeningMigration).toContain("ops_receive_portal_sync_url");
    expect(hardeningMigration).toContain("ops_webhook_secret");
    expect(hardeningMigration).toContain(
      "IF v_url IS NULL OR v_secret IS NULL THEN",
    );
    expect(hardeningMigration).toContain(
      "REVOKE ALL ON FUNCTION public.notify_ops_sync()",
    );
    expect(hardeningMigration).toContain("FROM PUBLIC, anon, authenticated");
    expect(hardeningMigration).not.toMatch(
      /https:\/\/[a-z0-9]{20}\.supabase\.co/i,
    );
    expect(hardeningMigration).not.toMatch(/SET search_path\s*=\s*public/i);
  });
});
