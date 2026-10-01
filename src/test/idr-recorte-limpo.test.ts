import { describe, expect, it } from "vitest";
import {
  alfaPorProjecao,
  fundoPelaBorda,
  limparBordaDoRecorte,
  recortarFundoSolido,
  toleranciaDoFundo,
  type PixelsRGBA,
  type Rgb,
} from "../../supabase/functions/_shared/recorte-limpo";
import { comporSobre, diagnosticarRecorte, LIMITE_DO_HALO, medirHalo, recorteLimpo, tirarFranja } from "@/lib/recorte/franja";
import { analisarLogo, opacidadeDoConteudo, recolorir, semFundo } from "../../supabase/functions/mesa-identidade/modulos/leitura-da-logo";

/** O "sem fundo" de antes (até 30/09): alfa por rampa de distância e a cor do pixel como veio (a mistura com o branco fica). */
function semFundoAntigo(img: PixelsRGBA, cor: Rgb): Uint8ClampedArray {
  const s = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < s.length; i += 4) {
    const d = img.data;
    s[i] = d[i];
    s[i + 1] = d[i + 1];
    s[i + 2] = d[i + 2];
    s[i + 3] = Math.round(opacidadeDoConteudo([d[i], d[i + 1], d[i + 2], d[i + 3]], "claro", cor) * 255);
  }
  return s;
}

/**
 * Frente IDR (30/09): "retira o fundo, mas ainda fica recorte branco".
 * Imagens feitas aqui com antisserrilhado de verdade (supersample 4x4), então
 * o alfa certo de cada pixel é conhecido e o erro é medido, não suposto.
 */

type Forma = (x: number, y: number) => Rgb | null;

/** Desenha formas sobre um fundo com antisserrilhado; devolve a imagem opaca e o alfa verdadeiro do desenho. */
function desenhar(W: number, H: number, fundo: Rgb | null, forma: Forma): { img: PixelsRGBA; alfa: Float32Array; cor: Float32Array } {
  const data = new Uint8ClampedArray(W * H * 4);
  const alfa = new Float32Array(W * H);
  const cor = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let n = 0, r = 0, g = 0, b = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const c = forma(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4);
          if (!c) continue;
          n++;
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const p = y * W + x;
      const a = n / 16;
      alfa[p] = a;
      if (n) {
        cor[p * 3] = r / n;
        cor[p * 3 + 1] = g / n;
        cor[p * 3 + 2] = b / n;
      }
      if (fundo) {
        data[p * 4] = Math.round((n ? r / n : 0) * a + fundo[0] * (1 - a));
        data[p * 4 + 1] = Math.round((n ? g / n : 0) * a + fundo[1] * (1 - a));
        data[p * 4 + 2] = Math.round((n ? b / n : 0) * a + fundo[2] * (1 - a));
        data[p * 4 + 3] = 255;
      } else {
        data[p * 4] = Math.round(n ? r / n : 0);
        data[p * 4 + 1] = Math.round(n ? g / n : 0);
        data[p * 4 + 2] = Math.round(n ? b / n : 0);
        data[p * 4 + 3] = Math.round(a * 255);
      }
    }
  }
  return { img: { data, largura: W, altura: H }, alfa, cor };
}

const VERMELHO: Rgb = [200, 30, 40];
const AZUL: Rgb = [20, 60, 170];
const BRANCO: Rgb = [255, 255, 255];

/** Uma logo: disco vermelho, anel preto (letra "o") e um selo azul cheio com um retângulo branco dentro. */
const logo: Forma = (x, y) => {
  const d1 = Math.hypot(x - 40, y - 40);
  if (d1 < 24) return VERMELHO;
  const d2 = Math.hypot(x - 110, y - 40);
  if (d2 < 22 && d2 > 13) return [15, 15, 15];
  if (x > 150 && x < 230 && y > 12 && y < 70) {
    if (x > 170 && x < 210 && y > 32 && y < 50) return BRANCO;
    return AZUL;
  }
  return null;
};

/** A mesma logo com o branco do selo como espaço negativo (o que "tirar", o padrão, deve devolver). */
const logoComVaos: Forma = (x, y) => (x > 170 && x < 210 && y > 32 && y < 50 ? null : logo(x, y));

function erroDoAlfa(saida: ArrayLike<number>, verdade: Float32Array): number {
  let s = 0;
  for (let p = 0; p < verdade.length; p++) s += Math.abs(saida[p * 4 + 3] / 255 - verdade[p]);
  return s / verdade.length;
}

