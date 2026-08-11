import { describe, expect, it } from "vitest";
import {
  allocateFixedCosts,
  calculateBreakEvenRevenue,
  calculateClientMargin,
  calculateGlobalOperatingResult,
  grossUp,
  grossUpAfterDiscount,
  monthlyEquivalent,
  normalizeTaxRate,
  recognizedPayment,
  remainingBalance,
  roundMoney,
  splitGrossAmount,
  taxReserveForPayment,
} from "./financialModel";

describe("financialModel", () => {
  it("arredonda dinheiro em centavos", () => expect(roundMoney(10.005)).toBe(10.01));
  it("aceita alíquota em percentual", () => expect(normalizeTaxRate(14)).toBe(0.14));
  it("aceita alíquota fracionária", () => expect(normalizeTaxRate(0.14)).toBe(0.14));
  it("rejeita alíquota igual a 100%", () => expect(() => normalizeTaxRate(100)).toThrow());
  it("calcula gross-up sem multiplicador simples", () => expect(grossUp(1000, 14)).toBe(1162.79));
  it("mantém valor quando imposto é zero", () => expect(grossUp(597, 0)).toBe(597));
  it("separa operacional, final e reserva", () => {
    expect(splitGrossAmount(1000, 14)).toEqual({
      operationalAmount: 1000,
      finalAmount: 1162.79,
      taxReserve: 162.79,
    });
  });
  it("aplica desconto antes do gross-up", () => {
    expect(grossUpAfterDiscount(1000, 100, 14)).toEqual({
      operationalAmount: 900,
      finalAmount: 1046.51,
      taxReserve: 146.51,
    });
  });
  it("não deixa desconto produzir base negativa", () => {
    expect(grossUpAfterDiscount(100, 150, 14).finalAmount).toBe(0);
  });
  it("converte periodicidade anual em MRR equivalente", () => expect(monthlyEquivalent(1200, "annual")).toBe(100));
  it("preserva periodicidade mensal no MRR", () => expect(monthlyEquivalent(597, "monthly")).toBe(597));
  it("reconhece pagamento parcial", () => expect(recognizedPayment(1000, 250, "partial")).toBe(250));
  it("limita parcial ao total", () => expect(recognizedPayment(1000, 1200, "partial")).toBe(1000));
  it("reconhece pago integral sem paid_amount", () => expect(recognizedPayment(1000, null, "paid")).toBe(1000));
  it("não reconhece pendente", () => expect(recognizedPayment(1000, 500, "pending")).toBe(0));
  it("calcula saldo aberto sem ficar negativo", () => {
    expect(remainingBalance(1000, 250)).toBe(750);
    expect(remainingBalance(1000, 1200)).toBe(0);
  });
  it("provisiona imposto proporcionalmente ao recebido", () => {
    expect(taxReserveForPayment(1162.79, 162.79, 581.4)).toBe(81.4);
  });
  it("calcula contribuição e margem completa do cliente", () => {
    expect(calculateClientMargin({ operationalRevenue: 1000, directCosts: 275, allocatedFixedCosts: 200 }))
      .toEqual({ directContribution: 725, fullEstimatedMargin: 525, marginPercent: 52.5 });
  });
  it("não divide margem por receita zero", () => {
    expect(calculateClientMargin({ operationalRevenue: 0, directCosts: 10 }).marginPercent).toBe(0);
  });
  it("deduz custo fixo uma única vez no resultado global", () => {
    expect(calculateGlobalOperatingResult({
      operationalRevenue: 10000,
      oneOffRevenue: 1000,
      directCosts: 2000,
      fixedCosts: 2500,
      otherExpenses: 500,
      proLabore: 3000,
    })).toBe(3000);
  });
  it("calcula ponto de equilíbrio pela taxa direta média", () => {
    expect(calculateBreakEvenRevenue(2500, 3000, 0.25)).toBe(7333.33);
  });
  it("aloca igualmente sem perder centavos", () => {
    const result = allocateFixedCosts([
      { id: "a", operationalRevenue: 1 },
      { id: "b", operationalRevenue: 1 },
      { id: "c", operationalRevenue: 1 },
    ], 100, "equal");
    expect(result.map((item) => item.allocatedFixedCosts)).toEqual([33.33, 33.33, 33.34]);
  });
  it("aloca proporcionalmente à receita", () => {
    const result = allocateFixedCosts([
      { id: "a", operationalRevenue: 100 },
      { id: "b", operationalRevenue: 300 },
    ], 200, "revenue");
    expect(result.map((item) => item.allocatedFixedCosts)).toEqual([50, 150]);
  });
  it("aloca por pesos customizados", () => {
    const result = allocateFixedCosts([
      { id: "a", operationalRevenue: 0, customShare: 2 },
      { id: "b", operationalRevenue: 0, customShare: 1 },
    ], 90, "custom");
    expect(result.map((item) => item.allocatedFixedCosts)).toEqual([60, 30]);
  });
  it("não aloca quando método é none", () => {
    expect(allocateFixedCosts([{ id: "a", operationalRevenue: 100 }], 90, "none")[0].allocatedFixedCosts).toBe(0);
  });
});
