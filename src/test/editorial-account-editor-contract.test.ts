import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const hook = read("src/hooks/useEditorialCalendar.ts");
const editor = read("src/components/editorial/EditorialEditor.tsx");
const accountSetup = read(
  "src/components/editorial/EditorialAccountSetup.tsx",
);
const clientConnections = read(
  "src/components/admin/ClientConnectionsPanel.tsx",
);

describe("editorial account setup contract", () => {
  it("loads linked and still-available supported accounts for the client", () => {
    expect(hook).toContain("allAccounts");
    expect(hook).toContain(".in(\"platform\", [...EDITORIAL_PLATFORMS])");
    expect(hook).toContain('.eq("status", "active")');
    expect(hook).toContain("const linkedAccountIdSet = new Set");
    expect(hook).toContain("availableAccounts");
    expect(editor).toContain("availableAccounts={options.availableAccounts}");
  });

  it("creates and links an account atomically through the guarded RPC", () => {
    expect(hook).toContain('"create_and_link_editorial_account"');
    expect(hook).toContain("p_client_id: clientId");
    expect(hook).toContain("p_project_id: projectId");
    expect(hook).toContain("p_platform: platform");
    expect(hook).toContain("p_display_name: displayName");
    expect(hook).toContain("p_handle: handle");
    expect(accountSetup).toContain("EDITORIAL_PLATFORMS.map");
    expect(accountSetup).toContain("Cadastrar e usar");
  });

  it("links an existing account under the current RLS policies", () => {
    expect(hook).toMatch(
      /\.from\("project_external_accounts"\)\s*\.insert\(\{/,
    );
    expect(hook).toContain("external_account_id: accountId");
    expect(accountSetup).toContain("Vincular e usar");
  });

  it("refreshes account options immediately and selects the new account", () => {
    expect(hook).toContain(
      'queryKey: ["editorial-editor-options"]',
    );
    expect(hook).toContain("await refreshAccounts()");
    expect(editor).toContain("onAccountReady={selectAccountForPublication}");
    expect(editor).toContain("externalAccountId: accountId");
    expect(clientConnections).toContain(
      'queryKey: ["editorial-editor-options"]',
    );
  });

  it("does not offer account writes without confirmed permission", () => {
    expect(hook).toContain('.rpc("can_manage_client"');
    expect(hook).toContain("accountPermissionUnavailable");
    expect(accountSetup).toContain("Somente administradores e responsáveis");
    expect(accountSetup).toContain("{canManage && showForm &&");
    expect(accountSetup).toContain("!canManage && linkedAccountCount > 0");
    expect(accountSetup).toContain("Publicar automaticamente ainda");
  });
});
