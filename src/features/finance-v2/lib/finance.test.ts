import { describe, expect, it } from "vitest";
import type { CashFlowItem } from "../types";
import {
  addMoney,
  buildCashFlowSeries,
  clampBillingDay,
  computeMarginPercent,
  currentMonthRange,
  flowFor,
  flowTotals,
  grossUp,
  monthlyEquivalent,
  netAfterTax,
  parseCurrencyInput,
  subtractMoney,
} from "./finance";

const row = (
  id: string,
  basis: CashFlowItem["basis"],
  type: CashFlowItem["type"],
  amount: number,
): CashFlowItem => ({
  id,
  obligation_id: "o1",
  date: "2026-08-02",
  basis,
  type,
  amount,
  source: type === "income" ? "billing" : "expense",
  category: null,
  description: id,
  status: "open",
  client_id: null,
  project_id: null,
});

describe("finance v2", () => {
  it("opera centavos sem ruido", () => {
    expect(addMoney(0.1, 0.2)).toBe(0.3);
    expect(subtractMoney(10, 3.33)).toBe(6.67);
  });

  it("le moeda pt-BR", () => {
    expect(parseCurrencyInput("R$ 1.234,56")).toBe(1234.56);
    expect(parseCurrencyInput("invalido")).toBe(0);
  });

  it("calcula margem, liquido e gross-up", () => {
    expect(computeMarginPercent(1000, 250)).toBe(75);
    expect(computeMarginPercent(0, 10)).toBe(0);
    expect(netAfterTax(1000, 10)).toBe(900);
    expect(grossUp(900, 10)).toBe(1000);
  });

  it("mensaliza recorrencia", () => {
    expect(monthlyEquivalent({ amount: 1200, frequency: "annual" })).toBe(100);
    expect(monthlyEquivalent({ amount: 300, frequency: "quarterly" })).toBe(100);
  });

  it("nao mistura caixa, competencia e previsao", () => {
    const rows = [
      row("cash", "cash", "income", 100),
      row("accrual", "competence", "income", 100),
      row("forecast", "forecast", "expense", 20),
    ];
    expect(flowTotals(flowFor(rows, "cash"))).toEqual({
      in: 100,
      out: 0,
      net: 100,
    });
    expect(flowFor(rows, "cash")).toHaveLength(1);
  });

  it("agrupa serie por dia", () => {
    expect(
      buildCashFlowSeries([
        row("a", "cash", "income", 100),
        row("b", "cash", "expense", 20.3),
      ])[0],
    ).toEqual({ date: "2026-08-02", income: 100, expense: 20.3, net: 79.7 });
  });

  it("limita cobranca a dias 1..28", () => {
    expect(clampBillingDay(0)).toBe(1);
    expect(clampBillingDay(31)).toBe(28);
  });

  it("gera intervalo mensal inclusivo", () => {
    expect(currentMonthRange(new Date(2026, 1, 10))).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
    });
  });
});
