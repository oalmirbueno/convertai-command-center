import { describe, expect, it } from "vitest";
import { estadoDoGanho, entradaRecebida, faltaDaEntrada, fechamentoDoEstado, kpisDaCampanha, mesDoGanho, nomeDoMes, realizadoDoMes, type Lead } from "@/lib/comercial";
import { valorDaOportunidade } from "@/components/comercial/resumoDaOportunidade";

/** 05/11/2026 (dono): cliente deu metade de entrada e o CRM somava tudo; a mensalidade pode começar no mês seguinte. */
const lead = (m: Partial<Lead> = {}) => ({ id: "l", name: "Ana", stage: "ganho", monthly_value: 300, one_off_value: 1000, campaign_id: "c", closed_at: "2026-11-05T15:00:00Z", created_at: "2026-11-01T15:00:00Z", ...m }) as Lead;
const NOV = "2026-11-01";
const avista = { entrada: "avista", recebido: "500", parcelas: "2", inicio: "este" } as const;

describe("entrada", () => {
  it("sem dado vale a entrada inteira, como antes", () => {
    expect(entradaRecebida(lead())).toBe(1000);
    expect(faltaDaEntrada(lead())).toBe(0);
    expect(valorDaOportunidade(lead())).toMatch(/R\$\s300\/mês \+ R\$\s1\.000 entrada/);
  });

  it("metade de entrada: conta só o que entrou e mostra o que falta", () => {
    const l = lead({ entrada_recebida: 500, entrada_parcelas: 2 });
    expect(entradaRecebida(l)).toBe(500);
    expect(faltaDaEntrada(l)).toBe(500);
    expect(valorDaOportunidade(l)).toContain("falta R$");
    expect(valorDaOportunidade(l)).toContain("em 2x");
    const c = { id: "c", spent: 100 } as never;
    expect(kpisDaCampanha(c, [l]).entradaGanha).toBe(500);
  });

  it("à vista grava nulo; parcelada guarda o recebido; conta que não fecha é recusada", () => {
    expect(fechamentoDoEstado(lead(), avista, NOV)).toEqual({ entrada_recebida: null, entrada_parcelas: null, mensalidade_inicio: NOV });
    expect(fechamentoDoEstado(lead(), { ...avista, entrada: "parcelada" }, NOV)).toEqual({ entrada_recebida: 500, entrada_parcelas: 1, mensalidade_inicio: NOV });
    expect(fechamentoDoEstado(lead(), { ...avista, entrada: "parcelada", recebido: "1000" }, NOV)).toHaveProperty("erro");
    expect(fechamentoDoEstado(lead(), { ...avista, entrada: "parcelada", recebido: "-1" }, NOV)).toHaveProperty("erro");
    expect(fechamentoDoEstado(lead(), { ...avista, entrada: "parcelada", parcelas: "0" }, NOV)).toHaveProperty("erro");
    // Entrada paga e 1 vez não fecha; nada pago em 1 vez é uma parcela a receber.
    expect(fechamentoDoEstado(lead(), { ...avista, entrada: "parcelada", parcelas: "1" }, NOV)).toHaveProperty("erro");
    expect(fechamentoDoEstado(lead(), { ...avista, entrada: "parcelada", recebido: "0", parcelas: "1" }, NOV)).toMatchObject({ entrada_recebida: 0, entrada_parcelas: 1 });
  });

  it("reabre o ganho com o que foi salvo", () => {
    expect(estadoDoGanho(lead({ entrada_recebida: 400, entrada_parcelas: 3, mensalidade_inicio: "2026-12-01" }), NOV)).toEqual({ entrada: "parcelada", recebido: "400", parcelas: "4", inicio: "proximo" });
    expect(estadoDoGanho(lead(), NOV)).toEqual({ entrada: "avista", recebido: "500", parcelas: "2", inicio: "este" });
  });
});

describe("início da mensalidade", () => {
  it("próximo mês, inclusive na virada do ano", () => {
    expect(fechamentoDoEstado(lead(), { ...avista, inicio: "proximo" }, NOV)).toMatchObject({ mensalidade_inicio: "2026-12-01" });
    expect(fechamentoDoEstado(lead(), { ...avista, inicio: "proximo" }, "2026-12-01")).toMatchObject({ mensalidade_inicio: "2027-01-01" });
    expect(fechamentoDoEstado(lead({ monthly_value: 0 }), { ...avista, inicio: "proximo" }, NOV)).toMatchObject({ mensalidade_inicio: null });
  });

  it("a meta conta no mês em que a mensalidade começa; sem data, no do fechamento", () => {
    const entra = (m: Partial<Lead>, periodo: string) => realizadoDoMes({ metrica: "mrr_novo", leads: [lead(m)], periodo, receitaFinanceiro: 0 });
    expect(entra({ mensalidade_inicio: "2026-12-01" }, NOV)).toBe(0);
    expect(entra({ mensalidade_inicio: "2026-12-01" }, "2026-12-01")).toBe(300);
    expect(entra({}, NOV)).toBe(300);
  });

  it("o mês de referência é o do fechamento; quem ainda não fechou usa hoje", () => {
    expect(mesDoGanho(lead(), "2027-02-10")).toBe(NOV);
    expect(mesDoGanho(lead({ stage: "proposta", closed_at: null }), "2027-02-10")).toBe("2027-02-01");
    expect(nomeDoMes("2026-12-01")).toBe("dez");
  });
});
