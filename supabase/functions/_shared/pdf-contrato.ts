/**
 * PDF do contrato (frente CON, 30/09/2026), no mesmo padrão de documento da
 * agência (A4, faixa verde na margem, logo no topo, rótulos verdes), com as
 * mesmas primitivas do gerador da Mesa Roteiros (pdf-roteiro.ts, que não é
 * alterado): fontes padrão do PDF em WinAnsi, larguras oficiais e quebra de
 * linha exata. Sem dependência, puro: roda no navegador (Baixar prévia), na
 * Edge Function (congelar e assinar) e no vitest.
 *
 * Entrada: o texto canônico do contrato (contrato-modelo.ts). O PDF não muda
 * nenhuma palavra: desenha o que foi congelado e o código de integridade em
 * todas as páginas. A página de carimbo (assinaturas e trilha de eventos)
 * entra no PDF final, depois da assinatura do cliente.
 *
 * Frente CON2 (30/09): capa (logo grande, partes, serviços, valor e o código
 * de integridade), bloco de assinaturas com uma linha para cada pessoa
 * (contratada, contratante, outros signatários e testemunhas) e página de
 * carimbo com todas as assinaturas. A capa só repete o que está no texto.
 *
 * Sem travessão.
 */
import { CORES, type Fonte, larguraDoTexto, paraWinAnsi, quebrarLinhas } from "./pdf-roteiro.ts";
import { LOGO_ALTURA, LOGO_LARGURA, LOGO_MASCARA_ZLIB_B64, LOGO_RGB_ZLIB_B64 } from "./pdf-logo-aceleriq.ts";
import { hashLegivel, lerDocumento } from "./contrato-modelo.ts";

export { paginasDoPdf, textosDoPdf } from "./pdf-roteiro.ts";

type Cor = [number, number, number];

const LARGURA = 595.28;
const ALTURA = 841.89;
const ESQ = 48;
const DIR = 547.28;
const MIOLO = DIR - ESQ;
const TOPO = 88;
const FIM = 784;

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

class Pagina {
  ops: string[] = [];
  cor(c: Cor) {
    this.ops.push(`${n2(c[0])} ${n2(c[1])} ${n2(c[2])} rg`);
  }
  retangulo(x: number, y: number, w: number, h: number, c: Cor) {
    this.cor(c);
    this.ops.push(`${n2(x)} ${n2(ALTURA - y - h)} ${n2(w)} ${n2(h)} re f`);
  }
  linha(x: number, y: number, w: number, c: Cor = CORES.linha) {
    this.retangulo(x, y, w, 0.65, c);
  }
  texto(x: number, y: number, t: string, fonte: Fonte, tamanho: number, c: Cor) {
    if (!t) return;
    this.cor(c);
    this.ops.push(`BT /${fonte} ${n2(tamanho)} Tf 1 0 0 1 ${n2(x)} ${n2(ALTURA - y)} Tm ${literal(t)} Tj ET`);
  }
  textoADireita(xDir: number, y: number, t: string, fonte: Fonte, tamanho: number, c: Cor) {
    this.texto(xDir - larguraDoTexto(t, fonte, tamanho), y, t, fonte, tamanho, c);
  }
  logo(x: number, y: number, w: number) {
    const h = (w * LOGO_ALTURA) / LOGO_LARGURA;
    this.ops.push(`q ${n2(w)} 0 0 ${n2(h)} ${n2(x)} ${n2(ALTURA - y - h)} cm /Im1 Do Q`);
  }
}

export type AssinaturaNoCarimbo = { papel: string; nome: string; email?: string | null; quando: string; ip?: string | null; navegador?: string | null };
export type EventoNoCarimbo = { quando: string; texto: string };

export type CarimboDoContrato = {
  assinaturas: AssinaturaNoCarimbo[];
  eventos: EventoNoCarimbo[];
  /** Endereço onde o código pode ser conferido (o link do contrato). */
  verificacao?: string | null;
};

export type QuemAssinaNoPdf = { papel: string; nome: string; detalhe?: string | null };

