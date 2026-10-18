import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { capaComTitulo, escolherCapa, indiceEscolhido, limparAlternativas, notasDasCapas, perguntasDaCapa, tituloDaCapa } from "./escolha-da-capa.ts";
import type { CardDirecao } from "../../_shared/direcao-arte.ts";
import type { RespostaJev } from "../../_shared/jev.ts";

const capa = {
  ordem: 1,
  funcao: "capa",
  texto_exato: "Seu anúncio queima dinheiro\nVeja o erro mais comum",
  blocos: [{ papel: "headline", texto: "Seu anúncio queima dinheiro" }, { papel: "subtitulo", texto: "Veja o erro mais comum" }],
} as unknown as CardDirecao;

const notas = (lista: Array<[number, number, number]>) => {
  const r: Record<string, RespostaJev> = {};
  lista.forEach(([g, c, l], i) => {
    r[`gancho_${i}`] = { score: g };
    r[`clareza_${i}`] = { score: c };
    r[`leitura_${i}`] = { score: l };
  });
  return r;
};

Deno.test("o título da capa é o headline e a troca mexe só nele", () => {
  assertEquals(tituloDaCapa(capa), "Seu anúncio queima dinheiro");
  const nova = capaComTitulo(capa, "Pare de pagar por clique vazio");
  assertEquals(nova.texto_exato, "Pare de pagar por clique vazio\nVeja o erro mais comum");
  assertEquals(nova.blocos?.[1].texto, "Veja o erro mais comum");
});

Deno.test("as alternativas: até 7 palavras, sem repetir a do diretor nem entre si", () => {
  const limpas = limparAlternativas({ capas: ["Seu anúncio queima dinheiro", "Pare de pagar por clique vazio", "pare de pagar por clique vazio!", "um título comprido demais que passa de sete palavras fácil", "Três erros que travam suas vendas"] }, "Seu anúncio queima dinheiro");
  assertEquals(limpas, ["Pare de pagar por clique vazio", "Três erros que travam suas vendas"]);
});

Deno.test("só troca a capa do diretor quando outra passa com folga", () => {
  const capas = ["do diretor", "alternativa"];
  assertEquals(indiceEscolhido(notasDasCapas(capas, notas([[2, 2, 2], [2.2, 2.1, 2]]))), 0);
  assertEquals(indiceEscolhido(notasDasCapas(capas, notas([[1.5, 1.5, 2], [2.8, 2.5, 2.5]]))), 1);
});

Deno.test("três notas por capa numa chamada só", () => {
  assertEquals(Object.keys(perguntasDaCapa(4)).length, 12);
});

Deno.test("o passo inteiro devolve a capa nova e o custo dos dois", async () => {
  const r = await escolherCapa(
    { capa, assunto: "anúncio", conceito: "", outras: [], fatos: [] },
    async () => ({ json: { capas: ["Pare de pagar por clique vazio"] }, custoUsd: 0.01 }),
    async () => ({ answers: notas([[1, 1, 2], [3, 3, 3]]), custoUsd: 0.001 }),
  );
  assertEquals(r.escolhida, 1);
  assertEquals(r.card ? tituloDaCapa(r.card) : null, "Pare de pagar por clique vazio");
  assert(Math.abs(r.custoUsd - 0.011) < 1e-9);
});
