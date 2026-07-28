import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const app = read("src/App.tsx");
const layout = read("src/components/AppLayout.tsx");
const mobileNav = read("src/components/MobileBottomNav.tsx");
const page = read("src/pages/EditorialCalendar.tsx");
const hook = read("src/hooks/useEditorialCalendar.ts");
const editor = read("src/components/editorial/EditorialEditor.tsx");
const views = read(
  "src/components/editorial/EditorialCalendarViews.tsx",
);
const detail = read(
  "src/components/editorial/EditorialDetailSheet.tsx",
);
const migration = read(
  "supabase/migrations/20260728161129_create_editorial_calendar.sql",
);

describe("editorial calendar integration contract", () => {
  it("exposes one protected route in desktop and mobile navigation", () => {
    expect(app).toContain('path="/calendario"');
    expect(layout).toContain(
      '{ title: "Calendário", url: "/calendario"',
    );
    expect(mobileNav).toContain('to="/calendario"');
  });

  it("keeps filters and the selected content in shareable URL state", () => {
    expect(page).toContain("useSearchParams");
    expect(page).toContain('searchParams.get("view")');
    expect(page).toContain('searchParams.get("date")');
    expect(page).toContain('searchParams.get("platform")');
    expect(page).toContain('searchParams.get("status")');
    expect(page).toContain('searchParams.get("production")');
    expect(page).toContain('searchParams.get("approval")');
    expect(page).toContain('searchParams.get("responsible")');
    expect(page).toContain('searchParams.get("content")');
  });

  it("uses guarded RPCs for every editorial write", () => {
    expect(hook).toContain('.rpc("save_editorial_post"');
    expect(hook).toContain(
      '"transition_editorial_publication"',
    );
    expect(hook).toContain('.rpc(\n        "archive_editorial_post"');
    expect(hook).not.toMatch(
      /\.from\(\s*["']editorial_[^"']+["']\s*\)\s*\.(?:insert|update|delete)\s*\(/,
    );
    expect(editor).not.toMatch(
      /\.from\(\s*["']editorial_[^"']+["']\s*\)/,
    );
    expect(detail).not.toMatch(
      /\.from\(\s*["']editorial_[^"']+["']\s*\)/,
    );
  });

  it("does not call social APIs or store social credentials", () => {
    const editorialSources = [page, hook, editor, detail, migration].join(
      "\n",
    );
    expect(editorialSources).not.toMatch(/\bfetch\s*\(/);
    expect(editorialSources).not.toMatch(
      /access_token|refresh_token|client_secret|oauth_token/i,
    );
    expect(page).toMatch(
      /Nenhuma\s+rede social é acionada automaticamente\./,
    );
    expect(detail).toMatch(
      /Nenhuma\s+plataforma\s+externa\s+é\s+acionada\s+automaticamente\./,
    );
  });

  it("keeps impersonation read-only and strips internal records", () => {
    expect(page).toContain(
      "{ forceClientView: isImpersonating }",
    );
    expect(page).toContain("const canCreateEditorial =");
    expect(page).toContain("permissions.canEdit &&");
    expect(page).toContain("!isImpersonating &&");
    expect(page).toContain("!editorialOptionsLoading &&");
    expect(page).toContain("!editorialOptionsError");
    expect(page).toContain("canCreate={canCreateEditorial}");
    expect(hook).toContain("const exposeInternal = actualStaff && !forceClientView");
    expect(hook).toContain("internal: null");
    expect(hook).toContain(
      "internal?.included_in_approval_snapshot === true",
    );
    expect(hook).toContain("bundle.publications.length > 0");
    expect(detail).toContain("!isImpersonating");
  });

  it("offers the guarded archive RPC through the detail view", () => {
    expect(hook).toContain('"archive_editorial_post"');
    expect(detail).toContain("archivePost.mutateAsync");
    expect(detail).toContain("expectedVersion: post.post.version");
    expect(page).toContain('onArchived={() => setParam("content", "")}');
  });

  it("keeps cancelled plans reachable for audit and reopening", () => {
    expect(hook).not.toContain(
      'publication.scheduled_at || publication.status !== "cancelled"',
    );
    expect(views).toContain(
      "const unscheduled = post.publications.filter(",
    );
    expect(detail).toContain('openAction(bundle, "reopen")');
  });
});

describe("editorial migration security contract", () => {
  it("separates safe and internal data behind RLS", () => {
    expect(migration).toContain(
      "CREATE TABLE public.editorial_post_internal",
    );
    expect(migration).toContain(
      "CREATE TABLE public.editorial_publication_internal",
    );
    expect(migration).toContain(
      "ALTER TABLE public.editorial_events ENABLE ROW LEVEL SECURITY",
    );
    expect(migration).toContain(
      "CREATE POLICY editorial_post_internal_staff_select",
    );
    expect(migration).not.toContain(
      "editorial_post_internal_client_select",
    );
    expect(migration).not.toContain(
      "editorial_events_client_select",
    );
  });

  it("requires the complete existing file double-gate", () => {
    const helperStart = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.editorial_file_is_publishable",
    );
    const helperEnd = migration.indexOf(
      "REVOKE ALL ON FUNCTION public.editorial_staff_can_access_client",
      helperStart,
    );
    const helper = migration.slice(helperStart, helperEnd);

    expect(helperStart).toBeGreaterThan(-1);
    expect(helper).toContain("agency_approval_status = 'approved'");
    expect(helper).toContain("visibility = 'approval'");
    expect(helper).toContain("approval_status = 'approved'");
    expect(helper).toContain("locked_at IS NOT NULL");
    expect(helper).toContain("status, 'ready') = 'ready'");
  });

  it("blocks direct writes for authenticated and service roles", () => {
    expect(migration).toContain(
      "REVOKE ALL ON public.editorial_posts FROM PUBLIC, anon, authenticated",
    );
    expect(migration).toContain(
      "REVOKE ALL ON public.editorial_posts FROM service_role",
    );
    expect(migration).toContain(
      "GRANT SELECT ON public.editorial_posts TO service_role",
    );
    expect(migration).not.toContain(
      "GRANT SELECT, INSERT, UPDATE ON public.editorial_posts TO service_role",
    );
    expect(migration).not.toContain(
      "GRANT INSERT ON public.editorial_events TO service_role",
    );
  });

  it("does not expose the file approval oracle to API roles", () => {
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.editorial_file_is_publishable(uuid, uuid, uuid)",
    );
    expect(migration).toContain(
      "FROM PUBLIC, anon, authenticated, service_role",
    );
    expect(migration).not.toContain(
      "GRANT EXECUTE ON FUNCTION public.editorial_file_is_publishable",
    );
  });

  it("binds file approval to the exact editorial payload", () => {
    expect(migration).toContain("approval_fingerprint text");
    expect(migration).toContain(
      "CREATE UNIQUE INDEX editorial_posts_primary_file_unique_idx",
    );
    expect(migration).toContain(
      "_existing_post_internal.approval_fingerprint",
    );
    expect(migration).toContain(
      "IS DISTINCT FROM _approval_fingerprint",
    );
    expect(migration).toContain("_post_internal.approval_fingerprint IS NULL");
    expect(migration).toContain(
      "encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex')",
    );
    expect(migration).not.toContain("editorial_payload_hash");
    expect(migration).not.toContain("md5(");
  });

  it("makes history append-only and transition versions mandatory", () => {
    expect(migration).toContain(
      "editorial history is append-only",
    );
    expect(migration).toContain(
      "publication expected version is required",
    );
    expect(migration).toContain(
      "editorial post expected version is required",
    );
    expect(migration).toContain("USING ERRCODE = '40001'");
    expect(migration).toContain(
      "Advancing\n  -- the parent CAS on every real transition",
    );
    expect(migration).toContain("'post_version', _post.version");
    expect(migration).toContain(
      "ADD TABLE public.editorial_events",
    );
  });
});
