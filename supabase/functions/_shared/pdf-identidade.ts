/**
 * PDFs da Mesa Identidade (frente IDV, 30/09/2026): o brandbook nos dois
 * modelos (prancha-resumo vertical e brandbook de 24 páginas em A4 deitado)
 * e o PDF dos finalistas do naming.
 *
 * Gerador próprio, sem dependência (a frente DOC ainda não tem o
 * `_shared/pdf-base.ts` no main): as fontes padrão do PDF (Helvetica e
 * Helvetica Bold, WinAnsi, com as métricas de pdf-roteiro.ts) e imagens:
 * - PNG (a prévia da logo, com transparência): o PNG é aberto aqui
 *   (inflar, desfazer os filtros das linhas) e vira RGB + máscara de
 *   transparência, para a logo ficar certa sobre qualquer cor de fundo;
 * - JPEG (mockups e fotos): entra como está (DCTDecode).
 * Abrir o PNG usa o DecompressionStream (Deno e navegadores atuais). Onde ele
 * não existe, a logo vira um quadro com o nome do arquivo: nunca uma imagem
 * inventada. A logo é sempre o arquivo real da equipe (logo pelo código).
 *
 * `prepararImagens` é assíncrona (abre os arquivos); `gerarPdfDoBrandbook` e
 * `gerarPdfDoNaming` são síncronas e rodam em milissegundos, no navegador
 * (Baixar) e na função (enviar para aprovação). Sem travessão.
 */

import { larguraDoTexto, paraWinAnsi, quebrarLinhas, type Fonte } from "./pdf-roteiro.ts";
import { LOGO_ALTURA, LOGO_LARGURA, LOGO_MASCARA_ZLIB_B64, LOGO_RGB_ZLIB_B64 } from "./pdf-logo-aceleriq.ts";
import { type DadosDoBrandbook, estadoDoModelo, arquivosEntregues, coresDoBrandbook, type LogoDoBrandbook, type ModeloDoBrandbook, PAGINAS_DO_BRANDBOOK, SLOTS_DE_LOGO } from "./brandbook.ts";
import { contraste, type FichaDaCor, hexParaRgb, luminanciaRelativa, rgbParaLab, nivelDoContraste, proporcaoDeUso, PERFIS, ROTULO_DO_PAPEL_DA_COR, textoCmyk, textoRgb } from "./cores-da-marca.ts";
import { type CandidatoDeNome, rotuloDaTecnica, textoDoDominio } from "./naming.ts";

// ------------------------------------------------------------------ imagens

export type ImagemDoPdf = {
  largura: number;
  altura: number;
  /** Dados já no formato do filtro (Flate para PNG, DCT para JPEG); sem filtro quando não deu para comprimir. */
  dados: Uint8Array;
  filtro: "FlateDecode" | "DCTDecode" | null;
  espaco: "DeviceRGB" | "DeviceGray";
  /** Máscara de transparência (cinza 8 bits), no mesmo filtro dos dados. */
  mascara: { dados: Uint8Array; filtro: "FlateDecode" | null } | null;
};

async function lerTudo(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const leitor = stream.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    if (value) {
      partes.push(value);
      total += value.length;
    }
  }
  const saida = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    saida.set(p, pos);
    pos += p.length;
  }
  return saida;
}

function fluxoDe(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
}

/** zlib (RFC 1950) -> bytes. Null quando o ambiente não tem DecompressionStream. */
export async function inflar(bytes: Uint8Array): Promise<Uint8Array | null> {
  const DS = (globalThis as { DecompressionStream?: new (f: string) => TransformStream<Uint8Array, Uint8Array> }).DecompressionStream;
  if (!DS) return null;
  return await lerTudo(fluxoDe(bytes).pipeThrough(new DS("deflate")));
}

/** bytes -> zlib (RFC 1950). Null quando o ambiente não tem CompressionStream. */
export async function comprimir(bytes: Uint8Array): Promise<Uint8Array | null> {
  const CS = (globalThis as { CompressionStream?: new (f: string) => TransformStream<Uint8Array, Uint8Array> }).CompressionStream;
  if (!CS) return null;
  return await lerTudo(fluxoDe(bytes).pipeThrough(new CS("deflate")));
}

const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

export function ehPng(b: Uint8Array): boolean {
  return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

export function ehJpeg(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0xff && b[1] === 0xd8;
}

/** Largura, altura e canais de um JPEG (marcador SOF). */
export function medidasDoJpeg(b: Uint8Array): { largura: number; altura: number; canais: number } | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const m = b[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    const tam = (b[i + 2] << 8) | b[i + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { altura: (b[i + 5] << 8) | b[i + 6], largura: (b[i + 7] << 8) | b[i + 8], canais: b[i + 9] };
    }
    i += 2 + tam;
  }
  return null;
}

/**
 * PNG (8 bits; cinza, RGB, paleta, com ou sem transparência; sem
 * entrelaçamento) em pixels RGB e alfa. Null no que não é suportado.
 */
export async function abrirPng(b: Uint8Array): Promise<{ largura: number; altura: number; rgb: Uint8Array; alfa: Uint8Array | null } | null> {
  if (!ehPng(b)) return null;
  let i = 8;
  let largura = 0;
  let altura = 0;
  let profundidade = 0;
  let tipo = 0;
  let entrelacado = 0;
  let paleta: Uint8Array | null = null;
  let transp: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let totalIdat = 0;
  while (i + 8 <= b.length) {
    const tam = u32(b, i);
    const nome = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    const dados = b.subarray(i + 8, i + 8 + tam);
    if (nome === "IHDR") {
      largura = u32(dados, 0);
      altura = u32(dados, 4);
      profundidade = dados[8];
      tipo = dados[9];
      entrelacado = dados[12];
    } else if (nome === "PLTE") paleta = dados;
    else if (nome === "tRNS") transp = dados;
    else if (nome === "IDAT") {
      idat.push(dados);
      totalIdat += dados.length;
    } else if (nome === "IEND") break;
    i += 12 + tam;
  }
  if (!largura || !altura || profundidade !== 8 || entrelacado !== 0) return null;
  if (largura * altura > 4_000_000) return null;
  const canais = tipo === 0 ? 1 : tipo === 2 ? 3 : tipo === 3 ? 1 : tipo === 4 ? 2 : tipo === 6 ? 4 : 0;
  if (!canais || (tipo === 3 && !paleta)) return null;
  const junto = new Uint8Array(totalIdat);
  let pos = 0;
  for (const p of idat) {
    junto.set(p, pos);
    pos += p.length;
  }
  const cru = await inflar(junto);
  if (!cru) return null;
  const linha = largura * canais;
  if (cru.length < (linha + 1) * altura) return null;
  const px = new Uint8Array(linha * altura);
  const bpp = canais;
  for (let y = 0; y < altura; y++) {
    const filtro = cru[y * (linha + 1)];
    const ini = y * (linha + 1) + 1;
    const destino = y * linha;
    for (let x = 0; x < linha; x++) {
      const bruto = cru[ini + x];
      const a = x >= bpp ? px[destino + x - bpp] : 0;
      const c = y > 0 ? px[destino - linha + x] : 0;
      const ac = y > 0 && x >= bpp ? px[destino - linha + x - bpp] : 0;
      let v = bruto;
      if (filtro === 1) v = bruto + a;
      else if (filtro === 2) v = bruto + c;
      else if (filtro === 3) v = bruto + ((a + c) >> 1);
      else if (filtro === 4) {
        const p = a + c - ac;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - c);
        const pc = Math.abs(p - ac);
        v = bruto + (pa <= pb && pa <= pc ? a : pb <= pc ? c : ac);
      }
      px[destino + x] = v & 255;
    }
  }
  const n = largura * altura;
  const rgb = new Uint8Array(n * 3);
  const alfa = new Uint8Array(n);
  let temAlfa = false;
  for (let k = 0; k < n; k++) {
    let r = 0;
    let g = 0;
    let bl = 0;
    let al = 255;
    if (tipo === 0) {
      r = g = bl = px[k];
      if (transp && transp.length >= 2 && px[k] === transp[1]) al = 0;
    } else if (tipo === 2) {
      r = px[k * 3];
      g = px[k * 3 + 1];
      bl = px[k * 3 + 2];
      if (transp && transp.length >= 6 && r === transp[1] && g === transp[3] && bl === transp[5]) al = 0;
    } else if (tipo === 3) {
      const idx = px[k];
      r = paleta![idx * 3] || 0;
      g = paleta![idx * 3 + 1] || 0;
      bl = paleta![idx * 3 + 2] || 0;
      if (transp && idx < transp.length) al = transp[idx];
    } else if (tipo === 4) {
      r = g = bl = px[k * 2];
      al = px[k * 2 + 1];
    } else {
      r = px[k * 4];
      g = px[k * 4 + 1];
      bl = px[k * 4 + 2];
      al = px[k * 4 + 3];
    }
    rgb[k * 3] = r;
    rgb[k * 3 + 1] = g;
    rgb[k * 3 + 2] = bl;
    alfa[k] = al;
    if (al < 255) temAlfa = true;
  }
  return { largura, altura, rgb, alfa: temAlfa ? alfa : null };
}

