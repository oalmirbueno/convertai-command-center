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
