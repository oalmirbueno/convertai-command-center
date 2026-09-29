import { describe, expect, it } from "vitest";
import { amostrar, codificarUv, comporMockup, decodificarUv, type CamadasDoMockup } from "@/lib/mockups/composicao";
import { contraste, escolherVarianteDaLogo, luma, lumaDaLogo, lumaDoHex } from "@/lib/mockups/varianteDaLogo";
import { aplicar, detectarAreaLisa, homografia, inverter, ordenarCantos, projetarDesign } from "@/lib/mockups/homografia";
import { candidatosDaSugestao, normalizarMockup, normalizarTextura, ordenarNaSequencia } from "@/lib/mockups/catalogo";
import { caixaDaLogo, superficieDoSlot, tamanhoDoDesign } from "@/lib/mockups/designDoSlot";
import { montarAtlas } from "@/lib/mockups/webgl";
// @ts-expect-error módulo .mjs sem tipos (script da máquina da agência)
import { caminhosDoMockup, enviosDoMockup, linhaDaTextura, linhaDoCatalogo } from "../../tools/mockups/catalogo-linhas.mjs";
import { limparCandidatos, NIVEIS_DE_ADEQUACAO, notasDoLote, perguntasDeAdequacao, promptDaCena, ranquear } from "../../supabase/functions/mesa-mockups/sugestao";

// ------------------------------------------------------------------ imagens sintéticas

function rgba(w: number, h: number, f: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set(f(x, y), (y * w + x) * 4);
  return px;
}

/** Mockup 4x2: coluna 0 fora do slot; colunas 1-3 no slot 1, com uv cobrindo o design da esquerda para a direita. */
function camadas(): CamadasDoMockup {
  const w = 4;
  const h = 2;
  return {
    largura: w,
    altura: h,
    base: rgba(w, h, (x) => (x === 0 ? [90, 90, 90, 255] : [20, 30, 40, 255])),
    vazio: rgba(w, h, (x) => (x === 0 ? [90, 90, 90, 255] : [200, 190, 180, 255])),
    ganho: rgba(w, h, (x) => (x === 0 ? [0, 0, 0, 255] : [200, 100, 50, 255])),
    uv: rgba(w, h, (x, y) => {
      const [r, g, b] = codificarUv(x === 0 ? 0 : (x - 0.5) / 3, (y + 0.5) / 2);
      return [r, g, b, 255];
    }),
    mapa: rgba(w, h, (x) => (x === 0 ? [0, 0, 0, 255] : [1, 1, 1, 255])),
  };
}

