import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const createFileMigration = read(
  "supabase/migrations/20260727170255_f9c52d42-ef4b-4ea9-94a0-e54c4af866de.sql",
);
const adminFiles = read("src/pages/AdminFiles.tsx");
const workspace = read("src/pages/Workspace.tsx");

describe("staff file access contract", () => {
  it.each(["admin", "manager", "design", "traffic"])(
    "allows the %s role through the guarded file creation RPC",
    (role) => {
      expect(createFileMigration).toContain(
        `public.has_role(_actor, '${role}'::public.app_role)`,
      );
    },
  );

  it("requires client and project access and never grants the client role", () => {
    expect(createFileMigration).toContain("public.can_access_client(_client_id)");
    expect(createFileMigration).toContain("public.can_staff_access_project(_project_id)");
    expect(createFileMigration).not.toContain(
      "public.has_role(_actor, 'client'::public.app_role)",
    );
  });

  it("keeps both staff surfaces gated and every new Files record internal", () => {
    expect(adminFiles).toContain('["design", "traffic", "manager"]');
    expect(workspace).toContain('["design", "traffic", "manager"]');
    expect(adminFiles).toContain('visibility: "internal"');
    expect(adminFiles).toContain('approval_status: "none"');
  });
});
