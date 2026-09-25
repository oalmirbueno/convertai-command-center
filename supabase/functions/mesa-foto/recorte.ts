/**
 * "Tirar fundo" da Mesa Foto (preparar modo fundo_transparente), pedido do
 * dono em 25/09: o recorte preserva os PIXELS ORIGINAIS do assunto.
 *
 * Como funciona: o GPT Image devolve a foto de trabalho com o fundo
 * transparente. Dela só o canal alfa é usado (a máscara do assunto). O
 * gerador às vezes reenquadra a foto (zoom e deslocamento pequenos), então a
 * máscara é primeiro ALINHADA à foto original comparando a luminância só nos
 * pixels do assunto; depois ela é levada para a foto original inteira (na
 * resolução em que chegou, até 2048 px), inclusive a faixa que a tela de
 * trabalho cortou. A cor de cada pixel é sempre a da foto original: o
 * assunto não é redesenhado.
 *
 * Sem IA e sem custo aqui (ImageScript, como _shared/imagem-local.ts, que
 * este arquivo só importa). Limite de 2 s de CPU da função: medido em Deno
 * local (ver docs/mesa-foto/CLONES.md, seção "Tirar fundo").
 */

import type { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { type Alinhamento, cobrir, decodificar, IDENTIDADE } from "../_shared/imagem-local.ts";

/**
 * Lado maior da foto no "Tirar fundo": decodificar JPEG é o passo mais caro
 * (cerca de 0,6 s em 2048 px contra 0,4 s em 1600 px no Deno local). Em 1600
 * px o fluxo inteiro mediu de 0,9 a 1,1 s de CPU; em 2048, de 1,25 a 1,5 s.
 */
export const LADO_DO_RECORTE = 1600;

/** Desvio de luminância (0 a 255) acima do qual o gerador mudou o assunto: a máscara não serve. */
export const LIMITE_RECORTE_DESALINHADO = 24;
/** Entre este e o limite acima, o recorte sai com aviso para conferir as bordas. */
export const LIMITE_RECORTE_CONFERIR = 14;
/** Menos que isto de assunto (fração do quadro) é recorte vazio. */
export const ASSUNTO_MINIMO = 0.01;

export type ResultadoDoRecorte = {
  png: Uint8Array;
  largura: number;
  altura: number;
  alinhamento: Alinhamento;
  alinhou: boolean;
  /** Desvio de luminância no assunto depois de alinhar (0 a 255). */
  erro: number;
  /** Fração do quadro que ficou com o assunto (alfa acima de 128). */
  assunto: number;
  situacao: "ok" | "conferir" | "desalinhado" | "vazio";
};

/** Janela da foto original que a tela de trabalho mostra ("cover" pelo centro, igual a cobrir()). */
export function janelaDoCover(larguraOriginal: number, alturaOriginal: number, largura: number, altura: number) {
  const escala = Math.max(largura / larguraOriginal, altura / alturaOriginal);
  const l = Math.max(largura, Math.round(larguraOriginal * escala));
  const a = Math.max(altura, Math.round(alturaOriginal * escala));
  return { escala, offX: Math.floor((l - largura) / 2), offY: Math.floor((a - altura) / 2), lEscalada: l, aEscalada: a };
}

type Mapa = { l: number; a: number; lum: Float32Array; peso: Float32Array };

/**
 * Luminância média por bloco da tela de trabalho vista na foto original
 * (sem redimensionar a foto inteira: cada pixel do original cai no bloco da
 * sua posição na tela). Fora da janela do cover, o pixel não conta.
 */
function mapaDoOriginal(o: Image, largura: number, altura: number, l: number, a: number): Mapa {
  const { escala, offX, offY } = janelaDoCover(o.width, o.height, largura, altura);
  const lum = new Float32Array(l * a);
  const n = new Float32Array(l * a);
  const b = o.bitmap, W = o.width, H = o.height;
  const colunas = new Int32Array(W);
  for (let x = 0; x < W; x++) {
    const tx = (x + 0.5) * escala - offX;
    colunas[x] = tx < 0 || tx >= largura ? -1 : Math.min(l - 1, Math.floor((tx * l) / largura));
  }
  for (let y = 0; y < H; y++) {
    const ty = (y + 0.5) * escala - offY;
    if (ty < 0 || ty >= altura) continue;
    const base = Math.min(a - 1, Math.floor((ty * a) / altura)) * l;
    let i = y * W * 4;
    for (let x = 0; x < W; x++, i += 4) {
      const c = colunas[x];
      if (c < 0) continue;
      lum[base + c] += 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
      n[base + c]++;
    }
  }
  for (let k = 0; k < lum.length; k++) lum[k] /= n[k] || 1;
  return { l, a, lum, peso: n };
}

/** Luminância e peso do assunto (média do alfa) por bloco da imagem gerada; `semAlfa` lê a tela de trabalho (tudo conta). */
function mapaDoGerado(g: Image, l: number, a: number, semAlfa = false): Mapa {
  const W = g.width, H = g.height, b = g.bitmap;
  const lum = new Float32Array(l * a);
  const peso = new Float32Array(l * a);
  const n = new Float32Array(l * a);
  const colunas = new Int32Array(W);
  for (let x = 0; x < W; x++) colunas[x] = Math.min(l - 1, Math.floor((x * l) / W));
  for (let y = 0; y < H; y++) {
    const base = Math.min(a - 1, Math.floor((y * a) / H)) * l;
    let i = y * W * 4;
    for (let x = 0; x < W; x++, i += 4) {
      const k = base + colunas[x];
      const al = semAlfa ? 1 : b[i + 3] / 255;
      n[k]++;
      if (al <= 0) continue;
      lum[k] += (0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2]) * al;
      peso[k] += al;
    }
  }
  for (let k = 0; k < lum.length; k++) {
    lum[k] = peso[k] > 0 ? lum[k] / peso[k] : 0;
    peso[k] = n[k] ? peso[k] / n[k] : 0;
  }
  return { l, a, lum, peso };
}

