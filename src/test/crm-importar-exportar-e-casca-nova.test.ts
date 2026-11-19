import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { etapaDe, lerCsv, mapearColunas, paraCsv, paraNegocios, valorDe } from "@/lib/comercial/importar-exportar";
import { baseDaCasa, definirEscopoDoCrm, tabelaDoCrm } from "@/lib/comercial/escopo";

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("importar de outro CRM (19/11/2026)", () => {
  it("lê o CSV do HubSpot (vírgula) e do Excel brasileiro (ponto e vírgula, BOM, aspas)", () => {
    expect(lerCsv('Name,Company,Email\n"Silva, Ana",Loja X,ana@x.com\n')).toEqual([["Name", "Company", "Email"], ["Silva, Ana", "Loja X", "ana@x.com"]]);
    expect(lerCsv('﻿Nome;Empresa;Observações\r\nBia;"Pet ""Amigo""";"linha 1\nlinha 2"\r\n')).toEqual([["Nome", "Empresa", "Observações"], ["Bia", 'Pet "Amigo"', "linha 1\nlinha 2"]]);
  });

  it("acha as colunas sozinho, com nome de cada CRM", () => {
    const m = mapearColunas(["Nome do contato", "Organização - Nome", "E-mail", "Telefone celular", "Etapa do funil", "Valor", "Origem do lead", "Notas"]);
    expect(m).toMatchObject({ name: 0, company: 1, email: 2, whatsapp: 3, stage: 4, one_off_value: 5, origin: 6, notes: 7 });
    expect(mapearColunas(["Deal stage", "Amount", "First name"]).stage).toBe(0);
  });

  it("valor, etapa e repetidos", () => {
    expect(valorDe("R$ 1.234,56")).toBe(1234.56);
    expect(valorDe("1,234.56")).toBe(1234.56);
    expect(valorDe("abc")).toBe(0);
    expect(etapaDe("Closed Won")).toBe("ganho");
    expect(etapaDe("Proposta enviada")).toBe("proposta");
    expect(etapaDe("Reunião agendada")).toBe("diagnostico");
    expect(etapaDe("")).toBe("novo");
    const linhas = [["Ana", "ana@x.com", "(47) 99999-0000"], ["Ana de novo", "ANA@x.com", ""], ["Caio", "caio@y.com", "47 98888-1111"], ["", "", ""]];
    const mapa = { name: 0, email: 1, whatsapp: 2, company: -1, stage: -1, monthly_value: -1, one_off_value: -1, origin: -1, notes: -1, next_action: -1 };
    const r = paraNegocios(linhas, mapa, [{ whatsapp: "4798888-1111" }]);
    expect(r.negocios.map((n) => n.name)).toEqual(["Ana"]);
    expect(r.repetidos).toBe(2);
    expect(r.vazios).toBe(1);
    expect(r.negocios[0]).toMatchObject({ email: "ana@x.com", whatsapp: "47999990000", stage: "novo", origin: "manual" });
  });

  it("exporta para o Excel brasileiro", () => {
    const csv = paraCsv([{ name: "Ana; Silva", company: "Loja", stage: "proposta", monthly_value: 300, created_at: "2026-11-19T10:00:00Z" }], (id) => (id === "proposta" ? "Proposta" : id));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const [cab, linha] = csv.slice(1).split("\r\n");
    expect(cab.split(";")[0]).toBe("Nome");
    expect(linha).toBe('"Ana; Silva";Loja;;;Proposta;300,00;;;;;;19/11/2026');
  });
});

describe("a Aceleriq na casca nova (19/11/2026)", () => {
  it("o escopo da casa pode morar em /vendas sem mudar de tabela", () => {
    definirEscopoDoCrm({ modo: "casa", base: "/vendas" });
    expect(baseDaCasa()).toBe("/vendas");
    expect(tabelaDoCrm("commercial_leads")).toBe("commercial_leads");
    definirEscopoDoCrm(null);
    expect(baseDaCasa()).toBe("/comercial");
  });

  it("rota /vendas, menu e atalho do painel apontam para a casca nova", () => {
    const app = ler("src/App.tsx");
    expect(app).toContain('<Route path="/vendas/:aba" element={<ProtectedRoute><ComercialRoute><CrmDaCasa /></ComercialRoute></ProtectedRoute>} />');
    expect(ler("src/pages/CrmDaCasa.tsx")).toContain('definirEscopoDoCrm({ modo: "casa", base: "/vendas" })');
    expect(ler("src/pages/AdminComercial.tsx")).toContain("data-abrir-crm-novo");
    const produtoApp = ler("src/pages/ProdutoApp.tsx");
    expect(produtoApp).toContain("useTemaDoCorreio(CHAVE_DO_TEMA_DO_CRM)");
    // A conta da Aceleriq no produto lê o comercial da casa; o botão de voltar leva ao painel.
    expect(produtoApp).toContain('definirEscopoDoCrm(ehDaCasa ? { modo: "casa", base: "/app/crm" } : escopo)');
    expect(produtoApp).toContain("data-voltar-do-crm");
  });
});