export type PdfDoContrato = {
  texto: string;
  numero: string;
  versao: number;
  /** Código de integridade do texto congelado (SHA-256). Sem ele, o PDF sai marcado como prévia. */
  hash?: string | null;
  carimbo?: CarimboDoContrato | null;
  /** Capa com as partes e o código (padrão: sim). */
  capa?: boolean;
  /** Linhas de assinatura no fim do texto (contratada, contratante, testemunhas). */
  quemAssina?: QuemAssinaNoPdf[];
};

/** "29/09/2026 14:03:21 (Brasília)" a partir de um instante ISO. */
export function horaDeBrasilia(iso: string): string {
  const t = new Date(iso);
  if (isNaN(t.getTime())) return String(iso || "");
  const d = new Date(t.getTime() - 3 * 3600 * 1000);
  const dois = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${dois(d.getUTCDate())}/${dois(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${dois(d.getUTCHours())}:${dois(d.getUTCMinutes())}:${dois(d.getUTCSeconds())} (Brasília)`;
}

class Documento {
  paginas: Pagina[] = [];
  y = TOPO;
  constructor(private cabecalho: { esquerda: string; direita: string }) {}
  atual(): Pagina {
    return this.paginas[this.paginas.length - 1];
  }
  nova(): Pagina {
    const p = new Pagina();
    this.paginas.push(p);
    p.retangulo(0, 0, 4, ALTURA, CORES.verde);
    p.texto(ESQ, 46, this.cabecalho.esquerda.slice(0, 60), "F2", 7.4, CORES.cinza);
    p.logo(LARGURA / 2 - 50, 26, 100);
    p.textoADireita(DIR, 46, this.cabecalho.direita.slice(0, 60), "F2", 7.4, CORES.cinza);
    p.linha(ESQ, 64, MIOLO);
    this.y = TOPO;
    return p;
  }
  /** Página da capa: só a faixa verde na margem (a capa desenha o resto). */
  capa(): Pagina {
    const p = new Pagina();
    this.paginas.push(p);
    this.y = TOPO;
    return p;
  }
  garantir(altura: number) {
    if (this.y + altura > FIM) this.nova();
  }
  paragrafo(t: string, fonte: Fonte, tamanho: number, cor: Cor, x = ESQ, largura = MIOLO, entrelinha = tamanho * 1.42) {
    for (const l of quebrarLinhas(t, fonte, tamanho, largura)) {
      this.garantir(entrelinha);
      this.atual().texto(x, this.y + tamanho, l, fonte, tamanho, cor);
      this.y += entrelinha;
    }
  }
  rodapes(esquerda: string) {
    const total = this.paginas.length;
    const dois = (n: number) => (n < 10 ? `0${n}` : String(n));
    this.paginas.forEach((p, i) => {
      p.linha(ESQ, 800, MIOLO);
      p.texto(ESQ, 816, esquerda.slice(0, 110), "F1", 6.8, CORES.cinza);
      p.textoADireita(DIR, 816, `${dois(i + 1)} / ${dois(total)}`, "F1", 6.8, CORES.cinza);
    });
  }
}

function desenharTexto(d: Documento, texto: string) {
  const blocos = lerDocumento(texto);
  let primeiraSecao = true;
  for (const b of blocos) {
    if (b.tipo === "titulo") {
      const linhas = quebrarLinhas(b.texto, "F2", 22, MIOLO);
      d.garantir(linhas.length * 26 + 10);
      linhas.forEach((l) => {
        d.atual().texto(ESQ, d.y + 22, l, "F2", 22, CORES.tinta);
        d.y += 27;
      });
      d.atual().retangulo(ESQ, d.y + 2, 58, 3, CORES.verde);
      d.y += 16;
    } else if (b.tipo === "meta") {
      d.paragrafo(b.texto, "F1", 9, CORES.cinza);
      d.y += 10;
    } else if (b.tipo === "secao") {
      d.y += primeiraSecao ? 4 : 14;
      primeiraSecao = false;
      d.garantir(46);
      d.atual().texto(ESQ, d.y + 8, b.texto.toLocaleUpperCase("pt-BR").slice(0, 80), "F2", 8, CORES.verdeEscuro);
      d.y += 14;
      d.atual().linha(ESQ, d.y, MIOLO, CORES.verdeClaro);
      d.y += 10;
    } else if (b.tipo === "clausula") {
      d.garantir(34);
      d.y += 6;
      d.paragrafo(b.texto, "F2", 10.4, CORES.tinta);
      d.y += 2;
    } else if (b.tipo === "quadro") {
      const col = 128;
      const linhas = quebrarLinhas(b.texto, "F1", 9, MIOLO - col - 10);
      const rotulo = quebrarLinhas(b.rotulo, "F2", 8.2, col - 6);
      const altura = Math.max(linhas.length, rotulo.length) * 12.4 + 8;
      d.garantir(altura);
      const p = d.atual();
      rotulo.forEach((l, i) => p.texto(ESQ, d.y + 10 + i * 12.4, l, "F2", 8.2, CORES.verdeEscuro));
      linhas.forEach((l, i) => p.texto(ESQ + col, d.y + 10 + i * 12.4, l, "F1", 9, CORES.tinta));
      d.y += altura;
      p.linha(ESQ, d.y - 3, MIOLO);
    } else if (b.tipo === "item") {
      const linhas = quebrarLinhas(b.texto, "F1", 9.4, MIOLO - 14);
      linhas.forEach((l, i) => {
        d.garantir(13.4);
        if (i === 0) d.atual().texto(ESQ + 2, d.y + 9.4, "•", "F1", 9.4, CORES.verde);
        d.atual().texto(ESQ + 14, d.y + 9.4, l, "F1", 9.4, CORES.tinta);
        d.y += 13.4;
      });
      d.y += 1;
    } else {
      d.paragrafo(b.texto, "F1", 9.4, CORES.tinta);
      d.y += 4;
    }
  }
}

/** O que a capa mostra, tirado do próprio texto (título, linha de identificação e quadro). */
export function dadosDaCapa(texto: string): { titulo: string; meta: string; linhas: Array<{ rotulo: string; texto: string }> } {
  const blocos = lerDocumento(texto);
  const titulo = (blocos.find((b) => b.tipo === "titulo") as { texto: string } | undefined)?.texto || "Contrato";
  const meta = (blocos.find((b) => b.tipo === "meta") as { texto: string } | undefined)?.texto || "";
  const quero = ["Contratante", "Contratada", "Serviços", "Contrato original", "Valor", "Início e vigência", "Vale a partir de", "Renovação"];
  const linhas: Array<{ rotulo: string; texto: string }> = [];
  for (const b of blocos) {
    if (b.tipo !== "quadro" || quero.indexOf(b.rotulo) < 0) continue;
    // Na capa, só o nome da parte (a qualificação inteira fica no quadro).
    const t = b.rotulo === "Contratante" || b.rotulo === "Contratada" ? b.texto.split(",")[0] : b.texto;
    linhas.push({ rotulo: b.rotulo, texto: t });
  }
  linhas.sort((a, b) => quero.indexOf(a.rotulo) - quero.indexOf(b.rotulo));
  return { titulo, meta, linhas };
}

function desenharCapa(d: Documento, p: PdfDoContrato) {
  const pg = d.atual();
  const c = dadosDaCapa(p.texto);
  pg.retangulo(0, 0, LARGURA, 250, CORES.cartaoVerde);
  pg.retangulo(0, 250, LARGURA, 3, CORES.verde);
  pg.logo(ESQ, 70, 150);
  pg.texto(ESQ, 186, /aditivo/i.test(c.titulo) ? "TERMO ADITIVO" : "CONTRATO", "F2", 8.4, CORES.verdeEscuro);
  let y = 212;
  for (const l of quebrarLinhas(c.titulo, "F2", 24, MIOLO).slice(0, 2)) {
    pg.texto(ESQ, y, l, "F2", 24, CORES.tinta);
    y += 28;
  }
  d.y = 290;
  if (c.meta) {
    d.paragrafo(c.meta, "F1", 9.6, CORES.cinza);
    d.y += 14;
  }
  for (const l of c.linhas) {
    const linhas = quebrarLinhas(l.texto, "F1", 10.4, MIOLO - 140).slice(0, 4);
    const altura = linhas.length * 14.6 + 14;
    if (d.y + altura > 684) break;
    const q = pg;
    q.texto(ESQ, d.y + 12, l.rotulo.toLocaleUpperCase("pt-BR"), "F2", 7.6, CORES.verdeEscuro);
    linhas.forEach((x, i) => q.texto(ESQ + 140, d.y + 12 + i * 14.6, x, i === 0 && (l.rotulo === "Contratante" || l.rotulo === "Contratada") ? "F2" : "F1", 10.4, CORES.tinta));
    d.y += altura;
    q.linha(ESQ, d.y - 4, MIOLO);
  }
  // Código de integridade no pé da capa.
  const base = 700;
  pg.retangulo(ESQ, base, MIOLO, 70, CORES.cartao);
  pg.texto(ESQ + 16, base + 20, p.hash ? "CÓDIGO DE INTEGRIDADE (SHA-256)" : "PRÉVIA, SEM VALOR DE ASSINATURA", "F2", 7.4, CORES.verdeEscuro);
  const codigo = p.hash ? hashLegivel(p.hash) : "O código sai quando o contrato é congelado e assinado pela agência.";
  quebrarLinhas(codigo, p.hash ? "F2" : "F1", 8.8, MIOLO - 32).slice(0, 3).forEach((l, i) => pg.texto(ESQ + 16, base + 36 + i * 12, l, p.hash ? "F2" : "F1", 8.8, CORES.tinta));
}

function desenharQuemAssina(d: Documento, lista: QuemAssinaNoPdf[]) {
  const pessoas = lista.filter((x) => x && String(x.nome || "").trim());
  if (!pessoas.length) return;
  d.y += 18;
  d.garantir(40);
  d.atual().texto(ESQ, d.y + 8, "QUEM ASSINA", "F2", 8, CORES.verdeEscuro);
  d.y += 16;
  const coluna = (MIOLO - 24) / 2;
  for (let i = 0; i < pessoas.length; i += 2) {
    d.garantir(78);
    const q = d.atual();
    [pessoas[i], pessoas[i + 1]].forEach((x, k) => {
      if (!x) return;
      const xa = ESQ + k * (coluna + 24);
      q.linha(xa, d.y + 36, coluna, CORES.tinta);
      q.texto(xa, d.y + 50, String(x.nome).slice(0, 60), "F2", 9.4, CORES.tinta);
      q.texto(xa, d.y + 63, `${x.papel}${x.detalhe ? ` · ${x.detalhe}` : ""}`.slice(0, 80), "F1", 8.2, CORES.cinza);
    });
    d.y += 78;
  }
}

function desenharCarimbo(d: Documento, p: PdfDoContrato, c: CarimboDoContrato) {
  d.nova();
  const pg = d.atual();
  pg.texto(ESQ, d.y + 8, "PÁGINA DE CARIMBO", "F2", 8, CORES.verdeEscuro);
  d.y += 20;
  d.paragrafo("Assinaturas e trilha do documento", "F2", 18, CORES.tinta);
  d.atual().retangulo(ESQ, d.y + 2, 58, 3, CORES.verde);
  d.y += 18;
  d.paragrafo(`Contrato nº ${p.numero}, versão ${p.versao}. Código de integridade do texto assinado (SHA-256):`, "F1", 9.2, CORES.cinza);
  d.y += 2;
  d.paragrafo(hashLegivel(p.hash || ""), "F2", 9.6, CORES.tinta);
  d.y += 12;
  for (const a of c.assinaturas) {
    const linhas = [
      `${a.nome}${a.email ? `, ${a.email}` : ""}`,
      `Assinou em ${horaDeBrasilia(a.quando)}${a.ip ? `, IP ${a.ip}` : ""}`,
      a.navegador ? `Navegador: ${a.navegador}` : "",
    ].filter(Boolean);
    const altura = 22 + linhas.reduce((s, l) => s + quebrarLinhas(l, "F1", 9, MIOLO - 28).length * 12.6, 0) + 10;
    d.garantir(altura + 8);
    const q = d.atual();
    q.retangulo(ESQ, d.y, MIOLO, altura, CORES.cartao);
    q.texto(ESQ + 14, d.y + 16, a.papel.toLocaleUpperCase("pt-BR"), "F2", 7.4, CORES.verdeEscuro);
    let y = d.y + 30;
    linhas.forEach((l, i) => {
      for (const x of quebrarLinhas(l, i === 0 ? "F2" : "F1", 9, MIOLO - 28)) {
        q.texto(ESQ + 14, y, x, i === 0 ? "F2" : "F1", 9, CORES.tinta);
        y += 12.6;
      }
    });
    d.y += altura + 8;
  }
  d.y += 6;
  d.garantir(30);
  d.atual().texto(ESQ, d.y + 8, "TRILHA DE EVENTOS", "F2", 7.6, CORES.verdeEscuro);
  d.y += 16;
  for (const e of c.eventos) {
    const linhas = quebrarLinhas(e.texto, "F1", 8.6, MIOLO - 150);
    d.garantir(linhas.length * 11.6 + 4);
    const q = d.atual();
    q.texto(ESQ, d.y + 8.6, horaDeBrasilia(e.quando), "F1", 8, CORES.cinza);
    linhas.forEach((l, i) => q.texto(ESQ + 150, d.y + 8.6 + i * 11.6, l, "F1", 8.6, CORES.tinta));
    d.y += linhas.length * 11.6 + 4;
  }
  d.y += 10;
  const nota = `Documento assinado eletronicamente (MP 2.200-2/2001, art. 10, § 2º, e Lei 14.063/2020). Qualquer mudança no texto muda o código acima.${c.verificacao ? ` Conferência: ${c.verificacao}` : ""}`;
  d.paragrafo(nota, "F1", 8.4, CORES.cinza);
}

function montarBytes(paginas: Pagina[], titulo: string, assunto: string): Uint8Array {
  const partes: Uint8Array[] = [];
  const offsets: number[] = [];
  let tamanho = 0;
  const escrever = (b: Uint8Array | string) => {
    const bytes = typeof b === "string" ? bytesDoTexto(b) : b;
    partes.push(bytes);
    tamanho += bytes.length;
  };
  const primeiraPagina = 8;
  const ids = paginas.map((_, i) => primeiraPagina + i * 2);
  const total = primeiraPagina + paginas.length * 2 - 1;
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
  objeto(7, `<< /Title ${literal(titulo)} /Subject ${literal(assunto)} /Producer ${literal("Aceleriq OS, Contratos")} /Creator ${literal("Aceleriq OS")} >>`);
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

/**
 * Gera o PDF do contrato. Sem hash: prévia (marcada em todas as páginas).
 * Com carimbo: acrescenta a página de assinaturas e trilha.
 */
export function gerarPdfDoContrato(p: PdfDoContrato): Uint8Array {
  if (!String(p.texto || "").trim()) throw new Error("Contrato sem texto.");
  const codigo = p.hash ? `CÓDIGO ${String(p.hash).slice(0, 16).toUpperCase()}` : "PRÉVIA, SEM VALOR DE ASSINATURA";
  const d = new Documento({ esquerda: `CONTRATO Nº ${p.numero}  /  VERSÃO ${p.versao}`, direita: codigo });
  if (p.capa !== false) {
    d.capa();
    desenharCapa(d, p);
  }
  d.nova();
  desenharTexto(d, p.texto);
  if (p.quemAssina && p.quemAssina.length) desenharQuemAssina(d, p.quemAssina);
  if (p.carimbo) desenharCarimbo(d, p, p.carimbo);
  d.rodapes(p.hash ? `Contrato nº ${p.numero}, versão ${p.versao}. SHA-256 ${p.hash}` : `Contrato nº ${p.numero}, versão ${p.versao}. Prévia: o código de integridade sai no envio.`);
  return montarBytes(d.paginas, `Contrato nº ${p.numero}`, p.hash ? `sha256:${p.hash}` : "previa");
}
