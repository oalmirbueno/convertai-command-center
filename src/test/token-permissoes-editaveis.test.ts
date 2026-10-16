import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 16/10: um agente do Paperclip concluiu que o token "não grava na Mesa" porque a
 * tela dizia que aceleriq:write só cria tarefas e rascunhos. A tela passa a dizer
 * o que cada escopo libera de fato e deixa editar as permissões de um token já
 * criado, sem gerar outro.
 */
const ler = (caminho: string) => readFileSync(resolve(process.cwd(), caminho), "utf8");

describe("Tela de tokens MCP: permissões claras e editáveis", () => {
  const painel = ler("src/components/admin/MCPManager.tsx");
  const auth = ler("supabase/functions/_shared/mcp-auth.ts");

  it("a dica de aceleriq:write cita tudo o que a expansão do servidor libera", () => {
    const expansao = auth.match(/'aceleriq:write':\s*\[([^\]]*)\]/)?.[1] ?? "";
    expect(expansao).toContain("mesas:write");
    expect(expansao).toContain("clients:write");
    const dica = painel.match(/id: "aceleriq:write"[^\n]*hint: "([^"]*)"/)?.[1] ?? "";
    for (const palavra of ["projetos", "tarefas", "relatórios", "arquivos", "clientes", "Mesas", "comercial"]) {
      expect(dica).toContain(palavra);
    }
  });

  it("oferece contracts:write como escopo sensível", () => {
    expect(painel).toMatch(/id: "contracts:write"[^\n]*danger: true/);
  });

  it("cada credencial tem o botão Editar permissões, que grava os escopos sem trocar o token", () => {
    expect(painel).toContain("Editar permissões de ${k.name}");
    expect(painel).toContain('supabase.from("api_keys").update({ scopes }).eq("id", k.id)');
    expect(painel).toContain("<EditarPermissoesDialog");
  });

  it("criar e editar usam a mesma lista de escopos, com Marcar todos", () => {
    expect((painel.match(/<ListaDeEscopos /g) ?? []).length).toBe(2);
    expect(painel).toContain('"Marcar todos"');
  });
});
