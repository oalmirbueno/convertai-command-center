import { describe, expect, it } from "vitest";
import {
  MAX_REFAZER_NA_LISTA,
  MAX_REFAZER_POR_PEDIDO,
  pedidoParaRefazer,
} from "../../supabase/functions/agente-calendario/acoes-agenda";
import { LOTE_DO_REFAZER, lotesDoRefazer, pedidoParaRefazer as pedidoParaRefazerDaTela } from "@/components/mesa/planoDoMes";

/**
 * Dono, 26/09: pediu para revisar todos os meses e o agente do Mês parou nas 12
 * primeiras peças. Agora a lista aceita a agenda inteira e o painel refaz em
 * lotes de 12, um atrás do outro, levando o porquê do pedido para cada lote.
 */
describe("agente do Mês: refazer em lotes", () => {
  const itens = Array.from({ length: 40 }, (_, i) => ({ titulo: `Peça ${i + 1}`, data: "2026-10-01", formato: "carrossel" }));

  it("lote da tela é o mesmo do servidor e a lista passa de 12", () => {
    expect(LOTE_DO_REFAZER).toBe(MAX_REFAZER_POR_PEDIDO);
    expect(MAX_REFAZER_NA_LISTA).toBeGreaterThanOrEqual(40);
  });

  it("40 peças viram 4 lotes na ordem, sem perder nenhuma", () => {
    const lotes = lotesDoRefazer(itens);
    expect(lotes.map((l) => l.length)).toEqual([12, 12, 12, 4]);
    expect(lotes.flat().map((i) => i.titulo)).toEqual(itens.map((i) => i.titulo));
    expect(lotesDoRefazer([])).toEqual([]);
  });

  it("a orientação vai em cada lote; sem orientação o texto é o de antes", () => {
    const lote = itens.slice(0, 2);
    const semOrientacao = pedidoParaRefazer(lote);
    expect(semOrientacao).not.toContain("Orientação");
    const com = pedidoParaRefazer(lote, "Falar com empresários e o público final, não com agências.");
    expect(com.startsWith(semOrientacao)).toBe(true);
    expect(com).toContain("Orientação da equipe para todas: Falar com empresários e o público final, não com agências.");
    // Tela e servidor montam o mesmo texto.
    expect(pedidoParaRefazerDaTela(lote, "Falar com empresários e o público final, não com agências.")).toBe(com);
    expect(pedidoParaRefazerDaTela(lote)).toBe(semOrientacao);
  });
});
