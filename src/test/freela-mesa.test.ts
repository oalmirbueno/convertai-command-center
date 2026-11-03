import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { dataBR, fmtMoeda, moedaDe, normalizar, somarMeses, statusVisualDaParcela } from "@/lib/freela/freelaLib";

/**
 * Mesa Freela (03/11/2026). Regra de ouro: real e dólar nunca se somam, e os
 * números da agência não mudam com as linhas type='freela' no billing.
 */
const ler = (c: string) => readFileSync(resolve(process.cwd(), c), "utf8");

describe("regras de moeda e parcela", () => {
  it("linha antiga sem currency é BRL; só USD é dólar", () => {
    expect(moedaDe({})).toBe("BRL");
    expect(moedaDe(null)).toBe("BRL");
    expect(moedaDe({ currency: "BRL" })).toBe("BRL");
    expect(moedaDe({ currency: "USD" })).toBe("USD");
  });

  it("formata na moeda da linha, com R$ ou US$", () => {
    expect(fmtMoeda(1500, "BRL")).toContain("R$");
    expect(fmtMoeda(1500, "USD")).toContain("US$");
  });

  it("aberta com vencimento no passado aparece como atrasada; paga não", () => {
    expect(statusVisualDaParcela({ status: "aberta", vencimento: "2026-11-01" }, "2026-11-03")).toBe("atrasada");
    expect(statusVisualDaParcela({ status: "aberta", vencimento: "2026-11-03" }, "2026-11-03")).toBe("aberta");
    expect(statusVisualDaParcela({ status: "paga", vencimento: "2026-11-01" }, "2026-11-03")).toBe("paga");
  });

  it("parcelas mensais, busca sem acento e data em pt-BR", () => {
    expect(somarMeses("2026-11-15", 2)).toBe("2027-01-15");
    expect(normalizar("José")).toBe("jose");
    expect(dataBR("2026-11-03")).toBe("03/11/2026");
  });
});

describe("somas em real", () => {
  it("/financeiro: gráfico e ads em R$, filtro de origem na tela e card que leva ao caixa", () => {
    const s = ler("src/pages/AdminFinanceiro.tsx");
    expect(s).toContain('const billingBRL = (billing || []).filter((b: any) => moedaDe(b) === "BRL");');
    expect(s).toContain("received += billingDaOrigem");
    expect(s).toContain("pending += billingDaOrigem");
    expect(s).toContain("<AdsInvestment billing={billingBRL}");
    expect(s).toContain('rotulo="Origem"');
    expect(s).toContain('para: "/freela/caixa"');
    expect(s).not.toContain("<AdsInvestment billing={billing || []}");
  });

  it("projeção, dashboard e CFO da tela não somam dólar", () => {
    expect(ler("src/pages/AdminProjection.tsx")).toContain('moedaDe(b) === "BRL" && b.type !== "freela"');
    expect(ler("src/pages/AdminDashboard.tsx")).toContain('(billing || []).filter((b: any) => moedaDe(b) === "BRL")');
    expect(ler("src/lib/cfo/dadosDoCFO.ts")).toContain('moedaDe(b) === "BRL"');
  });
});

describe("somas em real no servidor", () => {
  it("agente CFO e MCP financeiro só leem billing em real", () => {
    expect(ler("supabase/functions/agente-cfo/index.ts")).toContain('select(COLUNAS.cobrancas).eq("currency", "BRL")');
    expect(ler("supabase/functions/_shared/aceleriq-finance-services.ts")).toContain(".eq('currency', 'BRL')");
    expect(ler("supabase/functions/mcp-server/modulos/aceleriq-finance-dashboard.ts")).toContain(".eq('currency', 'BRL')");
    expect(ler("supabase/functions/mcp-server/modulos/aceleriq-finance-fluxo.ts").split(".eq('currency', 'BRL')")).toHaveLength(4);
  });
});

describe("guardas da mesa", () => {
  it("projeto com parcelas não troca de moeda", () => {
    const s = ler("src/components/freela/AbaProjetos.tsx");
    expect(s).toContain("disabled={temParcelas}");
    expect(s).toContain("temParcelas && editando && form.moeda !== editando.moeda");
  });

  it("o front nunca escreve no billing do freela", () => {
    for (const aba of ["AbaContatos", "AbaPropostas", "AbaProjetos", "AbaCaixa"]) {
      expect(ler(`src/components/freela/${aba}.tsx`)).not.toContain('from("billing")');
    }
  });

  it("rota com a régua do Comercial e dependências sem plugin do Lovable", () => {
    expect(ler("src/App.tsx")).toContain('path="/freela/:aba" element={<ComercialRoute><AdminFreela /></ComercialRoute>}');
    expect(ler("package.json")).not.toContain("lovable");
  });
});
