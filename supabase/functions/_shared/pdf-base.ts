/**
 * Base comum dos PDFs do painel (Frente DOC, 29/09/2026), extraída do PDF da
 * Mesa Roteiros (_shared/pdf-roteiro.ts), que continua saindo igual byte a
 * byte (prova em src/test/pdf-base.test.ts).
 *
 * O que fica aqui:
 * - página A4 com a faixa verde na margem esquerda, a logo no topo, o
 *   cabeçalho (cliente à esquerda, seção à direita) e o rodapé
 *   "seção · 02 / 08";
 * - fontes padrão do PDF (Helvetica e Helvetica Bold) em WinAnsiEncoding, com
 *   os acentos do português, e as larguras das métricas oficiais, para a
 *   quebra de linha ser exata;
 * - imagens: JPEG embutido como veio (XObject com DCTDecode) e PNG simples
 *   (8 bits, sem transparência e sem entrelaçamento; paleta também) com os
 *   dados do próprio PNG (FlateDecode com o preditor do PNG), sem abrir nem
 *   recomprimir nada. Escala e encaixe na caixa ("conter" ou "cobrir").
 *
 * Puro: sem Deno, sem npm. Roda igual no navegador e na Edge Function, em
 * poucos milissegundos. Compatível com Safari 11. Sem travessão.
 */

import { LOGO_ALTURA, LOGO_LARGURA, LOGO_MASCARA_ZLIB_B64, LOGO_RGB_ZLIB_B64 } from "./pdf-logo-aceleriq.ts";

// ------------------------------------------------------------------ fontes (métricas oficiais, códigos 32 a 255 em WinAnsi)

const LARGURAS_HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 0,
  556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667,
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
];

const LARGURAS_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 0,
  556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 667,
  278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556,
];

/** Unicode que o WinAnsi guarda entre 128 e 159. */
const WIN_ANSI_ESPECIAIS: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

const UNICODE_DO_WIN_ANSI: Record<number, number> = {};
Object.keys(WIN_ANSI_ESPECIAIS).forEach((u) => {
  UNICODE_DO_WIN_ANSI[WIN_ANSI_ESPECIAIS[Number(u)]] = Number(u);
});

/** Troca o que o WinAnsi não tem por algo equivalente (seta, aspas, espaços). */
const SUBSTITUTOS: Record<number, string> = { 0x2192: "->", 0x2190: "<-", 0x2212: "-", 0x2011: "-", 0x2010: "-", 0x00a0: " ", 0x2009: " ", 0x202f: " ", 0x200b: "" };

/** Texto em códigos WinAnsi (0 a 255). Acento solto é recomposto; emoji e símbolo sem par somem. */
export function paraWinAnsi(t: string): number[] {
  let s = String(t == null ? "" : t);
  try {
    s = s.normalize("NFC");
  } catch {
    /* navegador sem normalize: segue como veio */
  }
  const saida: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    // Par substituto (emoji e afins): pula os dois.
    if (c >= 0xd800 && c <= 0xdbff) {
      i++;
      continue;
    }
    if (c === 9) c = 32;
    if (SUBSTITUTOS[c] !== undefined) {
      const sub = SUBSTITUTOS[c];
      for (let k = 0; k < sub.length; k++) saida.push(sub.charCodeAt(k));
      continue;
    }
    if (c >= 32 && c < 127) saida.push(c);
    else if (c >= 0xa0 && c <= 0xff) saida.push(c);
    else if (WIN_ANSI_ESPECIAIS[c] !== undefined) saida.push(WIN_ANSI_ESPECIAIS[c]);
    else if (c >= 0x300 && c <= 0x36f) continue;
  }
  return saida;
}

export type Fonte = "F1" | "F2";

export function larguraDoTexto(t: string, fonte: Fonte, tamanho: number): number {
  const tabela = fonte === "F2" ? LARGURAS_BOLD : LARGURAS_HELV;
  let soma = 0;
  for (const c of paraWinAnsi(t)) soma += c >= 32 ? tabela[c - 32] || 556 : 0;
  return (soma * tamanho) / 1000;
}