describe("composição do mockup (base + ganho × design(uv), com o vazio para a transparência)", () => {
  it("o uv de 12 bits vai e volta", () => {
    for (const [u, v] of [[0, 0], [1, 1], [0.5, 0.25], [0.123, 0.987]]) {
      const [r, g, b] = codificarUv(u, v);
      const [u2, v2] = decodificarUv(r, g, b);
      expect(Math.abs(u2 - u)).toBeLessThan(1 / 4000);
      expect(Math.abs(v2 - v)).toBeLessThan(1 / 4000);
    }
  });

  it("design opaco: base + ganho × cor; fora do slot fica a base", () => {
    const c = camadas();
    const branco = { largura: 1, altura: 1, pixels: new Uint8ClampedArray([255, 255, 255, 255]) };
    const out = comporMockup(c, [branco]);
    expect(Array.from(out.slice(0, 4))).toEqual([90, 90, 90, 255]);
    // base 20,30,40 + ganho 200,100,50 × 1 = 220,130,90
    expect(Array.from(out.slice(4, 8))).toEqual([220, 130, 90, 255]);
    const preto = { largura: 1, altura: 1, pixels: new Uint8ClampedArray([0, 0, 0, 255]) };
    expect(Array.from(comporMockup(c, [preto]).slice(4, 8))).toEqual([20, 30, 40, 255]);
  });

  it("design transparente mostra o vazio (a superfície sem estampa)", () => {
    const c = camadas();
    const transparente = { largura: 1, altura: 1, pixels: new Uint8ClampedArray([255, 0, 0, 0]) };
    expect(Array.from(comporMockup(c, [transparente]).slice(4, 8))).toEqual([200, 190, 180, 255]);
  });

  it("meio alfa mistura vazio e estampa (conta linear, igual ao shader)", () => {
    const c = camadas();
    const meio = { largura: 1, altura: 1, pixels: new Uint8ClampedArray([255, 255, 255, 128]) };
    const a = 128 / 255;
    const esperado = [0, 1, 2].map((ch) => {
      const z = [200, 190, 180][ch];
      const b = [20, 30, 40][ch];
      const g = [200, 100, 50][ch];
      return Math.round(z + a * (b - z) + g * a);
    });
    const out = Array.from(comporMockup(c, [meio]).slice(4, 7));
    out.forEach((v, i) => expect(Math.abs(v - esperado[i])).toBeLessThanOrEqual(1));
  });

  it("o uv escolhe o ponto certo do design (listras vermelha, verde e azul)", () => {
    const c = camadas();
    const listras = { largura: 3, altura: 1, pixels: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]) };
    const out = comporMockup(c, [listras]);
    // coluna 1 = u 1/6 (vermelho puro), coluna 3 = u 5/6 (azul puro)
    expect(out[4]).toBe(220);
    expect(out[5]).toBe(30);
    expect(out[12 + 2]).toBe(90);
    expect(out[12]).toBe(20);
  });

  it("amostragem bilinear pré-multiplicada não escurece a borda da logo", () => {
    // pixel vermelho opaco ao lado de pixel preto transparente
    const d = { largura: 2, altura: 1, pixels: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]) };
    const [r, , , a] = amostrar(d, 0.5, 0.5);
    expect(a).toBeCloseTo(0.5, 5);
    expect(r / a).toBeCloseTo(1, 5);
  });

  it("slot sem design mostra o vazio", () => {
    const c = camadas();
    expect(Array.from(comporMockup(c, [null]).slice(4, 8))).toEqual([200, 190, 180, 255]);
  });

  it("atlas empilha os designs com folga e guarda a posição de cada slot", () => {
    const at = montarAtlas([{ width: 10, height: 4 }, null, { width: 6, height: 8 }]);
    expect(at.largura).toBe(10);
    expect(at.posicoes[0]).toEqual({ y: 0, w: 10, h: 4 });
    expect(at.posicoes[1]).toBeNull();
    expect(at.posicoes[2]).toEqual({ y: 6, w: 6, h: 8 });
    expect(at.altura).toBe(16);
  });
});

describe("variante da logo pela luminância da superfície (regra fixa)", () => {
  it("contraste WCAG: preto x branco = 21, igual x igual = 1", () => {
    expect(contraste(0, 1)).toBeCloseTo(21, 0);
    expect(contraste(0.4, 0.4)).toBeCloseTo(1, 5);
    expect(lumaDoHex("#ffffff")).toBeCloseTo(1, 5);
    expect(lumaDoHex("#000")).toBe(0);
    expect(lumaDoHex("azul")).toBeNull();
  });

  it("superfície escura com logo escura: versão branca", () => {
    const r = escolherVarianteDaLogo(0.1, [{ id: "principal", luminancia: 0.12 }]);
    expect(r.variante).toEqual({ tipo: "branca" });
  });

  it("superfície clara com logo escura: a logo do kit como veio", () => {
    const r = escolherVarianteDaLogo(0.92, [{ id: "principal", luminancia: 0.1 }]);
    expect(r.variante).toEqual({ tipo: "original", id: "principal" });
  });

  it("fica a logo do kit com mais contraste (principal escura, alternativa clara, fundo escuro)", () => {
    const r = escolherVarianteDaLogo(0.08, [
      { id: "principal", luminancia: 0.1 },
      { id: "alternativa", luminancia: 0.95 },
    ]);
    expect(r.variante).toEqual({ tipo: "original", id: "alternativa" });
  });

  it("sem medida, o tom do kit decide; superfície clara sem logo boa: preta", () => {
    expect(escolherVarianteDaLogo(0.05, [{ id: "a", tom: "clara" }]).variante).toEqual({ tipo: "original", id: "a" });
    expect(escolherVarianteDaLogo(0.9, [{ id: "a", tom: "clara" }]).variante).toEqual({ tipo: "preta" });
  });

  it("superfície desconhecida: a primeira logo, sem inventar", () => {
    expect(escolherVarianteDaLogo(null, [{ id: "principal" }]).variante).toEqual({ tipo: "original", id: "principal" });
  });

  it("luma da logo pesa o alfa (pixel transparente não conta)", () => {
    const px = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 0]);
    expect(lumaDaLogo(px)).toBeCloseTo(1, 5);
    expect(lumaDaLogo(new Uint8ClampedArray([0, 0, 0, 0]))).toBeNull();
    expect(luma(255, 255, 255)).toBeCloseTo(1, 5);
  });

  it("slot de arte mede contra a cor de fundo; slot de logo contra a superfície do mockup", () => {
    expect(superficieDoSlot({ papel: "arte", luminanciaSuperficie: 0.9 }, { fundo: "#000000", segunda: "#ffffff" })).toBe(0);
    expect(superficieDoSlot({ papel: "verso", luminanciaSuperficie: 0.1 }, { fundo: "#000000", segunda: "#ffffff" })).toBeCloseTo(1, 5);
    expect(superficieDoSlot({ papel: "logo", luminanciaSuperficie: 0.3 }, { fundo: "#000000", segunda: "#ffffff" })).toBe(0.3);
  });

  it("a logo cabe na área segura, centrada, na escala pedida", () => {
    const cx = caixaDaLogo([0.25, 0.25, 0.75, 0.75], 400, 200, 100, 100, 1);
    expect(cx.h).toBeCloseTo(100, 5);
    expect(cx.w).toBeCloseTo(100, 5);
    expect(cx.x).toBeCloseTo(150, 5);
    expect(cx.y).toBeCloseTo(50, 5);
  });

  it("o design não passa do dobro do espaço na tela (sem serrilhado) nem do smart object", () => {
    expect(tamanhoDoDesign({ soPx: [2000, 1000], pxNaTela: 600 }, 0.5)).toEqual([600, 300]);
    expect(tamanhoDoDesign({ soPx: [800, 400], pxNaTela: 3000 }, 1)).toEqual([800, 400]);
    expect(tamanhoDoDesign({ soPx: [800, 400], pxNaTela: null }, 1)).toEqual([800, 400]);
  });
});

