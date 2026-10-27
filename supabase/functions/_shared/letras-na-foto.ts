/**
 * Letras na foto real sem tocar na foto (27/10/2026). Dono: "não é fazer por cima da foto a arte; usar de forma
 * fiel as imagens e não gerar por cima, isso não pode acontecer" (lâmina da Verzelo saiu com a foto encolhida
 * dentro da lâmina e o texto cortado: o gerador reenquadrou além do que o alinhamento acha, erro 22 a 24).
 *
 * Quando a foto devolvida pelo gerador não alinha com a original, a lâmina não usa mais a imagem dele: o gerador
 * desenha SÓ o texto e a logo numa placa de cor lisa (a "chave"), o código tira a cor da chave e cola as letras
 * na foto original intacta, com uma sombra suave para leitura. A foto nunca passa pelo gerador nesse caminho.
 */
import { Image } from "./imagescript.ts";
import { decodificar } from "./imagem-local.ts";
import { dist, limparBordaDoRecorte, recortarFundoSolido, type Rgb } from "./recorte-limpo.ts";

/** Cores de chave possíveis: saturadas e longe de pele, céu, folha e tijolo comuns. */
export const CHAVES: { hex: string; rgb: Rgb }[] = [
  { hex: "#FF00FF", rgb: [255, 0, 255] },
  { hex: "#00FFFF", rgb: [0, 255, 255] },
  { hex: "#0000FF", rgb: [0, 0, 255] },
  { hex: "#00FF00", rgb: [0, 255, 0] },
];

export interface AreaRelativa { x0: number; y0: number; x1: number; y1: number }

/**
 * A chave que menos aparece nas letras que o gerador já desenhou (dentro das áreas do texto e da logo).
 * Pura sobre os pixels: os testes passam um bitmap pequeno.
 */
export function chaveLongeDasLetras(px: ArrayLike<number>, W: number, H: number, areas: AreaRelativa[]): { hex: string; rgb: Rgb } {
  const perto = CHAVES.map(() => 0);
  const passo = Math.max(1, Math.floor(Math.sqrt((W * H) / 40000)));
  for (const a of areas) {
    for (let y = Math.floor(a.y0 * H); y < Math.min(H, Math.ceil(a.y1 * H)); y += passo) {
      for (let x = Math.floor(a.x0 * W); x < Math.min(W, Math.ceil(a.x1 * W)); x += passo) {
        const i = (y * W + x) * 4;
        CHAVES.forEach((c, k) => { if (dist(px, i, c.rgb) < 110) perto[k]++; });
      }
    }
  }
  let melhor = 0;
  perto.forEach((n, k) => { if (n < perto[melhor]) melhor = k; });
  return CHAVES[melhor];
}

/** A chave a partir da arte que o gerador devolveu (decodifica aqui). */
export async function chaveParaAArte(gerado: Uint8Array, areas: AreaRelativa[]): Promise<{ hex: string; rgb: Rgb }> {
  const g = await decodificar(gerado);
  return chaveLongeDasLetras(g.bitmap, g.width, g.height, areas);
}

/** Desfoque de caixa na janela [x0..x1]x[y0..y1] (duas passadas), para a sombra das letras. */
function desfocar(a: Float32Array, W: number, H: number, r: number, j: { x0: number; y0: number; x1: number; y1: number }): Float32Array {
  const t = new Float32Array(a.length);
  const s = new Float32Array(a.length);
  for (let y = j.y0; y <= j.y1; y++) {
    let soma = 0;
    for (let x = j.x0 - r; x <= j.x0 + r; x++) soma += x >= 0 && x < W ? a[y * W + x] : 0;
    for (let x = j.x0; x <= j.x1; x++) {
      t[y * W + x] = soma / (2 * r + 1);
      const sai = x - r, entra = x + r + 1;
      soma += (entra < W ? a[y * W + entra] : 0) - (sai >= 0 ? a[y * W + sai] : 0);
    }
  }
  for (let x = j.x0; x <= j.x1; x++) {
    let soma = 0;
    for (let y = j.y0 - r; y <= j.y0 + r; y++) soma += y >= 0 && y < H ? t[y * W + x] : 0;
    for (let y = j.y0; y <= j.y1; y++) {
      s[y * W + x] = soma / (2 * r + 1);
      const sai = y - r, entra = y + r + 1;
      soma += (entra < H ? t[entra * W + x] : 0) - (sai >= 0 ? t[sai * W + x] : 0);
    }
  }
  return s;
}

/**
 * Cola as letras da placa (fundo na cor da chave) sobre a foto original, que fica intacta fora das letras.
 * A placa é levada ao tamanho da foto. Sombra: escura sob letra clara, clara sob letra escura, suave.
 */
export async function letrasSobreAFoto(original: Uint8Array, placa: Uint8Array, chave: Rgb): Promise<{ png: Uint8Array; pixelsDeLetra: number }> {
  const foto = await decodificar(original);
  const W = foto.width, H = foto.height;
  const p = await decodificar(placa);
  if (p.width !== W || p.height !== H) p.resize(W, H);
  const recorte = recortarFundoSolido({ data: p.bitmap, largura: W, altura: H }, { cor: chave, tolerancia: 60, furos: "tirar" });
  // A franja da cor da chave nas bordas das letras sai pela cor da própria placa (sem halo rosa ou ciano).
  const limpo = limparBordaDoRecorte({ data: recorte.data, largura: W, altura: H }, { original: p.bitmap, erodir: 1 }).data;
  const alfa = new Float32Array(W * H);
  let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0, lumLetra = 0;
  for (let k = 0; k < W * H; k++) {
    const a = limpo[k * 4 + 3] / 255;
    if (a <= 0.02) continue;
    alfa[k] = a;
    n++;
    lumLetra += (0.299 * limpo[k * 4] + 0.587 * limpo[k * 4 + 1] + 0.114 * limpo[k * 4 + 2]) * a;
    const x = k % W, y = (k - x) / W;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const fb = foto.bitmap;
  if (n) {
    const r = Math.max(3, Math.round(W * 0.006));
    const desloca = Math.max(1, Math.round(W * 0.002));
    const j = { x0: Math.max(0, x0 - 3 * r), y0: Math.max(0, y0 - 3 * r), x1: Math.min(W - 1, x1 + 3 * r), y1: Math.min(H - 1, y1 + 3 * r) };
    const sombra = desfocar(alfa, W, H, r, j);
    const clara = lumLetra / Math.max(1, n) > 140;
    const corSombra = clara ? 0 : 255;
    const forca = clara ? 0.42 : 0.3;
    for (let y = j.y0; y <= j.y1; y++) {
      for (let x = j.x0; x <= j.x1; x++) {
        const k = y * W + x, i = k * 4;
        const ys = Math.max(0, y - desloca);
        const s = sombra[ys * W + x] * forca * (1 - alfa[k]);
        if (s > 0) for (let c = 0; c < 3; c++) fb[i + c] = fb[i + c] * (1 - s) + corSombra * s;
        const a = alfa[k];
        if (a > 0) for (let c = 0; c < 3; c++) fb[i + c] = fb[i + c] * (1 - a) + limpo[i + c] * a;
        fb[i + 3] = 255;
      }
    }
  }
  return { png: await (foto as Image).encode(1), pixelsDeLetra: n };
}
