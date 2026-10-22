import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { conferirCopy, contarEmojis, lerConferencia, marcasDeIa, notaDaCopy, perguntasDaConferencia } from "../../supabase/functions/_shared/motor-de-copy";
import { avisosDoCarrossel, MAX_LAMINAS_PELA_API } from "../../supabase/functions/_shared/regras-do-carrossel";
import { misturaDeHashtags, tamanhoEstimado } from "../../supabase/functions/estudio-arte/modulos/hashtags-por-tamanho";

/**
 * Regras das skills de Instagram no Estúdio e na agenda (12/10/2026): marcas de texto de IA em
 * português (ig-humanizer), hashtags por tamanho (ig-hashtag-strategist) e carrossel (ig-carousel-planner).
 * Tudo vira aviso ou nota para escolher entre as variações: nunca laço de correção.
 */

describe("marcas de texto de IA em português (código)", () => {
  it("pega pergunta-ponte, contraste montado, sinceridade encenada e frase morta", () => {
    expect(marcasDeIa("Testamos 3 cores. O resultado? Vendas em dobro.")).toContain('pergunta-ponte ("O resultado?")');
    expect(marcasDeIa("Pare de postar todo dia, comece a postar com plano.")).toContain("contraste montado");
    expect(marcasDeIa("Vou ser sincero com você: o anúncio sozinho não vende.")).toContain("sinceridade encenada");
    expect(marcasDeIa("No fim do dia, o que importa é o cliente.")).toContain("frase morta");
    expect(marcasDeIa("Simples. Rápido. Feito.")).toContain("frases de uma palavra em sequência");
  });

  it("emojis: 4 ou mais é marca; 3 passa", () => {
    expect(contarEmojis("Promoção 🔥🔥🔥")).toBe(3);
    expect(marcasDeIa("Promoção 🔥🔥🔥")).toEqual([]);
    expect(marcasDeIa("Promoção 🔥🚀✨💯")).toContain("emojis demais (4 ou mais)");
  });

  it("texto normal da marca não é marcado", () => {
    expect(marcasDeIa("A poda de inverno da Verzelo protege a árvore da geada. Agende pelo Direct.")).toEqual([]);
  });

  it("vira problema na conferência em código e tira nota", () => {
    const c = conferirCopy("O resultado? Clientes felizes. Chame no Direct.", "legenda");
    expect(c.problemas.map((p) => p.tipo)).toContain("marca_ia");
    expect(c.nota).toBeLessThan(10);
  });

  it("o Jev ganha a pergunta das marcas e ela pesa na nota", () => {
    const q = perguntasDaConferencia(2);
    expect(Object.keys(q)).toContain("marcas_0");
    expect(Object.keys(q)).toContain("marcas_1");
    const [j] = lerConferencia({ voz_0: { score: 4 }, forca_0: { score: 4 }, marcas_0: { noul: 0.8 } } as never, 1);
    expect(j.marcas).toBe(0.8);
    const com = notaDaCopy({ nota: 10, problemas: [] }, j);
    const sem = notaDaCopy({ nota: 10, problemas: [] }, { ...j, marcas: 0.1 });
    expect(sem.nota - com.nota).toBe(10);
    expect(com.avisos.join(" ")).toContain("marca de texto de IA");
  });
});

describe("hashtags por tamanho", () => {
  it("monta 2 a 3 de nicho, 1 a 2 médias e no máximo 1 ampla, de 3 a 5", () => {
    const r = misturaDeHashtags([
      { hashtag: "#amor", nota: 3, tamanho: "ampla" },
      { hashtag: "#instagood", nota: 2, tamanho: "ampla" },
      { hashtag: "#podadearvorescuritiba", nota: 3, tamanho: "nicho" },
      { hashtag: "#jardinagemcuritiba", nota: 2.5, tamanho: "nicho" },
      { hashtag: "#paisagismoresidencial", nota: 2, tamanho: "nicho" },
      { hashtag: "#paisagismo", nota: 2, tamanho: "media" },
      { hashtag: "#jardinagem", nota: 1.5, tamanho: "media" },
    ]);
    expect(r.length).toBe(5);
    expect(r.filter((h) => h === "#amor" || h === "#instagood").length).toBeLessThanOrEqual(1);
    expect(r.slice(0, 2)).toEqual(["#podadearvorescuritiba", "#jardinagemcuritiba"]);
  });

  it("com poucas candidatas, completa até 3 sem passar de 1 ampla", () => {
    const r = misturaDeHashtags([
      { hashtag: "#amor", nota: 3, tamanho: "ampla" },
      { hashtag: "#love", nota: 2, tamanho: "ampla" },
      { hashtag: "#poda", nota: 1, tamanho: "media" },
    ]);
    expect(r).toEqual(["#poda", "#amor"]);
  });

  it("estimativa sem o Jev pelo tamanho da palavra", () => {
    expect(tamanhoEstimado("#amor")).toBe("ampla");
    expect(tamanhoEstimado("#paisagismo")).toBe("media");
    expect(tamanhoEstimado("#podadearvorescuritiba")).toBe("nicho");
  });
});

describe("carrossel", () => {
  const card = (texto: string) => ({ texto });
  it("mais de 10 lâminas avisa (a API não publica)", () => {
    const a = avisosDoCarrossel(Array.from({ length: 12 }, (_, i) => card(`Lâmina ${i + 1} salve`)));
    expect(MAX_LAMINAS_PELA_API).toBe(10);
    expect(a[0]).toContain("até 10");
  });

  it("menos de 3 lâminas sugere imagem única", () => {
    expect(avisosDoCarrossel([card("a"), card("b")])[0]).toContain("imagem única");
  });

  it("última lâmina sem pedido avisa; com 'salve' passa", () => {
    const sem = avisosDoCarrossel([card("5 erros que travam sua agenda, o 4º quase ninguém vê"), card("Erro 1"), card("Erro 2"), card("Resumo dos erros")]);
    expect(sem.join(" ")).toContain("não pede nada");
    const com = avisosDoCarrossel([card("5 erros que travam sua agenda, o 4º quase ninguém vê"), card("Erro 1"), card("Erro 2"), card("Resumo. Salve para consultar depois.")]);
    expect(com).toEqual([]);
  });

  it("lâmina 1 longa ou título seco avisa", () => {
    expect(avisosDoCarrossel([card("Dicas"), card("1"), card("Salve")]).join(" ")).toContain("título seco");
  });
});

describe("ligado nas mesas", () => {
  it("Estúdio: 4 variações, hashtags por tamanho e avisos de carrossel; agenda: até 10 lâminas e legenda pelo Jev", () => {
    const est = readFileSync(resolve(__dirname, "../../supabase/functions/estudio-arte/index.ts"), "utf8");
    expect(est).toContain("const VARIACOES_DA_LEGENDA = 3;");
    expect(est).toContain("misturaDeHashtags(");
    expect(est).toContain("avisosDoCarrossel(direcao.cards");
    const cal = readFileSync(resolve(__dirname, "../../supabase/functions/agente-calendario/index.ts"), "utf8");
    expect(cal).toContain("cards = cards.slice(0, MAX_LAMINAS_PELA_API);");
    expect((cal.match(/await conferirLegendasComJev\(/g) ?? []).length).toBe(4);
  });
});
