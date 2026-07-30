import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260730010000_fix_editorial_save_and_accounts.sql",
  ),
  "utf8",
);

const mediaHelper = migration.slice(
  migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.editorial_file_is_publishable_media",
  ),
  migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.create_and_link_editorial_account",
  ),
);

const accountRpc = migration.slice(
  migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.create_and_link_editorial_account",
  ),
);

describe("editorial save and account migration contract", () => {
  it("accepts a carousel whose child approval is owned by the approved root", () => {
    expect(mediaHelper).toContain("public.editorial_file_is_publishable(");
    expect(mediaHelper).not.toContain(
      "COALESCE(child.requires_approval, false)",
    );
    expect(mediaHelper).toContain("child.agency_approval_status <> 'approved'");
    expect(mediaHelper).toContain("child.approval_status <> 'none'");
    expect(mediaHelper).toContain("child.locked_at IS NULL");
  });

  it("aligns historical media detection while preserving document rejection", () => {
    expect(mediaHelper).toContain("root.file_url");
    expect(mediaHelper).toContain("root.storage_path");
    expect(mediaHelper).toContain("child.file_url");
    expect(mediaHelper).toContain("child.storage_path");
    expect(mediaHelper).toMatch(
      /'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'/,
    );
    expect(mediaHelper).toMatch(
      /'jpg', 'jpeg', 'png', 'gif', 'webp'[\s\S]*'mp4', 'webm', 'mov'/,
    );
  });

  it("creates and links a supported account atomically under explicit authorization", () => {
    expect(accountRpc).toContain("RETURNS uuid");
    expect(accountRpc).toContain("SECURITY DEFINER");
    expect(accountRpc).toContain("SET search_path = ''");
    expect(accountRpc).toContain("public.can_manage_client(p_client_id)");
    expect(accountRpc).toContain("project.deleted_at IS NULL");
    expect(accountRpc).toMatch(
      /'instagram'[\s\S]*'facebook'[\s\S]*'tiktok'[\s\S]*'linkedin'[\s\S]*'youtube'[\s\S]*'google_business'/,
    );
    expect(accountRpc).toContain("INSERT INTO public.external_accounts");
    expect(accountRpc).toContain(
      "INSERT INTO public.project_external_accounts",
    );
  });

  it("exposes only the guarded account RPC to authenticated users", () => {
    expect(accountRpc).toMatch(
      /REVOKE ALL ON FUNCTION public\.create_and_link_editorial_account\([\s\S]*FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(accountRpc).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.create_and_link_editorial_account\([\s\S]*TO authenticated;/,
    );
  });
});