describe("homografia (logo aplicada pelo código na cena gerada)", () => {
  const quad = [
    { x: 10, y: 12 },
    { x: 50, y: 8 },
    { x: 54, y: 40 },
    { x: 6, y: 44 },
  ];
  const ret = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];

  it("leva os 4 cantos nos 4 cantos e a inversa volta", () => {
    const H = homografia(ret, quad)!;
    ret.forEach((p, i) => {
      const q = aplicar(H, p);
      expect(q.x).toBeCloseTo(quad[i].x, 6);
      expect(q.y).toBeCloseTo(quad[i].y, 6);
    });
    const Hi = inverter(H)!;
    const volta = aplicar(Hi, aplicar(H, { x: 0.3, y: 0.7 }));
    expect(volta.x).toBeCloseTo(0.3, 6);
    expect(volta.y).toBeCloseTo(0.7, 6);
  });

  it("pontos degenerados não viram matriz", () => {
    expect(homografia(ret, [quad[0], quad[0], quad[0], quad[0]])).toBeNull();
  });

  it("ordena cantos soltos em sentido horário a partir do superior esquerdo", () => {
    const bagunca = [quad[2], quad[0], quad[3], quad[1]];
    expect(ordenarCantos(bagunca)).toEqual(quad);
  });

  it("projeta o design dentro do quadrilátero e não mexe fora", () => {
    const W = 64;
    const H = 52;
    const cena = { largura: W, altura: H, pixels: rgba(W, H, () => [40, 40, 40, 255]) };
    const vermelho = { largura: 4, altura: 4, pixels: rgba(4, 4, () => [255, 0, 0, 255]) };
    const out = projetarDesign(cena, vermelho, quad, { luz: 0 });
    const em = (x: number, y: number) => Array.from(out.slice((y * W + x) * 4, (y * W + x) * 4 + 4));
    expect(em(30, 26)).toEqual([255, 0, 0, 255]);
    expect(em(2, 2)).toEqual([40, 40, 40, 255]);
    expect(em(60, 50)).toEqual([40, 40, 40, 255]);
  });

  it("acha a placa branca lisa numa cena escura com ruído", () => {
    const W = 200;
    const H = 150;
    let s = 7;
    const ruido = () => {
      s = (s * 16807) % 2147483647;
      return (s % 60) - 30;
    };
    const img = { largura: W, altura: H, pixels: rgba(W, H, (x, y) => (x >= 50 && x < 150 && y >= 30 && y < 80 ? [245, 245, 245, 255] : [70 + ruido(), 70 + ruido(), 70 + ruido(), 255])) };
    const cantos = detectarAreaLisa(img, { lado: 200 })!;
    expect(cantos).not.toBeNull();
    const esperado = [
      { x: 50, y: 30 },
      { x: 150, y: 30 },
      { x: 150, y: 80 },
      { x: 50, y: 80 },
    ];
    cantos.forEach((p, i) => {
      expect(Math.abs(p.x - esperado[i].x)).toBeLessThan(4);
      expect(Math.abs(p.y - esperado[i].y)).toBeLessThan(4);
    });
  });

  it("sem área lisa, devolve null (a equipe marca à mão)", () => {
    let s = 3;
    const img = {
      largura: 80,
      altura: 60,
      pixels: rgba(80, 60, () => {
        s = (s * 16807) % 2147483647;
        const v = s % 256;
        return [v, v, v, 255];
      }),
    };
    expect(detectarAreaLisa(img)).toBeNull();
  });
});