/** Quebra em linhas que cabem na largura. Palavra maior que a linha quebra por letra. Nunca corta texto. */
export function quebrarLinhas(t: string, fonte: Fonte, tamanho: number, largura: number): string[] {
  const linhas: string[] = [];
  const paragrafos = String(t || "").replace(/\r\n/g, "\n").split("\n");
  for (const p of paragrafos) {
    const palavras = p.split(/\s+/).filter(Boolean);
    if (!palavras.length) {
      linhas.push("");
      continue;
    }
    let atual = "";
    for (let w of palavras) {
      const tentativa = atual ? `${atual} ${w}` : w;
      if (larguraDoTexto(tentativa, fonte, tamanho) <= largura) {
        atual = tentativa;
        continue;
      }
      if (atual) linhas.push(atual);
      atual = "";
      while (larguraDoTexto(w, fonte, tamanho) > largura && w.length > 1) {
        let corte = w.length - 1;
        while (corte > 1 && larguraDoTexto(w.slice(0, corte), fonte, tamanho) > largura) corte--;
        linhas.push(w.slice(0, corte));
        w = w.slice(corte);
      }
      atual = w;
    }
    if (atual) linhas.push(atual);
  }
  // Tira linhas vazias do começo e do fim (parágrafo em branco no meio fica).
  while (linhas.length && !linhas[0]) linhas.shift();
  while (linhas.length && !linhas[linhas.length - 1]) linhas.pop();
  return linhas;
}

// ------------------------------------------------------------------ bytes

export function literal(t: string): string {
  let s = "(";
  for (const c of paraWinAnsi(t)) {
    if (c === 0x28 || c === 0x29 || c === 0x5c) s += `\\${String.fromCharCode(c)}`;
    else if (c < 32 || c > 126) s += `\\${("00" + c.toString(8)).slice(-3)}`;
    else s += String.fromCharCode(c);
  }
  return `${s})`;
}

export function bytesDoTexto(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

export function deBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}

export const n2 = (v: number) => (Math.round(v * 100) / 100).toString();

// ------------------------------------------------------------------ cores (as do documento modelo)

export type Cor = [number, number, number];
export const hex = (h: string): Cor => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

export const CORES = {
  verde: hex("#00a900"),
  verdeEscuro: hex("#157330"),
  verdeClaro: hex("#73d578"),
  tinta: hex("#151b17"),
  cinza: hex("#626d66"),
  linha: hex("#dfe5df"),
  cartao: hex("#f5f7f5"),
  cartaoVerde: hex("#eff6ef"),
  branco: hex("#ffffff"),
};

// ------------------------------------------------------------------ imagens (JPEG como veio; PNG simples)

export type ImagemDoPdf = {
  largura: number;
  altura: number;
  /** Dicionário do XObject sem o /Length (vai na montagem). */
  dicionario: string;
  dados: Uint8Array;
  tipo: "jpeg" | "png";
};

/** Por que a imagem não entra no PDF (para a tela e o log). */
export type ImagemRecusada = { recusada: string };

function u16(b: Uint8Array, i: number) {
  return (b[i] << 8) | b[i + 1];
}
function u32(b: Uint8Array, i: number) {
  return ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
}

/** Lê o cabeçalho do JPEG (marcador SOF): tamanho e canais. Não decodifica nada. */
export function lerJpeg(b: Uint8Array): { largura: number; altura: number; componentes: number; adobe: boolean } | null {
  if (!b || b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  let adobe = false;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const m = b[i + 1];
    if (m === 0xff) {
      i++;
      continue;
    }
    // Marcadores sem tamanho.
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    if (m === 0xd9 || m === 0xda) break;
    const tam = u16(b, i + 2);
    if (tam < 2 || i + 2 + tam > b.length) return null;
    // APP14 "Adobe": CMYK invertido.
    if (m === 0xee && tam >= 7 && b[i + 4] === 0x41 && b[i + 5] === 0x64 && b[i + 6] === 0x6f && b[i + 7] === 0x62 && b[i + 8] === 0x65) adobe = true;
    const ehSof = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
    if (ehSof) {
      if (tam < 8) return null;
      const altura = u16(b, i + 5);
      const largura = u16(b, i + 7);
      const componentes = b[i + 9];
      if (!largura || !altura || [1, 3, 4].indexOf(componentes) < 0) return null;
      return { largura, altura, componentes, adobe };
    }
    i += 2 + tam;
  }
  return null;
}

