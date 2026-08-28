import { describe, expect, it } from "vitest";
import {
  MINIMO_DE_CLIQUES_PARA_COMPARAR,
  resumirCriativos,
  type PecaParaRelatorio,
} from "@/lib/adsCreativeReport";

/**
 * O relatório de criativos, construído sobre o dado REAL da carteira.
 *
 * Quando fui olhar antes de escrever, o retrato era: Verzelo com 34 peças
 * e só 15 gastando; Mirante Luz com 17 e só 6; a maior peça do mês em
 * R$ 104 e a segunda em R$ 17. Volume pequeno e metade das artes parada.
 */

const peca = (p: Partial<PecaParaRelatorio>): PecaParaRelatorio => ({
  ad_name: "Peça",
  gasto: 0,
  impressoes: 0,
  cliques_no_link: 0,
  ctr: null,
  custo_no_link: null,
  ...p,
});

describe("arte parada é informação, não ruído", () => {
  it("diz quantas peças não chegaram a rodar", () => {
    // Dezenove das trinta e quatro da Verzelo não gastaram um centavo.
    // Isso é trabalho da equipe que não virou resultado: é a informação
    // mais acionável do mês, e não uma nota de rodapé.
    const r = resumirCriativos([
      peca({ ad_name: "Rodou", gasto: 50, cliques_no_link: 20, custo_no_link: 2.5 }),
      peca({ ad_name: "Parada 1" }),
      peca({ ad_name: "Parada 2" }),
    ]);
    expect(r.paradas).toBe(2);
    expect(r.texto).toContain("2 peças não chegaram a rodar");
  });

  it("no singular também sai certo", () => {
    const r = resumirCriativos([
      peca({ ad_name: "Rodou", gasto: 50 }),
      peca({ ad_name: "Parada" }),
    ]);
    expect(r.texto).toContain("1 peça não chegou a rodar");
  });

  it("sem peça parada, não inventa a frase", () => {
    const r = resumirCriativos([peca({ ad_name: "A", gasto: 10 })]);
    expect(r.texto).not.toContain("não chegou a rodar");
    expect(r.texto).not.toContain("não chegaram a rodar");
  });
});

describe("custo só é comparado com amostra que sustente", () => {
  it("com menos de dez cliques, NÃO ranqueia — e diz por quê", () => {
    // Uma peça com dois cliques e R$ 5 produz um "R$ 2,50 por clique" que
    // parece análise e é sorte. Alguém decidiria verba com isso.
    const r = resumirCriativos([
      peca({ ad_name: "A", gasto: 5, cliques_no_link: 2, custo_no_link: 2.5 }),
      peca({ ad_name: "B", gasto: 9, cliques_no_link: 3, custo_no_link: 3 }),
    ]);
    expect(r.comparaveis).toBe(0);
    expect(r.texto).toContain("é sorte, não desempenho");
    expect(r.texto).not.toContain("mais eficiente");
    expect(r.destaque).toBe("");
  });

  it("com duas ou mais acima do corte, compara a melhor com a pior", () => {
    const r = resumirCriativos([
      peca({ ad_name: "Barata", gasto: 100, cliques_no_link: 50, custo_no_link: 2 }),
      peca({ ad_name: "Cara", gasto: 100, cliques_no_link: 10, custo_no_link: 10 }),
    ]);
    expect(r.comparaveis).toBe(2);
    expect(r.texto).toContain("a mais eficiente foi Barata");
    expect(r.texto).toContain("Cara");
    expect(r.destaque).toContain("Barata");
  });

  it("com uma só acima do corte, diz que as demais não têm volume", () => {
    const r = resumirCriativos([
      peca({ ad_name: "Única", gasto: 100, cliques_no_link: 30, custo_no_link: 3.33 }),
      peca({ ad_name: "Pouca", gasto: 4, cliques_no_link: 2, custo_no_link: 2 }),
    ]);
    expect(r.comparaveis).toBe(1);
    expect(r.texto).toContain("não têm volume para comparar");
  });

  it("o corte é dez, e o número está exposto no texto", () => {
    // Quem lê precisa saber qual foi a régua, senão o ranking vira opinião.
    expect(MINIMO_DE_CLIQUES_PARA_COMPARAR).toBe(10);
    const r = resumirCriativos([
      peca({ ad_name: "A", gasto: 5, cliques_no_link: 2, custo_no_link: 2.5 }),
    ]);
    expect(r.texto).toContain("10 cliques no link");
  });

  it("peça no limite exato entra na comparação", () => {
    const r = resumirCriativos([
      peca({ ad_name: "Limite", gasto: 20, cliques_no_link: 10, custo_no_link: 2 }),
      peca({ ad_name: "Outra", gasto: 40, cliques_no_link: 20, custo_no_link: 2 }),
    ]);
    expect(r.comparaveis).toBe(2);
  });
});

