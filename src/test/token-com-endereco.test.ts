import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 16/10: ao gerar o token, o Almir colou o token no campo de URL do Paperclip
 * ("Paste a full http or https link"). A janela "Credencial criada" passa a
 * mostrar o endereço do servidor e o token juntos, cada um dizendo onde colar.
 */
const ler = (caminho: string) => readFileSync(resolve(process.cwd(), caminho), "utf8");

describe("Credencial criada mostra endereço e token", () => {
  const painel = ler("src/components/admin/MCPManager.tsx");
  const janela = painel.slice(painel.indexOf("Issued token modal"), painel.indexOf("Revoke confirm"));

  it("mostra o endereço do servidor com botão de copiar antes do token", () => {
    expect(janela).toContain("1. Endereço do servidor");
    expect(janela).toContain('copyText(MCP_URL, "Endereço copiado")');
    expect(janela.indexOf("1. Endereço do servidor")).toBeLessThan(janela.indexOf("2. Token completo"));
  });

  it("diz onde colar o token e qual opção escolher na conexão", () => {
    expect(janela).toContain('"App key"');
    expect(janela).toContain('sem escrever "Bearer"');
    expect(janela).toContain('nunca "sem login"');
  });
});