describe("recorte limpo: fundo sólido", () => {
  const { img } = desenhar(240, 84, BRANCO, logo);

  it("acha o fundo branco pela borda, com tolerância pelo ruído", () => {
    const f = fundoPelaBorda(img);
    expect(f.tipo).toBe("solido");
    expect(f.claro).toBe(true);
    expect(f.cor).toEqual([255, 255, 255]);
    expect(toleranciaDoFundo(f.ruido)).toBeGreaterThanOrEqual(22);
  });

  it("alfa perto do verdadeiro e sem halo branco no escuro (o jeito antigo deixava)", () => {
    const r = recortarFundoSolido(img, { cor: BRANCO, tolerancia: 26 });
    const antigo = semFundoAntigo(img, BRANCO);
    // A versão "sem fundo" da Mesa Identidade passa a ser o recorte limpo.
    expect(Array.from(semFundo(img, analisarLogo(img)))).toEqual(Array.from(recortarFundoSolido(img, { cor: BRANCO, tolerancia: toleranciaDoFundo(fundoPelaBorda(img).ruido) }).data));
    const haloNovo = medirHalo({ data: r.data, largura: 240, altura: 84 });
    const haloAntigo = medirHalo({ data: antigo, largura: 240, altura: 84 });
    expect(haloAntigo.claro).toBeGreaterThan(LIMITE_DO_HALO);
    expect(haloNovo.claro).toBeLessThan(4);
    const verdade = desenhar(240, 84, BRANCO, logoComVaos).alfa;
    expect(erroDoAlfa(r.data, verdade)).toBeLessThan(0.01);
    expect(erroDoAlfa(r.data, verdade)).toBeLessThan(erroDoAlfa(antigo, verdade));
  });

  it("o vão fechado da cor do fundo sai por padrão (miolo do anel e o branco do selo); com manter, os dois ficam", () => {
    const r = recortarFundoSolido(img, { cor: BRANCO, tolerancia: 26 });
    const a = (x: number, y: number) => r.data[(y * 240 + x) * 4 + 3];
    expect(a(110, 40)).toBe(0); // miolo do "o"
    expect(a(190, 41)).toBe(0); // branco dentro do selo: espaço negativo por padrão
    expect(a(40, 40)).toBe(255);
    expect(a(5, 5)).toBe(0);
    expect(r.info.furos_tirados).toBe(2);
    const mantendo = recortarFundoSolido(img, { cor: BRANCO, tolerancia: 26, furos: "manter" });
    expect(mantendo.data[(41 * 240 + 190) * 4 + 3]).toBe(255);
    expect(mantendo.data[(40 * 240 + 110) * 4 + 3]).toBe(255);
    expect(mantendo.info.furos_mantidos).toBe(2);
  });

  it("a cor da borda volta à da logo (sem mistura com o branco)", () => {
    const r = recortarFundoSolido(img, { cor: BRANCO, tolerancia: 26 });
    // Pixels de borda do disco (alfa parcial): a cor é o vermelho, não rosa.
    let pior = 0;
    for (let y = 10; y < 70; y++) {
      for (let x = 10; x < 70; x++) {
        const i = (y * 240 + x) * 4;
        if (r.data[i + 3] > 20 && r.data[i + 3] < 235) pior = Math.max(pior, Math.abs(r.data[i + 1] - VERMELHO[1]));
      }
    }
    expect(pior).toBeLessThan(25);
  });

  it("o transparente em volta recebe a cor da borda (reduzir não puxa branco)", () => {
    const r = recortarFundoSolido(img, { cor: BRANCO, tolerancia: 26 });
    // Um pixel logo fora do disco (x = 40, y = 40 - 25): transparente, mas com a cor vermelha.
    const i = (15 * 240 + 40) * 4;
    expect(r.data[i + 3]).toBe(0);
    expect(r.data[i]).toBeGreaterThan(150);
    expect(r.data[i + 1]).toBeLessThan(90);
  });

  it("aguenta JPEG: fundo com ruído e ainda sem halo", () => {
    const ruidosa = new Uint8ClampedArray(img.data);
    let semente = 7;
    for (let i = 0; i < ruidosa.length; i += 4) {
      semente = (semente * 1103515245 + 12345) & 0x7fffffff;
      const n = (semente % 9) - 4;
      for (let k = 0; k < 3; k++) ruidosa[i + k] = ruidosa[i + k] + n;
    }
    const d = { data: ruidosa, largura: 240, altura: 84 };
    const r = recorteLimpo(d);
    expect(r && r.diagnostico.precisa).toBe("fundo_solido");
    const h = medirHalo({ data: r!.data, largura: 240, altura: 84 });
    expect(h.claro).toBeLessThan(6);
    expect(erroDoAlfa(r!.data, desenhar(240, 84, BRANCO, logoComVaos).alfa)).toBeLessThan(0.02);
  });
});

