/**
 * PDF do briefing respondido (frente BRF, 30/09/2026), no mesmo padrão do
 * documento da Mesa Roteiros: A4, faixa verde na margem, logo da Aceleriq no
 * topo, rótulos verdes em caixa alta, rodapé com cliente e página.
 *
 * Conteúdo: capa curta (cliente, serviço, data do envio), os pontos da
 * decupagem (quando houver) e cada bloco com as perguntas respondidas. Texto
 * nunca é cortado: o que não cabe vai para a página seguinte. Pergunta sem
 * resposta não entra.
 *
 * Usa as métricas e a conversão WinAnsi do pdf-roteiro.ts (exportadas) e o
 * logo embutido de pdf-logo-aceleriq.ts. Puro: sem Deno e sem npm. Sem travessão.
 */

import { CORES, type Fonte, larguraDoTexto, paraWinAnsi, quebrarLinhas } from "./pdf-roteiro.ts";
import { LOGO_ALTURA, LOGO_LARGURA, LOGO_MASCARA_ZLIB_B64, LOGO_RGB_ZLIB_B64 } from "./pdf-logo-aceleriq.ts";

type Cor = [number, number, number];

export type BlocoDoPdf = { titulo: string; itens: Array<{ pergunta: string; resposta: string }> };
export type PontoDoPdf = { rotulo: string; itens: string[] };

export type DocumentoDoBriefing = {
  cliente: string;
  titulo: string;
  enviadoEm?: string | null;
  estado: string;
  pontos: PontoDoPdf[];
  tom?: string | null;
  blocos: BlocoDoPdf[];
};

const LARGURA = 595.28;
const ALTURA = 841.89;
const ESQ = 40;
const DIR = 555.28;
const MIOLO = DIR - ESQ;
const TOPO = 84;
const FIM = 790;

const n2 = (v: number) => (Math.round(v * 100) / 100).toString();
const caixaAlta = (t: string) => String(t || "").toLocaleUpperCase("pt-BR");
const dois = (n: number) => (n < 10 ? `0${n}` : String(n));

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

class Pagina {
  ops: string[] = [];
  cor(c: Cor) {
    this.ops.push(`${n2(c[0])} ${n2(c[1])} ${n2(c[2])} rg`);
  }
  retangulo(x: number, y: number, w: number, h: number, c: Cor) {
    this.cor(c);
    this.ops.push(`${n2(x)} ${n2(ALTURA - y - h)} ${n2(w)} ${n2(h)} re f`);
  }
  texto(x: number, y: number, t: string, fonte: Fonte, tamanho: number, c: Cor) {
    if (!t) return;
    this.cor(c);
    this.ops.push(`BT /${fonte} ${n2(tamanho)} Tf 1 0 0 1 ${n2(x)} ${n2(ALTURA - y)} Tm ${literal(t)} Tj ET`);
  }
  aDireita(xDir: number, y: number, t: string, fonte: Fonte, tamanho: number, c: Cor) {
    this.texto(xDir - larguraDoTexto(t, fonte, tamanho), y, t, fonte, tamanho, c);
  }
  logo(x: number, y: number, w: number) {
    const h = (w * LOGO_ALTURA) / LOGO_LARGURA;
    this.ops.push(`q ${n2(w)} 0 0 ${n2(h)} ${n2(x)} ${n2(ALTURA - y - h)} cm /Im1 Do Q`);
  }
}

class Documento {
  paginas: Pagina[] = [];
  y = TOPO;
  constructor(public cliente: string, public secao: string) {}
  atual() {
    return this.paginas[this.paginas.length - 1];
  }
  nova() {
    const p = new Pagina();
    this.paginas.push(p);
    p.retangulo(0, 0, 4, ALTURA, CORES.verde);
    p.texto(ESQ, 44, caixaAlta(this.cliente).slice(0, 48), "F2", 7.6, CORES.cinza);
    p.logo(242.6, 23, 110);
    p.aDireita(DIR - 12, 44, "BRIEFING", "F2", 7.6, CORES.cinza);
    p.retangulo(ESQ, 66, MIOLO, 0.65, CORES.linha);
    this.y = TOPO;
    return p;
  }
  garantir(altura: number) {
    if (this.y + altura <= FIM) return;
    this.nova();
  }
  paragrafo(x: number, t: string, fonte: Fonte, tamanho: number, c: Cor, largura: number, entrelinha: number) {
    for (const l of quebrarLinhas(t, fonte, tamanho, largura)) {
      this.garantir(entrelinha);
      this.atual().texto(x, this.y, l, fonte, tamanho, c);
      this.y += entrelinha;
    }
  }
  rodapes() {
    const total = this.paginas.length;
    this.paginas.forEach((p, i) => {
      p.retangulo(ESQ, 803, MIOLO, 0.65, CORES.linha);
      p.texto(ESQ, 821, `${caixaAlta(this.cliente).slice(0, 40)}  /  ${this.secao}`, "F1", 7.2, CORES.cinza);
      p.aDireita(DIR, 821, `${dois(i + 1)} / ${dois(total)}`, "F1", 7.2, CORES.cinza);
    });
  }
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
function dataPorExtenso(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d.getTime())) return "";
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

