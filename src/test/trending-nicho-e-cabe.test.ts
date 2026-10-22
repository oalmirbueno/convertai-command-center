import { describe, expect, it } from "vitest";
import {
  assuntoSensivel, assuntosDoNicho, julgarNoticias, ordenarPeloCabe, perguntasDoCabe,
} from "../../supabase/functions/agente-calendario/modulos/trending-noticias";
import { separarNoticias, type Noticia } from "@/components/mesa/hypeETrending";
import { datasDasProximasSemanas, dataDoNicho, datasDoAno, separarPeloNicho } from "@/components/mesa/datasDoHype";

const n = (titulo: string): { titulo: string } => ({ titulo });

describe("Em alta pelo nicho do cliente", () => {
  it("a busca automática usa o nicho: segmento, nicho e produtos do contexto e o nicho lido (nada genérico)", () => {
    expect(assuntosDoNicho({ segmento: "Odontologia", contexto: { produtos: "Clareamento dental, lentes e implantes. Atendemos em Curitiba." }, titulosDoNicho: ["Clareamento caseiro viralizando"] }))
      .toEqual(["Odontologia", "Clareamento dental, lentes e implantes", "Clareamento caseiro viralizando"]);
    expect(assuntosDoNicho({ segmento: null, contexto: { nicho: "Moda feminina" } })).toEqual(["Moda feminina"]);
    expect(assuntosDoNicho({ segmento: null, contexto: {} })).toEqual([]);
  });

  it("corta tragédia, crime e política partidária em código, pelo começo da palavra", () => {
    expect(assuntoSensivel("Acidente na BR-277 deixa três mortos")).toBe(true);
    expect(assuntoSensivel("Eleição: candidato promete reduzir impostos")).toBe(true);
    expect(assuntoSensivel("Polícia prende suspeito de golpe")).toBe(true);
    expect(assuntoSensivel("Tendência absoluta: o jeans volta às vitrines")).toBe(false);
    expect(assuntoSensivel("Clareamento dental cresce antes das festas")).toBe(false);
  });

  it("um pedido só ao Jev por lote: cabe (Choice), sensível (Noul) e ângulo (Choice) por manchete", () => {
    const q = perguntasDoCabe(2);
    expect(Object.keys(q).sort()).toEqual(["a0", "a1", "c0", "c1", "s0", "s1"]);
    expect(q.c0.type).toBe("choice");
    expect(Object.keys(q.c0.criteria as Record<string, string>)).toEqual(["serve", "talvez", "nao_serve"]);
    expect(q.s1.type).toBe("noul");
  });

  it("junta o Jev com o corte: o que serve vem primeiro com o porquê; sensível e não serve vão para o fim", () => {
    const itens = [n("Juros sobem de novo"), n("Acidente deixa feridos"), n("Jeans volta às vitrines"), n("Feira de moda abre inscrições")];
    const respostas = {
      c0: { choice: "nao_serve" }, s0: { noul: 0.1 }, a0: { choice: "educar" },
      c1: { choice: "serve" }, s1: { noul: 0.2 }, a1: { choice: "oferta" },
      c2: { choice: "serve" }, s2: { noul: 0.05 }, a2: { choice: "tendencia" },
      c3: { choice: "talvez" }, s3: { noul: 0.7 }, a3: { choice: "autoridade" },
    };
    const julgadas = ordenarPeloCabe(julgarNoticias(itens, respostas));
    expect(julgadas.map((x) => x.titulo)).toEqual(["Jeans volta às vitrines", "Juros sobem de novo", "Acidente deixa feridos", "Feira de moda abre inscrições"]);
    expect(julgadas[0].julgamento).toEqual({ cabe: "serve", motivo: "Serve para surfar uma tendência que o público está acompanhando.", sensivel: false });
    // Sensível no código (acidente) e no Jev (Noul >= 0,5) viram "não serve".
    expect(julgadas[2].julgamento!.sensivel).toBe(true);
    expect(julgadas[3].julgamento).toEqual({ cabe: "nao_serve", motivo: "Assunto sensível: não serve para marca.", sensivel: true });
  });

  it("sem o Jev, só o corte em código: o sensível sai, o resto fica sem julgamento", () => {
    const julgadas = julgarNoticias([n("Morre ator famoso"), n("Nova coleção de verão")], null);
    expect(julgadas[0].julgamento!.cabe).toBe("nao_serve");
    expect(julgadas[1].julgamento).toBeNull();
  });

  it("na tela: o que não serve fica escondido; serve, talvez e sem julgamento à vista, nessa ordem", () => {
    const base = { fonte: "F", fonte_url: null, link: "https://x.test", data: "2026-10-21T10:00:00Z" };
    const itens: Noticia[] = [
      { ...base, titulo: "A", julgamento: null },
      { ...base, titulo: "B", julgamento: { cabe: "nao_serve", motivo: "x", sensivel: false } },
      { ...base, titulo: "C", julgamento: { cabe: "talvez", motivo: "x", sensivel: false } },
      { ...base, titulo: "D", julgamento: { cabe: "serve", motivo: "x", sensivel: false } },
    ];
    const { visiveis, descartadas } = separarNoticias(itens);
    expect(visiveis.map((x) => x.titulo)).toEqual(["D", "C", "A"]);
    expect(descartadas.map((x) => x.titulo)).toEqual(["B"]);
  });
});

describe("Datas pelo nicho do cliente", () => {
  const d = (id: string) => datasDoAno(2026).find((x) => x.id === id)!;

  it("regra sem Jev: varejo e cultura servem a todos; profissão e gastronomia só com o segmento", () => {
    expect(dataDoNicho(d("black-friday"), null)).toBe(true);
    expect(dataDoNicho(d("dia-do-dentista"), "Odontologia")).toBe(true);
    expect(dataDoNicho(d("dia-do-dentista"), "Moda feminina")).toBe(false);
    expect(dataDoNicho(d("dia-do-veterinario"), "Pet shop")).toBe(true);
    expect(dataDoNicho(d("dia-da-pizza"), "Pizzaria do bairro")).toBe(true);
    expect(dataDoNicho(d("dia-da-pizza"), "Restaurante italiano")).toBe(true);
    expect(dataDoNicho(d("dia-do-medico"), null)).toBe(false);
  });

  it("as datas fora do nicho saem da lista principal (Jev manda; sem nota, a regra)", () => {
    const datas = datasDasProximasSemanas("2026-10-21");
    const comJev = separarPeloNicho(datas, { natal: { nota: 9 }, halloween: { nota: 2 } }, "Odontologia");
    expect(comJev.principais.map((x) => x.id)).toContain("natal");
    expect(comJev.outras.map((x) => x.id)).toContain("halloween");
    // Sem nota para a data: a regra (o Dia do Dentista é do nicho de Odontologia, o do Designer não).
    expect(comJev.principais.map((x) => x.id)).toContain("dia-do-dentista");
    expect(comJev.outras.map((x) => x.id)).toContain("dia-do-designer");
    const semJev = separarPeloNicho(datas, null, null);
    expect(semJev.outras.every((x) => x.tipo === "profissao" || x.tipo === "gastronomia")).toBe(true);
  });
});