/** JPEG embutido como veio (DCTDecode): nenhum pixel é aberto nem recomprimido. */
export function imagemJpeg(b: Uint8Array): ImagemDoPdf | ImagemRecusada {
  const c = lerJpeg(b);
  if (!c) return { recusada: "JPEG sem cabeçalho legível." };
  const espaco = c.componentes === 1 ? "/DeviceGray" : c.componentes === 4 ? "/DeviceCMYK" : "/DeviceRGB";
  const decode = c.componentes === 4 && c.adobe ? " /Decode [1 0 1 0 1 0 1 0]" : "";
  return {
    largura: c.largura,
    altura: c.altura,
    tipo: "jpeg",
    dados: b,
    dicionario: `/Type /XObject /Subtype /Image /Width ${c.largura} /Height ${c.altura} /ColorSpace ${espaco} /BitsPerComponent 8${decode} /Filter /DCTDecode`,
  };
}

const ASSINATURA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * PNG simples embutido sem abrir: os dados comprimidos do PNG (IDAT) vão
 * direto para o PDF com o preditor do PNG. Aceita tons de cinza e RGB de 8
 * bits e paleta (1 a 8 bits), sem entrelaçamento. Com transparência (canal
 * alfa) ou 16 bits, recusa: quem chama converte para JPEG antes.
 */
export function imagemPng(b: Uint8Array): ImagemDoPdf | ImagemRecusada {
  if (!b || b.length < 33) return { recusada: "PNG vazio." };
  for (let k = 0; k < 8; k++) if (b[k] !== ASSINATURA_PNG[k]) return { recusada: "Não é PNG." };
  let i = 8;
  let largura = 0;
  let altura = 0;
  let bits = 0;
  let tipoCor = -1;
  let entrelacado = 0;
  let paleta: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let totalIdat = 0;
  while (i + 8 <= b.length) {
    const tam = u32(b, i);
    const nome = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    const ini = i + 8;
    if (ini + tam > b.length) return { recusada: "PNG cortado." };
    if (nome === "IHDR") {
      largura = u32(b, ini);
      altura = u32(b, ini + 4);
      bits = b[ini + 8];
      tipoCor = b[ini + 9];
      entrelacado = b[ini + 12];
    } else if (nome === "PLTE") {
      paleta = b.subarray(ini, ini + tam);
    } else if (nome === "IDAT") {
      idat.push(b.subarray(ini, ini + tam));
      totalIdat += tam;
    } else if (nome === "IEND") break;
    i = ini + tam + 4; // pula o CRC
  }
  if (!largura || !altura || !idat.length) return { recusada: "PNG sem imagem." };
  if (entrelacado) return { recusada: "PNG entrelaçado." };
  if (tipoCor === 4 || tipoCor === 6) return { recusada: "PNG com transparência." };
  let espaco = "";
  let cores = 1;
  if (tipoCor === 0 && bits === 8) espaco = "/DeviceGray";
  else if (tipoCor === 2 && bits === 8) {
    espaco = "/DeviceRGB";
    cores = 3;
  } else if (tipoCor === 3 && paleta && [1, 2, 4, 8].indexOf(bits) >= 0) {
    let h = "";
    for (let k = 0; k < paleta.length; k++) h += ("0" + paleta[k].toString(16)).slice(-2);
    espaco = `[/Indexed /DeviceRGB ${paleta.length / 3 - 1} <${h}>]`;
  } else return { recusada: "PNG de 16 bits ou tipo não aceito." };
  const dados = new Uint8Array(totalIdat);
  let pos = 0;
  for (const p of idat) {
    dados.set(p, pos);
    pos += p.length;
  }
  return {
    largura,
    altura,
    tipo: "png",
    dados,
    dicionario: `/Type /XObject /Subtype /Image /Width ${largura} /Height ${altura} /ColorSpace ${espaco} /BitsPerComponent ${bits} /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors ${cores} /BitsPerComponent ${bits} /Columns ${largura} >>`,
  };
}

/** JPEG ou PNG simples, pelo começo dos bytes. */
export function imagemParaPdf(b: Uint8Array): ImagemDoPdf | ImagemRecusada {
  if (b && b[0] === 0xff && b[1] === 0xd8) return imagemJpeg(b);
  if (b && b[0] === 0x89 && b[1] === 0x50) return imagemPng(b);
  return { recusada: "Formato de imagem não aceito no PDF (só JPEG e PNG)." };
}

export const ehImagemDoPdf = (x: ImagemDoPdf | ImagemRecusada | null | undefined): x is ImagemDoPdf => !!x && !(x as ImagemRecusada).recusada;

