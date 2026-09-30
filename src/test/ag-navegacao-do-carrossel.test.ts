import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { margensDoQuadro, promptDaLamina, type MarcaParaDirecao } from "../../supabase/functions/_shared/direcao-arte";
import {
  areaDaNavegacao,
  avisoDaNavegacao,
  blocoDaNavegacao,
  navegacaoDaLamina,
  perguntaDaNavegacao,
  semTextoDaNavegacao,
  TEXTO_DO_INDICADOR,
} from "../../supabase/functions/estudio-arte/modulos/navegacao-do-carrossel";

// Pedido do dono (28/09), só para CARROSSEL: capa com o indicador "arraste para
// o lado" na base, lâminas do meio com o mesmo indicador, última com a fileira
// de ícones do Instagram (curtir, comentar, enviar, salvar); padronizado, na
// cor e na fonte da marca, discreto. Correção dele: "não quero que faça nada
// por cima, e sim pelo gerador": a regra vai no prompt do gerador de imagem, e
// a conferência (Jev) só avisa quando não veio. Nada em arte única, story nem
// reel. "Sem mudar nada do que já existe; só adicionar": o prompt de sempre
// (promptDaLamina, replicar) fica byte a byte; o bloco entra no fim da base.

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const estudio = ler("supabase/functions/estudio-arte/index.ts");
const gerar = estudio.slice(estudio.indexOf("async function gerarCard("), estudio.indexOf("async function gravarVersao("));

/** O bloco que o gerarCard manda ao gerador para a lâmina (mesmos parâmetros do código: 4:5, Stop Informática). */
const blocoDa = (ordem: number, total: number, extra: { anuncio?: boolean; post?: string | null } = {}) => {
  const m = margensDoQuadro(null, (extra.post as never) ?? null);
  return blocoDaNavegacao(navegacaoDaLamina({ ordem, total, ...extra }), {
    quadro: { largura: 1080, altura: 1350 },
    margemBasePct: m.base,
    margemLateralPct: m.x,
    cor: "#242629",
    corSobreEscuro: "#F7F7F7",
    fonte: "Roboto",
  });
};

describe("carrossel de 5 lâminas: o texto da direção enviada ao gerador, por tipo de lâmina", () => {
  const b = [1, 2, 3, 4, 5].map((o) => blocoDa(o, 5));

  it("capa: o indicador 'arraste para o lado' na base inferior, concreto", () => {
    expect(b[0]).toContain("NAVEGAÇÃO DO CARROSSEL");
    expect(b[0]).toContain(`"${TEXTO_DO_INDICADOR}" seguido de uma seta fina apontando para a direita`);
    expect(b[0]).toContain("no canto inferior direito, alinhado à margem direita (90 px da borda) e com a base a 107 px da borda de baixo");
    expect(b[0]).toContain("letras de cerca de 27 px de altura numa arte de 1080 x 1350 (2% da altura do quadro)");
    expect(b[0]).toContain("a cor #242629 da marca (sobre base escura, #F7F7F7), fonte Roboto, peso regular");
    expect(b[0]).toContain("única exceção à regra de nenhum texto além do texto exato");
    expect(b[0]).not.toContain("coração");
  });

  it("meio (2, 3 e 4): o mesmo indicador, texto idêntico ao da capa", () => {
    expect(b[1]).toBe(b[0]);
    expect(b[2]).toBe(b[0]);
    expect(b[3]).toBe(b[0]);
  });

  it("última: a fileira de ícones curtir, comentar, enviar e salvar, sem indicador", () => {
    expect(b[4]).toContain("coração (curtir), balão de conversa (comentar), avião de papel (enviar) e marcador de página (salvar)");
    expect(b[4]).toContain("centralizada na largura, com a base dos ícones a 107 px da borda de baixo");
    expect(b[4]).toContain("cada ícone com cerca de 47 px de altura");
    expect(b[4]).toContain("a mesma nos quatro ícones");
    expect(b[4]).toContain("Nesta lâmina não há indicador de arrastar.");
    expect(b[4]).not.toContain(TEXTO_DO_INDICADOR);
  });

  it("discreto e nunca sobre o texto, a logo ou a foto real, em todas", () => {
    for (const x of b) {
      expect(x).toContain("Sem caixa, faixa, fundo, sombra, contorno ou brilho; discreto, menor que o texto de apoio.");
      expect(x).toMatch(/Nunca sobre o texto( da lâmina)?, a logo, um rosto ou o produto da foto real/);
    }
  });

  it("o gerarCard põe o bloco no fim da base (todos os modos) e no replicar, com a cor e a fonte da marca", () => {
    expect(gerar).toContain("const navegacaoDaGeracao = navegacaoDaLamina({ ordem, total, anuncio: ads, post: quadro.post });");
    expect(gerar).toContain("    dasEntregas.variedade,\n    // Frente AG: navegação do carrossel (indicador de arrastar ou ícones), pelo próprio gerador.\n    blocoDaNavegacaoAqui,\n");
    // O que já existia fica igual: o estilo e o template continuam fechando a base.
    expect(gerar).toContain("ordem, total > 1 && ordem > 1),\n    blocoDoEstilo,\n    blocoDoTemplate,\n  ].filter(Boolean).join");
    expect(gerar).toContain('variedade ? variedade.bloco : "",\n      // Frente AG: a navegação do carrossel também no modo replicar (a referência não traz a nossa).\n      blocoDaNavegacaoAqui,\n      continuidade,');
    expect(gerar).toContain('cor: corDaNavegacao("texto") || corDaNavegacao("prim") || corDaNavegacao("destaque")');
  });

  it("com foto real, a faixa da base abre na máscara para o gerador desenhar (senão a foto original apagava)", () => {
    expect(gerar).toContain("areasDeDesenho(card, total, false, quadro).concat(navegacaoAqui ? [areaDaNavegacao(margensAqui.base, margensAqui.x)] : [])");
    const a = areaDaNavegacao(7.9, 8.3);
    expect(a.y1).toBeGreaterThan(1 - 0.079);
    expect(a.y1).toBeLessThanOrEqual(1);
    expect(a.y0).toBeCloseTo(0.851, 3);
    expect(a.x0).toBeCloseTo(0.083, 3);
    expect(a.x1).toBeCloseTo(0.917, 3);
  });
});

