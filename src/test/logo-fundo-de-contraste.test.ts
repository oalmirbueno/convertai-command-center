import { describe, expect, it } from "vitest";
import { analisarPixels, fundoDeConferencia, tipoDoFundo, tirarFundoLiso, tomGravado } from "@/components/mesa/logoAnalise";

/**
 * Logo legível (pedido do dono, 25/09): a miniatura vai sobre um fundo que
 * contrasta com a logo, e ao gravar o fundo liso vira pergunta e o branco
 * sobre branco pede a versão certa.
 */

type Cor = [number, number, number, number];
const BRANCO: Cor = [255, 255, 255, 255];
const PRETO: Cor = [0, 0, 0, 255];
const VERDE: Cor = [40, 170, 90, 255];
const CREME: Cor = [246, 238, 220, 255];
const VAZIO: Cor = [0, 0, 0, 0];

/** Imagem W x H com o fundo e um retângulo de desenho no meio (letras). */
function imagem(W: number, H: number, fundo: Cor, desenho: Cor | null, partes: { x0: number; y0: number; x1: number; y1: number; cor: Cor }[] = []) {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let c = fundo;
      if (desenho && x >= W * 0.25 && x < W * 0.75 && y >= H * 0.35 && y < H * 0.65) c = desenho;
      for (const p of partes) if (x >= p.x0 && x < p.x1 && y >= p.y0 && y < p.y1) c = p.cor;
      px.set(c, (y * W + x) * 4);
    }
  }
  return px;
}

describe("fundo de conferência da logo", () => {
  it("logo branca em PNG transparente: clara, vai sobre cinza-escuro, sem pergunta", () => {
    const a = analisarPixels(imagem(40, 40, VAZIO, BRANCO), 40, 40)!;
    expect(a).toEqual({ tom: "clara", transparente: true, fundo: null, ilegivel: false });
    expect(fundoDeConferencia(a.tom)).toBe("escuro");
  });

  it("logo escura em PNG transparente: escura, vai sobre claro", () => {
    const a = analisarPixels(imagem(40, 40, VAZIO, PRETO), 40, 40)!;
    expect(a.tom).toBe("escura");
    expect(fundoDeConferencia(a.tom)).toBe("claro");
  });

  it("parte branca grande ao lado de uma cor (Aceler branco + iq verde) conta como clara, como no servidor", () => {
    const px = imagem(60, 30, VAZIO, null, [
      { x0: 5, y0: 10, x1: 35, y1: 20, cor: BRANCO },
      { x0: 35, y0: 10, x1: 55, y1: 20, cor: VERDE },
    ]);
    expect(analisarPixels(px, 60, 30)!.tom).toBe("clara");
  });

  it("sem saber o tom: xadrez neutro; valor gravado só aceita clara ou escura", () => {
    expect(fundoDeConferencia(null)).toBe("xadrez");
    expect(tomGravado("clara")).toBe("clara");
    expect(tomGravado("branca")).toBeNull();
    expect(tomGravado(null)).toBeNull();
  });
});

describe("conferência ao gravar", () => {
  it("fundo branco liso com letra escura: pergunta se tira o fundo", () => {
    const a = analisarPixels(imagem(40, 40, BRANCO, PRETO), 40, 40)!;
    expect(a).toMatchObject({ tom: "escura", transparente: false, fundo: { tipo: "branco", hex: "#FFFFFF" }, ilegivel: false });
  });

  it("fundo preto liso com letra branca: clara, fundo preto", () => {
    const a = analisarPixels(imagem(40, 40, PRETO, BRANCO), 40, 40)!;
    expect(a).toMatchObject({ tom: "clara", fundo: { tipo: "preto" }, ilegivel: false });
  });

  it("creme é reconhecido como fundo", () => {
    expect(analisarPixels(imagem(40, 40, CREME, VERDE), 40, 40)!.fundo!.tipo).toBe("creme");
    expect(tipoDoFundo(128, 30, 200)).toBe("liso");
  });

  it("letra branca sobre fundo branco: ilegível", () => {
    const a = analisarPixels(imagem(40, 40, BRANCO, [250, 250, 250, 255]), 40, 40)!;
    expect(a.ilegivel).toBe(true);
    expect(a.tom).toBe("clara");
    // Cinza bem claro sobre branco também não se lê.
    expect(analisarPixels(imagem(40, 40, BRANCO, [200, 200, 200, 255]), 40, 40)!.ilegivel).toBe(true);
  });

  it("foto (fundo que não é liso) não vira pergunta de fundo", () => {
    const px = imagem(40, 40, BRANCO, PRETO);
    for (let x = 0; x < 40; x++) px.set(x % 2 ? PRETO : VERDE, x * 4);
    for (let y = 0; y < 40; y++) px.set(y % 2 ? VERDE : PRETO, (y * 40) * 4);
    expect(analisarPixels(px, 40, 40)!.fundo).toBeNull();
  });

  it("tirar o fundo liso: a borda fica transparente e o desenho fica inteiro", () => {
    const W = 40, H = 40;
    const px = imagem(W, H, BRANCO, PRETO);
    const limpos = tirarFundoLiso(px, W, H, "#FFFFFF");
    expect(limpos).toBeGreaterThan(W * H * 0.5);
    expect(px[3]).toBe(0);
    const meio = (20 * W + 20) * 4;
    expect([px[meio], px[meio + 1], px[meio + 2], px[meio + 3]]).toEqual([0, 0, 0, 255]);
  });

  it("branco de dentro da letra, cercado pelo desenho, fica (preenchimento só a partir da borda)", () => {
    const W = 40, H = 40;
    // Anel preto com miolo branco no meio.
    const px = imagem(W, H, BRANCO, PRETO, [{ x0: 17, y0: 17, x1: 23, y1: 23, cor: BRANCO }]);
    tirarFundoLiso(px, W, H, "#FFFFFF");
    expect(px[(20 * W + 20) * 4 + 3]).toBe(255);
  });
});
