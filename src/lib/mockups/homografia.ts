/**
 * Logo e design aplicados pelo código numa cena gerada por IA (fachada, redes sociais).
 *
 * A IA só desenha a cena com uma área lisa (placa, tela, parede); o design da marca entra aqui,
 * por homografia: os 4 cantos da área (marcados pela equipe ou achados por detectarAreaLisa)
 * recebem o retângulo do design. A IA nunca desenha a logo.
 */
import { amostrar, type ImagemRGBA } from "./composicao";

export interface Ponto {
  x: number;
  y: number;
}

/** Matriz 3x3 em linha (9 números), com h[8] = 1. */
export type Matriz3 = number[];

/** Resolve A x = b (8x8) por eliminação de Gauss com pivô. Sistema singular: null. */
function resolver(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((linha, i) => linha.concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let l = c + 1; l < n; l++) if (Math.abs(M[l][c]) > Math.abs(M[piv][c])) piv = l;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    const t = M[c];
    M[c] = M[piv];
    M[piv] = t;
    for (let l = 0; l < n; l++) {
      if (l === c) continue;
      const f = M[l][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[l][k] -= f * M[c][k];
    }
  }
  return M.map((linha, i) => linha[n] / linha[i]);
}

/** Homografia que leva os 4 pontos `de` nos 4 pontos `para`. Pontos degenerados: null. */
export function homografia(de: Ponto[], para: Ponto[]): Matriz3 | null {
  if (de.length !== 4 || para.length !== 4) return null;
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = de[i];
    const { x: u, y: v } = para[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = resolver(A, b);
  return h ? h.concat([1]) : null;
}

export function aplicar(H: Matriz3, p: Ponto): Ponto {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}

export function inverter(H: Matriz3): Matriz3 | null {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((x) => x / det);
  return inv.map((x) => x / inv[8]);
}

/** Ordena 4 pontos como superior esquerdo, superior direito, inferior direito, inferior esquerdo. */
export function ordenarCantos(pts: Ponto[]): Ponto[] {
  const soma = pts.map((p) => p.x + p.y);
  const dif = pts.map((p) => p.x - p.y);
  const idx = (arr: number[], maior: boolean) => arr.indexOf(maior ? Math.max.apply(null, arr) : Math.min.apply(null, arr));
  return [pts[idx(soma, false)], pts[idx(dif, true)], pts[idx(soma, true)], pts[idx(dif, false)]];
}

/**
 * Projeta o design nos 4 cantos da cena (ordem: sup. esq., sup. dir., inf. dir., inf. esq.).
 * `luz` (0..1) leva a sombra e o brilho da área lisa para o design (1 = toda a luz da cena).
 * Devolve uma cópia da cena com o design aplicado. Cantos degenerados: a cena sem mudança.
 */
export function projetarDesign(cena: ImagemRGBA, design: ImagemRGBA, cantos: Ponto[], opcoes: { luz?: number } = {}): Uint8ClampedArray {
  const out = new Uint8ClampedArray(cena.pixels);
  const W = cena.largura;
  const Hh = cena.altura;
  const ret = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const H = homografia(ret, cantos);
  const Hi = H && inverter(H);
  if (!Hi) return out;
  const x0 = Math.max(0, Math.floor(Math.min.apply(null, cantos.map((p) => p.x))));
  const x1 = Math.min(W, Math.ceil(Math.max.apply(null, cantos.map((p) => p.x))));
  const y0 = Math.max(0, Math.floor(Math.min.apply(null, cantos.map((p) => p.y))));
  const y1 = Math.min(Hh, Math.ceil(Math.max.apply(null, cantos.map((p) => p.y))));
  if (x1 <= x0 || y1 <= y0) return out;
  const luz = Math.max(0, Math.min(1, opcoes.luz ?? 0.6));
  const px = cena.pixels;
  const lumaEm = (k: number) => (0.2126 * px[k] + 0.7152 * px[k + 1] + 0.0722 * px[k + 2]) / 255;

  // Luma média da área (para a luz relativa: sombra escurece, brilho clareia).
  let soma = 0;
  let n = 0;
  if (luz > 0) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const q = aplicar(Hi, { x: x + 0.5, y: y + 0.5 });
        if (q.x < 0 || q.x > 1 || q.y < 0 || q.y > 1) continue;
        soma += lumaEm((y * W + x) * 4);
        n++;
      }
    }
  }
  const media = n > 0 ? soma / n : 0;
  const amostra = [0, 0, 0, 0];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const q = aplicar(Hi, { x: x + 0.5, y: y + 0.5 });
      // Meio pixel de folga na borda para o antisserrilhado.
      const mx = 0.5 / design.largura;
      const my = 0.5 / design.altura;
      if (q.x < -mx || q.x > 1 + mx || q.y < -my || q.y > 1 + my) continue;
      amostrar(design, q.x, q.y, amostra);
      let a = amostra[3];
      const borda = Math.min(q.x + mx, 1 + mx - q.x, q.y + my, 1 + my - q.y);
      if (borda < 2 * mx) a *= Math.max(0, borda / (2 * mx));
      if (a <= 0) continue;
      const k = (y * W + x) * 4;
      let fator = 1;
      if (luz > 0 && media > 0.02) {
        const rel = lumaEm(k) / media;
        fator = Math.pow(Math.max(0.35, Math.min(1.4, rel)), luz);
      }
      for (let ch = 0; ch < 3; ch++) {
        const cor = amostra[3] > 0 ? (amostra[ch] / amostra[3]) * 255 * fator : 0;
        out[k + ch] = px[k + ch] * (1 - a) + cor * a;
      }
      out[k + 3] = 255;
    }
  }
  return out;
}