/**
 * Onde a imagem fica dentro da caixa, mantendo a proporção. "conter": cabe
 * inteira, centrada (sobra borda). "cobrir": preenche a caixa (o excesso fica
 * fora e é recortado pela caixa).
 */
export function encaixar(largura: number, altura: number, caixaL: number, caixaA: number, modo: "conter" | "cobrir" = "conter"): { x: number; y: number; w: number; h: number } {
  if (!(largura > 0) || !(altura > 0)) return { x: 0, y: 0, w: caixaL, h: caixaA };
  const escala = modo === "cobrir" ? Math.max(caixaL / largura, caixaA / altura) : Math.min(caixaL / largura, caixaA / altura);
  const w = largura * escala;
  const h = altura * escala;
  return { x: (caixaL - w) / 2, y: (caixaA - h) / 2, w, h };
}

// ------------------------------------------------------------------ página

export const LARGURA = 595.28;
export const ALTURA = 841.89;
export const ESQ = 40;
export const DIR = 555.28;
export const MIOLO = DIR - ESQ;
export const TOPO_DO_CONTEUDO = 84;
export const FIM_DO_CONTEUDO = 790;

export class Pagina {
  ops: string[] = [];
  usaLogo = false;
  rascunho = false;
  secao: string;
  /** Imagens desta página, na ordem dos nomes /Ix1, /Ix2... */
  imagens: ImagemDoPdf[] = [];
  constructor(secao: string) {
    this.secao = secao;
  }
  cor(c: Cor, preenchimento = true) {
    this.ops.push(`${n2(c[0])} ${n2(c[1])} ${n2(c[2])} ${preenchimento ? "rg" : "RG"}`);
  }
  retangulo(x: number, y: number, w: number, h: number, c: Cor) {
    this.cor(c);
    this.ops.push(`${n2(x)} ${n2(ALTURA - y - h)} ${n2(w)} ${n2(h)} re f`);
  }
  arredondado(x: number, y: number, w: number, h: number, r: number, c: Cor) {
    const k = 0.5523 * r;
    const x0 = x;
    const x1 = x + w;
    const y0 = ALTURA - y - h;
    const y1 = ALTURA - y;
    this.cor(c);
    this.ops.push(
      [
        `${n2(x0 + r)} ${n2(y0)} m`,
        `${n2(x1 - r)} ${n2(y0)} l`,
        `${n2(x1 - r + k)} ${n2(y0)} ${n2(x1)} ${n2(y0 + r - k)} ${n2(x1)} ${n2(y0 + r)} c`,
        `${n2(x1)} ${n2(y1 - r)} l`,
        `${n2(x1)} ${n2(y1 - r + k)} ${n2(x1 - r + k)} ${n2(y1)} ${n2(x1 - r)} ${n2(y1)} c`,
        `${n2(x0 + r)} ${n2(y1)} l`,
        `${n2(x0 + r - k)} ${n2(y1)} ${n2(x0)} ${n2(y1 - r + k)} ${n2(x0)} ${n2(y1 - r)} c`,
        `${n2(x0)} ${n2(y0 + r)} l`,
        `${n2(x0)} ${n2(y0 + r - k)} ${n2(x0 + r - k)} ${n2(y0)} ${n2(x0 + r)} ${n2(y0)} c`,
        "f",
      ].join("\n"),
    );
  }
  linha(x: number, y: number, w: number, c: Cor = CORES.linha, espessura = 0.65) {
    this.retangulo(x, y, w, espessura, c);
  }
  texto(x: number, y: number, t: string, fonte: Fonte, tamanho: number, c: Cor) {
    if (!t) return;
    this.cor(c);
    this.ops.push(`BT /${fonte} ${n2(tamanho)} Tf 1 0 0 1 ${n2(x)} ${n2(ALTURA - y)} Tm ${literal(t)} Tj ET`);
  }
  textoADireita(xDir: number, y: number, t: string, fonte: Fonte, tamanho: number, c: Cor) {
    this.texto(xDir - larguraDoTexto(t, fonte, tamanho), y, t, fonte, tamanho, c);
  }
  textoCentrado(xMeio: number, y: number, t: string, fonte: Fonte, tamanho: number, c: Cor) {
    this.texto(xMeio - larguraDoTexto(t, fonte, tamanho) / 2, y, t, fonte, tamanho, c);
  }
  /** Parágrafo com quebra; devolve o y depois da última linha. */
  paragrafo(x: number, y: number, t: string, fonte: Fonte, tamanho: number, c: Cor, largura: number, entrelinha: number): number {
    const linhas = quebrarLinhas(t, fonte, tamanho, largura);
    linhas.forEach((l, i) => this.texto(x, y + i * entrelinha, l, fonte, tamanho, c));
    return y + linhas.length * entrelinha;
  }
  logo(x: number, y: number, w: number) {
    const h = (w * LOGO_ALTURA) / LOGO_LARGURA;
    this.usaLogo = true;
    this.ops.push(`q ${n2(w)} 0 0 ${n2(h)} ${n2(x)} ${n2(ALTURA - y - h)} cm /Im1 Do Q`);
  }
  /** A logo da agência (dados da agência) quando há; senão a logo padrão, no mesmo lugar e na mesma altura. */
  logoOuPropria(propria: ImagemDoPdf | null | undefined, x: number, y: number, w: number) {
    if (!propria) return this.logo(x, y, w);
    this.imagem(propria, x, y, w, (w * LOGO_ALTURA) / LOGO_LARGURA, "conter");
  }
  /**
   * Imagem dentro da caixa (x, y, w, h em pontos, y a partir do topo),
   * mantendo a proporção. "cobrir" recorta o que passa da caixa. Devolve o
   * retângulo ocupado.
   */
  imagem(img: ImagemDoPdf, x: number, y: number, w: number, h: number, modo: "conter" | "cobrir" = "conter"): { x: number; y: number; w: number; h: number } {
    let k = this.imagens.indexOf(img);
    if (k < 0) {
      this.imagens.push(img);
      k = this.imagens.length - 1;
    }
    const e = encaixar(img.largura, img.altura, w, h, modo);
    const recorte = modo === "cobrir" ? `${n2(x)} ${n2(ALTURA - y - h)} ${n2(w)} ${n2(h)} re W n ` : "";
    this.ops.push(`q ${recorte}${n2(e.w)} 0 0 ${n2(e.h)} ${n2(x + e.x)} ${n2(ALTURA - y - e.y - e.h)} cm /Ix${k + 1} Do Q`);
    return modo === "cobrir" ? { x, y, w, h } : { x: x + e.x, y: y + e.y, w: e.w, h: e.h };
  }
}

