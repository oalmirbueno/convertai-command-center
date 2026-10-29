import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blocoDaCombinacao,
  blocoDaTrocaPeloTema,
  LINHA_DO_TRATAMENTO_DA_LETRA,
  linhaDoMundoTematico,
  linhasDoEnquadramentoDoRosto,
  temaDoConteudo,
} from "../../supabase/functions/estudio-arte/tema-e-referencias";
import { blocoDoRosto } from "../../supabase/functions/estudio-arte/rosto-na-geracao";

/**
 * 29/10/2026 (dono): a referência é o estilo e o tema manda no conteúdo; combinar duas referências; o mundo
 * temático da capa até o fim do carrossel; letra da empresa com o tratamento da referência; rosto fiel sem repetir
 * o ângulo da foto, com o enquadramento pelo layout.
 */

describe("a referência é o estilo, o tema manda no conteúdo", () => {
  it("troca cada elemento do assunto da referência pelo tema e pelo nicho, mesmo em Idêntica, com elementos reais", () => {
    const b = blocoDaTrocaPeloTema({ tema: "Halloween na assistência técnica", cliente: "Stop Informática", temCopy: true });
    expect(b).toContain("Halloween na assistência técnica");
    expect(b).toContain("Stop Informática");
    expect(b).toMatch(/apague e troque por um equivalente do nicho, na mesma posição, escala, ângulo, luz e função/);
    expect(b).toMatch(/Mesmo em Idêntica: idêntica é a estética/);
    expect(b).toMatch(/elementos REAIS/);
    expect(b).toMatch(/logo dela entra pelo anexo, nunca desenhada de memória/);
    expect(b).toMatch(/Nunca copie e cole/);
    expect(blocoDaTrocaPeloTema({ tema: "", cliente: "x", temCopy: false })).toBe("");
  });

  it("tema vem do conceito e do fio visual do trabalho", () => {
    expect(temaDoConteudo({ conceito: "  Black Friday  da loja ", fio_visual: "neon roxo" })).toBe("Black Friday da loja / neon roxo");
    expect(temaDoConteudo(null)).toBe("");
  });
});

describe("duas referências se combinam", () => {
  it("lê todas, estrutura da primeira e o melhor da segunda", () => {
    const b = blocoDaCombinacao({ indices: [1, 3] });
    expect(b).toContain("imagem 1 e imagem 3");
    expect(b).toMatch(/estrutura .* é a da imagem 1/);
    expect(b).toMatch(/Da imagem 3 venha também o que for melhor/);
    expect(blocoDaCombinacao({ indices: [2] })).toBe("");
  });
});

describe("carrossel ambientado no tema até o fim", () => {
  it("da lâmina 2 em diante: mesmo mundo, elementos novos; o fim fecha o tema", () => {
    expect(linhaDoMundoTematico({ ordem: 1, total: 5, tema: "x" })).toBe("");
    const meio = linhaDoMundoTematico({ ordem: 3, total: 5, tema: "Dia das Bruxas" });
    expect(meio).toContain("Dia das Bruxas");
    expect(meio).toMatch(/elementos NOVOS/);
    expect(meio).toMatch(/nada repetido da capa/);
    expect(meio).not.toMatch(/Fechamento/);
    expect(linhaDoMundoTematico({ ordem: 5, total: 5, tema: "" })).toMatch(/Fechamento: termine o tema/);
  });
});

describe("letra e rosto", () => {
  it("a família é a da empresa; da referência só o tratamento", () => {
    expect(LINHA_DO_TRATAMENTO_DA_LETRA).toMatch(/família é sempre a da empresa/);
    expect(LINHA_DO_TRATAMENTO_DA_LETRA).toMatch(/Nunca troque a fonte da empresa pela da referência/);
  });

  it("rosto fiel, sem repetir a foto; enquadramento pelo espaço do layout (o COMO da equipe manda quando existe)", () => {
    const b = blocoDoRosto({ indices: [2], destacar: false, pessoaNaReferencia: true });
    expect(b).toMatch(/nunca repita o ângulo, a pose, a expressão, o enquadramento/);
    expect(b).toMatch(/área lateral ou estreita, de lado ou em três quartos/);
    expect(b).toMatch(/só o rosto em close/);
    const comComo = blocoDoRosto({ indices: [2], destacar: false, pessoaNaReferencia: false, como: "sorrindo, de perfil" });
    expect(comComo).toMatch(/segue o COMO pedido pela equipe/);
    expect(linhasDoEnquadramentoDoRosto(false)).toHaveLength(2);
  });
});

describe("ligação no gerador", () => {
  const index = readFileSync(resolve(process.cwd(), "supabase/functions/estudio-arte/index.ts"), "utf8");
  it("réplica: troca pelo tema, combinação, letra e mundo temático; anúncio fica de fora", () => {
    expect(index).toContain('ads ? "" : blocoDaTrocaPeloTema({ tema: temaDoConteudo(t.direcao), cliente: marca.nomeCliente');
    expect(index).toContain('ads ? "" : blocoDaCombinacao({ indices: refsNoPrompt.map((r) => r.indice) })');
    expect(index).toContain('ads ? "" : LINHA_DO_TRATAMENTO_DA_LETRA');
    expect(index).toContain('ads ? "" : linhaDoMundoTematico({ ordem, total, tema: temaDoConteudo(t.direcao) })');
  });
  it("lâmina normal: mundo temático fora da cena fixa e do anúncio", () => {
    expect(index).toContain('replicar || ads || cenaFixa ? "" : linhaDoMundoTematico');
    expect(index).toContain("(29/10) Referência é ESTILO");
  });
});