describe("catálogo de mockups", () => {
  const meta = {
    id: "cartao-colorido",
    nome: "Cartão de visita · colorido",
    categoria: "cartao",
    tags: ["cartao"],
    largura: 2300,
    altura: 1650,
    largura_trabalho: 1280,
    altura_trabalho: 918,
    luminancia_media: 0.93,
    versao_pipeline: 2,
    origem: "GraphicBurger",
    slots: [
      { indice: 1, papel: "arte", nome: "Your design here", so_px: [1024, 663], area_segura: [0, 0, 1, 1], luminancia_superficie: 0.95, px_na_tela: 700, deformacao: "warpNone" },
      { indice: 2, papel: "verso", nome: "Your design here", so_px: [1024, 663], area_segura: [0, 0, 1, 1], luminancia_superficie: 0.9, px_na_tela: 650 },
    ],
    qualidade: { aprovado: true, diferenca: 1.25, diferenca_imagem: 0.33, diferenca_slot: 1.25, limite: 3, avisos: [] },
    bytes: { alta: { "base.jpg": 100, "uv.png": 50 }, trabalho: { "base.jpg": 10 }, thumb: 5 },
  };

  it("meta aprovado vira linha do banco com os caminhos do bucket", () => {
    const r = linhaDoCatalogo(meta);
    expect(r.erro).toBeUndefined();
    expect(r.linha.caminhos.alta.uv).toBe("catalogo/cartao-colorido/alta/uv.png");
    expect(r.linha.caminhos.trabalho.mapa).toBe("catalogo/cartao-colorido/trabalho/mapa.png");
    expect(r.linha.caminhos.thumb).toBe("catalogo/cartao-colorido/thumb.jpg");
    expect(r.linha.bytes).toBe(165);
    expect(r.linha.slots[0].px_na_tela).toBe(700);
  });

  it("reprovado no controle de qualidade, categoria desconhecida ou slot torto ficam fora", () => {
    expect(linhaDoCatalogo({ ...meta, qualidade: { aprovado: false, diferenca: 9 } }).erro).toMatch(/controle de qualidade/);
    expect(linhaDoCatalogo({ ...meta, categoria: "nave" }).erro).toMatch(/categoria/);
    expect(linhaDoCatalogo({ ...meta, slots: [{ ...meta.slots[0], area_segura: [0.5, 0, 0.2, 1] }] }).erro).toMatch(/slot/);
    expect(linhaDoCatalogo({ ...meta, id: "Com Espaço" }).erro).toMatch(/id/);
  });

  it("a linha gravada volta inteira na tela (mesmo contrato dos dois lados)", () => {
    const { linha } = linhaDoCatalogo(meta);
    const m = normalizarMockup(linha)!;
    expect(m).not.toBeNull();
    expect(m.slots.map((s) => s.papel)).toEqual(["arte", "verso"]);
    expect(m.slots[0].pxNaTela).toBe(700);
    expect(m.caminhos.alta.base).toBe(caminhosDoMockup("cartao-colorido").alta.base);
  });

  it("linha com defeito não derruba a lista", () => {
    const { linha } = linhaDoCatalogo(meta);
    expect(normalizarMockup({ ...linha, caminhos: { alta: linha.caminhos.alta } })).toBeNull();
    expect(normalizarMockup({ ...linha, ativo: false })).toBeNull();
    expect(normalizarMockup(null)).toBeNull();
  });

  it("11 envios por mockup (5 camadas × 2 tamanhos + miniatura)", () => {
    const e = enviosDoMockup("cartao-colorido", "C:/x/saida/cartao-colorido");
    expect(e).toHaveLength(11);
    expect(e[0]).toEqual({ local: "C:/x/saida/cartao-colorido/alta/base.jpg", destino: "catalogo/cartao-colorido/alta/base.jpg" });
  });

  it("textura vira linha com PNG e miniatura", () => {
    const { linha } = linhaDaTextura({ id: "grunge-rons-grunge-004", nome: "Grunge 1", categoria: "grunge", largura: 2048, altura: 1500, bytes: 10 });
    expect(linha.caminho).toBe("texturas/grunge-rons-grunge-004.png");
    expect(normalizarTextura(linha)!.caminhoMini).toBe("texturas/grunge-rons-grunge-004_mini.png");
    expect(linhaDaTextura({ id: "x-1", categoria: "nuvem", largura: 1, altura: 1 }).erro).toMatch(/categoria/);
  });

  it("sequência: papelaria, digital, produto, exterior; candidatos só das categorias escolhidas", () => {
    const base = normalizarMockup(linhaDoCatalogo(meta).linha)!;
    const itens = [
      { ...base, id: "van", categoria: "veiculo" as const, nome: "Van" },
      { ...base, id: "caneca", categoria: "caneca" as const, nome: "Caneca" },
      { ...base, id: "cartao", categoria: "cartao" as const, nome: "Cartão" },
      { ...base, id: "tela", categoria: "dispositivo" as const, nome: "Tela" },
    ];
    expect(ordenarNaSequencia(itens).map((i) => i.id)).toEqual(["cartao", "tela", "caneca", "van"]);
    expect(candidatosDaSugestao(itens, ["caneca", "veiculo"]).map((i) => i.id)).toEqual(["caneca", "van"]);
    expect(candidatosDaSugestao(itens, []).length).toBe(4);
  });
});

