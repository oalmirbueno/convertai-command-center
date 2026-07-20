import { describe, expect, it } from "vitest";
import {
  buildPaymentInstallments,
  normalizeMoney,
  splitAmount,
} from "@/lib/paymentInstallments";

describe("payment installment builder", () => {
  it("fecha os centavos no valor total e ajusta a última parcela", () => {
    const amounts = splitAmount(100, 3);

    expect(amounts).toEqual([33.33, 33.33, 33.34]);
    expect(Math.round(amounts.reduce((sum, amount) => sum + amount, 0) * 100)).toBe(10_000);
  });

  it("normaliza o total uma única vez em centavos", () => {
    expect(normalizeMoney(100.005)).toBe(100.01);
    expect(splitAmount(100.005, 3)).toEqual([33.33, 33.33, 33.35]);
    expect(() => normalizeMoney(0.001)).toThrow("R$ 0,01");
  });

  it("usa a data escolhida como vencimento e recebimento à vista", () => {
    const [installment] = buildPaymentInstallments({
      paymentId: "payment-1",
      total: 597,
      installmentsCount: 1,
      firstDueDate: "2026-04-12",
      paidInstallments: 1,
    });

    expect(installment).toMatchObject({
      amount: 597,
      due_date: "2026-04-12",
      status: "paid",
      paid_amount: 597,
      paid_date: "2026-04-12",
    });
  });

  it("preserva o dia quando possível e limita fim de mês no parcelado", () => {
    const installments = buildPaymentInstallments({
      paymentId: "payment-2",
      total: 100,
      installmentsCount: 3,
      firstDueDate: "2026-01-31",
      paidInstallments: 2,
    });

    expect(installments.map((item) => item.due_date)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
    expect(installments.map((item) => item.paid_date)).toEqual([
      "2026-01-31",
      "2026-02-28",
      null,
    ]);
    expect(installments[2]).toMatchObject({
      amount: 33.34,
      status: "pending",
      paid_amount: null,
    });
  });
});