function amostrar(m: Float32Array, l: number, a: number, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(l - 1, x0 + 1), y1 = Math.min(a - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  return (m[y0 * l + x0] * (1 - fx) + m[y0 * l + x1] * fx) * (1 - fy) + (m[y1 * l + x0] * (1 - fx) + m[y1 * l + x1] * fx) * fy;
}

/**
 * Desvio da diferença de luminância entre o assunto gerado (blocos quase
 * todos assunto) e o original posto no alinhamento. Tira a diferença média
 * (o gerador clareia ou esquenta). Menos de 60% dos blocos do assunto dentro
 * do original = alinhamento impossível.
 */
function erroNoAssunto(g: Mapa, o: Mapa, al: Alinhamento, passo = 1): number {
  const { l, a } = g;
  let s = 0, s2 = 0, n = 0, total = 0;
  for (let y = 0; y < a; y += passo) {
    const oy = (al.cv + ((y + 0.5) / a - 0.5) / al.escala) * a - 0.5;
    for (let x = 0; x < l; x += passo) {
      const k = y * l + x;
      if (g.peso[k] < 0.9) continue;
      total++;
      const ox = (al.cu + ((x + 0.5) / l - 0.5) / al.escala) * l - 0.5;
      if (ox < 0 || oy < 0 || ox > l - 1 || oy > a - 1) continue;
      const d = g.lum[k] - amostrar(o.lum, l, a, ox, oy);
      s += d;
      s2 += d * d;
      n++;
    }
  }
  if (!total || n < total * 0.6) return Infinity;
  const media = s / n;
  return Math.sqrt(Math.max(0, s2 / n - media * media));
}

function reduzirMapa(m: Mapa, f: number): Mapa {
  const l = Math.floor(m.l / f), a = Math.floor(m.a / f);
  const lum = new Float32Array(l * a), peso = new Float32Array(l * a);
  for (let y = 0; y < a; y++) {
    for (let x = 0; x < l; x++) {
      let sl = 0, sp = 0, sw = 0;
      for (let dy = 0; dy < f; dy++) {
        const linha = (y * f + dy) * m.l + x * f;
        for (let dx = 0; dx < f; dx++) {
          const w = m.peso[linha + dx];
          sl += m.lum[linha + dx] * w;
          sw += w;
          sp += w;
        }
      }
      lum[y * l + x] = sw ? sl / sw : 0;
      peso[y * l + x] = sp / (f * f);
    }
  }
  return { l, a, lum, peso };
}

/**
 * Onde o gerador pôs a foto (mesma convenção de _shared/imagem-local.ts): o
 * ponto (u, v) do gerado mostra o ponto (cu + (u - 0,5) / escala, cv + (v -
 * 0,5) / escala) da tela de trabalho. Busca em três níveis, só no assunto.
 */
export function alinharAssunto(o: Image, g: Image, tela?: Image | null): { alinhamento: Alinhamento; erro: number; erroSemAlinhar: number } {
  const lf = 192, af = Math.max(24, Math.round((lf * g.height) / g.width / 6) * 6);
  // Com a tela de trabalho já aberta (mesma proporção do gerado), o mapa sai dela: metade dos pixels do original.
  const mesmaProporcao = !!tela && Math.abs(tela.width / tela.height - g.width / g.height) < 0.01;
  const gFino = mapaDoGerado(g, lf, af);
  const oFino = mesmaProporcao ? mapaDoGerado(tela!, lf, af, true) : mapaDoOriginal(o, g.width, g.height, lf, af);
  const niveis = [6, 2, 1].map((f) => (f === 1 ? { g: gFino, o: oFino } : { g: reduzirMapa(gFino, f), o: reduzirMapa(oFino, f) }));
  // Amostragem: o nível fino olha um bloco sim, um não (limite de 2 s de CPU da função).
  const busca = (nivel: number, base: Alinhamento, de: number, ate: number, passo: number, raioU: number, raioV: number, amostra = 1) => {
    const { g: mg, o: mo } = niveis[nivel];
    let melhor = base, menor = erroNoAssunto(mg, mo, base, amostra);
    for (let e = de; e <= ate + 1e-9; e += passo) {
      for (let du = -raioU; du <= raioU; du++) {
        for (let dv = -raioV; dv <= raioV; dv++) {
          const al = { escala: e, cu: base.cu + du / mg.l, cv: base.cv + dv / mg.a };
          const err = erroNoAssunto(mg, mo, al, amostra);
          if (err < menor) {
            menor = err;
            melhor = al;
          }
        }
      }
    }
    return { melhor, menor };
  };
  const n0 = niveis[0].g;
  // Os geradores reenquadram pouco: zoom de 0,9 a 1,15 e centro até 12% fora do meio.
  const r1 = busca(0, IDENTIDADE, 0.9, 1.15, 0.025, Math.round(0.12 * n0.l), Math.round(0.12 * n0.a));
  const r2 = busca(1, r1.melhor, r1.melhor.escala - 0.02, r1.melhor.escala + 0.02, 0.01, 2, 2);
  const r3 = busca(2, r2.melhor, r2.melhor.escala - 0.006, r2.melhor.escala + 0.006, 0.003, 2, 2, 2);
  return { alinhamento: r3.melhor, erro: r3.menor, erroSemAlinhar: erroNoAssunto(gFino, oFino, IDENTIDADE) };
}

/**
 * O recorte final: a foto original (na resolução em que chegou) com o alfa
 * do gerador alinhado. Bordas quase transparentes e quase opacas são limpas
 * para não deixar halo. A faixa que a tela de trabalho cortou recebe a borda
 * da máscara (o assunto que encosta na borda continua).
 */
export async function recortePreservandoOriginal(
  original: Uint8Array | Image,
  geradoComAlfa: Uint8Array | Image,
  tela?: Image | null,
): Promise<ResultadoDoRecorte> {
  const o = original instanceof Uint8Array ? await decodificar(original) : original;
  const g = geradoComAlfa instanceof Uint8Array ? await decodificar(geradoComAlfa) : geradoComAlfa;
  const est = alinharAssunto(o, g, tela);
  const alinhou = Number.isFinite(est.erro) && est.erro < est.erroSemAlinhar * 0.95;
  const al = alinhou ? est.alinhamento : IDENTIDADE;
  const erro = alinhou ? est.erro : est.erroSemAlinhar;

  const Wg = g.width, Hg = g.height, ga = g.bitmap;
  const W = o.width, H = o.height, ob = o.bitmap;
  const { escala, offX, offY } = janelaDoCover(W, H, Wg, Hg);
  // Coluna do gerado para cada x do original (a transformação é separável).
  const gxDe = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const ut = ((x + 0.5) * escala - offX) / Wg;
    gxDe[x] = Math.max(0, Math.min(Wg - 1, ((ut - al.cu) * al.escala + 0.5) * Wg - 0.5));
  }
  let opacos = 0;
  for (let y = 0; y < H; y++) {
    const vt = ((y + 0.5) * escala - offY) / Hg;
    const gy = Math.max(0, Math.min(Hg - 1, ((vt - al.cv) * al.escala + 0.5) * Hg - 0.5));
    const y0 = Math.floor(gy), y1 = Math.min(Hg - 1, y0 + 1), fy = gy - y0;
    const l0 = y0 * Wg, l1 = y1 * Wg;
    let i = y * W * 4;
    for (let x = 0; x < W; x++, i += 4) {
      const gx = gxDe[x];
      const x0 = Math.floor(gx), x1 = Math.min(Wg - 1, x0 + 1), fx = gx - x0;
      const cima = ga[(l0 + x0) * 4 + 3] * (1 - fx) + ga[(l0 + x1) * 4 + 3] * fx;
      const baixo = ga[(l1 + x0) * 4 + 3] * (1 - fx) + ga[(l1 + x1) * 4 + 3] * fx;
      let a = cima * (1 - fy) + baixo * fy;
      if (a < 8) a = 0;
      else if (a > 247) a = 255;
      const final = Math.min(ob[i + 3], Math.round(a));
      ob[i + 3] = final;
      if (final > 128) opacos++;
    }
  }
  const assunto = opacos / (W * H);
  const situacao: ResultadoDoRecorte["situacao"] = assunto < ASSUNTO_MINIMO
    ? "vazio"
    : !(erro <= LIMITE_RECORTE_DESALINHADO)
    ? "desalinhado"
    : erro > LIMITE_RECORTE_CONFERIR
    ? "conferir"
    : "ok";
  return { png: await o.encode(1), largura: W, altura: H, alinhamento: al, alinhou, erro, assunto, situacao };
}

