import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cobrancaAtrasada, dataDoPortal } from "@/lib/clientes/cobrancaDoPortal";

/**
 * Financeiro do cliente (portal): a cobrança que vence em 10/11 aparecia como "09/11/2026" e ficava "Atrasado"
 * desde 09/11 às 21h e durante todo o dia 10/11, porque `new Date("2026-11-10")` é meia-noite UTC (21h da
 * véspera em São Paulo). O navegador do cliente está em UTC-3; o teste roda no mesmo fuso.
 */

const fusoOriginal = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/Sao_Paulo";
});
afterAll(() => {
  process.env.TZ = fusoOriginal;
});

describe("datas do Financeiro do cliente", () => {
  it("mostra o vencimento no dia certo (não na véspera)", () => {
    expect(dataDoPortal("2026-11-10")).toBe("10/11/2026");
    expect(dataDoPortal("2026-01-01")).toBe("01/01/2026");
    expect(dataDoPortal("")).toBe("");
    expect(dataDoPortal(null)).toBe("");
  });

  it("timestamp continua no dia de São Paulo", () => {
    // 01/11 às 01:30 UTC = 31/10 às 22:30 em Brasília.
    expect(dataDoPortal("2026-11-01T01:30:00Z")).toBe("31/10/2026");
  });

  it("no próprio dia do vencimento a cobrança não está atrasada; no dia seguinte, está", () => {
    expect(cobrancaAtrasada("pending", "2026-11-10", "2026-11-09")).toBe(false);
    expect(cobrancaAtrasada("pending", "2026-11-10", "2026-11-10")).toBe(false);
    expect(cobrancaAtrasada("pending", "2026-11-10", "2026-11-11")).toBe(true);
  });

  it("só cobrança pendente vira atrasada", () => {
    expect(cobrancaAtrasada("paid", "2026-10-01", "2026-11-10")).toBe(false);
    expect(cobrancaAtrasada("partial", "2026-10-01", "2026-11-10")).toBe(false);
    expect(cobrancaAtrasada("pending", null, "2026-11-10")).toBe(false);
  });

  it("a tela usa as regras do dia de calendário", () => {
    const tela = readFileSync(resolve(__dirname, "../pages/ClientFinanceiro.tsx"), "utf8");
    expect(tela).not.toMatch(/new Date\(dueDate\) < today/);
    expect(tela).not.toMatch(/new Date\(d\)\.toLocaleDateString/);
    expect(tela).not.toMatch(/renewalDateStr \? new Date\(renewalDateStr\)/);
    expect(tela).toMatch(/cobrancaAtrasada\(status, dueDate\)/);
  });
});
