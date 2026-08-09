import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const auth = readFileSync(
  "supabase/functions/_shared/mcp-auth.ts",
  "utf8",
);
const migration = readFileSync(
  "supabase/migrations/20260807210000_bind_mcp_oauth_clients.sql",
  "utf8",
);

describe("MCP OAuth client binding", () => {
  it("checks every OAuth client before trusting its user token", () => {
    expect(auth).toContain("isAllowedOAuthClient(clientId)");
    expect(auth).toContain("is_allowed_mcp_oauth_client");
    expect(auth).not.toContain("MCP_OAUTH_ALLOWED_CLIENT_IDS");
  });

  it("grants admin only after the exact server-side user/client binding", () => {
    const oauthBlock = auth.slice(
      auth.indexOf("// 2) Supabase OAuth JWT path"),
      auth.indexOf("// 3) Known-but-revoked"),
    );

    expect(oauthBlock).toContain("MCP_ADMIN_OAUTH_BINDINGS");
    expect(oauthBlock).toContain("canGrantMcpOAuthAdmin");
    expect(oauthBlock).toContain("hasAdminRole: dataScope.unrestricted");
    expect(oauthBlock).toContain("isAllowedOAuthClient: oauthClientAllowed");
    expect(oauthBlock).toMatch(
      /exactAdminBinding\s*\?\s*\['admin'\]\s*:\s*oauthScopesForStaff/,
    );
    expect(oauthBlock.indexOf("const oauthClientAllowed"))
      .toBeLessThan(oauthBlock.indexOf("const exactAdminBinding"));
    expect(oauthBlock.indexOf("hasVerifiedSubject"))
      .toBeLessThan(oauthBlock.indexOf("const exactAdminBinding"));
  });

  it("allows only active public registrations with trusted exact redirect origins", () => {
    expect(migration).toContain("auth.oauth_clients");
    expect(migration).toContain("client.deleted_at IS NULL");
    expect(migration).toContain("client.client_type::text = 'public'");
    expect(migration).toContain("client.token_endpoint_auth_method = 'none'");
    expect(migration).toContain("https://chatgpt.com");
    expect(migration).toContain("https://chat.openai.com");
    expect(migration).toContain("NOT EXISTS");
    expect(migration).toContain("REVOKE ALL ON FUNCTION");
  });
});
