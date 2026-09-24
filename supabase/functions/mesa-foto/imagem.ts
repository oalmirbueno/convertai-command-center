/**
 * Operações de imagem da Mesa Foto feitas na própria função, sem IA e sem
 * custo (ImageScript, como _shared/imagem-local.ts):
 *
 * - tela de trabalho: a foto no tamanho que o gerador aceita (recorte mínimo);
 * - recorte com pixels originais: do gerador só vem o canal alfa (a máscara
 *   do assunto); a cor de cada pixel é a da foto original. É o modo Preservar
 *   do fundo transparente: o assunto não é redesenhado;
 * - fundo branco sem custo a partir de um recorte (sombra de contato local);
 * - recorte original sobre o cenário gerado (Novo cenário preservando o assunto);
 * - devolução dos pixels originais DENTRO das áreas protegidas (máscara do
 *   editor aberta no complemento das áreas e devolverOriginalForaDasAreas).
 */

import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { cobrir, decodificar, devolverOriginalForaDasAreas, mascara } from "../_shared/imagem-local.ts";
import { type Area, complementoDasAreas } from "./calculos.ts";

const tamanhoDe = (t: string) => {
  const [l, a] = t.split("x").map((v) => Number(v));
  return { largura: l, altura: a };
};

/** Foto no tamanho de trabalho (cover pelo centro; o tamanho já tem a proporção mais próxima). Mantém o alfa. */
export async function telaDeTrabalho(bytes: Uint8Array, tamanho: string): Promise<Uint8Array> {
  const { largura, altura } = tamanhoDe(tamanho);
  return await cobrir(await decodificar(bytes), largura, altura).encode(1);
}

