import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cobrança parcial (01/11/2026, dono: "saldo fica só na linha nova"). Pagar parte marca a original como
 * "partial" e cria a linha "pending" de "Saldo restante". O "Total em aberto" dos clientes avulsos somava
 * `amount - paid_amount` também da parcial, e o mesmo saldo entrava duas vezes. A conta de cobrança usa a regra
 * única `saldoDaCobranca` (zero na parcial); a de parcela de projeto continua com o resto na própria linha.
 */

const tela = readFileSync(resolve(__dirname, "../pages/AdminFinanceiro.tsx"), "utf8");

describe("Financeiro: o saldo da cobrança parcial conta uma vez só", () => {
  it("o em aberto de cobrança usa saldoDaCobranca, sem somar o resto da parcial", () => {
    const inicio = tela.indexOf("const sumBillingOpen");
    expect(inicio).toBeGreaterThan(-1);
    const bloco = tela.slice(inicio, tela.indexOf(";", inicio));
    expect(bloco).toMatch(/saldoDaCobranca\(b\)/);
    expect(bloco).not.toMatch(/"partial"/);
  });
});