function montarBytes(paginas: Pagina[], titulo: string): Uint8Array {
  const partes: Uint8Array[] = [];
  const offsets: number[] = [];
  let tamanho = 0;
  const escrever = (b: Uint8Array | string) => {
    const bytes = typeof b === "string" ? bytesDoTexto(b) : b;
    partes.push(bytes);
    tamanho += bytes.length;
  };
  const primeira = 8;
  const ids = paginas.map((_, i) => primeira + i * 2);
  const total = primeira + paginas.length * 2 - 1;
  const objeto = (n: number, corpo: string) => {
    offsets[n] = tamanho;
    escrever(`${n} 0 obj\n${corpo}\nendobj\n`);
  };
  escrever("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  objeto(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objeto(2, `<< /Type /Pages /Kids [${ids.map((n) => `${n} 0 R`).join(" ")}] /Count ${paginas.length} >>`);
  objeto(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objeto(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const rgb = deBase64(LOGO_RGB_ZLIB_B64);
  const mascara = deBase64(LOGO_MASCARA_ZLIB_B64);
  offsets[5] = tamanho;
  escrever(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${LOGO_LARGURA} /Height ${LOGO_ALTURA} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /SMask 6 0 R /Length ${rgb.length} >>\nstream\n`);
  escrever(rgb);
  escrever("\nendstream\nendobj\n");
  offsets[6] = tamanho;
  escrever(`6 0 obj\n<< /Type /XObject /Subtype /Image /Width ${LOGO_LARGURA} /Height ${LOGO_ALTURA} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${mascara.length} >>\nstream\n`);
  escrever(mascara);
  escrever("\nendstream\nendobj\n");
  objeto(7, `<< /Title ${literal(titulo)} /Producer ${literal("Aceleriq OS, Briefing")} /Creator ${literal("Aceleriq OS")} >>`);
  paginas.forEach((p, i) => {
    const id = ids[i];
    const conteudo = p.ops.join("\n");
    objeto(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LARGURA} ${ALTURA}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Im1 5 0 R >> >> /Contents ${id + 1} 0 R >>`);
    objeto(id + 1, `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`);
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

/** Gera o PDF do briefing (bytes). Não altera nenhuma resposta. */
export function gerarPdfDoBriefing(doc: DocumentoDoBriefing): Uint8Array {
  const d = new Documento(doc.cliente || "Cliente", caixaAlta(doc.titulo).slice(0, 40));
  d.nova();
  const p = d.atual();
  p.texto(ESQ, d.y, caixaAlta("Briefing respondido"), "F2", 7.6, CORES.verdeEscuro);
  d.y += 32;
  for (const l of quebrarLinhas(doc.titulo, "F2", 25, MIOLO)) {
    p.texto(ESQ, d.y, l, "F2", 25, CORES.tinta);
    d.y += 29;
  }
  d.y -= 15;
  p.retangulo(ESQ, d.y, 58, 3, CORES.verde);
  d.y += 22;
  const linhaDeApoio = [doc.cliente, doc.enviadoEm ? `enviado em ${dataPorExtenso(doc.enviadoEm)}` : "", doc.estado].filter(Boolean).join("  /  ");
  d.paragrafo(ESQ, linhaDeApoio, "F1", 9.2, CORES.cinza, MIOLO, 12.5);
  d.y += 14;

  if (doc.pontos.length || doc.tom) {
    d.garantir(40);
    d.atual().texto(ESQ, d.y, caixaAlta("Pontos principais"), "F2", 7.6, CORES.verdeEscuro);
    d.y += 16;
    if (doc.tom) {
      d.paragrafo(ESQ, `Tom de voz: ${doc.tom}`, "F2", 9.6, CORES.tinta, MIOLO, 13);
      d.y += 4;
    }
    for (const ponto of doc.pontos) {
      if (!ponto.itens.length) continue;
      d.garantir(30);
      d.paragrafo(ESQ, ponto.rotulo, "F2", 9.6, CORES.tinta, MIOLO, 13);
      d.paragrafo(ESQ + 10, ponto.itens.join("; "), "F1", 9.2, CORES.cinza, MIOLO - 10, 12.4);
      d.y += 6;
    }
    d.y += 10;
  }

  for (const bloco of doc.blocos) {
    if (!bloco.itens.length) continue;
    d.garantir(60);
    d.atual().retangulo(ESQ, d.y - 2, MIOLO, 0.65, CORES.linha);
    d.y += 16;
    d.atual().texto(ESQ, d.y, caixaAlta(bloco.titulo), "F2", 7.6, CORES.verdeEscuro);
    d.y += 18;
    for (const item of bloco.itens) {
      const alturaPergunta = quebrarLinhas(item.pergunta, "F2", 9.6, MIOLO).length * 13;
      d.garantir(alturaPergunta + 14);
      d.paragrafo(ESQ, item.pergunta, "F2", 9.6, CORES.tinta, MIOLO, 13);
      d.y += 1;
      d.paragrafo(ESQ, item.resposta, "F1", 9.6, CORES.cinza, MIOLO, 13);
      d.y += 9;
    }
  }
  d.rodapes();
  return montarBytes(d.paginas, `${doc.titulo}: ${doc.cliente}`);
}

/** Nome do arquivo: briefing-site-cliente-2026-09-30.pdf, sem acento nem espaço. */
export function nomeDoArquivoDoBriefing(modelo: string, cliente: string, data?: string | null): string {
  const limpar = (t: string) =>
    String(t || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
  const d = data ? new Date(data) : new Date();
  const dia = isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
  return `${["briefing", limpar(modelo), limpar(cliente), dia].filter(Boolean).join("-").replace(/-+/g, "-")}.pdf`;
}