// ------------------------------------------------------------------ texto e datas

export const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function dataDoDocumento(v: string | Date | undefined): Date {
  const d = v instanceof Date ? v : v ? new Date(v) : new Date();
  return isNaN(d.getTime()) ? new Date() : d;
}

export const dois = (n: number) => (n < 10 ? `0${n}` : String(n));
export const caixaAlta = (t: string) => String(t || "").toLocaleUpperCase("pt-BR");

/** Quanto ocupa um parágrafo (altura em pt). */
export const alturaDe = (t: string, fonte: Fonte, tamanho: number, largura: number, entrelinha: number) => quebrarLinhas(t, fonte, tamanho, largura).length * entrelinha;

// ------------------------------------------------------------------ documento (páginas com cabeçalho e rodapé)

export class DocumentoPdf {
  paginas: Pagina[] = [];
  y = TOPO_DO_CONTEUDO;
  cliente: string;
  rascunho: boolean;
  /** Texto da direita no cabeçalho das páginas internas (ex.: "PRODUÇÃO AUDIOVISUAL"). */
  direita: string;
  /** Logo da agência no cabeçalho (sem ela, a logo padrão embutida). */
  logoPropria: ImagemDoPdf | null;
  constructor(cliente: string, rascunho: boolean, direita: string, logoPropria: ImagemDoPdf | null = null) {
    this.cliente = cliente;
    this.rascunho = rascunho;
    this.direita = direita;
    this.logoPropria = logoPropria;
  }

  atual(): Pagina {
    return this.paginas[this.paginas.length - 1];
  }

  /** Página interna com o cabeçalho do documento modelo. */
  nova(secao: string, direita = this.direita, rascunho = this.rascunho): Pagina {
    const p = new Pagina(secao);
    p.rascunho = rascunho;
    this.paginas.push(p);
    p.retangulo(0, 0, 4, ALTURA, CORES.verde);
    p.texto(ESQ, 44, caixaAlta(this.cliente).slice(0, 48), "F2", 7.6, CORES.cinza);
    p.logoOuPropria(this.logoPropria, 242.6, 23, 110);
    p.textoADireita(DIR - 12, 44, rascunho ? `RASCUNHO  /  ${direita}` : direita, "F2", 7.6, CORES.cinza);
    p.linha(ESQ, 66, MIOLO);
    this.y = TOPO_DO_CONTEUDO;
    return p;
  }

