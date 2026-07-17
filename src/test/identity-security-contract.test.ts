import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationsDir = resolve(root, "supabase/migrations");

const readUniqueMigrationContaining = (...markers: string[]) => {
  const matches = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => ({
      name,
      content: readFileSync(resolve(migrationsDir, name), "utf8"),
    }))
    .filter(({ content }) => markers.every((marker) => content.includes(marker)));

  if (matches.length !== 1) {
    throw new Error(
      `Expected one migration containing ${markers.join(", ")}; found ${matches.length}: ${matches.map(({ name }) => name).join(", ")}`,
    );
  }

  return matches[0].content;
};

const roleMigration = readUniqueMigrationContaining(
  "CREATE OR REPLACE FUNCTION public.replace_managed_user_role",
  "the last administrator cannot be demoted",
);
const authMigration = readUniqueMigrationContaining(
  "VALUES (NEW.id, 'client'::public.app_role)",
  "REVOKE ALL ON FUNCTION public.handle_new_user()",
  "CREATE OR REPLACE FUNCTION public.is_staff",
);
const manageTeam = readFileSync(
  resolve(root, "supabase/functions/manage-team/index.ts"),
  "utf8",
);
const teamPage = readFileSync(resolve(root, "src/pages/Team.tsx"), "utf8");
const editClientDrawer = readFileSync(
  resolve(root, "src/components/admin/EditClientDrawer.tsx"),
  "utf8",
);

describe("identity boundary required by the internal agent Kanban", () => {
  it("creates every auth signup as client and ignores user-editable role metadata", () => {
    expect(authMigration).toContain("VALUES (NEW.id, 'client'::public.app_role)");
    expect(authMigration).not.toMatch(/raw_user_meta_data\s*->>\s*'role'/);
    expect(authMigration).toContain("SET search_path = ''");
  });

  it("removes implicit public execution from privileged auth helpers", () => {
    expect(authMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.handle_new_user\(\)\s+FROM PUBLIC, anon, authenticated/,
    );
    expect(authMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.has_role\(uuid, public\.app_role\)\s+FROM PUBLIC, anon, authenticated/,
    );
    expect(authMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.is_staff\(uuid\)\s+TO authenticated, service_role/,
    );
    expect(authMigration.match(/SET search_path = ''/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("replaces roles atomically and protects the administrator boundary", () => {
    expect(roleMigration).toContain("public.replace_managed_user_role");
    expect(roleMigration).toContain("SECURITY INVOKER");
    expect(roleMigration).toContain("pg_advisory_xact_lock");
    expect(roleMigration).toContain("DELETE FROM public.user_roles");
    expect(roleMigration).toContain("INSERT INTO public.user_roles");
    expect(roleMigration).toContain("the last administrator cannot be demoted");
    expect(roleMigration).toContain("cannot demote their own account");
    expect(roleMigration).toContain("TO service_role");
    expect(roleMigration).toContain("user_roles_user_id_key UNIQUE (user_id)");
    expect(roleMigration).toContain("HAVING count(*) > 1");
    expect(roleMigration).toContain("REVOKE ALL ON TABLE public.user_roles FROM anon");
    expect(roleMigration).toMatch(
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON TABLE public\.user_roles FROM authenticated/,
    );
    expect(roleMigration).toContain(
      "GRANT SELECT ON TABLE public.user_roles TO authenticated, service_role",
    );
    expect(roleMigration).toContain('DROP POLICY IF EXISTS "user_roles_admin_insert"');
    expect(roleMigration).toContain('DROP POLICY IF EXISTS "user_roles_admin_update"');
    expect(roleMigration).toContain('DROP POLICY IF EXISTS "user_roles_admin_delete"');
  });

  it("allows only server-validated roles and activates users after setup", () => {
    expect(manageTeam).toContain("MANAGED_ROLES");
    expect(manageTeam).toContain("if (!MANAGED_ROLES.has(role))");
    expect(manageTeam).not.toContain("Temp@2026!");
    expect(manageTeam).not.toMatch(/user_metadata:\s*\{[^}]*role/);
    expect(manageTeam).toContain("replace_managed_user_role");
    expect(manageTeam).toContain('action === "update_role"');
    expect(manageTeam).toContain("email_confirm: false");
    expect(manageTeam).toContain("{ email_confirm: true }");
    expect(manageTeam).toContain("rollbackCreatedUser");
    expect(manageTeam).not.toContain("Password must be at least 6 characters");
    expect(manageTeam).toContain("Demote the administrator before deleting this account");
    expect(manageTeam).toMatch(/targetRoles\?\.some\(\(\{ role \}\) => role === "admin"\)/);
  });

  it("keeps role writes and explicit passwords behind the server boundary", () => {
    expect(teamPage).toContain("Senha Inicial *");
    expect(teamPage).toContain("Mínimo 8 caracteres");
    expect(teamPage).not.toContain("Temp@2026!");
    expect(teamPage).toContain('action: "update_role"');
    expect(teamPage).not.toMatch(/from\(["']user_roles["']\)[\s\S]{0,80}\.update/);
  });

  it("keeps every password editor aligned with the eight-character server rule", () => {
    expect(editClientDrawer).toContain("clientPassword.length < 8");
    expect(editClientDrawer).toContain("Senha deve ter no mínimo 8 caracteres");
    expect(editClientDrawer).not.toContain("clientPassword.length < 6");
  });
});