describe("o resumo conta onde a verba foi", () => {
  it("lista as três maiores por gasto", () => {
    const r = resumirCriativos([
      peca({ ad_name: "Grande", gasto: 104.27, cliques_no_link: 40, custo_no_link: 2.6 }),
      peca({ ad_name: "Media", gasto: 17.78, cliques_no_link: 6 }),
      peca({ ad_name: "Pequena", gasto: 5.39, cliques_no_link: 2 }),
      peca({ ad_name: "Menor", gasto: 1.1 }),
    ]);
    expect(r.texto).toContain("Onde a verba foi:");
    expect(r.texto).toContain("Grande");
    expect(r.texto).not.toContain("Menor");
  });

  it("peça sem nome não vira vazio no texto", () => {
    const r = resumirCriativos([peca({ ad_name: null, gasto: 10 })]);
    expect(r.texto).toContain("peça sem nome");
  });

  it("lista vazia não produz relatório nenhum", () => {
    // Trecho vazio no relatório do cliente é pior que trecho ausente.
    const r = resumirCriativos([]);
    expect(r.texto).toBe("");
    expect(r.destaque).toBe("");
  });
});

describe("o texto que sai da carteira real", () => {
  it("lê bem com os números da Verzelo", () => {
    // Estes são os valores que estavam no banco quando escrevi: 34 peças,
    // 15 com verba, três acima do corte de dez cliques, e a mais eficiente
    // a R$ 0,33 por clique contra R$ 0,71 da pior. Serve de âncora para o
    // dia em que alguém mexer nas frases: se o resultado deixar de fazer
    // sentido lido em voz alta, este teste mostra na hora.
    const r = resumirCriativos([
      peca({ ad_name: "[VERZELO] Direct V3 | Revitalização", gasto: 17.78, cliques_no_link: 4 }),
      peca({ ad_name: "[VERZELO] Site V3 | Manutenção", gasto: 9.53, cliques_no_link: 26, custo_no_link: 0.37 }),
      peca({ ad_name: "[VERZELO V4 ROTA] Site | Manutenção", gasto: 7.77, cliques_no_link: 11, custo_no_link: 0.71 }),
      peca({ ad_name: "[VERZELO] Ad 01 | Revitalização | Contact", gasto: 3.5, cliques_no_link: 106, custo_no_link: 0.33 }),
      ...Array.from({ length: 30 }, (_, i) => peca({ ad_name: `Parada ${i + 1}` })),
    ]);

    expect(r.total).toBe(34);
    expect(r.rodaram).toBe(4);
    expect(r.paradas).toBe(30);
    expect(r.comparaveis).toBe(3);
    expect(r.texto).toContain("30 peças não chegaram a rodar");
    expect(r.texto).toContain("a mais eficiente foi [VERZELO] Ad 01 | Revitalização | Contact");
    // toLocaleString separa "R$" do número com espaço NÃO separável (U+00A0),
    // e não com o espaço comum que se digita. Comparar sem normalizar falha
    // por um caractere invisível, o que é o pior tipo de teste vermelho.
    const semEspacoDuro = r.texto.replace(/ /g, " ");
    expect(semEspacoDuro).toContain("R$ 0,33");
    expect(semEspacoDuro).toContain("R$ 0,71");
    expect(r.destaque).toContain("clique mais barato");
  });
});