  /** Garante espaço; sem espaço, abre página com o mesmo cabeçalho e devolve true. */
  garantir(altura: number, secao: string, continuacao?: () => void): boolean {
    if (this.y + altura <= FIM_DO_CONTEUDO) return false;
    const anterior = this.atual();
    this.nova(secao, this.direita, anterior ? anterior.rascunho : this.rascunho);
    if (continuacao) continuacao();
    return true;
  }

  /** Rodapé de todas as páginas: "CLIENTE  /  SEÇÃO" e "02 / 08". */
  rodapes() {
    const total = this.paginas.length;
    this.paginas.forEach((p, i) => {
      p.linha(ESQ, 803, MIOLO);
      p.texto(ESQ, 821, `${caixaAlta(this.cliente).slice(0, 40)}  /  ${p.secao}`, "F1", 7.2, CORES.cinza);
      p.textoADireita(DIR, 821, `${dois(i + 1)} / ${dois(total)}`, "F1", 7.2, CORES.cinza);
    });
  }
}

export function rotuloEmCima(p: Pagina, x: number, y: number, t: string, c: Cor = CORES.verdeEscuro) {
  p.texto(x, y, caixaAlta(t), "F2", 7.6, c);
}

/** Título de seção como no documento modelo: rótulo verde, título grande e traço verde. */
export function tituloDeSecao(d: DocumentoPdf, rotulo: string, titulo: string, apoio?: string) {
  const p = d.atual();
  rotuloEmCima(p, ESQ, d.y, rotulo);
  d.y += 34;
  const linhas = quebrarLinhas(titulo, "F2", 25, MIOLO);
  linhas.forEach((l, i) => p.texto(ESQ, d.y + i * 29, l, "F2", 25, CORES.tinta));
  d.y += (linhas.length - 1) * 29 + 14;
  p.retangulo(ESQ, d.y, 58, 3, CORES.verde);
  d.y += 22;
  if (apoio) d.y = p.paragrafo(ESQ, d.y, apoio, "F1", 9.2, CORES.cinza, MIOLO, 12.5) + 10;
}

// ------------------------------------------------------------------ montagem final

/**
 * Bytes do PDF. Objetos: 1 catálogo, 2 páginas, 3 F1, 4 F2, 5 logo, 6
 * máscara, 7 info, depois página e conteúdo de cada página e, por último, as
 * imagens (cada imagem uma vez, mesmo usada em várias páginas). Sem imagem, a
 * saída é a mesma do gerador antigo da Mesa Roteiros.
 */
