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
const metaClient = read("src/lib/socialMetaOAuth.ts");
const metaHook = read("src/hooks/useMetaOAuth.ts");
const metaCallback = read("src/pages/MetaOAuthCallback.tsx");
const app = read("src/App.tsx");
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
    expect(clientConnections).toContain(
      "availableAccounts={availablePublishingAccounts}",
    );
  });

  it("creates and links an account atomically through the guarded RPC", () => {
    expect(hook).toContain('"create_and_link_editorial_account"');
    expect(hook).toContain("p_client_id: clientId");
    expect(hook).toContain("p_project_id: projectId");
    expect(hook).toContain("p_platform: platform");
    expect(hook).toContain("p_display_name: displayName");
    expect(hook).toContain("p_handle: handle");
    expect(accountSetup).toContain("EDITORIAL_PLATFORMS.map");
    expect(accountSetup).toContain("Cadastrar manualmente e usar");
  });

  it("links an existing account under the current RLS policies", () => {
    expect(hook).toMatch(
      /\.from\("project_external_accounts"\)\s*\.insert\(\{/,
    );
    expect(hook).toContain("external_account_id: accountId");
    expect(accountSetup).toContain("Vincular e usar");
  });

  it("refreshes account options immediately inside the selected client project", () => {
    expect(hook).toContain(
      'queryKey: ["editorial-editor-options"]',
    );
    expect(hook).toContain("await refreshAccounts()");
    expect(clientConnections).toContain("linkedPublishingAccounts");
    expect(clientConnections).toContain("availablePublishingAccounts");
    expect(clientConnections).toContain("onAccountReady={() => undefined}");
    expect(clientConnections).toContain(
      'queryKey: ["editorial-editor-options"]',
    );
  });

  it("does not offer account writes without confirmed permission", () => {
    expect(clientConnections).toContain('.rpc("can_manage_client"');
    expect(hook).toContain("accountPermissionUnavailable");
    expect(accountSetup).toContain("Somente administradores e responsáveis");
    expect(accountSetup).toContain("{canManage && showForm &&");
    expect(accountSetup).toContain("!canManage && linkedAccountCount > 0");
    // O texto mudou quando a publicação automática passou a funcionar de
    // verdade. A regra continua: a tela não promete mais do que entrega, e o
    // que libera a publicação é o material aprovado e agendado, não a conexão.
    expect(accountSetup).toMatch(
      /material\s+aprovado e agendado é publicado pelo painel/,
    );
  });

  it("loads persisted connection state without enabling automation", () => {
    expect(hook).toContain('.from("external_account_connections")');
    expect(hook).toContain(
      '"external_account_id, connection_status, automation_enabled"',
    );
    expect(hook).toContain('.eq("client_id", clientId)');
    expect(hook).toContain("connectionByAccountId");
    expect(hook).toContain('("manual" as const)');
    expect(accountSetup).toContain('return "Conectada"');
    expect(accountSetup).toContain('return "Expirada"');
    expect(accountSetup).toContain('return "Manual"');
    // Conectar a conta continua NÃO sendo o que liga a publicação: quem manda
    // é o material aprovado e agendado.
    expect(accountSetup).toMatch(
      /A conexão identifica e vincula a conta\./,
    );
    expect(accountSetup).not.toContain("transitionEditorialPublication");
  });

  it("uses the typed Meta OAuth function contract without provider secrets", () => {
    expect(metaClient).toContain('META_OAUTH_FUNCTION_NAME = "social-meta-oauth"');
    for (const action of [
      "start",
      "complete",
      "connect",
      "finish",
      "disconnect",
    ]) {
      expect(metaClient).toContain(`action: "${action}"`);
    }
    expect(metaClient).toContain("client_id: clientId");
    expect(metaClient).toContain("project_id: projectId");
    expect(metaClient).toContain("return_path: returnPath");
    expect(metaClient).toContain("oauth_session_id:");
    expect(metaClient).toContain("candidate_id:");
    expect(metaClient).toContain("external_account_id:");
    expect(metaClient).not.toMatch(/client_secret|access_token|refresh_token/i);
    expect(metaClient).not.toMatch(/graph\.facebook|graph\.instagram|\bfetch\s*\(/i);
    expect(metaHook).toContain("startMetaOAuth");
    expect(metaHook).toContain("connectMetaOAuth");
    expect(metaHook).toContain("finishMetaOAuth");
    expect(metaHook).toContain("disconnectMetaOAuth");
  });

  it("keeps one OAuth session open for multiple Meta resources", () => {
    expect(accountSetup).toContain("connectedMetaCandidateIds");
    expect(accountSetup).toContain("Você pode escolher outra ou concluir");
    expect(accountSetup).toContain("Concluir");
    expect(accountSetup).toContain(
      "connectedCandidateIds.length >= metaResources.length",
    );
    expect(accountSetup).toContain("await finalizeMetaSession(activeSession)");
    expect(accountSetup).not.toMatch(
      /setMetaDialogOpen\(false\);\s*setMetaSessionId\(""\);\s*setMetaResources\(\[\]\);\s*onAccountReady/,
    );
  });

  it("ignores stale Meta responses and separates cache refresh from success", () => {
    expect(accountSetup).toContain("scopeRef.current.clientId");
    expect(accountSetup).toContain("scopeRef.current.projectId");
    expect(accountSetup).toContain("activeMetaSessionRef.current?.id");
    expect(metaHook).toContain("Promise.allSettled");
    expect(metaHook).toContain("onSuccess: refreshAccounts");
  });

  it("monitors popup closure and timeout with cleanup", () => {
    expect(accountSetup).toContain("META_POPUP_TIMEOUT_MS");
    expect(accountSetup).toContain("window.setInterval");
    expect(accountSetup).toContain("window.setTimeout");
    expect(accountSetup).toContain("clearPopupMonitoring");
    expect(accountSetup).toContain("popup.closed");
  });

  it("finalizes temporary sessions without rolling back connected accounts", () => {
    expect(metaClient).toContain('action: "finish"');
    expect(accountSetup).toContain("finishSessionAsyncRef.current");
    expect(accountSetup).toContain("toast.warning");
    expect(accountSetup).toContain("A conta foi preservada");
    expect(accountSetup).toContain("handleFinishMetaConnection");
  });

  it("keeps revoked state distinct and account setup outside content creation", () => {
    expect(hook).toContain('connection.connection_status === "revoked"');
    expect(accountSetup).toContain('return "Desconectada"');
    expect(editor).not.toContain("selectAccountForPublication");
    expect(editor).not.toContain("<EditorialAccountSetup");
    expect(clientConnections).toContain("<EditorialAccountSetup");
  });

  it("opens the popup synchronously and accepts only its same-origin result", () => {
    const popupOpen = accountSetup.indexOf("const popup = window.open(");
    const startRequest = accountSetup.indexOf(
      "await startConnection.mutateAsync()",
      popupOpen,
    );

    expect(popupOpen).toBeGreaterThan(-1);
    expect(startRequest).toBeGreaterThan(popupOpen);
    expect(accountSetup).toContain("event.origin !== window.location.origin");
    expect(accountSetup).toContain("event.source !== popup");
    expect(accountSetup).toContain("parseMetaOAuthPopupMessage(event.data)");
    expect(accountSetup).toContain("Entrar com Facebook/Meta");
    expect(accountSetup).toContain("onAccountReady(accountId)");
  });

  it("makes the target client and project explicit and provides account search", () => {
    expect(clientConnections).toContain("clientName={clientName}");
    expect(clientConnections).toContain("projectName={publishingProject.name");
    expect(accountSetup).toContain("Destino obrigatório do vínculo");
    expect(accountSetup).toContain("{clientName}");
    expect(accountSetup).toContain("{projectName}");
    expect(accountSetup).toContain("filterMetaOAuthResources");
    expect(accountSetup).toContain("Pesquisar por nome, @ ou plataforma");
    expect(accountSetup).toContain("Nenhuma conta encontrada");
    expect(accountSetup).toContain("Vincular");
    expect(accountSetup).not.toMatch(
      /type=["']password["']|name=["']password["']/i,
    );
  });

  it("marks official Meta accounts and protects their provider identity", () => {
    expect(clientConnections).toContain(
      '.from("external_account_connections")',
    );
    expect(clientConnections).toContain("officialAccountIds");
    expect(clientConnections).toContain("Oficial Meta");
    expect(clientConnections).toContain("disabled={editingOfficial}");
    expect(clientConnections).toContain("readOnly={editingOfficial}");
    expect(clientConnections).toContain(
      "plataforma e ID são protegidos",
    );
  });

  it("protects the callback, strips its URL and messages only a same-origin opener", () => {
    expect(app).toContain('path="/oauth/meta/callback"');
    expect(app).toMatch(
      /path="\/oauth\/meta\/callback"[^\n]*<ProtectedRoute><MetaOAuthCallback \/><\/ProtectedRoute>/,
    );
    expect(metaCallback).toContain(
      "opener.location.origin === window.location.origin",
    );
    expect(metaCallback).toContain(
      "opener.postMessage(message, window.location.origin)",
    );
    expect(metaCallback).toContain("window.history.replaceState(");
    expect(metaCallback).toContain("window.close()");
    expect(metaCallback).toContain("completeMetaOAuth({ code, state })");
    expect(metaCallback).toContain("metaOAuthCompletions");
    expect(metaCallback).toContain("completeMetaOAuthOnce(code, state)");
  });
});
