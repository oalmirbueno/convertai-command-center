// 23/11/2026 (dono): "marcar como pago, mas se pagou parte": total ou parte, com o saldo pendente.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classificarPagamento, valorRecebido } from "@/lib/financeiro/pagamentoParcial";

describe("pagamento parcial", () => {
  it("lê o valor digitado em reais", () => {
    expect(valorRecebido("100")).toBe(100);
    expect(valorRecebido("100,50")).toBe(100.5);
    expect(valorRecebido("1.200,00")).toBe(1200);
    expect(valorRecebido("")).toBeNull();
    expect(valorRecebido("0")).toBeNull();
    expect(valorRecebido("abc")).toBeNull();
  });
  it("separa total de parte e calcula o restante", () => {
    expect(classificarPagamento(400, 400)).toEqual({ tipo: "total" });
    expect(classificarPagamento(400, 100)).toEqual({ tipo: "parcial", recebido: 100, restante: 300 });
    expect(classificarPagamento(899.9, 300.3)).toEqual({ tipo: "parcial", recebido: 300.3, restante: 599.6 });
  });
  it("os dois botões perguntam antes de marcar pago", () => {
    const ficha = readFileSync("src/components/admin/CobrancasDoCliente.tsx", "utf8");
    expect(ficha).toContain("registrarPagamento(linha.id");
    expect(ficha).toContain('"Pagou parte"');
    expect(ficha).not.toContain('paid_amount: linha.amount,\n                            },\n                            "Pagamento registrado."');
    const financeiro = readFileSync("src/pages/AdminFinanceiro.tsx", "utf8");
    expect(financeiro).not.toContain("onClick={() => handleMarkPaid(b.id)}");
  });
});
