/**
 * Composição de um mockup pré-processado (tools/mockups/psd_mockup.py), sem PSD e sem servidor.
 *
 *   saida = vazio + a * (base - vazio) + ganho * p
 *
 * base   = o mockup com os slots pretos     (luz e fundo)
 * vazio  = o mockup com os slots escondidos (o que aparece onde a logo é transparente)
 * ganho  = branco - preto                   (quanto do design chega a cada pixel)
 * p, a   = cor do design já multiplicada pelo alfa, e o alfa, no ponto uv
 *
 * É a mesma conta do shader (webgl.ts) e da conferência do pré-processamento (compor, em
 * psd_mockup.py). Aqui fica a versão pura, em memória, usada como reserva quando o navegador
 * não tem WebGL e pelos testes.
 */

/** Imagem RGBA em memória (o formato do ImageData). */
export interface ImagemRGBA {
  largura: number;
  altura: number;
  pixels: Uint8ClampedArray | Uint8Array;
}

/** As cinco camadas de um mockup, todas do mesmo tamanho. */
export interface CamadasDoMockup {
  largura: number;
  altura: number;
  base: Uint8ClampedArray | Uint8Array;
  vazio: Uint8ClampedArray | Uint8Array;
  ganho: Uint8ClampedArray | Uint8Array;
  /** uv.png: R = u>>4, G = v>>4, B = (u&15)<<4 | (v&15), com u e v em 12 bits. */
  uv: Uint8ClampedArray | Uint8Array;
  /** mapa.png: índice do slot (0 = nenhum) no canal R. */
  mapa: Uint8ClampedArray | Uint8Array;
  /** fundo.png (só mockup de estúdio): R = objeto (0..255), G = luz do fundo / 1,25. */
  fundo?: Uint8ClampedArray | Uint8Array | null;
}

/** Razão máxima de luz guardada no fundo.png (G = razão / RAZAO_MAX_DO_FUNDO). */
export const RAZAO_MAX_DO_FUNDO = 1.25;

/**
 * Ajustes da cena, iguais no shader (webgl.ts) e aqui:
 * - luz: quanto da sombra e do brilho da superfície chega ao design (1 = o do mockup, 0 = chapado,
 *   até 1,5 = mais contraste de luz). O ganho vira  gm + (ganho - gm) * luz, com gm = ganho médio do slot.
 * - brilho: multiplica a cor do design (0,6 a 1,4).
 * - novoFundo: RGBA do tamanho das camadas; com a camada fundo, troca o fundo da cena mantendo a sombra.
 */
export interface OpcoesDaComposicao {
  luz?: number;
  brilho?: number;
  /** Ganho médio (0..1) de cada slot, na ordem do índice (ganhoMedio[0] = slot 1). */
  ganhoMedio?: number[];
  novoFundo?: Uint8ClampedArray | Uint8Array | null;
}

/**
 * Ganho médio de cada slot (0..1), só onde o design aparece (ganho > 8): é o ponto fixo do
 * ajuste de luz. Slot sem pixel útil: 1.
 */
export function ganhoMedioPorSlot(ganho: Uint8ClampedArray | Uint8Array, mapa: Uint8ClampedArray | Uint8Array, slots: number): number[] {
  const soma = new Array(slots).fill(0);
  const n = new Array(slots).fill(0);
  for (let k = 0; k < mapa.length; k += 4) {
    const s = mapa[k];
    if (!s || s > slots) continue;
    const g = (ganho[k] + ganho[k + 1] + ganho[k + 2]) / 3;
    if (g <= 8) continue;
    soma[s - 1] += g / 255;
    n[s - 1]++;
  }
  return soma.map((t, i) => (n[i] ? t / n[i] : 1));
}

const MAX_UV = 4095;

/** Lê u e v (0..1) dos três bytes do uv.png. */
export function decodificarUv(r: number, g: number, b: number): [number, number] {
  const u = (r << 4) | (b >> 4);
  const v = (g << 4) | (b & 15);
  return [u / MAX_UV, v / MAX_UV];
}

/** O inverso (para teste e para gerar mapas sintéticos). */
export function codificarUv(u: number, v: number): [number, number, number] {
  const u12 = Math.max(0, Math.min(MAX_UV, Math.round(u * MAX_UV)));
  const v12 = Math.max(0, Math.min(MAX_UV, Math.round(v * MAX_UV)));
  return [u12 >> 4, v12 >> 4, ((u12 & 15) << 4) | (v12 & 15)];
}