/** Um arquivo (PNG ou JPEG) pronto para o PDF. Null no que não dá para usar. */
export async function imagemParaPdf(bytes: Uint8Array): Promise<ImagemDoPdf | null> {
  if (ehJpeg(bytes)) {
    const m = medidasDoJpeg(bytes);
    if (!m || (m.canais !== 1 && m.canais !== 3)) return null;
    return { largura: m.largura, altura: m.altura, dados: bytes, filtro: "DCTDecode", espaco: m.canais === 1 ? "DeviceGray" : "DeviceRGB", mascara: null };
  }
  const png = await abrirPng(bytes).catch(() => null);
  if (!png) return null;
  const rgbZ = await comprimir(png.rgb).catch(() => null);
  const alfaZ = png.alfa ? await comprimir(png.alfa).catch(() => null) : null;
  return {
    largura: png.largura,
    altura: png.altura,
    dados: rgbZ || png.rgb,
    filtro: rgbZ ? "FlateDecode" : null,
    espaco: "DeviceRGB",
    mascara: png.alfa ? { dados: alfaZ || png.alfa, filtro: alfaZ ? "FlateDecode" : null } : null,
  };
}

/** Abre vários arquivos (caminho -> bytes) de uma vez; o que falhar fica de fora. */
export async function prepararImagens(arquivos: Record<string, Uint8Array>): Promise<Record<string, ImagemDoPdf>> {
  const saida: Record<string, ImagemDoPdf> = {};
  for (const caminho of Object.keys(arquivos)) {
    const img = await imagemParaPdf(arquivos[caminho]).catch(() => null);
    if (img) saida[caminho] = img;
  }
  return saida;
}

// ------------------------------------------------------------------ desenho

type Cor = [number, number, number];
const cor = (h: string): Cor => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const n2 = (v: number) => (Math.round(v * 100) / 100).toString();

function literal(t: string): string {
  let s = "(";
  for (const c of paraWinAnsi(t)) {
    if (c === 0x28 || c === 0x29 || c === 0x5c) s += `\\${String.fromCharCode(c)}`;
    else if (c < 32 || c > 126) s += `\\${("00" + c.toString(8)).slice(-3)}`;
    else s += String.fromCharCode(c);
  }
  return `${s})`;
}

function bytesDoTexto(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

function deBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}

const caixaAlta = (t: string) => String(t || "").toLocaleUpperCase("pt-BR");
const dois = (n: number) => (n < 10 ? `0${n}` : String(n));
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

