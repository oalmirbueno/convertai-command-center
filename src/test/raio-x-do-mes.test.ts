import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { raioXDoMes, tipoDoGancho } from "@/components/mesa/contaDoRaioX";
import { avisosDeSemelhanca, dHash, distancia, LIMIAR_DE_QUASE_IGUAL } from "../../supabase/functions/estudio-arte/modulos/semelhanca-das-laminas";

/** 17/10/2026: raio-x do mês, gancho do momento na memória e aviso de lâmina repetida no Estúdio. */
describe("raio-x do mês", () => {
  const itens = [
    { title: "a", delivery_type: "carousel", description: "Pilar: autoridade\nGancho do momento: Hype: Black Friday" },
    { title: "b", delivery_type: "carousel", description: "Pilar: Autoridade\nGancho do momento: Concorrente @rival: responder" },
    { title: "c", delivery_type: "static", description: "Pilar: autoridade\nGancho do momento: Nicho: IA nas buscas" },
    { title: "d", delivery_type: "static", description: "Pilar: venda" },
  ];
  it("conta formatos, pilares e o que pega o momento", () => {
    const r = raioXDoMes(itens);
    expect(r.total).toBe(4);
    expect(r.formatos).toEqual([{ rotulo: "Carrossel", n: 2 }, { rotulo: "Estático", n: 2 }]);
    expect(r.ganchos).toEqual({ hype: 1, nicho: 1, concorrente: 1, nenhum: 1 });
    expect(r.pilares[0]).toEqual({ rotulo: "Autoridade", n: 3 });
    expect(r.pilarDominante).toEqual({ rotulo: "Autoridade", pct: 75 });
  });
  it("o tipo do gancho pelo texto que o agente grava", () => {
    expect(tipoDoGancho("Hype: Halloween")).toBe("hype");
    expect(tipoDoGancho("Nicho: trend")).toBe("nicho");
    expect(tipoDoGancho("Concorrente @x: antecipar")).toBe("concorrente");
    expect(tipoDoGancho(null)).toBeNull();
  });
  it("o agente grava a linha e a memória guarda o momento com os números", () => {
    const mes = readFileSync("supabase/functions/agente-calendario/index.ts", "utf8");
    expect(mes).toContain("gancho_do_momento: S(\"string\")");
    expect(mes).toContain("linhas.push(`Gancho do momento: ${item.gancho_do_momento}`)");
    const memoria = readFileSync("supabase/functions/agente-calendario/modulos/memoria-editorial.ts", "utf8");
    expect(memoria).toContain("t.momento ? `momento ${t.momento}` : \"\"");
    expect(readFileSync("src/components/mesa/AgendaDoMes.tsx", "utf8")).toContain("<RaioXDoMes itens={itensDaMesa} />");
  });
});

describe("lâmina quase igual à capa", () => {
  const tons = (f: (x: number, y: number) => number) => Array.from({ length: 72 }, (_, i) => f(i % 9, Math.floor(i / 9)));
  const capa = dHash(tons((x) => x * 10));
  it("a mesma imagem avisa; uma imagem diferente não", () => {
    expect(avisosDeSemelhanca({ ordem: 2, esta: capa, capa })[0]).toContain("quase igual à capa");
    const outra = dHash(tons((x, y) => ((x + y) % 2 ? 200 : 10)));
    expect(distancia(capa, outra)).toBeGreaterThan(LIMIAR_DE_QUASE_IGUAL);
    expect(avisosDeSemelhanca({ ordem: 2, esta: outra, capa })).toEqual([]);
    expect(avisosDeSemelhanca({ ordem: 1, esta: capa, capa })).toEqual([]);
  });
  it("a geração grava a assinatura e o aviso vai para a versão", () => {
    const f = readFileSync("supabase/functions/estudio-arte/index.ts", "utf8");
    expect(f).toContain("semelhancaNaSerie(t, card.ordem, pngFinal)");
    expect(f).toContain("assinatura: semelhanca.assinatura");
  });
});