/**
 * Amostra bilinear do design em (u, v), já com a cor multiplicada pelo alfa (evita a franja
 * escura na borda da logo transparente). Devolve [pr, pg, pb, a] em 0..1.
 */
export function amostrar(d: ImagemRGBA, u: number, v: number, saida: number[] = [0, 0, 0, 0]): number[] {
  const w = d.largura;
  const h = d.altura;
  const x = Math.max(0, Math.min(w - 1, u * w - 0.5));
  const y = Math.max(0, Math.min(h - 1, v * h - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1 < w ? x0 + 1 : x0;
  const y1 = y0 + 1 < h ? y0 + 1 : y0;
  const fx = x - x0;
  const fy = y - y0;
  const px = d.pixels;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  const cantos = [
    [x0, y0, (1 - fx) * (1 - fy)],
    [x1, y0, fx * (1 - fy)],
    [x0, y1, (1 - fx) * fy],
    [x1, y1, fx * fy],
  ];
  for (let i = 0; i < 4; i++) {
    const c = cantos[i];
    const peso = c[2];
    if (peso === 0) continue;
    const k = (c[1] * w + c[0]) * 4;
    const al = px[k + 3] / 255;
    r += (px[k] / 255) * al * peso;
    g += (px[k + 1] / 255) * al * peso;
    b += (px[k + 2] / 255) * al * peso;
    a += al * peso;
  }
  saida[0] = r;
  saida[1] = g;
  saida[2] = b;
  saida[3] = a;
  return saida;
}

/**
 * Compõe o mockup com um design por slot (designs[0] vai no slot 1). Slot sem design fica como
 * a base (o slot "preto" do PSD não aparece: sem design, mostra o vazio).
 * Devolve RGBA opaco do tamanho das camadas.
 */
export function comporMockup(c: CamadasDoMockup, designs: Array<ImagemRGBA | null | undefined>, destino?: Uint8ClampedArray, opcoes: OpcoesDaComposicao = {}): Uint8ClampedArray {
  const n = c.largura * c.altura;
  const out = destino && destino.length === n * 4 ? destino : new Uint8ClampedArray(n * 4);
  const amostra = [0, 0, 0, 0];
  const luz = typeof opcoes.luz === "number" && Number.isFinite(opcoes.luz) ? Math.max(0, Math.min(1.5, opcoes.luz)) : 1;
  const brilho = typeof opcoes.brilho === "number" && Number.isFinite(opcoes.brilho) ? Math.max(0.6, Math.min(1.4, opcoes.brilho)) : 1;
  const gm = opcoes.ganhoMedio || [];
  const trocaFundo = !!(c.fundo && opcoes.novoFundo && opcoes.novoFundo.length === n * 4);
  const cor = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    const slot = c.mapa[k];
    const d = slot > 0 ? designs[slot - 1] : null;
    if (!d) {
      // Sem slot: base e vazio são iguais. Slot sem design: o vazio (o objeto sem estampa).
      const fonte = slot > 0 ? c.vazio : c.base;
      cor[0] = fonte[k];
      cor[1] = fonte[k + 1];
      cor[2] = fonte[k + 2];
    } else {
      const uv = decodificarUv(c.uv[k], c.uv[k + 1], c.uv[k + 2]);
      amostrar(d, uv[0], uv[1], amostra);
      const a = amostra[3];
      const media = (typeof gm[slot - 1] === "number" ? gm[slot - 1] : 1) * 255;
      for (let ch = 0; ch < 3; ch++) {
        const z = c.vazio[k + ch];
        const b = c.base[k + ch];
        const g = luz === 1 ? c.ganho[k + ch] : Math.max(0, media + (c.ganho[k + ch] - media) * luz);
        cor[ch] = z + a * (b - z) + g * amostra[ch] * brilho;
      }
    }
    if (trocaFundo) {
      const f = c.fundo as Uint8ClampedArray | Uint8Array;
      const nf = opcoes.novoFundo as Uint8ClampedArray | Uint8Array;
      const objeto = f[k] / 255;
      if (objeto < 1) {
        const r = (f[k + 1] / 255) * RAZAO_MAX_DO_FUNDO;
        for (let ch = 0; ch < 3; ch++) cor[ch] = objeto * cor[ch] + (1 - objeto) * nf[k + ch] * r;
      }
    }
    out[k] = cor[0];
    out[k + 1] = cor[1];
    out[k + 2] = cor[2];
    out[k + 3] = 255;
  }
  return out;
}
