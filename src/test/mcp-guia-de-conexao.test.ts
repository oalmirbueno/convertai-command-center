import { describe, expect, it } from "vitest";
import { configDoMcp } from "@/components/admin/GuiaDeConexaoMcp";

// 18/11/2026: "Headers.append: 'Painel Aceleriq' is an invalid header name" vinha do nome do painel no
// campo do nome do cabeçalho. A configuração pronta sempre usa Authorization: Bearer <chave>.
describe("guia de conexão do MCP central", () => {
  const url = "https://x.supabase.co/functions/v1/mcp-server";
  it("Streamable HTTP: URL e cabeçalho Authorization com Bearer", () => {
    const c = JSON.parse(configDoMcp(url, "mcp_live_abc", "http"));
    expect(c.mcpServers.aceleriq).toEqual({ type: "http", url, headers: { Authorization: "Bearer mcp_live_abc" } });
  });
  it("STDIO: npx mcp-remote com o cabeçalho pela variável (sem espaço quebrando o argumento)", () => {
    const c = JSON.parse(configDoMcp(url, "mcp_live_abc", "stdio"));
    expect(c.mcpServers.aceleriq.command).toBe("npx");
    expect(c.mcpServers.aceleriq.args).toEqual(["-y", "mcp-remote", url, "--header", "Authorization:${AUTH_HEADER}"]);
    expect(c.mcpServers.aceleriq.env).toEqual({ AUTH_HEADER: "Bearer mcp_live_abc" });
  });
  it("nome do cabeçalho nunca é o nome do painel", () => {
    expect(configDoMcp(url, "k", "http")).not.toContain("Painel");
  });
});

describe("prompt pronto para a IA", async () => {
  const { promptDeConexao } = await import("@/components/admin/GuiaDeConexaoMcp");
  const p = promptDeConexao("https://x/mcp", "mcp_live_ABCDEFGHIJ");
  it("traz servidor, cabeçalho certo, STDIO e o teste pelo aceleriq_health", () => {
    expect(p).toContain("Servidor (Streamable HTTP): https://x/mcp");
    expect(p).toContain("nome Authorization e valor Bearer mcp_live_ABCDEFGHIJ");
    expect(p).toContain("npx -y mcp-remote https://x/mcp --header Authorization:${AUTH_HEADER}");
    expect(p).toContain("aceleriq_health");
    expect(p).toContain("public:discovery");
    expect(p).toContain("o começo certo é mcp_live_ABC…");
  });
});