class Pagina {
  ops: string[] = [];
  usaLogo = false;
  imagens: string[] = [];
  largura: number;
  altura: number;
  constructor(largura: number, altura: number) {
    this.largura = largura;
    this.altura = altura;
  }
  preencher(c: Cor) {
    this.ops.push(`${n2(c[0])} ${n2(c[1])} ${n2(c[2])} rg`);
  }
  traco(c: Cor, espessura = 0.6) {
    this.ops.push(`${n2(c[0])} ${n2(c[1])} ${n2(c[2])} RG ${n2(espessura)} w`);
  }
  retangulo(x: number, y: number, w: number, h: number, c: Cor) {
    this.preencher(c);
    this.ops.push(`${n2(x)} ${n2(this.altura - y - h)} ${n2(w)} ${n2(h)} re f`);
  }
  contorno(x: number, y: number, w: number, h: number, c: Cor, espessura = 0.6, tracejado = false) {
    this.ops.push("q");
    this.traco(c, espessura);
    if (tracejado) this.ops.push("[4 3] 0 d");
    this.ops.push(`${n2(x)} ${n2(this.altura - y - h)} ${n2(w)} ${n2(h)} re S Q`);
  }
  linha(x1: number, y1: number, x2: number, y2: number, c: Cor, espessura = 0.6) {
    this.ops.push("q");
    this.traco(c, espessura);
    this.ops.push(`${n2(x1)} ${n2(this.altura - y1)} m ${n2(x2)} ${n2(this.altura - y2)} l S Q`);
  }
  arredondado(x: number, y: number, w: number, h: number, r: number, c: Cor) {
    const k = 0.5523 * r;
    const x0 = x;
    const x1 = x + w;
    const y0 = this.altura - y - h;
    const y1 = this.altura - y;
    this.preencher(c);
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
  circulo(cx: number, cy: number, r: number, c: Cor) {
    this.arredondado(cx - r, cy - r, 2 * r, 2 * r, r, c);
  }
  texto(x: number, y: number, t: string, fonte: Fonte, tamanho: number, c: Cor) {
    if (!t) return;
    this.preencher(c);
    this.ops.push(`BT /${fonte} ${n2(tamanho)} Tf 1 0 0 1 ${n2(x)} ${n2(this.altura - y)} Tm ${literal(t)} Tj ET`);
  }
  textoADireita(xDir: number, y: number, t: string, fonte: Fonte, tamanho: number, c: Cor) {
    this.texto(xDir - larguraDoTexto(t, fonte, tamanho), y, t, fonte, tamanho, c);
  }
  textoCentrado(xMeio: number, y: number, t: string, fonte: Fonte, tamanho: number, c: Cor) {
    this.texto(xMeio - larguraDoTexto(t, fonte, tamanho) / 2, y, t, fonte, tamanho, c);
  }
  /** Parágrafo com quebra, até `maxLinhas`; devolve o y depois da última linha. */
  paragrafo(x: number, y: number, t: string, fonte: Fonte, tamanho: number, c: Cor, largura: number, entrelinha: number, maxLinhas = 60): number {
    let linhas = quebrarLinhas(t, fonte, tamanho, largura);
    if (linhas.length > maxLinhas) {
      linhas = linhas.slice(0, maxLinhas);
      linhas[maxLinhas - 1] = `${linhas[maxLinhas - 1].replace(/\s+\S*$/, "")}...`;
    }
    linhas.forEach((l, i) => this.texto(x, y + i * entrelinha, l, fonte, tamanho, c));
    return y + linhas.length * entrelinha;
  }
  logoAceleriq(x: number, y: number, w: number) {
    const h = (w * LOGO_ALTURA) / LOGO_LARGURA;
    this.usaLogo = true;
    this.ops.push(`q ${n2(w)} 0 0 ${n2(h)} ${n2(x)} ${n2(this.altura - y - h)} cm /Im0 Do Q`);
  }
  imagem(nome: string, x: number, y: number, w: number, h: number) {
    if (this.imagens.indexOf(nome) < 0) this.imagens.push(nome);
    this.ops.push(`q ${n2(w)} 0 0 ${n2(h)} ${n2(x)} ${n2(this.altura - y - h)} cm /${nome} Do Q`);
  }
}

class Documento {
  paginas: Pagina[] = [];
  /** caminho -> nome no PDF (Im1, Im2...). */
  nomes: Record<string, string> = {};
  imagens: Record<string, ImagemDoPdf>;
  constructor(imagens: Record<string, ImagemDoPdf>) {
    this.imagens = imagens;
  }
  nova(largura: number, altura: number): Pagina {
    const p = new Pagina(largura, altura);
    this.paginas.push(p);
    return p;
  }
  nomeDa(caminho: string | null | undefined): string | null {
    if (!caminho || !this.imagens[caminho]) return null;
    if (!this.nomes[caminho]) this.nomes[caminho] = `Im${Object.keys(this.nomes).length + 1}`;
    return this.nomes[caminho];
  }
  /** Desenha a imagem inteira dentro da caixa, centrada; sem imagem, devolve false. */
  encaixar(p: Pagina, caminho: string | null | undefined, x: number, y: number, w: number, h: number, preencherCaixa = false): boolean {
    const nome = this.nomeDa(caminho);
    if (!nome || !caminho) return false;
    const img = this.imagens[caminho];
    const escala = preencherCaixa ? Math.max(w / img.largura, h / img.altura) : Math.min(w / img.largura, h / img.altura);
    const iw = img.largura * escala;
    const ih = img.altura * escala;
    if (preencherCaixa) {
      // Recorte na caixa (sangria), sem distorcer.
      p.ops.push(`q ${n2(x)} ${n2(p.altura - y - h)} ${n2(w)} ${n2(h)} re W n`);
      p.imagem(nome, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
      p.ops.push("Q");
    } else p.imagem(nome, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
    return true;
  }
}

function montarBytes(d: Documento, titulo: string, assunto: string): Uint8Array {
  const partes: Uint8Array[] = [];
  const offsets: number[] = [];
  let tamanho = 0;
  const escrever = (b: Uint8Array | string) => {
    const bytes = typeof b === "string" ? bytesDoTexto(b) : b;
    partes.push(bytes);
    tamanho += bytes.length;
  };
  const objetoComFluxo = (n: number, dicionario: string, fluxo: Uint8Array) => {
    offsets[n] = tamanho;
    escrever(`${n} 0 obj\n<< ${dicionario} /Length ${fluxo.length} >>\nstream\n`);
    escrever(fluxo);
    escrever("\nendstream\nendobj\n");
  };
  const objeto = (n: number, corpo: string) => {
    offsets[n] = tamanho;
    escrever(`${n} 0 obj\n${corpo}\nendobj\n`);
  };
  // 1 catálogo, 2 páginas, 3 F1, 4 F2, 5 logo Aceleriq, 6 máscara, 7 info, depois imagens (+ máscaras) e páginas.
  const usadas = Object.keys(d.nomes);
  let proximo = 8;
  const idDaImagem: Record<string, number> = {};
  const idDaMascara: Record<string, number> = {};
  for (const caminho of usadas) {
    idDaImagem[caminho] = proximo++;
    if (d.imagens[caminho].mascara) idDaMascara[caminho] = proximo++;
  }
  const idsDasPaginas = d.paginas.map(() => {
    const id = proximo;
    proximo += 2;
    return id;
  });
  const total = proximo - 1;
  escrever("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  objeto(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objeto(2, `<< /Type /Pages /Kids [${idsDasPaginas.map((n) => `${n} 0 R`).join(" ")}] /Count ${d.paginas.length} >>`);
  objeto(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objeto(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  objetoComFluxo(5, `/Type /XObject /Subtype /Image /Width ${LOGO_LARGURA} /Height ${LOGO_ALTURA} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /SMask 6 0 R`, deBase64(LOGO_RGB_ZLIB_B64));
  objetoComFluxo(6, `/Type /XObject /Subtype /Image /Width ${LOGO_LARGURA} /Height ${LOGO_ALTURA} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, deBase64(LOGO_MASCARA_ZLIB_B64));
  objeto(7, `<< /Title ${literal(titulo)} /Subject ${literal(assunto)} /Producer ${literal("Aceleriq OS, Mesa Identidade")} /Creator ${literal("Aceleriq OS")} >>`);
  for (const caminho of usadas) {
    const img = d.imagens[caminho];
    const filtro = img.filtro ? ` /Filter /${img.filtro}` : "";
    const smask = img.mascara ? ` /SMask ${idDaMascara[caminho]} 0 R` : "";
    objetoComFluxo(idDaImagem[caminho], `/Type /XObject /Subtype /Image /Width ${img.largura} /Height ${img.altura} /ColorSpace /${img.espaco} /BitsPerComponent 8${filtro}${smask}`, img.dados);
    if (img.mascara) {
      const fm = img.mascara.filtro ? ` /Filter /${img.mascara.filtro}` : "";
      objetoComFluxo(idDaMascara[caminho], `/Type /XObject /Subtype /Image /Width ${img.largura} /Height ${img.altura} /ColorSpace /DeviceGray /BitsPerComponent 8${fm}`, img.mascara.dados);
    }
  }
  d.paginas.forEach((p, i) => {
    const id = idsDasPaginas[i];
    const xobjetos = [`/Im0 5 0 R`].concat(p.imagens.map((nome) => {
      const caminho = usadas.filter((c) => d.nomes[c] === nome)[0];
      return `/${nome} ${idDaImagem[caminho]} 0 R`;
    }));
    objeto(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n2(p.largura)} ${n2(p.altura)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ${xobjetos.join(" ")} >> >> /Contents ${id + 1} 0 R >>`);
    const conteudo = bytesDoTexto(p.ops.join("\n"));
    offsets[id + 1] = tamanho;
    escrever(`${id + 1} 0 obj\n<< /Length ${conteudo.length} >>\nstream\n`);
    escrever(conteudo);
    escrever("\nendstream\nendobj\n");
  });
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

// ------------------------------------------------------------------ tema da marca

type Tema = { primaria: Cor; primariaHex: string; acentoNoEscuro: Cor; escura: Cor; escuraHex: string; clara: Cor; tinta: Cor; cinza: Cor; linha: Cor; poco: Cor; branco: Cor };

const PESO_DO_PAPEL: Record<string, number> = { primaria: 3, destaque: 2, secundaria: 1, neutra: 0 };

/**
 * A cor da marca que serve de acento sobre um fundo: legível (contraste de
 * 2,2 ou mais), de preferência primária e com cor de verdade (croma alto).
 * Sem nenhuma, o acento é o texto (preto ou branco).
 */
export function acentoSobre(fundo: string, cores: FichaDaCor[]): string {
  let melhor: { hex: string; nota: number } | null = null;
  for (const c of cores) {
    if (contraste(c.hex, fundo) < 2.2) continue;
    const lab = rgbParaLab(hexParaRgb(c.hex));
    const croma = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
    const nota = (PESO_DO_PAPEL[c.papel] || 0) + Math.min(croma, 80) / 20;
    if (!melhor || nota > melhor.nota) melhor = { hex: c.hex, nota };
  }
  if (melhor) return melhor.hex;
  return luminanciaRelativa(fundo) < 0.2 ? "#FFFFFF" : "#157330";
}

/**
 * Tema visual do brandbook (IDV2) no PDF: o PDF é para imprimir, então as
 * páginas ficam claras em todos; muda o acento e a capa. Editorial e minimal
 * usam acento escuro (a cor da marca fica nas amostras); vibrante pinta a
 * capa com a primária quando ela segura texto branco.
 */
function temaDa(cores: FichaDaCor[], tema?: string): Tema {
  const ordenadas = cores.slice().sort((a, b) => luminanciaRelativa(a.hex) - luminanciaRelativa(b.hex));
  let escura = ordenadas[0] && luminanciaRelativa(ordenadas[0].hex) < 0.06 ? ordenadas[0].hex : "#151B17";
  const clara = ordenadas.length && luminanciaRelativa(ordenadas[ordenadas.length - 1].hex) > 0.8 ? ordenadas[ordenadas.length - 1].hex : "#F4F6F4";
  let acento = acentoSobre("#FFFFFF", cores);
  if (tema === "editorial") acento = escura;
  if (tema === "minimal") acento = "#151B17";
  if (tema === "vibrante") {
    const prim = cores.filter((c) => c.papel === "primaria")[0];
    if (prim && contraste(prim.hex, "#FFFFFF") >= 3) escura = prim.hex;
  }
  return {
    primaria: cor(acento),
    primariaHex: acento,
    acentoNoEscuro: cor(acentoSobre(escura, cores)),
    escura: cor(escura),
    escuraHex: escura,
    clara: cor(clara),
    tinta: cor("#151B17"),
    cinza: cor("#626D66"),
    linha: cor("#DFE5DF"),
    poco: cor("#F4F6F4"),
    branco: cor("#FFFFFF"),
  };
}

function dataPorExtenso(d: Date): string {
  return `${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

// ------------------------------------------------------------------ brandbook

export type EntradaDoBrandbook = {
  modelo: ModeloDoBrandbook;
  dados: DadosDoBrandbook;
  versao: number;
  /** caminho (bucket mesa) -> imagem pronta (prepararImagens). */
  imagens: Record<string, ImagemDoPdf>;
  data?: Date | string;
};

const L = 841.89;
const A = 595.28;
const MX = 48;

function rotuloDaLogo(l: LogoDoBrandbook | null, padrao: string): string {
  return l ? l.rotulo || padrao : padrao;
}

/** Caixa de logo: a prévia real sobre o fundo pedido, ou o quadro "falta a logo". */
function caixaDeLogo(d: Documento, p: Pagina, t: Tema, l: LogoDoBrandbook | null, x: number, y: number, w: number, h: number, fundo: Cor, respiro = 0.18) {
  p.arredondado(x, y, w, h, 8, fundo);
  const m = Math.min(w, h) * respiro;
  const ok = l ? d.encaixar(p, l.previa_png || l.caminho, x + m, y + m, w - 2 * m, h - 2 * m) : false;
  if (!ok) {
    const escuro = (fundo[0] + fundo[1] + fundo[2]) / 3 < 0.5;
    p.textoCentrado(x + w / 2, y + h / 2, l ? "Logo em arquivo (SVG no pacote)" : "Falta a logo", "F1", 9, escuro ? t.branco : t.cinza);
  }
}

function cabecalho(p: Pagina, t: Tema, n: number, titulo: string, marca: string) {
  p.retangulo(0, 0, L, 5, t.primaria);
  p.texto(MX, 50, dois(n), "F2", 11, t.primaria);
  p.texto(MX + 26, 50, caixaAlta(titulo), "F2", 11, t.tinta);
  p.textoADireita(L - MX, 50, caixaAlta(marca).slice(0, 40), "F1", 8, t.cinza);
  p.linha(MX, 64, L - MX, 64, t.linha);
}

function rodape(p: Pagina, t: Tema, n: number, total: number, marca: string) {
  p.linha(MX, A - 40, L - MX, A - 40, t.linha);
  p.texto(MX, A - 24, `Manual da marca  /  ${marca}`.slice(0, 80), "F1", 7.5, t.cinza);
  p.texto(L / 2 - 36, A - 24, "feito pela", "F1", 7, t.cinza);
  p.logoAceleriq(L / 2 + 2, A - 32, 40);
  p.textoADireita(L - MX, A - 24, `${dois(n)} / ${dois(total)}`, "F1", 7.5, t.cinza);
}

function tituloGrande(p: Pagina, t: Tema, x: number, y: number, texto: string, largura: number): number {
  return p.paragrafo(x, y, texto, "F2", 26, t.tinta, largura, 30, 3);
}

function blocoDeTexto(p: Pagina, t: Tema, x: number, y: number, rotulo: string, valor: string, largura: number, maxLinhas = 8): number {
  p.texto(x, y, caixaAlta(rotulo), "F2", 8, t.primaria);
  if (!valor) {
    p.texto(x, y + 16, "A preencher.", "F1", 10, t.cinza);
    return y + 32;
  }
  return p.paragrafo(x, y + 16, valor, "F1", 10.5, t.tinta, largura, 15, maxLinhas) + 10;
}

function listaComMarcador(p: Pagina, t: Tema, x: number, y: number, itens: string[], largura: number, tamanho = 10.5): number {
  let yy = y;
  for (const i of itens) {
    p.circulo(x + 3, yy - 3.5, 2.2, t.primaria);
    yy = p.paragrafo(x + 12, yy, i, "F1", tamanho, t.tinta, largura - 12, tamanho + 4, 3) + 4;
  }
  return yy;
}

function chips(p: Pagina, t: Tema, x: number, y: number, itens: string[], largura: number): number {
  let cx = x;
  let cy = y;
  for (const i of itens) {
    const w = larguraDoTexto(i, "F2", 9.5) + 20;
    if (cx + w > x + largura) {
      cx = x;
      cy += 28;
    }
    p.arredondado(cx, cy, w, 22, 11, t.poco);
    p.texto(cx + 10, cy + 14.5, i, "F2", 9.5, t.tinta);
    cx += w + 8;
  }
  return cy + 30;
}

function paginaDoBrandbook(d: Documento, t: Tema, dados: DadosDoBrandbook, id: string, n: number, titulo: string, versao: number, data: Date, cores: FichaDaCor[]) {
  const p = d.nova(L, A);
  const marca = dados.marca.nome || "Marca";
  const larg = L - 2 * MX;
  if (id === "capa") {
    p.retangulo(0, 0, L, A, t.escura);
    p.retangulo(0, 0, 10, A, t.primaria);
    caixaDeLogo(d, p, t, dados.logos.principal, L / 2 - 170, 120, 340, 180, t.escura, 0.08);
    p.textoCentrado(L / 2, 360, "MANUAL DA MARCA", "F2", 30, t.branco);
    if (dados.marca.slogan) p.textoCentrado(L / 2, 392, dados.marca.slogan.slice(0, 90), "F1", 12, t.branco);
    p.textoCentrado(L / 2, A - 70, `Versão ${versao}  /  ${dataPorExtenso(data)}`, "F1", 9, t.branco);
    p.arredondado(L / 2 - 58, A - 60, 116, 26, 13, t.branco);
    p.texto(L / 2 - 46, A - 43, "feito pela", "F1", 8, t.cinza);
    p.logoAceleriq(L / 2 - 4, A - 55, 52);
    return;
  }
  cabecalho(p, t, n, titulo, marca);
  const topo = 104;
  switch (id) {
    case "sumario": {
      tituloGrande(p, t, MX, topo + 10, "Sumário", 300);
      const col = (larg - 40) / 2;
      PAGINAS_DO_BRANDBOOK.forEach((pg, i) => {
        const c = i < 12 ? 0 : 1;
        const y = topo + 70 + (i % 12) * 28;
        const x = MX + c * (col + 40);
        p.texto(x, y, dois(pg.n), "F2", 10, t.primaria);
        p.texto(x + 28, y, pg.titulo, "F1", 10.5, t.tinta);
        p.linha(x, y + 9, x + col, y + 9, t.linha, 0.4);
      });
      break;
    }
    case "apresentacao": {
      tituloGrande(p, t, MX, topo + 10, marca, 360);
      let y = topo + 60;
      y = blocoDeTexto(p, t, MX, y, "Propósito", dados.plataforma.proposito, 340);
      y = blocoDeTexto(p, t, MX, y + 6, "Para quem", dados.plataforma.publico, 340);
      blocoDeTexto(p, t, MX + 400, topo + 60, "A ideia da marca", dados.conceito.resumo, larg - 400, 16);
      break;
    }
    case "plataforma": {
      tituloGrande(p, t, MX, topo + 10, "Plataforma da marca", 500);
      const w = (larg - 40) / 3;
      blocoDeTexto(p, t, MX, topo + 64, "Missão", dados.plataforma.missao, w, 10);
      blocoDeTexto(p, t, MX + w + 20, topo + 64, "Visão", dados.plataforma.visao, w, 10);
      p.texto(MX + 2 * (w + 20), topo + 64, "VALORES", "F2", 8, t.primaria);
      listaComMarcador(p, t, MX + 2 * (w + 20), topo + 84, dados.plataforma.valores.length ? dados.plataforma.valores : ["A preencher."], w);
      p.texto(MX, topo + 300, "PERSONALIDADE", "F2", 8, t.primaria);
      chips(p, t, MX, topo + 312, dados.plataforma.personalidade.length ? dados.plataforma.personalidade : ["A preencher"], larg * 0.6);
      if (dados.plataforma.arquetipo) blocoDeTexto(p, t, MX + larg * 0.66, topo + 300, "Arquétipo", dados.plataforma.arquetipo, larg * 0.34);
      break;
    }
    case "tom": {
      tituloGrande(p, t, MX, topo + 10, "Tom de voz", 400);
      const w = (larg - 30) / 2;
      p.texto(MX, topo + 64, "COMO A MARCA FALA", "F2", 8, t.primaria);
      listaComMarcador(p, t, MX, topo + 84, dados.tom.como_fala.length ? dados.tom.como_fala : ["A preencher."], w);
      p.texto(MX + w + 30, topo + 64, "COMO A MARCA NÃO FALA", "F2", 8, t.primaria);
      listaComMarcador(p, t, MX + w + 30, topo + 84, dados.tom.como_nao_fala.length ? dados.tom.como_nao_fala : ["A preencher."], w);
      let y = topo + 280;
      for (const e of dados.tom.exemplos.slice(0, 3)) {
        p.arredondado(MX, y - 14, w, 40, 6, t.poco);
        p.texto(MX + 10, y, "Assim", "F2", 8, t.primaria);
        p.paragrafo(MX + 60, y, e.certo, "F1", 9.5, t.tinta, w - 70, 12, 2);
        p.arredondado(MX + w + 30, y - 14, w, 40, 6, t.poco);
        p.texto(MX + w + 40, y, "Não assim", "F2", 8, t.cinza);
        p.paragrafo(MX + w + 100, y, e.errado, "F1", 9.5, t.cinza, w - 110, 12, 2);
        y += 52;
      }
      break;
    }
    case "conceito": {
      tituloGrande(p, t, MX, topo + 10, "Conceito do logo", 360);
      const y = blocoDeTexto(p, t, MX, topo + 64, "Significado", dados.conceito.significado_do_logo, 360, 14);
      if (dados.conceito.palavras.length) chips(p, t, MX, y + 8, dados.conceito.palavras, 360);
      caixaDeLogo(d, p, t, dados.logos.principal, MX + 400, topo + 20, larg - 400, 300, t.poco);
      break;
    }
    case "logo_principal": {
      const w = (larg - 20) / 2;
      caixaDeLogo(d, p, t, dados.logos.principal, MX, topo, w, 300, t.poco);
      caixaDeLogo(d, p, t, dados.logos.principal, MX + w + 20, topo, w, 300, t.escura);
      p.texto(MX, topo + 330, "Sobre fundo claro", "F2", 9, t.tinta);
      p.texto(MX + w + 20, topo + 330, "Sobre fundo escuro", "F2", 9, t.tinta);
      p.paragrafo(MX, topo + 352, SLOTS_DE_LOGO[0].uso, "F1", 10, t.cinza, larg, 14, 2);
      break;
    }
    case "grid": {
      const w = larg * 0.6;
      const h = 330;
      caixaDeLogo(d, p, t, dados.logos.principal, MX, topo, w, h, t.poco, 0.2);
      for (let i = 1; i < 8; i++) {
        p.linha(MX + (w * i) / 8, topo, MX + (w * i) / 8, topo + h, t.primaria, 0.3);
      }
      for (let i = 1; i < 5; i++) p.linha(MX, topo + (h * i) / 5, MX + w, topo + (h * i) / 5, t.primaria, 0.3);
      blocoDeTexto(p, t, MX + w + 30, topo + 10, "Malha de construção", "A malha divide a caixa da logo em módulos iguais. Use os módulos para alinhar a logo a textos e imagens e para manter a mesma proporção em qualquer tamanho. A logo nunca é redesenhada: use sempre os arquivos do pacote.", larg - w - 30, 14);
      break;
    }
    case "protecao": {
      const w = 360;
      const h = 220;
      const f = dados.regras.protecao_fator;
      const m = h * f * 0.6;
      p.arredondado(MX, topo, w, h, 8, t.poco);
      p.contorno(MX + m, topo + m, w - 2 * m, h - 2 * m, t.primaria, 0.8, true);
      d.encaixar(p, dados.logos.principal ? dados.logos.principal.previa_png || dados.logos.principal.caminho : null, MX + m * 1.6, topo + m * 1.6, w - 3.2 * m, h - 3.2 * m);
      blocoDeTexto(p, t, MX + w + 36, topo + 10, "Área de proteção", `Deixe livre, em volta da logo, um espaço igual a ${Math.round(f * 100)}% da altura dela. Nenhum texto, imagem ou borda entra nessa área.`, larg - w - 36, 6);
      blocoDeTexto(p, t, MX + w + 36, topo + 120, "Redução mínima", `No digital, a logo não fica menor que ${dados.regras.reducao_minima_px} px de largura. No impresso, não fica menor que ${dados.regras.reducao_minima_mm} mm.`, larg - w - 36, 6);
      const tamanhos = [120, 80, 50];
      let x = MX;
      for (const tw of tamanhos) {
        d.encaixar(p, dados.logos.principal ? dados.logos.principal.previa_png || dados.logos.principal.caminho : null, x, topo + 260, tw, tw * 0.45);
        x += tw + 30;
      }
      break;
    }
    case "versoes": {
      const lista: Array<{ l: LogoDoBrandbook | null; r: string }> = [{ l: dados.logos.secundario, r: "Secundário" }].concat(dados.logos.alternativas.map((a, i) => ({ l: a, r: a.rotulo || `Alternativa ${i + 1}` })));
      const itens = lista.slice(0, 4);
      const w = (larg - 20 * (Math.max(itens.length, 2) - 1)) / Math.max(itens.length, 2);
      itens.forEach((it, i) => {
        caixaDeLogo(d, p, t, it.l, MX + i * (w + 20), topo, w, 240, t.poco);
        p.texto(MX + i * (w + 20), topo + 262, rotuloDaLogo(it.l, it.r), "F2", 9, t.tinta);
      });
      p.paragrafo(MX, topo + 300, `${SLOTS_DE_LOGO[1].uso} ${SLOTS_DE_LOGO[2].uso}`, "F1", 10, t.cinza, larg, 14, 3);
      break;
    }
    case "cromaticas": {
      const fundos = [t.branco, t.escura].concat(cores.slice(0, 4).map((c) => cor(c.hex)));
      const col = 3;
      const w = (larg - 20 * (col - 1)) / col;
      fundos.slice(0, 6).forEach((f, i) => {
        const x = MX + (i % col) * (w + 20);
        const y = topo + Math.floor(i / col) * 190;
        caixaDeLogo(d, p, t, dados.logos.principal, x, y, w, 170, f);
        if (i === 0) p.contorno(x, y, w, 170, t.linha, 0.6);
      });
      p.texto(MX, topo + 400, "Confira o contraste: sobre cor, prefira a versão que fica legível a um passo de distância.", "F1", 9.5, t.cinza);
      break;
    }
    case "incorretos": {
      const lista = dados.regras.usos_incorretos.slice(0, 8);
      const col = 4;
      const w = (larg - 16 * (col - 1)) / col;
      lista.forEach((u, i) => {
        const x = MX + (i % col) * (w + 16);
        const y = topo + Math.floor(i / col) * 190;
        caixaDeLogo(d, p, t, dados.logos.principal, x, y, w, 130, t.poco, 0.22);
        p.linha(x + 10, y + 10, x + w - 10, y + 120, cor("#D93025"), 1.4);
        p.paragrafo(x, y + 150, u, "F1", 9.5, t.tinta, w, 12, 2);
      });
      break;
    }
    case "icone": {
      const ic = dados.logos.icone[0] || dados.logos.principal;
      caixaDeLogo(d, p, t, ic, MX, topo, 200, 200, t.primaria, 0.2);
      p.circulo(MX + 330, topo + 100, 90, t.escura);
      d.encaixar(p, ic ? ic.previa_png || ic.caminho : null, MX + 270, topo + 40, 120, 120);
      caixaDeLogo(d, p, t, ic, MX + 470, topo + 60, 80, 80, t.poco, 0.15);
      caixaDeLogo(d, p, t, ic, MX + 580, topo + 84, 32, 32, t.poco, 0.1);
      p.texto(MX, topo + 240, "App e avatar", "F2", 9, t.tinta);
      p.texto(MX + 470, topo + 160, "Favicon", "F2", 9, t.tinta);
      p.paragrafo(MX, topo + 270, SLOTS_DE_LOGO[3].uso, "F1", 10, t.cinza, larg, 14, 2);
      break;
    }
    case "cores": {
      const lista = cores.slice(0, 6);
      if (!lista.length) {
        p.texto(MX, topo + 20, "Falta a paleta.", "F1", 11, t.cinza);
        break;
      }
      const w = (larg - 14 * (lista.length - 1)) / lista.length;
      lista.forEach((c, i) => {
        const x = MX + i * (w + 14);
        p.arredondado(x, topo, w, 250, 8, cor(c.hex));
        if (c.hex === "#FFFFFF" || luminanciaRelativa(c.hex) > 0.9) p.contorno(x, topo, w, 250, t.linha);
        const tc = cor(c.texto);
        p.paragrafo(x + 12, topo + 26, caixaAlta(c.nome), "F2", 11, tc, w - 24, 13, 2);
        p.texto(x + 12, topo + 60, ROTULO_DO_PAPEL_DA_COR[c.papel], "F1", 8.5, tc);
        p.texto(x, topo + 276, "HEX", "F2", 8, t.cinza);
        p.texto(x + 34, topo + 276, c.hex, "F1", 9, t.tinta);
        p.texto(x, topo + 294, "RGB", "F2", 8, t.cinza);
        p.texto(x + 34, topo + 294, textoRgb(c.rgb), "F1", 9, t.tinta);
        p.texto(x, topo + 312, "CMYK", "F2", 8, t.cinza);
        p.texto(x + 34, topo + 312, textoCmyk(c.cmyk), "F1", 9, t.tinta);
      });
      p.paragrafo(MX, topo + 350, `CMYK calculado por código pelo perfil ${PERFIS[dados.perfil_cmyk].nome}, colorimétrico relativo, limite de tinta de ${PERFIS[dados.perfil_cmyk].limiteDeTinta}%. Para impressão, confirme a prova com a gráfica.`, "F1", 8.5, t.cinza, larg, 12, 2);
      break;
    }
    case "proporcao": {
      const partes = proporcaoDeUso(cores.map((c) => ({ hex: c.hex, papel: c.papel })));
      let x = MX;
      for (const pt of partes) {
        const w = (larg * pt.parte) / 100;
        p.retangulo(x, topo, w, 70, cor(pt.hex));
        if (w > 40) p.texto(x + 8, topo + 90, `${pt.parte}%`, "F2", 9, t.tinta);
        x += w;
      }
      p.contorno(MX, topo, larg, 70, t.linha);
      p.texto(MX, topo + 130, "PARES COM CONTRASTE PARA TEXTO", "F2", 8, t.primaria);
      const pares: Array<{ a: FichaDaCor; b: FichaDaCor; r: number }> = [];
      for (let i = 0; i < cores.length; i++) for (let j = 0; j < cores.length; j++) if (i !== j) pares.push({ a: cores[i], b: cores[j], r: contraste(cores[i].hex, cores[j].hex) });
      // Cada par uma vez só (a sobre b e b sobre a têm o mesmo contraste): fica o texto mais escuro sobre o fundo mais claro.
      const bons = pares.filter((x2) => x2.r >= 4.5 && luminanciaRelativa(x2.a.hex) <= luminanciaRelativa(x2.b.hex)).sort((x1, x2) => x2.r - x1.r).slice(0, 6);
      bons.forEach((par, i) => {
        const bx = MX + (i % 3) * ((larg - 32) / 3 + 16);
        const by = topo + 150 + Math.floor(i / 3) * 90;
        const bw = (larg - 32) / 3;
        p.arredondado(bx, by, bw, 70, 6, cor(par.b.hex));
        p.texto(bx + 14, by + 32, "Texto de exemplo", "F2", 14, cor(par.a.hex));
        p.texto(bx + 14, by + 54, `${par.a.nome} sobre ${par.b.nome}: ${par.r.toFixed(1)} (${nivelDoContraste(par.r)})`.slice(0, 60), "F1", 8, cor(par.a.hex));
      });
      if (!bons.length) p.texto(MX, topo + 160, "Nenhum par da paleta chega a 4,5 de contraste: use preto ou branco no texto.", "F1", 10, t.cinza);
      break;
    }
    case "tipografia": {
      const titulo = dados.tipografia.filter((x) => x.uso === "titulo")[0] || dados.tipografia[0];
      const textoT = dados.tipografia.filter((x) => x.uso === "texto")[0] || titulo;
      if (!titulo) {
        p.texto(MX, topo + 20, "Falta a tipografia.", "F1", 11, t.cinza);
        break;
      }
      p.arredondado(MX, topo, 360, 330, 8, t.poco);
      p.texto(MX + 20, topo + 34, "FAMÍLIA TIPOGRÁFICA", "F2", 8, t.primaria);
      p.texto(MX + 20, topo + 70, titulo.familia.slice(0, 26), "F2", 24, t.tinta);
      p.texto(MX + 230, topo + 150, "Aa", "F2", 80, t.tinta);
      p.texto(MX + 20, topo + 200, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "F1", 11, t.tinta);
      p.texto(MX + 20, topo + 218, "abcdefghijklmnopqrstuvwxyz", "F1", 11, t.tinta);
      p.texto(MX + 20, topo + 236, "0123456789  !@#$%&*()", "F1", 11, t.tinta);
      p.texto(MX + 20, topo + 270, `Pesos: ${titulo.pesos.length ? titulo.pesos.join(", ") : "a definir"}`.slice(0, 60), "F1", 9, t.cinza);
      p.texto(MX + 20, topo + 288, `Licença: ${titulo.licenca || "a confirmar"}`.slice(0, 60), "F1", 9, t.cinza);
      p.texto(MX + 20, topo + 314, "Amostra em Helvetica; a fonte da marca vai no pacote.", "F1", 7.5, t.cinza);
      const x = MX + 390;
      const niveis: Array<[string, Fonte, number]> = [
        ["Título 1", "F2", 26],
        ["Título 2", "F2", 20],
        ["Subtítulo", "F1", 15],
        ["Texto corrido", "F1", 11],
        ["Texto complementar", "F1", 8.5],
      ];
      let y = topo + 30;
      niveis.forEach(([nome, f, tam], i) => {
        p.texto(x, y, `Aqui um exemplo de ${nome.toLowerCase()}`, f, tam, t.tinta);
        p.texto(x, y + 14, `${nome}  /  ${i < 3 ? titulo.familia : textoT.familia}`, "F1", 7.5, t.cinza);
        y += tam + 40;
      });
      if (textoT && textoT !== titulo) p.texto(x, topo + 320, `Texto: ${textoT.familia}${textoT.alternativa ? `  /  alternativa: ${textoT.alternativa}` : ""}`.slice(0, 70), "F1", 9, t.cinza);
      break;
    }
    case "grafismos":
    case "ilustracao": {
      const lista = id === "grafismos" ? dados.grafismos.filter((g) => g.tipo !== "ilustracao" && g.tipo !== "icones") : dados.grafismos.filter((g) => g.tipo === "ilustracao" || g.tipo === "icones");
      const itens = (lista.length ? lista : id === "grafismos" ? dados.grafismos : []).slice(0, 4);
      if (!itens.length) {
        p.texto(MX, topo + 20, id === "grafismos" ? "Faltam os grafismos da marca." : "Esta marca não tem ilustração própria nesta versão.", "F1", 11, t.cinza);
        break;
      }
      const w = (larg - 16 * (itens.length - 1)) / itens.length;
      itens.forEach((g, i) => {
        const x = MX + i * (w + 16);
        p.arredondado(x, topo, w, 260, 8, t.poco);
        if (!d.encaixar(p, g.imagem, x, topo, w, 260, true)) p.textoCentrado(x + w / 2, topo + 130, "Sem imagem", "F1", 9, t.cinza);
        p.paragrafo(x, topo + 284, g.descricao || g.tipo, "F1", 9.5, t.tinta, w, 12, 4);
      });
      break;
    }
    case "fotografia": {
      tituloGrande(p, t, MX, topo + 10, "Fotografia e imagem", 500);
      const w = (larg - 40) / 2;
      blocoDeTexto(p, t, MX, topo + 64, "Coloração", dados.fotografia.coloracao, w, 7);
      blocoDeTexto(p, t, MX + w + 40, topo + 64, "Composição", dados.fotografia.composicao, w, 7);
      blocoDeTexto(p, t, MX, topo + 220, "O que evitar", dados.fotografia.evitar, w, 7);
      blocoDeTexto(p, t, MX + w + 40, topo + 220, "Imagem gerada por IA", dados.fotografia.ia || "Imagem de IA só como apoio, nunca no lugar da logo, do produto real ou das pessoas da marca.", w, 7);
      break;
    }
    case "redes":
    case "papelaria":
    case "mockups": {
      const fonte = id === "mockups" ? dados.mockups.map((m) => ({ titulo: m.titulo, imagem: m.imagem || null, descricao: "" })) : dados.aplicacoes.filter((a) => (id === "redes" ? /rede|post|story|avatar|carrossel|destaque|instagram/i.test(a.tipo) : /papel|cart|timbr|envelope|assinatura/i.test(a.tipo))).map((a) => ({ titulo: a.tipo, imagem: a.imagem || null, descricao: a.descricao }));
      const itens = fonte.slice(0, 3);
      if (!itens.length) {
        const vazio = id === "mockups" ? "Os mockups entram pela etapa Mockups." : id === "redes" ? "As aplicações em redes entram quando houver peças aprovadas." : "Papelaria fora do escopo desta versão.";
        p.texto(MX, topo + 20, vazio, "F1", 11, t.cinza);
        break;
      }
      const w = (larg - 16 * (itens.length - 1)) / itens.length;
      itens.forEach((m, i) => {
        const x = MX + i * (w + 16);
        p.arredondado(x, topo, w, 300, 8, t.poco);
        if (!d.encaixar(p, m.imagem, x, topo, w, 300, true)) p.textoCentrado(x + w / 2, topo + 150, "Sem imagem", "F1", 9, t.cinza);
        p.texto(x, topo + 322, m.titulo.slice(0, 50), "F2", 9.5, t.tinta);
        if (m.descricao) p.paragrafo(x, topo + 338, m.descricao, "F1", 9, t.cinza, w, 12, 2);
      });
      break;
    }
    case "arquivos": {
      tituloGrande(p, t, MX, topo + 10, "Arquivos entregues", 500);
      let y = topo + 64;
      p.texto(MX, y, "ARQUIVO", "F2", 8, t.primaria);
      p.texto(MX + 380, y, "FORMATO", "F2", 8, t.primaria);
      p.texto(MX + 500, y, "ONDE", "F2", 8, t.primaria);
      y += 18;
      for (const a of arquivosEntregues(dados).slice(0, 14)) {
        p.texto(MX, y, a.nome.slice(0, 60), "F1", 9.5, t.tinta);
        p.texto(MX + 380, y, a.formato.slice(0, 20), "F1", 9.5, t.tinta);
        p.texto(MX + 500, y, a.onde.slice(0, 44), "F1", 9.5, t.cinza);
        p.linha(MX, y + 7, L - MX, y + 7, t.linha, 0.4);
        y += 22;
      }
      break;
    }
    case "creditos": {
      p.retangulo(0, 70, L, A - 110, t.poco);
      p.textoCentrado(L / 2, 230, "Obrigado.", "F2", 30, t.tinta);
      p.textoCentrado(L / 2, 262, `Manual da marca ${marca}, versão ${versao}.`, "F1", 11, t.cinza);
      p.textoCentrado(L / 2 - 26, 318, "feito pela", "F1", 10, t.cinza);
      p.logoAceleriq(L / 2 + 14, 306, 64);
      if (dados.creditos.contato) p.textoCentrado(L / 2, 370, dados.creditos.contato.slice(0, 90), "F1", 10, t.cinza);
      break;
    }
  }
}

/** A prancha-resumo vertical (uma página longa, a estrutura do modelo recebido). */
function pranchaResumo(d: Documento, t: Tema, dados: DadosDoBrandbook, cores: FichaDaCor[]) {
  const W = 595.28;
  const H = 1560;
  const p = d.nova(W, H);
  const mx = 28;
  const larg = W - 2 * mx;
  p.retangulo(0, 0, W, H, t.escura);
  p.textoCentrado(W / 2, 72, "MANUAL DA MARCA", "F2", 30, t.acentoNoEscuro);
  if (dados.marca.nome) p.textoCentrado(W / 2, 96, dados.marca.nome.slice(0, 60), "F1", 11, t.branco);
  // 1. Logos: 4 cartões.
  let y = 124;
  const cw = (larg - 3 * 10) / 4;
  const cartoes: Array<{ titulo: string; logo: LogoDoBrandbook | null; uso: string }> = [
    { titulo: "LOGOTIPO PRINCIPAL", logo: dados.logos.principal, uso: SLOTS_DE_LOGO[0].uso },
    { titulo: "LOGOTIPO SECUNDÁRIO", logo: dados.logos.secundario || dados.logos.principal, uso: SLOTS_DE_LOGO[1].uso },
    { titulo: "VERSÕES ALTERNATIVAS", logo: dados.logos.alternativas[0] || null, uso: SLOTS_DE_LOGO[2].uso },
    { titulo: "ÍCONE", logo: dados.logos.icone[0] || null, uso: SLOTS_DE_LOGO[3].uso },
  ];
  cartoes.forEach((c, i) => {
    const x = mx + i * (cw + 10);
    p.contorno(x, y, cw, 250, cor("#3A4148"), 0.6);
    p.textoCentrado(x + cw / 2, y + 20, c.titulo, "F2", 6.8, t.acentoNoEscuro);
    p.linha(x, y + 30, x + cw, y + 30, cor("#3A4148"), 0.5);
    caixaDeLogo(d, p, t, c.logo, x + 8, y + 40, cw - 16, 70, t.escura, 0.12);
    caixaDeLogo(d, p, t, c.logo, x + 8, y + 118, cw - 16, 70, t.clara, 0.12);
    p.paragrafo(x + 8, y + 206, c.uso, "F1", 6.2, t.branco, cw - 16, 8, 4);
  });
  // 2. Paleta.
  y += 270;
  p.contorno(mx, y, larg, 250, cor("#3A4148"), 0.6);
  p.texto(mx + 16, y + 30, "PALETA DE CORES", "F2", 12, t.acentoNoEscuro);
  p.paragrafo(mx + 16, y + 50, "Primárias garantem o reconhecimento; secundárias enriquecem sem competir; o destaque chama a atenção para o que importa.", "F1", 7, t.branco, 140, 9, 8);
  const lista = cores.slice(0, 5);
  const px = mx + 170;
  const pw = larg - 170 - 12;
  const cwc = lista.length ? (pw - 8 * (lista.length - 1)) / lista.length : pw;
  lista.forEach((c, i) => {
    const x = px + i * (cwc + 8);
    p.arredondado(x, y + 16, cwc, 218, 6, cor(c.hex));
    if (contraste(c.hex, t.escuraHex) < 1.3) p.contorno(x, y + 16, cwc, 218, cor("#5B646C"), 0.6);
    const tc = cor(c.texto);
    p.paragrafo(x + 8, y + 34, caixaAlta(c.nome), "F2", 8, tc, cwc - 16, 9.5, 2);
    p.texto(x + 8, y + 58, ROTULO_DO_PAPEL_DA_COR[c.papel], "F1", 6.5, tc);
    p.texto(x + 8, y + 184, `CMYK ${c.cmyk.c} ${c.cmyk.m} ${c.cmyk.y} ${c.cmyk.k}`, "F1", 6.2, tc);
    p.texto(x + 8, y + 198, `RGB ${c.rgb.r} ${c.rgb.g} ${c.rgb.b}`, "F1", 6.2, tc);
    p.texto(x + 8, y + 212, `HEX ${c.hex}`, "F1", 6.2, tc);
  });
  if (!lista.length) p.texto(px, y + 120, "Falta a paleta.", "F1", 9, t.branco);
  // 3. Ativos.
  y += 270;
  p.contorno(mx, y, larg, 190, cor("#3A4148"), 0.6);
  p.texto(mx + 16, y + 30, "ATIVOS DA MARCA", "F2", 12, t.acentoNoEscuro);
  p.paragrafo(mx + 16, y + 50, "Padrões, estilo de foto, ilustrações e ícones que dão consistência à marca.", "F1", 7, t.branco, 140, 9, 8);
  const ativos = dados.grafismos.slice(0, 3);
  const aw = (pw - 16) / 3;
  for (let i = 0; i < 3; i++) {
    const x = px + i * (aw + 8);
    p.arredondado(x, y + 16, aw, 158, 6, cor("#2A3036"));
    const g = ativos[i];
    if (!g || !d.encaixar(p, g.imagem, x, y + 16, aw, 158, true)) p.textoCentrado(x + aw / 2, y + 96, g ? g.descricao.slice(0, 28) || "Ativo" : "Ativo da marca", "F1", 7.5, t.branco);
  }
  // 4. Tipografia.
  y += 210;
  p.contorno(mx, y, larg, 200, cor("#3A4148"), 0.6);
  p.texto(mx + 16, y + 30, "TIPOGRAFIA", "F2", 12, t.acentoNoEscuro);
  const tipo = dados.tipografia.filter((x) => x.uso === "titulo")[0] || dados.tipografia[0];
  p.arredondado(px, y + 16, pw * 0.45, 168, 6, cor("#2A3036"));
  p.texto(px + 12, y + 40, "FAMÍLIA TIPOGRÁFICA:", "F2", 6.5, t.branco);
  p.texto(px + 12, y + 60, tipo ? tipo.familia.slice(0, 22) : "A definir", "F2", 14, t.branco);
  p.texto(px + pw * 0.45 - 70, y + 80, "Aa", "F2", 44, t.branco);
  p.texto(px + 12, y + 120, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "F1", 6.5, t.branco);
  p.texto(px + 12, y + 134, "abcdefghijklmnopqrstuvwxyz", "F1", 6.5, t.branco);
  p.texto(px + 12, y + 148, "0123456789 !@#$%&*()", "F1", 6.5, t.branco);
  const hx = px + pw * 0.45 + 10;
  const hw = pw * 0.55 - 10;
  p.arredondado(hx, y + 16, hw, 168, 6, cor("#2A3036"));
  const niveis: Array<[string, Fonte, number]> = [["Um exemplo de título", "F2", 15], ["Um exemplo de título 2", "F2", 12], ["Um exemplo de subtítulo", "F1", 10], ["Um exemplo de texto", "F1", 8], ["Um exemplo de texto complementar", "F1", 6.5]];
  let hy = y + 44;
  for (const [tx, f, tam] of niveis) {
    p.texto(hx + 12, hy, tx, f, tam, t.branco);
    hy += tam + 16;
  }
  // 5. Mockups (sangria).
  y += 220;
  const mock = dados.mockups.slice(0, 3);
  const alturaDosMockups = H - y - 60;
  const metade = alturaDosMockups * 0.45;
  const pedacos: Array<[number, number, number, number]> = [[0, y, W / 2, metade], [W / 2, y, W / 2, metade], [0, y + metade, W, alturaDosMockups - metade]];
  pedacos.forEach(([x, yy, w, h], i) => {
    p.retangulo(x, yy, w, h, i === 1 ? cor("#2A3036") : i === 2 ? cor("#20262B") : cor("#262C31"));
    const m = mock[i];
    if (!m || !d.encaixar(p, m.imagem, x, yy, w, h, true)) p.textoCentrado(x + w / 2, yy + h / 2, "MOCKUP", "F2", 11, cor("#5B646C"));
  });
  // 6. Assinatura.
  p.arredondado(W - mx - 130, H - 42, 130, 26, 13, t.branco);
  p.texto(W - mx - 118, H - 25, "feito pela", "F1", 8, t.cinza);
  p.logoAceleriq(W - mx - 72, H - 37, 60);
}

/** O brandbook em PDF, no modelo pedido. */
export function gerarPdfDoBrandbook(e: EntradaDoBrandbook): Uint8Array {
  const dados = e.dados;
  const cores = coresDoBrandbook(dados);
  const t = temaDa(cores, dados.tema);
  const data = e.data instanceof Date ? e.data : e.data ? new Date(e.data) : new Date();
  const doc = new Documento(e.imagens || {});
  if (e.modelo === "prancha") pranchaResumo(doc, t, dados, cores);
  else {
    const paginas = estadoDoModelo("paginado", dados);
    paginas.forEach((pg) => paginaDoBrandbook(doc, t, dados, pg.id, pg.n, pg.titulo, e.versao, isNaN(data.getTime()) ? new Date() : data, cores));
    doc.paginas.forEach((p, i) => {
      if (i > 0) rodape(p, t, i + 1, doc.paginas.length, dados.marca.nome || "Marca");
    });
  }
  const titulo = `Manual da marca: ${dados.marca.nome || "Marca"} (v${e.versao})`;
  return montarBytes(doc, titulo, `brandbook ${e.modelo} v${e.versao}`);
}

export function nomeDoArquivoDoBrandbook(marca: string, modelo: ModeloDoBrandbook, versao: number): string {
  const limpo = String(marca || "marca")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "marca";
  return `${modelo === "prancha" ? "prancha-da-marca" : "manual-da-marca"}-${limpo}-v${versao}.pdf`;
}

// ------------------------------------------------------------------ naming

export type EntradaDoNaming = {
  cliente: string;
  alvo: string;
  criterios: string[];
  candidatos: CandidatoDeNome[];
  data?: Date | string;
};

/** O PDF dos finalistas (A4 em pé): cada finalista com a justificativa e os filtros, e a lista inteira. */
export function gerarPdfDoNaming(e: EntradaDoNaming): Uint8Array {
  const W = 595.28;
  const H = 841.89;
  const mx = 44;
  const larg = W - 2 * mx;
  const t = temaDa([]);
  const doc = new Documento({});
  const data = e.data instanceof Date ? e.data : e.data ? new Date(e.data) : new Date();
  const finalistas = e.candidatos.filter((c) => c.finalista);
  const nova = (titulo: string) => {
    const p = doc.nova(W, H);
    p.retangulo(0, 0, 4, H, t.primaria);
    p.texto(mx, 44, caixaAlta(e.cliente).slice(0, 48), "F2", 7.6, t.cinza);
    p.logoAceleriq(W / 2 - 50, 26, 100);
    p.textoADireita(W - mx, 44, caixaAlta(titulo), "F2", 7.6, t.cinza);
    p.linha(mx, 62, W - mx, 62, t.linha);
    return p;
  };
  let p = nova("NAMING");
  p.texto(mx, 110, `Naming: ${e.alvo}`, "F2", 22, t.tinta);
  p.texto(mx, 132, `${finalistas.length} finalistas entre ${e.candidatos.length} nomes  /  ${dataPorExtenso(isNaN(data.getTime()) ? new Date() : data)}`, "F1", 10, t.cinza);
  p.texto(mx, 164, "CRITÉRIOS", "F2", 8, t.primaria);
  let y = listaComMarcador(p, t, mx, 182, e.criterios.slice(0, 6), larg, 10) + 10;
  for (let i = 0; i < finalistas.length; i++) {
    const f = finalistas[i];
    const altura = 150;
    if (y + altura > H - 60) {
      p = nova("FINALISTAS");
      y = 90;
    }
    p.arredondado(mx, y, larg, altura - 14, 8, t.poco);
    p.texto(mx + 16, y + 30, `${i + 1}`, "F2", 12, t.primaria);
    p.texto(mx + 40, y + 32, f.nome, "F2", 22, t.tinta);
    p.textoADireita(W - mx - 16, y + 30, rotuloDaTecnica(f.tecnica), "F2", 9, t.cinza);
    p.paragrafo(mx + 40, y + 52, f.justificativa || "Sem justificativa.", "F1", 10, t.tinta, larg - 56, 13, 4);
    const filtros = `.com.br ${textoDoDominio(f.filtros.com_br)}   .com ${textoDoDominio(f.filtros.com)}   @${f.filtros.arroba || "?"} a conferir   INPI: busca pronta no painel`;
    p.texto(mx + 40, y + altura - 30, filtros.slice(0, 110), "F1", 8.5, t.cinza);
    y += altura;
  }
  // Lista inteira.
  p = nova("TODOS OS NOMES");
  y = 96;
  p.texto(mx, y, "NOME", "F2", 8, t.primaria);
  p.texto(mx + 190, y, "TÉCNICA", "F2", 8, t.primaria);
  p.texto(mx + 300, y, "NOTA", "F2", 8, t.primaria);
  p.texto(mx + 350, y, ".COM.BR", "F2", 8, t.primaria);
  p.texto(mx + 430, y, ".COM", "F2", 8, t.primaria);
  y += 18;
  for (const c of e.candidatos) {
    if (y > H - 60) {
      p = nova("TODOS OS NOMES");
      y = 96;
    }
    p.texto(mx, y, `${c.finalista ? "* " : ""}${c.nome}`.slice(0, 34), c.finalista ? "F2" : "F1", 9.5, t.tinta);
    p.texto(mx + 190, y, rotuloDaTecnica(c.tecnica), "F1", 9, t.cinza);
    p.texto(mx + 300, y, c.nota === null ? "sem nota" : `${Math.round(c.nota * 100)}`, "F1", 9, t.tinta);
    p.texto(mx + 350, y, textoDoDominio(c.filtros.com_br), "F1", 9, t.tinta);
    p.texto(mx + 430, y, textoDoDominio(c.filtros.com), "F1", 9, t.tinta);
    p.linha(mx, y + 6, W - mx, y + 6, t.linha, 0.4);
    y += 20;
  }
  p.paragrafo(mx, Math.min(y + 20, H - 70), "Nota: avaliação do Jev contra os critérios, com um ajuste pequeno pelo domínio. Domínio conferido no RDAP público (registro.br e Verisign) no dia da geração. O @ do Instagram e o INPI precisam ser conferidos antes do registro; criar o nome não garante o registro da marca.", "F1", 8, t.cinza, larg, 11, 4);
  doc.paginas.forEach((pg, i) => {
    pg.linha(mx, H - 38, W - mx, H - 38, t.linha);
    pg.textoADireita(W - mx, H - 22, `${dois(i + 1)} / ${dois(doc.paginas.length)}`, "F1", 7.2, t.cinza);
    pg.texto(mx, H - 22, `${caixaAlta(e.cliente).slice(0, 40)}  /  NAMING`, "F1", 7.2, t.cinza);
  });
  return montarBytes(doc, `Naming: ${e.alvo} (${e.cliente})`, `naming ${finalistas.map((f) => f.nome).join(", ")}`.slice(0, 300));
}

export function nomeDoArquivoDoNaming(cliente: string, alvo: string): string {
  const limpar = (s: string) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30);
  return `naming-${limpar(cliente) || "cliente"}-${limpar(alvo) || "nome"}.pdf`;
}