export function montarPdf(paginas: Pagina[], info: { titulo: string; assunto: string; produtor: string }): Uint8Array {
  const partes: Uint8Array[] = [];
  const offsets: number[] = [];
  let tamanho = 0;
  const escrever = (b: Uint8Array | string) => {
    const bytes = typeof b === "string" ? bytesDoTexto(b) : b;
    partes.push(bytes);
    tamanho += bytes.length;
  };
  const primeiraPagina = 8;
  const idsDasPaginas = paginas.map((_, i) => primeiraPagina + i * 2);
  const ultimaPagina = primeiraPagina + paginas.length * 2 - 1;
  // Imagens: numeradas depois das páginas, uma vez cada.
  const idDaImagem = new Map<ImagemDoPdf, number>();
  const imagens: ImagemDoPdf[] = [];
  for (const p of paginas) {
    for (const img of p.imagens) {
      if (idDaImagem.has(img)) continue;
      idDaImagem.set(img, ultimaPagina + 1 + imagens.length);
      imagens.push(img);
    }
  }
  const total = ultimaPagina + imagens.length;
  const objeto = (n: number, corpo: Uint8Array | string) => {
    offsets[n] = tamanho;
    escrever(`${n} 0 obj\n`);
    escrever(corpo);
    escrever("\nendobj\n");
  };
  const fluxo = (n: number, dicionario: string, dados: Uint8Array) => {
    offsets[n] = tamanho;
    escrever(`${n} 0 obj\n<< ${dicionario} /Length ${dados.length} >>\nstream\n`);
    escrever(dados);
    escrever("\nendstream\nendobj\n");
  };
  escrever("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  objeto(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objeto(2, `<< /Type /Pages /Kids [${idsDasPaginas.map((n) => `${n} 0 R`).join(" ")}] /Count ${paginas.length} >>`);
  objeto(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objeto(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const rgb = deBase64(LOGO_RGB_ZLIB_B64);
  const mascara = deBase64(LOGO_MASCARA_ZLIB_B64);
  fluxo(5, `/Type /XObject /Subtype /Image /Width ${LOGO_LARGURA} /Height ${LOGO_ALTURA} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /SMask 6 0 R`, rgb);
  fluxo(6, `/Type /XObject /Subtype /Image /Width ${LOGO_LARGURA} /Height ${LOGO_ALTURA} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, mascara);
  objeto(7, `<< /Title ${literal(info.titulo)} /Subject ${literal(info.assunto)} /Producer ${literal(info.produtor)} /Creator ${literal("Aceleriq OS")} >>`);
  paginas.forEach((p, i) => {
    const idPagina = idsDasPaginas[i];
    const conteudo = p.ops.join("\n");
    const extras = p.imagens.map((img, k) => ` /Ix${k + 1} ${idDaImagem.get(img)} 0 R`).join("");
    objeto(
      idPagina,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LARGURA} ${ALTURA}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Im1 5 0 R${extras} >> >> /Contents ${idPagina + 1} 0 R >>`,
    );
    objeto(idPagina + 1, `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`);
  });
  imagens.forEach((img) => fluxo(idDaImagem.get(img)!, img.dicionario, img.dados));
  const inicioXref = tamanho;
  let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= total; n++) xref += `${("0000000000" + (offsets[n] || 0)).slice(-10)} 00000 n \n`;
  escrever(xref);
  escrever(`trailer\n<< /Size ${total + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`);
  const saida = new Uint8Array(tamanho);
  let pos = 0;
  for (const b of partes) {
    saida.set(b, pos);
    pos += b.length;
  }
  return saida;
}

// ------------------------------------------------------------------ leitura (testes e conferência)

function latin1(bytes: Uint8Array): string {
  let bruto = "";
  for (let i = 0; i < bytes.length; i++) bruto += String.fromCharCode(bytes[i]);
  return bruto;
}

/**
 * Textos das páginas, na ordem em que foram desenhados (lê os literais dos
 * fluxos, que ficam sem compressão). Serve para conferir que o PDF tem os
 * blocos, sem depender de leitor de PDF.
 */
export function textosDoPdf(bytes: Uint8Array): string[] {
  const bruto = latin1(bytes);
  const saida: string[] = [];
  const re = /\((.*?[^\\])\) Tj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bruto))) {
    const lit = m[1];
    let s = "";
    for (let k = 0; k < lit.length; k++) {
      const c = lit.charAt(k);
      if (c !== "\\") {
        s += c;
        continue;
      }
      const prox = lit.charAt(k + 1);
      if (/[0-7]/.test(prox)) {
        const cod = parseInt(lit.substr(k + 1, 3), 8);
        s += String.fromCharCode(UNICODE_DO_WIN_ANSI[cod] || cod);
        k += 3;
      } else {
        s += prox;
        k += 1;
      }
    }
    saida.push(s);
  }
  return saida;
}

/** Quantas páginas o PDF tem (conta os objetos de página). */
export function paginasDoPdf(bytes: Uint8Array): number {
  const m = /\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(latin1(bytes));
  return m ? Number(m[1]) : 0;
}

/** Imagens embutidas (sem contar a logo e a máscara dela): tamanho e filtro de cada uma. */
export function imagensDoPdf(bytes: Uint8Array): Array<{ largura: number; altura: number; filtro: string }> {
  const bruto = latin1(bytes);
  const saida: Array<{ largura: number; altura: number; filtro: string }> = [];
  const re = /(\d+) 0 obj\n<< \/Type \/XObject \/Subtype \/Image \/Width (\d+) \/Height (\d+)[^\n]*?\/Filter \/(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bruto))) {
    if (m[1] === "5" || m[1] === "6") continue;
    saida.push({ largura: Number(m[2]), altura: Number(m[3]), filtro: m[4] });
  }
  return saida;
}
