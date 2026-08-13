import { describe, expect, it } from "vitest";
import { buildGrowthSeries, sumGrowthBuckets } from "./reportGrowth";

describe("série de crescimento dos relatórios", () => {
  it("classifica métricas com nomes próprios em qualquer idioma", () => {
    const totals = sumGrowthBuckets({
      investimento_brl: 168, conversas: 13, reservas: 2, alcance: 5400,
      custo_conversa_brl: 12.9, ctr_link_pct: 1.2,
    });
    expect(totals).toEqual({ contacts: 15, reach: 5400, spend: 168, revenue: 0 });
  });

  it("monta a série ordenada no tempo e ignora rituais e relatórios vazios", () => {
    const series = buildGrowthSeries([
      { metrics: { conversas: 5, ad_spend: 100 }, period_end: "2026-08-11" },
      { metrics: { ritual_type: "rota_semana", conversas: 99 }, period_end: "2026-08-12" },
      { metrics: { conversas: 3 }, period_end: "2026-07-20" },
      { metrics: {}, period_end: "2026-06-01" },
    ]);
    expect(series.map((p) => p.contacts)).toEqual([3, 5]);
    expect(series[1].spend).toBe(100);
  });

  it("lê métricas dentro de custom", () => {
    const totals = sumGrowthBuckets({ custom: { leads_capturados: 7, faturamento: 900 } });
    expect(totals.contacts).toBe(7);
    expect(totals.revenue).toBe(900);
  });
});