describe("recorte limpo: franja clara num PNG já transparente", () => {
  // Disco vermelho com a franja de uma ferramenta ruim: 2 px de MISTURA do vermelho para o branco, opaca
  // (o branco quase puro foi apagado, a mistura ficou), e uma letra branca larga e solta, que é desenho.
  const comFranja: Forma = (x, y) => {
    const d = Math.hypot(x - 40, y - 40);
    if (d < 24) return VERMELHO;
    if (d < 26) {
      const a = 0.25 * ((26 - d) / 2);
      return [BRANCO[0] * (1 - a) + VERMELHO[0] * a, BRANCO[1] * (1 - a) + VERMELHO[1] * a, BRANCO[2] * (1 - a) + VERMELHO[2] * a];
    }
    if (x > 90 && x < 130 && y > 20 && y < 60) return BRANCO;
    return null;
  };
  const { img } = desenhar(150, 80, null, comFranja);

  it("diagnóstico acha a franja, tira o anel de mistura e deixa a letra branca", () => {
    const dg = diagnosticarRecorte(img);
    expect(dg.fundo.tipo).toBe("transparente");
    expect(dg.precisa).toBe("franja");
    const r = tirarFranja(img);
    const depois = medirHalo({ data: r.data, largura: 150, altura: 80 });
    expect(depois.claro).toBeLessThan(dg.halo!.claro / 4);
    expect(r.data[(40 * 150 + 110) * 4 + 3]).toBe(255); // letra branca inteira
    expect(r.data[(40 * 150 + 65) * 4 + 3]).toBe(0); // anel (x = 40 + 25)
    expect(r.data[(40 * 150 + 40) * 4 + 3]).toBe(255); // disco
    expect(r.info.furos_tirados).toBeGreaterThanOrEqual(1);
  });

  it("PNG limpo não pede nada", () => {
    const { img: limpa } = desenhar(150, 80, null, (x, y) => (Math.hypot(x - 40, y - 40) < 24 ? VERMELHO : null));
    expect(diagnosticarRecorte(limpa).precisa).toBe("nada");
    expect(recorteLimpo(limpa)).toBeNull();
  });
});

/**
 * Revisão de 01/10 (VIFUT e CME, logos reais da casa): detalhe claro que é
 * desenho, colado ao transparente e encostado em outra cor, NÃO é franja.
 * O critério do anel: até 2 px, contorna 60% ou mais da borda externa das
 * formas vizinhas e é mistura (não branco chapado e opaco).
 */