// ------------------------------------------------------------------ passos do "Tirar fundo"

/** Fração de pixels transparentes (alfa abaixo de 250), por amostragem, da imagem já aberta. */
export function fracaoTransparenteDe(img: Image): number {
  const b = img.bitmap;
  const passo = Math.max(1, Math.floor(Math.sqrt((img.width * img.height) / 250_000)));
  let total = 0, transparentes = 0;
  for (let y = 0; y < img.height; y += passo) {
    for (let x = 0; x < img.width; x += passo) {
      total++;
      if (b[(y * img.width + x) * 4 + 3] < 250) transparentes++;
    }
  }
  return total ? transparentes / total : 0;
}

/** A foto aberta uma vez só (limite de CPU): serve para conferir se já é recorte, montar a tela e o resultado. */
export async function abrirFoto(bytes: Uint8Array): Promise<Image> {
  return await decodificar(bytes);
}

/** Tela de trabalho no tamanho que o gerador aceita ("cover" pelo centro), aberta e em PNG. */
export async function telaDoRecorte(o: Image, tamanho: string): Promise<{ tela: Image; png: Uint8Array }> {
  const [l, a] = tamanho.split("x").map((v) => Number(v));
  const tela = cobrir(o, l, a);
  return { tela, png: await tela.encode(1) };
}

/** Situação do recorte em palavras para a equipe (aviso na resposta e na descrição da derivada). */
export function avisoDoRecorte(r: Pick<ResultadoDoRecorte, "situacao" | "alinhou">): string | null {
  if (r.situacao === "conferir") return "O gerador redesenhou um pouco o assunto: confira as bordas do recorte antes de usar.";
  if (r.situacao === "ok" && r.alinhou) return "O gerador reenquadrou a foto; a máscara foi alinhada à foto original.";
  return null;
}