describe("fora do carrossel orgânico: nada disso", () => {
  it("arte única, story ou reel (9:16) e criativo de anúncio: bloco vazio", () => {
    expect(blocoDa(1, 1)).toBe("");
    expect(blocoDa(1, 5, { post: "stories_9x16" })).toBe("");
    expect(blocoDa(5, 5, { post: "stories_9x16" })).toBe("");
    expect(blocoDa(1, 3, { anuncio: true })).toBe("");
    expect(navegacaoDaLamina({ ordem: 1, total: 1 })).toBeNull();
  });

  it("3:4 e 1:1 continuam carrossel", () => {
    expect(blocoDa(1, 4, { post: "retrato_3x4" })).toContain(TEXTO_DO_INDICADOR);
    expect(blocoDa(4, 4, { post: "quadrado_1x1" })).toContain("marcador de página (salvar)");
  });

  it("o prompt de sempre (promptDaLamina) não muda: nada foi mexido no que já funciona", () => {
    const marca: MarcaParaDirecao = { nomeCliente: "X", paleta: [{ nome: "Grafite", hex: "#242629", papel: "texto" }], estilo: null, regras: null, fontes: [], temLogo: false };
    const card = { ordem: 1, funcao: "capa" as const, texto_exato: "Oi", blocos: [{ papel: "headline" as const, texto: "Oi" }], layout: { zona_texto: "topo-esquerda" as const, alinhamento: "esquerda" as const, imagem: "a", ponto_focal: "b", fundo: "c", tratamento: "d" }, ilustracao: "a" };
    expect(promptDaLamina(card, marca, { total: 5, carrosselInfinito: false, levaLogo: false })).not.toContain("NAVEGAÇÃO DO CARROSSEL");
  });
});

describe("conferência da navegação: Jev como aviso, sem laço", () => {
  it("o texto 'Arraste para o lado' não conta como texto sobrando", () => {
    expect(semTextoDaNavegacao("Mouse na oferta\nR$ 9,90\nArraste para o lado →")).toBe("Mouse na oferta\nR$ 9,90");
    expect(semTextoDaNavegacao("Mouse na oferta\narraste →")).toBe("Mouse na oferta");
    expect(semTextoDaNavegacao("Arraste a cadeira para perto")).toBe("Arraste a cadeira para perto");
  });

  it("pergunta Noul por tipo e aviso só quando não veio", () => {
    expect(perguntaDaNavegacao("arrastar").instructions).toContain("indicador de arrastar");
    expect(perguntaDaNavegacao("icones").instructions).toContain("curtir (coração)");
    expect(avisoDaNavegacao("arrastar", 0.2)).toContain("não apareceu");
    expect(avisoDaNavegacao("icones", 0.1)).toContain("fileira de ícones");
    expect(avisoDaNavegacao("arrastar", 0.8)).toBeNull();
    expect(avisoDaNavegacao("icones", null)).toBeNull();
  });

  it("a conferência pergunta ao Jev na mesma chamada, grava só o aviso e a autocorreção não lê", () => {
    const v = estudio.slice(estudio.indexOf("async function verificar("), estudio.indexOf("function notaDoJev("));
    expect(v).toContain("questions.navegacao = perguntaDaNavegacao(navegacaoDaConferencia)");
    expect(v).toContain("semTextoDaNavegacao(v.texto_lido)");
    expect(v).toContain("aviso: avisoDaNavegacao(navegacaoDaConferencia, p)");
    expect((v.match(/await jevPerguntar\(/g) || []).length).toBe(1);
    expect(ler("supabase/functions/estudio-arte/autocorrecao.ts")).not.toContain("navegacao");
  });
});
