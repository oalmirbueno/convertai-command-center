import { describe, expect, it } from "vitest";
import { resolveMcpEndpoints } from "./endpoints";

describe("resolveMcpEndpoints", () => {
  it("uses explicit portable MCP endpoints when configured", () => {
    expect(
      resolveMcpEndpoints({
        VITE_SUPABASE_URL: "https://old-project.supabase.co",
        VITE_MCP_SERVER_URL: "https://api.aceleriq.online/mcp/",
        VITE_MCP_OAUTH_METADATA_URL: "https://api.aceleriq.online/oauth/metadata/",
      }),
    ).toEqual({
      serverUrl: "https://api.aceleriq.online/mcp",
      oauthMetadataUrl: "https://api.aceleriq.online/oauth/metadata",
    });
  });

  it("falls back to the configured Supabase base URL", () => {
    expect(
      resolveMcpEndpoints({
        VITE_SUPABASE_URL: "https://proxy.example.com/supabase/",
      }),
    ).toEqual({
      serverUrl: "https://proxy.example.com/supabase/functions/v1/mcp-server",
      oauthMetadataUrl:
        "https://proxy.example.com/supabase/functions/v1/mcp-oauth-metadata",
    });
  });

  it("resolves each override independently", () => {
    expect(
      resolveMcpEndpoints({
        VITE_SUPABASE_URL: "https://project-ref.supabase.co",
        VITE_MCP_SERVER_URL: "https://mcp.aceleriq.online",
      }),
    ).toEqual({
      serverUrl: "https://mcp.aceleriq.online",
      oauthMetadataUrl:
        "https://project-ref.supabase.co/functions/v1/mcp-oauth-metadata",
    });
  });

  it("fails closed when neither an override nor Supabase is configured", () => {
    expect(() => resolveMcpEndpoints({})).toThrow("Configuração MCP ausente");
  });

  it("rejects non-HTTP endpoint protocols", () => {
    expect(() =>
      resolveMcpEndpoints({
        VITE_MCP_SERVER_URL: "file:///tmp/mcp",
        VITE_MCP_OAUTH_METADATA_URL: "https://api.example.com/oauth",
      }),
    ).toThrow("VITE_MCP_SERVER_URL precisa usar http ou https");
  });

  it("rejects insecure remote HTTP and allows loopback development", () => {
    expect(() =>
      resolveMcpEndpoints({
        VITE_MCP_SERVER_URL: "http://api.example.com/mcp",
        VITE_MCP_OAUTH_METADATA_URL: "https://api.example.com/oauth",
      }),
    ).toThrow("precisa usar https fora do ambiente local");

    expect(
      resolveMcpEndpoints({ VITE_SUPABASE_URL: "http://127.0.0.1:54321" }),
    ).toEqual({
      serverUrl: "http://127.0.0.1:54321/functions/v1/mcp-server",
      oauthMetadataUrl:
        "http://127.0.0.1:54321/functions/v1/mcp-oauth-metadata",
    });
  });

  it.each([
    "https://user:secret@api.example.com/mcp",
    "https://api.example.com/mcp?token=secret",
    "https://api.example.com/mcp#fragment",
  ])("rejects unsafe or ambiguous endpoint URLs: %s", (serverUrl) => {
    expect(() =>
      resolveMcpEndpoints({
        VITE_MCP_SERVER_URL: serverUrl,
        VITE_MCP_OAUTH_METADATA_URL: "https://api.example.com/oauth",
      }),
    ).toThrow("não pode conter credenciais, query string ou fragmento");
  });
});
