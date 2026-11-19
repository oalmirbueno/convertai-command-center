// 18/11/2026: o dono pediu a gestão do CRM e a do E-mail separadas, cada uma com a sua área no menu e a sua tela.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { abaDaRota, enderecoNovo } from "@/pages/AdminProduto";

const layout = readFileSync("src/components/AppLayout.tsx", "utf8");
const precos = readFileSync("src/components/produto/casa/PrecosDoProduto.tsx", "utf8");

describe("menu: Produto CRM e Produto E-mail separados", () => {
  it("cada produto tem o seu grupo e as suas rotas", () => {
    expect(layout).toContain('label: "Produto CRM"');
    expect(layout).toContain('label: "Produto E-mail"');
    expect(layout).toContain('{ title: "Empresas", url: "/produto/crm/empresas"');
    expect(layout).toContain('{ title: "Entradas e migrações", url: "/produto/email/entradas"');
    expect(layout).not.toContain('label: "Produtos"');
    expect(layout).not.toContain('{ title: "CRM e E-mail", url: "/produto"');
  });
  it("o CRM do comercial se chama CRM de vendas e a conversa com clientes tem grupo próprio", () => {
    expect(layout).toContain('{ title: "CRM de vendas", url: "/vendas/crm"');
    expect(layout).toContain('label: "Clientes"');
  });
});

describe("AdminProduto: endereços", () => {
  it("os antigos caem na tela certa", () => {
    expect(enderecoNovo(undefined, null)).toBe("/produto/crm");
    expect(enderecoNovo(undefined, "empresas")).toBe("/produto/crm/empresas");
    expect(enderecoNovo(undefined, "email")).toBe("/produto/email/entradas");
    expect(enderecoNovo("central", null)).toBe("/produto/email");
    expect(enderecoNovo("caixa", null)).toBe("/produto/email/caixa");
    expect(enderecoNovo("faturamento", null)).toBe("/produto/crm/faturamento");
  });
  it("os novos ficam onde estão e a aba desconhecida vira a primeira", () => {
    expect(enderecoNovo("crm", null)).toBeNull();
    expect(enderecoNovo("email", "empresas")).toBeNull();
    expect(abaDaRota("crm", "empresas")).toBe("empresas");
    expect(abaDaRota("email", "empresas")).toBe("inicio");
    expect(abaDaRota("email", undefined)).toBe("inicio");
  });
});

describe("preços: cada produto vê só o que é dele", () => {
  it("o e-mail não mostra planos nem cobrança; o CRM não mostra o preço do e-mail", () => {
    expect(precos).toContain('{doCrm && (\n      <Secao\n        titulo="Planos"');
    expect(precos).toContain("{doEmail && (");
    expect(precos).toContain('const doEmail = parte !== "crm";');
  });
});