/** Fração de pixels transparentes (alfa abaixo de 250), por amostragem. */
export async function fracaoTransparente(bytes: Uint8Array): Promise<number> {
  const img = await decodificar(bytes);
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

/** Foto já recortada (fundo transparente de verdade, pelo menos 2% de pixels transparentes). */
export async function ehRecorte(bytes: Uint8Array): Promise<boolean> {
  try {
    return (await fracaoTransparente(bytes)) >= 0.02;
  } catch {
    return false;
  }
}

/**
 * Recorte preservando o assunto: o alfa vem do gerador, a cor vem da foto
 * original (na mesma resolução de trabalho). Bordas quase transparentes e
 * quase opacas são limpas para não deixar halo.
 */
export async function recorteComPixelsOriginais(original: Uint8Array, geradoComAlfa: Uint8Array): Promise<Uint8Array> {
  const g = await decodificar(geradoComAlfa);
  const o = cobrir(await decodificar(original), g.width, g.height);
  const ga = g.bitmap, ob = o.bitmap;
  for (let i = 0; i < ob.length; i += 4) {
    let a = ga[i + 3];
    if (a < 8) a = 0;
    else if (a > 247) a = 255;
    ob[i + 3] = Math.min(ob[i + 3], a);
  }
  return await o.encode(1);
}

/** Caixa do assunto (alfa acima de 128) ou null quando o recorte está vazio. */
function caixaDoAssunto(img: Image): { x0: number; y0: number; x1: number; y1: number } | null {
  const b = img.bitmap;
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (b[(y * img.width + x) * 4 + 3] > 128) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/** Mistura a camada (com alfa) sobre o fundo opaco, pixel a pixel. */
function misturar(fundo: Image, camada: Image) {
  const f = fundo.bitmap, c = camada.bitmap;
  for (let i = 0; i < f.length; i += 4) {
    const a = c[i + 3] / 255;
    if (a <= 0) continue;
    f[i] = c[i] * a + f[i] * (1 - a);
    f[i + 1] = c[i + 1] * a + f[i + 1] * (1 - a);
    f[i + 2] = c[i + 2] * a + f[i + 2] * (1 - a);
    f[i + 3] = 255;
  }
}

/**
 * Fundo branco a partir de um recorte, sem gerador: branco puro, sombra de
 * contato suave e curta sob a base do assunto, assunto com os pixels do recorte.
 */
export async function comporSobreBranco(recorte: Uint8Array, sombra = true): Promise<Uint8Array> {
  const img = await decodificar(recorte);
  const caixa = caixaDoAssunto(img);
  if (!caixa) throw new Error("recorte_vazio");
  const W = img.width, H = img.height;
  const saida = new Image(W, H);
  saida.fill(0xffffffff);
  if (sombra) {
    const b = saida.bitmap;
    const cx = (caixa.x0 + caixa.x1) / 2;
    const cy = caixa.y1;
    const rx = Math.max(6, 0.42 * (caixa.x1 - caixa.x0));
    const ry = Math.max(3, 0.035 * (caixa.y1 - caixa.y0));
    const yIni = Math.max(0, Math.floor(cy - ry * 1.5)), yFim = Math.min(H - 1, Math.ceil(cy + ry * 2.5));
    const xIni = Math.max(0, Math.floor(cx - rx * 1.4)), xFim = Math.min(W - 1, Math.ceil(cx + rx * 1.4));
    for (let y = yIni; y <= yFim; y++) {
      for (let x = xIni; x <= xFim; x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        const escuro = 0.26 * Math.exp(-d * 1.8);
        if (escuro < 0.004) continue;
        const i = (y * W + x) * 4;
        b[i] = b[i] * (1 - escuro);
        b[i + 1] = b[i + 1] * (1 - escuro);
        b[i + 2] = b[i + 2] * (1 - escuro);
      }
    }
  }
  misturar(saida, img);
  return await saida.encode(1);
}

/** Recorte original (com alfa) por cima do cenário gerado, no tamanho do cenário. */
export async function comporRecorteSobre(fundo: Uint8Array, recorte: Uint8Array): Promise<Uint8Array> {
  const f = await decodificar(fundo);
  const r = cobrir(await decodificar(recorte), f.width, f.height);
  misturar(f, r);
  return await f.encode(1);
}

/** Leva o alfa da foto de origem para a imagem gerada (luz e cor sobre um recorte continua recorte). */
export async function aplicarAlfaDaOrigem(gerado: Uint8Array, origemComAlfa: Uint8Array): Promise<Uint8Array> {
  const g = await decodificar(gerado);
  const o = cobrir(await decodificar(origemComAlfa), g.width, g.height);
  const gb = g.bitmap, ob = o.bitmap;
  for (let i = 0; i < gb.length; i += 4) gb[i + 3] = ob[i + 3];
  return await g.encode(1);
}

/**
 * Pixels originais de volta DENTRO das áreas protegidas (pena curta para não
 * marcar a emenda). Sem área protegida, devolve o gerado como veio.
 */
export async function devolverOriginalNasAreas(original: Uint8Array, gerado: Uint8Array, protegidas: Area[]): Promise<Uint8Array> {
  if (!protegidas.length) return gerado;
  return await devolverOriginalForaDasAreas(original, gerado, complementoDasAreas(protegidas), 16);
}

/** Máscara do editor que abre tudo menos as áreas protegidas (transparente = pode mudar). */
export async function mascaraProtegendo(largura: number, altura: number, protegidas: Area[]): Promise<Uint8Array> {
  return await mascara(largura, altura, complementoDasAreas(protegidas));
}

/** Qualquer imagem (PNG, JPEG, WebP do provedor) vira PNG. */
export async function emPng(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return bytes;
  return await (await decodificar(bytes)).encode(1);
}

/** Largura e altura decodificando (quando o cabeçalho não basta). */
export async function dimensoesDecodificando(bytes: Uint8Array): Promise<{ largura: number; altura: number }> {
  const img = await decodificar(bytes);
  return { largura: img.width, altura: img.height };
}

/** Imagem menor para leitura por visão (lado maior até `max`), em PNG. */
export async function reduzir(bytes: Uint8Array, max = 1280): Promise<Uint8Array> {
  const img = await decodificar(bytes);
  if (img.width <= max && img.height <= max) return await img.encode(1);
  // contain escala para caber na caixa (sem margem): o lado maior fica com `max`.
  return await img.contain(max, max).encode(1);
}