describe("sugestão do Jev (Score) e cenas", () => {
  const cliente = { nome: "Padaria Sol", negocio: "padaria de bairro", publico: "famílias", oferta: null, estilo: null };
  const lote = [
    { id: "caneca-fosca-1", nome: "Caneca", categoria: "caneca", tags: ["brinde"] },
    { id: "outdoor-rua", nome: "Outdoor", categoria: "outdoor", tags: [] },
  ];

  it("uma pergunta Score por mockup, lista ordenada de níveis e referência ao item", () => {
    const { state, questions } = perguntasDeAdequacao(cliente, lote);
    expect(Object.keys(questions)).toEqual(["m0", "m1"]);
    expect(questions.m1.type).toBe("score");
    expect(Array.isArray(questions.m1.criteria)).toBe(true);
    expect(questions.m1.criteria).toBe(NIVEIS_DE_ADEQUACAO);
    expect(String(questions.m1.instructions)).toContain("mockups[1]");
    expect((state as { mockups: unknown[] }).mockups).toHaveLength(2);
  });

  it("lê as notas e ranqueia (empate mantém a sequência)", () => {
    const notas = notasDoLote(lote, { m0: { score: 2.4, confidence: 0.8 }, m1: { score: 2.4 } });
    expect(notas).toHaveLength(2);
    expect(ranquear(lote, notas).map((n) => n.mockup_id)).toEqual(["caneca-fosca-1", "outdoor-rua"]);
    const r = ranquear(lote, notasDoLote(lote, { m0: { score: 0.5 }, m1: { score: 3 } }));
    expect(r[0].mockup_id).toBe("outdoor-rua");
    expect(notasDoLote(lote, { m0: {} })).toHaveLength(0);
  });

  it("candidatos limpos: sem repetição, id válido e no máximo 40", () => {
    const muitos = Array.from({ length: 60 }, (_, i) => ({ id: `m-${i}`, nome: "x", categoria: "cartao" }));
    expect(limparCandidatos(muitos)).toHaveLength(40);
    expect(limparCandidatos([{ id: "a-1" }, { id: "a-1" }, { id: "Ruim!" }, null])).toHaveLength(1);
  });

  it("a cena pede área lisa e proíbe texto e logo (a marca entra pelo código)", () => {
    const f = promptDaCena("fachada", cliente, ["#ff0000"], "");
    expect(f).toContain("totalmente branca e lisa");
    expect(f).toContain("Nenhum texto");
    expect(f).toContain("padaria de bairro");
    const s = promptDaCena("social", cliente, [], "com café");
    expect(s).toContain("tela totalmente branca");
    expect(s).toContain("com café");
  });
});
