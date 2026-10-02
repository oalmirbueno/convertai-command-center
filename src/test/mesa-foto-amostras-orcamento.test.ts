import { describe, expect, it } from "vitest";
import { custoPorImagemDoModelo, escolherModeloMaisBarato, lerTeto, pendentesSemImagem, planejarAmostras, podeGerarMais, TETO_PADRAO_USD } from "../../scripts/orcamento-das-amostras.mjs";

/**
 * Item 9 da Mesa Foto (02/10): o script que gera uma amostra por prompt sem
 * imagem tem teto rígido (padrão US$ 3,00), escolhe o gerador mais barato
 * do catálogo e para ANTES de passar do teto. Aqui só as funções puras
 * (nada de rede, nada de geração).
 */

const itens = (n: number) => Array.from({ length: n }, (_, k) => ({ id: `p${k + 1}`, titulo: `Prompt ${k + 1}` }));

describe("planejarAmostras: teto rígido", () => {
  it("teto padrão é US$ 3,00", () => {
    expect(TETO_PADRAO_USD).toBe(3);
    const p = planejarAmostras({ pendentes: itens(200), custoPorImagem: 0.04 });
    expect(p.tetoUsd).toBe(3);
    // 75 x 0,04 = 3,00 cabe exatamente; o 76º passaria.
    expect(p.itens).toHaveLength(75);
    expect(p.totalUsd).toBe(3);
    expect(p.cortados).toBe(125);
    expect(p.motivo).toBe("teto");
  });

  it("para antes de passar do teto (nunca soma acima dele)", () => {
    const p = planejarAmostras({ pendentes: itens(10), custoPorImagem: 0.7, tetoUsd: 2 });
    expect(p.itens.map((x: { item: { id: string } }) => x.item.id)).toEqual(["p1", "p2"]);
    expect(p.totalUsd).toBeCloseTo(1.4, 6);
    expect(p.totalUsd).toBeLessThanOrEqual(2);
    expect(p.itens[1].acumuladoUsd).toBeCloseTo(1.4, 6);
    // Custo por item (função): o terceiro (1,0) não cabe em 0,9 + 1,0 > 1,5; para ali, não pula para o barato.
    const custos: Record<string, number> = { p1: 0.5, p2: 0.4, p3: 1.0, p4: 0.01 };
    const q = planejarAmostras({ pendentes: itens(4), custoPorImagem: (i: { id: string }) => custos[i.id], tetoUsd: 1.5 });
    expect(q.itens.map((x: { item: { id: string } }) => x.item.id)).toEqual(["p1", "p2"]);
    expect(q.totalUsd).toBeCloseTo(0.9, 6);
  });

  it("limite corta antes do teto; sem pendente, plano vazio", () => {
    const p = planejarAmostras({ pendentes: itens(10), custoPorImagem: 0.04, tetoUsd: 3, limite: 3 });
    expect(p.itens).toHaveLength(3);
    expect(p.motivo).toBe("limite");
    expect(planejarAmostras({ pendentes: [], custoPorImagem: 0.04 }).itens).toEqual([]);
  });

  it("custo zero, negativo ou inválido não planeja nada", () => {
    for (const custo of [0, -1, NaN, null, undefined, "abc"]) {
      const p = planejarAmostras({ pendentes: itens(5), custoPorImagem: custo });
      expect(p.itens).toEqual([]);
      expect(p.totalUsd).toBe(0);
      expect(p.motivo).toBe("custo_invalido");
    }
    // Teto inválido vira o padrão; teto zero não gera nada.
    expect(lerTeto("x")).toBe(3);
    expect(lerTeto(-2)).toBe(3);
    expect(planejarAmostras({ pendentes: itens(5), custoPorImagem: 0.04, tetoUsd: 0 }).itens).toEqual([]);
  });

  it("execução real: o próximo só vai se o gasto real mais a estimativa couber", () => {
    expect(podeGerarMais({ gastoUsd: 2.96, proximoUsd: 0.04, tetoUsd: 3 })).toBe(true);
    expect(podeGerarMais({ gastoUsd: 2.97, proximoUsd: 0.04, tetoUsd: 3 })).toBe(false);
    expect(podeGerarMais({ gastoUsd: 0, proximoUsd: 0, tetoUsd: 3 })).toBe(false);
  });
});

describe("escolherModeloMaisBarato", () => {
  const catalogo = [
    { id: "openai:gpt-image-2", tipo: "imagem", ativo: true, preco_imagem: { baixa: 0.02, media: 0.07, alta: 0.19 }, preco_entrada_1m: 5 },
    { id: "openrouter:microsoft/mai-image-2.6", tipo: "imagem", ativo: true, preco_imagem: { media: 0.04 } },
    { id: "openrouter:barato-desligado", tipo: "imagem", ativo: false, preco_imagem: { media: 0.001 } },
    { id: "openrouter:barato-fora-do-ar", tipo: "imagem", ativo: true, disponivel: false, preco_imagem: { media: 0.002 } },
    { id: "openrouter:sem-preco", tipo: "imagem", ativo: true, preco_imagem: { media: 0 } },
    { id: "openrouter:so-edita", tipo: "imagem", ativo: true, preco_imagem: { media: 0.003 }, modalidades: { entrada: ["imagem"], saida: ["imagem"] } },
    { id: "openai:gpt-6-sol", tipo: "texto", ativo: true, preco_entrada_1m: 0.01 },
  ];

  it("escolhe o ativo, disponível, texto para imagem e com preço mais baixo", () => {
    const e = escolherModeloMaisBarato(catalogo);
    expect(e.modelo.id).toBe("openrouter:microsoft/mai-image-2.6");
    expect(e.custoPorImagem).toBeCloseTo(0.04, 6);
  });

  it("o preço soma a entrada do prompt (mesma fórmula do motor) e a qualidade conta", () => {
    expect(custoPorImagemDoModelo(catalogo[0], { qualidade: "media", tokensEntrada: 1000 })).toBeCloseTo(0.07 + 0.005, 6);
    expect(escolherModeloMaisBarato(catalogo, { qualidade: "baixa", tokensEntrada: 0 }).modelo.id).toBe("openai:gpt-image-2");
  });

  it("sem gerador que sirva, null", () => {
    expect(escolherModeloMaisBarato([])).toBeNull();
    expect(escolherModeloMaisBarato(catalogo.slice(2))).toBeNull();
    expect(escolherModeloMaisBarato(null)).toBeNull();
  });
});

describe("pendentesSemImagem", () => {
  it("só prompt com texto e sem imagem nenhuma", () => {
    const lista = [
      { id: "a", tipo: "prompt", prompt_pt: "x" },
      { id: "b", tipo: "prompt", prompt_pt: "x", storage_path: "s.png" },
      { id: "c", tipo: "prompt", prompt_en: "x", miniatura_url: "https://m" },
      { id: "d", tipo: "referencia", prompt_pt: "x" },
      { id: "e", tipo: "prompt", prompt_pt: "", prompt_en: "" },
      { id: "f", tipo: "prompt", prompt_en: "y", imagem_url: null },
    ];
    expect(pendentesSemImagem(lista).map((i: { id: string }) => i.id)).toEqual(["a", "f"]);
  });
});
