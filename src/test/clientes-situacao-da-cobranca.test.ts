import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  passaNoFiltroDaCobranca,
  renovacaoEmAlerta,
  saldoDaCobranca,
  situacaoDoCliente,
  situacoesPorCliente,
} from "@/lib/clientes/situacaoDaCobranca";

/**
 * Clientes (26/10/2026, dono): inativo só na aba Inativos; filtro do que está vencido e do que está pago; o
 * alerta de atrasado sai quando o cliente já pagou, mesmo atrasado. Casos tirados dos dados reais de 26/10:
 * Verzelo (renovação 20/09, pagou 30/09, nada em aberto) e Preserva Eco (renovação 06/10, pagou 02/10) tinham o
 * alerta vermelho da renovação; RD Ar e Terra Flor têm mensalidade vencida sem pagamento.
 */

const HOJE = "2026-10-26";

describe("situação da cobrança", () => {
  it("pagou atrasado: não é Atrasado (Em dia com a data do pagamento)", () => {
    const s = situacaoDoCliente([{ type: "renewal", status: "paid", amount: 800, due_date: "2026-09-20", paid_date: "2026-09-30" }], HOJE);
    expect(s && s.tom).toBe("paid");
    expect(s && s.detalhe).toContain("30/09/2026");
  });

  it("vencida e sem pagamento: Atrasado com a data do vencimento", () => {
    const s = situacaoDoCliente([
      { type: "renewal", status: "paid", amount: 697, due_date: "2026-09-04", paid_date: "2026-09-04" },
      { type: "renewal", status: "pending", amount: 697, due_date: "2026-10-04" },
    ], HOJE);
    expect(s).toMatchObject({ tom: "late", rotulo: "Atrasado" });
    expect(s && s.detalhe).toContain("04/10/2026");
  });

  it("parcial quitada pelo valor e pendente com o valor pago não contam como atraso", () => {
    expect(saldoDaCobranca({ status: "partial", amount: 300, paid_amount: 300 })).toBe(0);
    expect(saldoDaCobranca({ status: "pending", amount: 300, paid_amount: 300 })).toBe(0);
    expect(saldoDaCobranca({ status: "partial", amount: 300, paid_amount: 100 })).toBe(200);
    expect(saldoDaCobranca({ status: "cancelled", amount: 300 })).toBe(0);
    const s = situacaoDoCliente([{ type: "one_off", status: "partial", amount: 300, paid_amount: 300, due_date: "2026-09-21", paid_date: "2026-09-25" }], HOJE);
    expect(s && s.tom).toBe("paid");
  });

  it("recarga de anúncio não entra; a receber é o que vence no mês", () => {
    expect(situacaoDoCliente([{ type: "ads_recharge", status: "pending", amount: 500, due_date: "2026-10-01" }], HOJE)).toBeNull();
    expect(situacaoDoCliente([{ type: "renewal", status: "pending", amount: 500, due_date: "2026-10-30" }], HOJE)).toMatchObject({ tom: "due", rotulo: "A receber" });
  });

  it("várias cobranças misturadas viram uma situação por cliente e o filtro separa", () => {
    const m = situacoesPorCliente([
      { client_id: "a", type: "renewal", status: "pending", amount: 350, due_date: "2026-10-08" },
      { client_id: "b", type: "renewal", status: "paid", amount: 900, due_date: "2026-10-06", paid_date: "2026-10-02" },
      { client_id: "c", type: "renewal", status: "pending", amount: 900, due_date: "2026-10-29" },
    ], HOJE);
    expect(passaNoFiltroDaCobranca(m.get("a"), "atrasados")).toBe(true);
    expect(passaNoFiltroDaCobranca(m.get("b"), "atrasados")).toBe(false);
    expect(passaNoFiltroDaCobranca(m.get("b"), "em_dia")).toBe(true);
    expect(passaNoFiltroDaCobranca(m.get("c"), "a_receber")).toBe(true);
    expect(passaNoFiltroDaCobranca(m.get("z"), "sem_cobranca")).toBe(true);
    expect(passaNoFiltroDaCobranca(m.get("a"), "todas")).toBe(true);
  });

  it("o alerta da renovação só aparece com cobrança vencida e não paga", () => {
    const pago = situacaoDoCliente([{ type: "renewal", status: "paid", amount: 900, due_date: "2026-10-06", paid_date: "2026-10-02" }], HOJE);
    const devendo = situacaoDoCliente([{ type: "renewal", status: "pending", amount: 350, due_date: "2026-10-08" }], HOJE);
    expect(renovacaoEmAlerta("expired", pago)).toBe(false);
    expect(renovacaoEmAlerta("expired", devendo)).toBe(true);
    expect(renovacaoEmAlerta("ok", devendo)).toBe(false);
    expect(renovacaoEmAlerta("expired", null)).toBe(false);
  });
});

describe("tela de Clientes (código)", () => {
  const tela = readFileSync(resolve(__dirname, "../pages/Clients.tsx"), "utf8");

  it("inativo tem aba própria e não aparece nas outras abas", () => {
    expect(tela).toContain('{ value: "inactive", label: "Inativos" }');
    expect(tela).toContain('if (typeFilter === "inactive") return status === "inactive"');
    expect(tela).toContain('if (status === "inactive") return false;');
    // O filtro de status não oferece mais Inativos (mora na aba).
    const status = tela.slice(tela.indexOf("const STATUS_TABS"), tela.indexOf("];", tela.indexOf("const STATUS_TABS")));
    expect(status).not.toContain("inactive");
  });

  it("o filtro da cobrança e o alerta usam a regra única", () => {
    expect(tela).toContain("situacoesPorCliente(");
    expect(tela).toContain("data-filtro-da-cobranca");
    expect(tela).toContain("alertaDaRenovacao(status?.level");
  });
});
