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

import { janelaDoPedidoLivre } from "../../supabase/functions/agente-calendario/acoes-agenda";

describe("pedido livre: datas citadas valem", () => {
  it("sem data citada, janela de 30 dias só com dias úteis", () => {
    const { fim, uteis } = janelaDoPedidoLivre("2026-09-26", "três conteúdos sobre site");
    expect(fim).toBe("2026-10-26");
    expect(uteis[0]).toBe("2026-09-28");
    expect(uteis.every((d) => d <= "2026-10-26")).toBe(true);
  });

  it("refazer de novembro e dezembro estica a janela até a última data citada (26/09: tudo caía em 26/10)", () => {
    const msg = "- 2026-11-02 · carrossel · no lugar de \"A\"\n- 2026-12-25 · carrossel · no lugar de \"B\"\n- 2026-11-28 · estático · no lugar de \"C\"";
    const { fim, uteis } = janelaDoPedidoLivre("2026-09-26", msg);
    expect(fim).toBe("2026-12-25");
    expect(uteis).toContain("2026-11-02");
    expect(uteis).toContain("2026-12-25");
    // 28/11/2026 é sábado, mas a peça já estava nesse dia: vale.
    expect(uteis).toContain("2026-11-28");
    // Data no passado ou além de 12 meses não mexe na janela.
    expect(janelaDoPedidoLivre("2026-09-26", "2026-01-01 e 2028-01-01").fim).toBe("2026-10-26");
  });
});
