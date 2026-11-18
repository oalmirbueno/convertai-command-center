// 18/11/2026: o dono pediu o menu organizado, com uma área de Produtos (CRM e E-mail separados).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { areaDaRota } from "@/pages/AdminProduto";

const layout = readFileSync("src/components/AppLayout.tsx", "utf8");

describe("menu: área de Produtos", () => {
  it("tem o grupo Produtos com CRM e E-mail cada um na sua rota", () => {
    expect(layout).toContain('label: "Produtos"');
    expect(layout).toContain('{ title: "CRM", url: "/produto/crm"');
    expect(layout).toContain('{ title: "E-mail", url: "/produto/email"');
    expect(layout).not.toContain('{ title: "CRM e E-mail", url: "/produto"');
  });
  it("o CRM do comercial se chama CRM de vendas e a conversa com clientes tem grupo próprio", () => {
    expect(layout).toContain('{ title: "CRM de vendas", url: "/comercial/crm"');
    expect(layout).toContain('label: "Clientes"');
  });
});

describe("AdminProduto: a área sai da rota (e o ?area= antigo ainda vale)", () => {
  it("lê a rota", () => {
    expect(areaDaRota("crm", null)).toBe("empresas");
    expect(areaDaRota("email", null)).toBe("email");
    expect(areaDaRota("faturamento", null)).toBe("faturamento");
    expect(areaDaRota(undefined, null)).toBe("monitor");
  });
  it("aceita o link antigo e ignora lixo", () => {
    expect(areaDaRota(undefined, "empresas")).toBe("empresas");
    expect(areaDaRota("qualquer", "nada")).toBe("monitor");
  });
});
