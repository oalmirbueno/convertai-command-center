import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { listaDeMeses, mesDe, mesesDaEvolucao, type TrabalhoDaEvolucao } from "./evolucao.ts";

const hoje = new Date("2026-10-17T15:00:00Z");
const t = (entrega_status: string, entrega_rodada: number, aprovado_em: string | null, criado_em = "2026-09-01T12:00:00Z"): TrabalhoDaEvolucao => ({ entrega_status, entrega_rodada, aprovado_em, criado_em });

Deno.test("os 6 meses até o de hoje, do mais antigo ao mais novo, virando o ano", () => {
  assertEquals(listaDeMeses(hoje), ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
  assertEquals(listaDeMeses(new Date("2026-02-10T12:00:00Z"), 3), ["2025-12", "2026-01", "2026-02"]);
});

Deno.test("o mês vira na meia-noite de Brasília; dia puro fica no próprio mês", () => {
  assertEquals(mesDe("2026-11-01T02:00:00Z"), "2026-10");
  assertEquals(mesDe("2026-11-01T03:00:00Z"), "2026-11");
  assertEquals(mesDe("2026-10-01"), "2026-10");
  assertEquals(mesDe(null), null);
  assertEquals(mesDe("lixo"), null);
});

Deno.test("aprovadas de primeira, decididas e rodadas por peça aprovada", () => {
  const meses = mesesDaEvolucao({
    hoje,
    trabalhos: [
      t("aprovado", 1, "2026-10-02T12:00:00Z"),
      t("agendado", 1, "2026-10-03T12:00:00Z"),
      t("aprovado", 3, "2026-10-04T12:00:00Z"),
      t("reprovado", 2, null, "2026-10-05T12:00:00Z"),
      // Em andamento não conta como decidida.
      t("aguardando_cliente", 1, null, "2026-10-06T12:00:00Z"),
      t("aguardando_agencia", 1, null, "2026-10-06T12:00:00Z"),
      // Aprovada em setembro, mesmo nascida em agosto.
      t("aprovado", 2, "2026-09-10T12:00:00Z", "2026-08-20T12:00:00Z"),
      // Fora da janela: some.
      t("aprovado", 1, "2026-03-10T12:00:00Z"),
    ],
    posts: [],
    anunciosPorMes: {},
  });
  assertEquals(meses.length, 6);
  const out = meses[5];
  assertEquals(out.mes, "2026-10");
  assertEquals(out.decididas, 4);
  assertEquals(out.aprovadasDePrimeira, 2);
  assertEquals(out.taxaDePrimeira, 0.5);
  assertEquals(out.rodadasMedia, 1.67);
  const set = meses[4];
  assertEquals([set.mes, set.decididas, set.aprovadasDePrimeira, set.taxaDePrimeira, set.rodadasMedia], ["2026-09", 1, 0, 0, 2]);
  const ago = meses[3];
  assertEquals([ago.decididas, ago.taxaDePrimeira, ago.rodadasMedia], [0, null, null]);
});

Deno.test("múltiplo médio dos posts do mês ignora post sem régua, mas conta o post", () => {
  const meses = mesesDaEvolucao({
    hoje,
    trabalhos: [],
    posts: [
      { mes: "2026-10", multiplo: 1.2 },
      { mes: "2026-10", multiplo: 2.1 },
      { mes: "2026-10", multiplo: null },
      { mes: "2026-07", multiplo: 0.8 },
      { mes: "2025-01", multiplo: 9 },
    ],
    anunciosPorMes: {},
  });
  assertEquals([meses[5].posts, meses[5].multiploMedio], [3, 1.65]);
  assertEquals([meses[2].mes, meses[2].posts, meses[2].multiploMedio], ["2026-07", 1, 0.8]);
  assertEquals([meses[0].posts, meses[0].multiploMedio], [0, null]);
});

Deno.test("anúncios: custo por resultado e resultados do mês; sem anúncio, null e zero", () => {
  const meses = mesesDaEvolucao({
    hoje,
    trabalhos: [],
    posts: [],
    anunciosPorMes: {
      "2026-09": { custo_por_resultado: 12.5, resultados: 8 },
      "2026-10": { custo_por_resultado: null, resultados: 0 },
    },
  });
  assertEquals([meses[4].custoPorResultado, meses[4].resultadosAds], [12.5, 8]);
  assertEquals([meses[5].custoPorResultado, meses[5].resultadosAds], [null, 0]);
  assertEquals([meses[0].custoPorResultado, meses[0].resultadosAds], [null, 0]);
  assert(meses.every((m, i) => i === 0 || m.mes > meses[i - 1].mes));
});
