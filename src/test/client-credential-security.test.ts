import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const firstAccessFunction = read("supabase/functions/client-first-access/index.ts");
const manageTeamFunction = read("supabase/functions/manage-team/index.ts");
const apiGatewayFunction = read("supabase/functions/api-gateway/index.ts");
const firstAccessPage = read("src/pages/FirstAccess.tsx");
const loginPage = read("src/pages/Login.tsx");
const profilePage = read("src/pages/ProfilePage.tsx");
const editClientDrawer = read("src/components/admin/EditClientDrawer.tsx");
const createClientModal = read("src/components/admin/CreateClientModal.tsx");
const profileFields = read("src/lib/profileFields.ts");
const dataHooks = read("src/hooks/useSupabaseData.ts");
const viewAsClient = read("src/pages/AdminViewAsClient.tsx");

describe("client credential boundary", () => {
  it("never persists or reveals a client's password in profile data", () => {
    expect(firstAccessFunction).not.toMatch(/portal_password:\s*password/);
    expect(firstAccessFunction).toContain("portal_password: null");
    expect(editClientDrawer).not.toContain("client.portal_password");
    expect(editClientDrawer).not.toContain("navigator.clipboard");
    expect(editClientDrawer).not.toContain("Senha copiada!");
    expect(editClientDrawer).toContain("não pode ser visualizada");
    expect(createClientModal).not.toContain("portal_password:");
    expect(createClientModal).toContain("permanece privada e protegida");
  });

  it("uses the same eight-character minimum in the page and server", () => {
    expect(firstAccessFunction).toContain("password.length < 8");
    expect(firstAccessFunction).toContain("no mínimo 8 caracteres");
    expect(firstAccessPage).toContain("password.length < 8");
    expect(firstAccessPage).toContain('placeholder="Mínimo 8 caracteres"');
    expect(firstAccessPage).not.toContain("password.length < 6");
    expect(firstAccessPage).not.toContain("Mínimo 6 caracteres");
    expect(loginPage).toContain("password.length < 8");
    expect(loginPage).toContain("Mínimo 8 caracteres");
    expect(profilePage).toContain("newPassword.length < 8");
    expect(profilePage).toContain("Mínimo 8 caracteres");
    expect(loginPage).not.toContain("pw.length < 6");
    expect(loginPage).not.toContain("Mínimo 6 caracteres");
    expect(profilePage).not.toContain("Mínimo 6 caracteres");
  });

  it("keeps the first-access password exclusively in Supabase Auth", () => {
    const authUpdate = firstAccessFunction.indexOf(
      "admin.auth.admin.updateUserById",
    );
    const profileCleanup = firstAccessFunction.indexOf(
      "portal_password: null",
      authUpdate,
    );

    expect(authUpdate).toBeGreaterThan(-1);
    expect(profileCleanup).toBeGreaterThan(authUpdate);
    expect(firstAccessFunction).toContain("first_access_token: null");
    expect(firstAccessFunction).not.toContain("client-first-access token restore failed");
  });

  it("clears legacy profile credentials during an administrator reset", () => {
    const updatePasswordStart = manageTeamFunction.indexOf(
      'if (action === "update_password")',
    );
    const updatePasswordBlock = manageTeamFunction.slice(updatePasswordStart);

    expect(updatePasswordStart).toBeGreaterThan(-1);
    expect(updatePasswordBlock).toContain("portal_password: null");
    expect(updatePasswordBlock).toContain("first_access_token: null");
    expect(updatePasswordBlock).toContain("first_access_used_at: new Date().toISOString()");
    expect(updatePasswordBlock.indexOf("portal_password: null")).toBeGreaterThan(
      updatePasswordBlock.indexOf("auth.admin.updateUserById"),
    );
  });

  it("keeps sensitive profile columns out of browser query caches", () => {
    expect(profileFields).toContain("PROFILE_SAFE_SELECT");
    expect(profileFields).not.toContain("portal_password");
    expect(profileFields).not.toContain("first_access_token");
    expect(dataHooks.match(/select\(PROFILE_SAFE_SELECT\)/g)?.length).toBe(3);
    expect(viewAsClient).toContain("select(PROFILE_SAFE_SELECT)");
    expect(dataHooks).not.toMatch(
      /from\("profiles"\)[\s\S]{0,100}?select\("\*"\)/,
    );
    expect(viewAsClient).not.toMatch(
      /from\("profiles"\)[\s\S]{0,100}?select\("\*"\)/,
    );
  });

  it("keeps credentials out of the legacy API gateway", () => {
    const safeColumns = apiGatewayFunction.slice(
      apiGatewayFunction.indexOf("const SAFE_PROFILE_COLUMNS"),
      apiGatewayFunction.indexOf("const SAFE_PROFILE_UPDATES"),
    );

    expect(safeColumns).not.toContain("portal_password");
    expect(safeColumns).not.toContain("first_access_token");
    expect(apiGatewayFunction).not.toContain("profiles(*)");
    expect(apiGatewayFunction).not.toMatch(
      /from\('profiles'\)\.select\('\*'\)/,
    );
    expect(apiGatewayFunction).toContain("SAFE_PROFILE_UPDATES.has(key)");
    expect(apiGatewayFunction).toContain("sanitizeAuditInput(params)");
    expect(apiGatewayFunction).toContain("sanitizeAuditError(e.message");
  });
});
