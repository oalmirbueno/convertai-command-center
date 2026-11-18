import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cobrancasDaPrimeiraMensalidade, conferirDivisao, diaSeguinte } from "@/lib/primeiraMensalidade";

// 12/11/2026 (dono): cliente de R$ 700 pagou R$ 350 e ficou de pagar R$ 350 no dia seguinte. O cadastro
// lançou a mensalidade inteira como paga e a divisão como "projeto": caixa de R$ 1.050 com R$ 350 no bolso.
const base = { clienteId: "c1", nome: "Vip DK", valor: 700, hoje: "2026-11-12", renovacao: "2026-12-13" };
const soma = (l: { amount: number }[]) => l.reduce((s, x) => s + x.amount, 0);

describe("primeira mensalidade no cadastro", () => {
  it("dividida: R$ 350 pagos hoje, R$ 350 amanhã e o mês seguinte cheio", () => {
    const l = cobrancasDaPrimeiraMensalidade({ ...base, modo: "dividida", recebidoAgora: 350, restanteVence: "2026-11-13" });
    expect(l.map((x) => [x.amount, x.status, x.due_date])).toEqual([[350, "paid", "2026-11-12"], [350, "pending", "2026-11-13"], [700, "pending", "2026-12-13"]]);
    expect(l[0].paid_amount).toBe(350);
    expect(l[0].paid_date).toBe("2026-11-12");
    expect(l.every((x) => x.type === "renewal")).toBe(true);
    // O que entrou no caixa hoje é só o que foi recebido.
    expect(soma(l.filter((x) => x.status === "paid"))).toBe(350);
    // As duas partes fecham o valor do plano, sem centavo sobrando.
    expect(soma(l.slice(0, 2))).toBe(700);
  });
  it("divisão desigual fecha no centavo", () => {
    const l = cobrancasDaPrimeiraMensalidade({ ...base, valor: 697, modo: "dividida", recebidoAgora: 233.33, restanteVence: "2026-11-20" });
    expect(l[1].amount).toBe(463.67);
    expect(Math.round(soma(l.slice(0, 2)) * 100)).toBe(69700);
  });
  it("recebida e a receber continuam como eram", () => {
    const paga = cobrancasDaPrimeiraMensalidade({ ...base, modo: "recebida" });
    expect(paga.map((x) => [x.amount, x.status])).toEqual([[700, "paid"], [700, "pending"]]);
    expect(paga[0].description).toBe("Mensalidade · Vip DK (pago no cadastro)");
    const aberta = cobrancasDaPrimeiraMensalidade({ ...base, modo: "a_receber", renovacao: null });
    expect(aberta).toHaveLength(1);
    expect(aberta[0].status).toBe("pending");
    expect(aberta[0].paid_date).toBeNull();
  });
  it("sem valor de plano não cria cobrança", () => {
    expect(cobrancasDaPrimeiraMensalidade({ ...base, valor: 0, modo: "recebida" })).toEqual([]);
  });
  it("recusa divisão que não fecha", () => {
    expect(conferirDivisao(700, 0, "2026-11-13", "2026-11-12")).toContain("quanto foi recebido");
    expect(conferirDivisao(700, 700, "2026-11-13", "2026-11-12")).toContain("menor que a mensalidade");
    expect(conferirDivisao(700, 350, "", "2026-11-12")).toContain("vence o restante");
    expect(conferirDivisao(700, 350, "2026-11-10", "2026-11-12")).toContain("antes de hoje");
    expect(conferirDivisao(700, 350, "2026-11-13", "2026-11-12")).toBeNull();
  });
  it("o restante vence amanhã por padrão, mesmo na virada do mês", () => {
    expect(diaSeguinte("2026-11-12")).toBe("2026-11-13");
    expect(diaSeguinte("2026-11-30")).toBe("2026-12-01");
    expect(diaSeguinte("2026-12-31")).toBe("2027-01-01");
  });
  it("o cadastro oferece Dividida e confere antes de salvar", () => {
    const tela = readFileSync(resolve(process.cwd(), "src/components/admin/CreateClientModal.tsx"), "utf8");
    expect(tela).toContain('{ v: "dividida", label: "Dividida"');
    expect(tela).toContain("cobrancasDaPrimeiraMensalidade({");
    expect(tela).toContain("toast.error(erroDaDivisao)");
  });
});
