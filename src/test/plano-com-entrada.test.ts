import { describe, expect, it } from "vitest";
import { buildPlanoComEntrada, lerValorBR, percentualDaEntrada } from "@/lib/paymentInstallments";

// 16/11/2026: "poder colocar o valor que deu de entrada e quantos que restou; fazendo a conta geral tira a liberdade".
describe("plano com entrada livre", () => {
  const base = { paymentId: "p", total: 6500, entradaEm: "2026-11-16", primeiraEm: "2026-12-16" };
  it("entrada de qualquer valor e o restante em parcelas iguais", () => {
    const l = buildPlanoComEntrada({ ...base, entrada: 3000, entradaPaga: true, parcelas: 2 });
    expect(l.map((x) => [x.installment_number, x.amount, x.due_date, x.status])).toEqual([
      [0, 3000, "2026-11-16", "paid"],
      [1, 1750, "2026-12-16", "pending"],
      [2, 1750, "2027-01-16", "pending"],
    ]);
    expect(l[0].description).toBe("Entrada");
    expect(l[0].paid_date).toBe("2026-11-16");
  });
  it("o centavo que sobra vai na última e a soma fecha", () => {
    const l = buildPlanoComEntrada({ ...base, total: 1000, entrada: 0, entradaPaga: false, parcelas: 3, primeiraEm: "2026-11-16" });
    expect(l.map((x) => x.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(l.some((x) => x.installment_number === 0)).toBe(false);
  });
  it("restante numa vez só vira 'Restante'; tudo na entrada vira à vista", () => {
    expect(buildPlanoComEntrada({ ...base, entrada: 1500, entradaPaga: false, parcelas: 1 })[1].description).toBe("Restante");
    const tudo = buildPlanoComEntrada({ ...base, entrada: 6500, entradaPaga: true, parcelas: 4 });
    expect(tudo).toHaveLength(1);
    expect(tudo[0].description).toBe("Pagamento à vista");
  });
  it("entrada maior que o total é recusada", () => {
    expect(() => buildPlanoComEntrada({ ...base, entrada: 7000, entradaPaga: false, parcelas: 1 })).toThrow("maior que o valor total");
  });
  it("parcelas do restante já pagas, para plano que já está andando", () => {
    const l = buildPlanoComEntrada({ ...base, entrada: 500, entradaPaga: true, parcelas: 3, parcelasPagas: 1 });
    expect(l.map((x) => x.status)).toEqual(["paid", "paid", "pending", "pending"]);
  });
  it("lê valor com ponto de milhar, vírgula ou ponto decimal", () => {
    expect(lerValorBR("3.000")).toBe(3000);
    expect(lerValorBR("3.000,50")).toBe(3000.5);
    expect(lerValorBR("3000,50")).toBe(3000.5);
    expect(lerValorBR("3000.50")).toBe(3000.5);
    expect(lerValorBR("")).toBe(0);
    expect(percentualDaEntrada(6500, 3000)).toBe(46.15);
  });
});
