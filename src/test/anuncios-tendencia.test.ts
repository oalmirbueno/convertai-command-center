import { describe, expect, it } from "vitest";
import { direcao, tendenciaDoCliente } from "@/lib/adsTendencia";
import type { AdsDailyRow } from "@/lib/adsLanguage";

/**
 * A seta da tela de anúncios (16/10, dono: "mais intuitivo, mais claro"):
 * últimos 15 dias contra os 15 de antes, no mesmo objetivo, e nada de seta
 * inventada quando não há com o que comparar.
 */

const AGORA = new Date(2026, 9, 16, 12);
const dia = (n: number) => {
  const d = new Date(AGORA.getTime() - n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const linha = (n: number, gasto: number, conversas: number): AdsDailyRow =>
  ({
    id: `l-${n}`,
    client_id: "c",
    external_account_id: "ea",
    captured_at: AGORA.toISOString(),
    campaign_id: "camp",
    campaign_name: "Conversas",
    objective: "OUTCOME_ENGAGEMENT",
    day: dia(n),
    spend: String(gasto),
    impressions: 1000,
    reach: 500,
    clicks: 10,
    link_clicks: 5,
    ctr: "1",
    cpc: "1",
    cpm: "10",
    frequency: "2",
    actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: String(conversas) }],
    cost_per_action: null,
  }) as unknown as AdsDailyRow;

describe("direção", () => {
  it("menos de 10% é estável; sem base, nada", () => {
    expect(direcao(110, 100)).toBe("igual");
    expect(direcao(120, 100)).toBe("subiu");
    expect(direcao(80, 100)).toBe("caiu");
    expect(direcao(5, 0)).toBe("subiu");
    expect(direcao(0, 0)).toBeNull();
    expect(direcao(null, 10)).toBeNull();
  });
});

describe("tendência do cliente", () => {
  it("mais conversas e custo por conversa menor", () => {
    const t = tendenciaDoCliente([linha(20, 100, 4), linha(3, 100, 10)], "conversas", AGORA);
    expect(t).toEqual({ resultados: "subiu", custo: "caiu" });
  });

  it("conversas sumiram nos últimos 15 dias: caiu", () => {
    const t = tendenciaDoCliente([linha(20, 100, 10)], "conversas", AGORA);
    expect(t.resultados).toBe("caiu");
    expect(t.custo).toBeNull();
  });

  it("conta nova (nada antes do corte) não ganha seta", () => {
    expect(tendenciaDoCliente([linha(2, 100, 10)], "conversas", AGORA)).toEqual({ resultados: null, custo: null });
    expect(tendenciaDoCliente([linha(20, 100, 4)], null, AGORA)).toEqual({ resultados: null, custo: null });
  });
});
