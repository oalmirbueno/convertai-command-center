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

  it("mostra a configuração pronta: endereço do servidor, cabeçalho e a chave (18/11)", () => {
    expect(janela).toContain("<GuiaDeConexaoMcp url={MCP_URL} chave={issuedToken}");
    const guia = ler("src/components/admin/GuiaDeConexaoMcp.tsx");
    expect(guia.indexOf('rotulo="URL do servidor"')).toBeLessThan(guia.indexOf('rotulo="Nome do cabeçalho"'));
    expect(guia).toContain('valor="Authorization"');
  });

  it("diz onde colar o token e qual opção escolher na conexão", () => {
    expect(janela).toContain('"App key"');
    expect(janela).toContain('sem escrever "Bearer"');
    expect(janela).toContain('nunca "sem login"');
  });
});