describe("recorte limpo: branco que é desenho fica (VIFUT e CME)", () => {
  const MARINHO: Rgb = [20, 40, 100];
  const CINZA_CLARO: Rgb = [168, 176, 192]; // #A8B0C0, o cinza da bússola da VIFUT
  const ROSA: Rgb = [214, 70, 130];

  /** Opacos (alfa 255) da imagem de entrada que perderam alfa. */
  const opacosPerdidos = (antes: PixelsRGBA, depois: Uint8ClampedArray) => {
    let n = 0;
    for (let i = 3; i < depois.length; i += 4) if (antes.data[i] === 255 && depois[i] < 255) n++;
    return n;
  };

  // VIFUT: bússola marinho com pontas finas CLARAS (branco e cinza) saindo do disco, gomos brancos finos no
  // disco encostados no transparente, e um miolo branco de 2 px (o detalhe que a versão de 30/09 apagava).
  const bussola: Forma = (x, y) => {
    const dx = x - 60, dy = y - 60, d = Math.hypot(dx, dy);
    // Pontas: cunhas que afinam de 3 px para 0 entre o raio 20 e 40 (leste: branca; norte: cinza claro).
    if (dx > 18 && dx < 40 && Math.abs(dy) < 1.5 * (1 - (dx - 18) / 22)) return BRANCO;
    if (dy < -18 && dy > -40 && Math.abs(dx) < 1.5 * (1 - (-dy - 18) / 22)) return CINZA_CLARO;
    if (d < 20) {
      // Gomo branco de 2 px na borda do disco, ao sul (encosta no transparente e no marinho).
      if (d > 18 && dy > 8) return BRANCO;
      return MARINHO;
    }
    return null;
  };
  const vifut = desenhar(120, 120, null, bussola).img;

  it("VIFUT: pontas claras e gomos brancos não são franja e nada perde alfa", () => {
    const dg = diagnosticarRecorte(vifut);
    expect(dg.fundo.tipo).toBe("transparente");
    expect(dg.precisa).toBe("nada");
    const r = tirarFranja(vifut);
    expect(opacosPerdidos(vifut, r.data)).toBe(0);
    expect(r.data[(60 * 120 + 85) * 4 + 3]).toBe(255); // ponta branca (leste)
    expect(r.data[(35 * 120 + 60) * 4 + 3]).toBe(255); // ponta cinza (norte)
    expect(r.data[(79 * 120 + 60) * 4 + 3]).toBeGreaterThan(0); // gomo branco (sul)
  });

  // CME: círculo rosa com um anel BRANCO chapado e opaco de 2 px em volta (desenho).
  const anelBranco: Forma = (x, y) => {
    const d = Math.hypot(x - 50, y - 50);
    if (d < 30) return ROSA;
    if (d < 32) return BRANCO;
    return null;
  };
  const cme = desenhar(100, 100, null, anelBranco).img;

  it("CME: o anel branco chapado em volta do círculo fica com alfa 255", () => {
    expect(diagnosticarRecorte(cme).precisa).toBe("nada");
    const r = tirarFranja(cme);
    expect(r.info.furos_tirados).toBe(0);
    expect(opacosPerdidos(cme, r.data)).toBe(0);
    expect(r.data[(50 * 100 + 81) * 4 + 3]).toBe(255); // anel (x = 50 + 31)
  });

  it("anel de 3 px ou mais é desenho, mesmo de mistura", () => {
    const largo = desenhar(100, 100, null, (x, y) => {
      const d = Math.hypot(x - 50, y - 50);
      if (d < 28) return VERMELHO;
      if (d < 33) return [235, 200, 200];
      return null;
    }).img;
    expect(tirarFranja(largo).info.furos_tirados).toBe(0);
  });

  it("os caminhos automáticos não tiram franja: semFundo e recolorir deixam o PNG transparente como veio", () => {
    const a = analisarLogo(cme);
    expect(a.fundo).toBe("transparente");
    expect(Array.from(semFundo(cme, a))).toEqual(Array.from(cme.data));
    const mono = recolorir(vifut, analisarLogo(vifut), "#111111");
    for (let i = 3; i < mono.length; i += 4) if (vifut.data[i] >= 16) expect(mono[i]).toBe(vifut.data[i]);
  });
});

describe("recorte limpo: borda do recorte da IA", () => {
  it("máscara larga demais sobre fundo claro: o anel do fundo sai e o assunto fica", () => {
    const fundoClaro: Rgb = [232, 232, 228];
    const { img: foto, alfa } = desenhar(120, 120, fundoClaro, (x, y) => (Math.hypot(x - 60, y - 60) < 30 ? AZUL : null));
    // "IA": alfa cheio até 3 px além do assunto (o erro típico que vira contorno claro).
    const ia = new Uint8ClampedArray(foto.data);
    for (let p = 0; p < 120 * 120; p++) {
      const x = p % 120, y = Math.floor(p / 120);
      ia[p * 4 + 3] = Math.hypot(x + 0.5 - 60, y + 0.5 - 60) < 33 ? 255 : 0;
    }
    const recorte = { data: ia, largura: 120, altura: 120 };
    const antes = medirHalo(recorte);
    const r = limparBordaDoRecorte(recorte, { original: foto.data, erodir: "auto" });
    const depois = medirHalo({ data: r.data, largura: 120, altura: 120 });
    expect(antes.claro).toBeGreaterThan(LIMITE_DO_HALO);
    expect(depois.claro).toBeLessThan(antes.claro / 3);
    expect(r.data[(60 * 120 + 60) * 4 + 3]).toBe(255);
    expect(erroDoAlfa(r.data, alfa)).toBeLessThan(erroDoAlfa(ia, alfa) / 2);
  });

  it("sem fonte do fundo não inventa: devolve igual", () => {
    const { img } = desenhar(40, 40, null, (x, y) => (Math.hypot(x - 20, y - 20) < 10 ? AZUL : null));
    const r = limparBordaDoRecorte(img);
    expect(Array.from(r.data)).toEqual(Array.from(img.data));
  });
});

describe("contas", () => {
  it("projeção devolve a parte do desenho e recusa cores que se confundem", () => {
    const c = [127, 142, 147];
    expect(alfaPorProjecao(c, 0, [0, 30, 40], [255, 255, 255])).toBeCloseTo(0.5, 1);
    expect(alfaPorProjecao(c, 0, [250, 250, 250], [255, 255, 255])).toBeNull();
  });

  it("compor sobre uma cor usa o alfa", () => {
    const s = comporSobre({ data: new Uint8ClampedArray([255, 0, 0, 128]), largura: 1, altura: 1 }, [0, 0, 0]);
    expect(s[0]).toBe(128);
    expect(s[3]).toBe(255);
  });
});