/**
 * Acha a maior área lisa e clara da cena (placa em branco, tela vazia) e devolve os 4 cantos
 * na escala da imagem. Sem área boa (pequena, grande demais ou longe de um quadrilátero): null.
 * A cena é pedida à IA com essa área "lisa, branca, sem texto"; a equipe pode ajustar os cantos.
 */
export function detectarAreaLisa(img: ImagemRGBA, opcoes: { lado?: number; lumaMinima?: number } = {}): Ponto[] | null {
  const lado = opcoes.lado ?? 192;
  const s = Math.min(1, lado / Math.max(img.largura, img.altura));
  const w = Math.max(8, Math.round(img.largura * s));
  const h = Math.max(8, Math.round(img.altura * s));
  const L = new Float32Array(w * h);
  const px = img.pixels;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // média de uma caixa da imagem original
      const sx0 = Math.floor((x / w) * img.largura);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) / w) * img.largura));
      const sy0 = Math.floor((y / h) * img.altura);
      const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) / h) * img.altura));
      let soma = 0;
      let n = 0;
      for (let yy = sy0; yy < sy1; yy++) {
        for (let xx = sx0; xx < sx1; xx++) {
          const k = (yy * img.largura + xx) * 4;
          soma += (0.2126 * px[k] + 0.7152 * px[k + 1] + 0.0722 * px[k + 2]) / 255;
          n++;
        }
      }
      L[y * w + x] = n ? soma / n : 0;
    }
  }
  const lumaMin = opcoes.lumaMinima ?? 0.55;
  const liso = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const grad = Math.abs(L[i + 1] - L[i - 1]) + Math.abs(L[i + w] - L[i - w]);
      if (grad < 0.04 && L[i] >= lumaMin) liso[i] = 1;
    }
  }
  // Maior componente conexa (vizinhança de 4).
  const rotulo = new Int32Array(w * h);
  let melhor: number[] = [];
  let atual = 0;
  const pilha: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!liso[i] || rotulo[i]) continue;
    atual++;
    const comp: number[] = [];
    pilha.push(i);
    rotulo[i] = atual;
    while (pilha.length) {
      const p = pilha.pop() as number;
      comp.push(p);
      const x = p % w;
      const viz = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
      for (let v = 0; v < 4; v++) {
        const q = viz[v];
        if (q < 0 || q >= w * h || !liso[q] || rotulo[q]) continue;
        rotulo[q] = atual;
        pilha.push(q);
      }
    }
    if (comp.length > melhor.length) melhor = comp;
  }
  const area = melhor.length / (w * h);
  if (area < 0.02 || area > 0.7) return null;
  const pts = melhor.map((p) => ({ x: (p % w) + 0.5, y: Math.floor(p / w) + 0.5 }));
  const cantos = ordenarCantos(pts);
  // O quadrilátero precisa ser preenchido pela área (senão não é uma placa).
  const areaQuad = Math.abs(
    cantos.reduce((t, p, i) => {
      const q = cantos[(i + 1) % 4];
      return t + (p.x * q.y - q.x * p.y);
    }, 0) / 2,
  );
  if (areaQuad <= 0 || melhor.length / areaQuad < 0.72) return null;
  // A borda da área tem gradiente e fica de fora: devolve 1,5 px (na escala reduzida) para fora.
  const cx = (cantos[0].x + cantos[1].x + cantos[2].x + cantos[3].x) / 4;
  const cy = (cantos[0].y + cantos[1].y + cantos[2].y + cantos[3].y) / 4;
  return cantos.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const k = 1.5 * Math.SQRT2;
    return { x: Math.max(0, Math.min(img.largura, (p.x + (dx / d) * k) / s)), y: Math.max(0, Math.min(img.altura, (p.y + (dy / d) * k) / s)) };
  });
}
