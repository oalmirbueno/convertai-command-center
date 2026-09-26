/**
 * PDF da Mesa Roteiros no padrão do documento modelo do dono
 * (Roteiros_Thaina_Rosa_Aceleriq.pdf, "é esse estilo de padrão de PDF de
 * documento"): A4, faixa verde na margem esquerda, logo no topo, rótulos
 * verdes em caixa alta, título grande, blocos de fala numerados (a abertura
 * em fundo escuro), cena e edição por vídeo, direção por vídeo, captação e
 * acabamento, fontes, rodapé com seção e página "02 / 08".
 *
 * Kit V2 (produtor-pdf.md e MESA-ROTEIROS.md, "PDF para gravar"): exportar
 * não reescreve nem aprova. Sai a fala limpa (página de cada vídeo) e o
 * técnico (tempo, imagem, texto na tela, apoio e captação), com revisão, hash
 * e estado; rascunho sai marcado como RASCUNHO e mantém as pendências. Bloco
 * que não cabe vai inteiro para a página seguinte; texto nunca é cortado.
 *
 * Gerador próprio, sem dependência: fontes padrão do PDF (Helvetica e
 * Helvetica Bold) com WinAnsiEncoding, que tem todos os acentos do português
 * (á, â, ã, à, ç, é, ê, í, ó, ô, õ, ú, ü). As larguras vêm das métricas
 * oficiais das fontes, para a quebra de linha ser exata. Roda igual no
 * navegador (Baixar) e na Edge Function (Compartilhar), em poucos
 * milissegundos. Puro: sem Deno, sem npm. Compatível com Safari 11. Sem travessão.
 */

import {
  duracaoEstimada,
  faixaDeDuracao,
  faixaDeVarios,
  modoDoTipo,
  ROTULO_DO_STATUS,
  type Roteiro,
  type StatusDoRoteiro,
} from "./roteiro-modelo.ts";
import { LOGO_ALTURA, LOGO_LARGURA, LOGO_MASCARA_ZLIB_B64, LOGO_RGB_ZLIB_B64 } from "./pdf-logo-aceleriq.ts";

// ------------------------------------------------------------------ entrada

export type ItemDoPdf = {
  roteiro: Roteiro;
  versao: number;
  hash: string;
  status: StatusDoRoteiro;
  /** Item da agenda ligado (título e data), quando há. */
  agenda?: { titulo: string; data?: string | null; formato?: string | null } | null;
};

export type DocumentoDeRoteiros = {
  cliente: string;
  itens: ItemDoPdf[];
  /** Data do documento (ISO ou Date). Padrão: agora. */
  data?: string | Date;
  /** Linha extra da assinatura nos vídeos (ex.: registro profissional, @perfil). */
  assinatura?: string | null;
};

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

const n2 = (v: number) => (Math.round(v * 100) / 100).toString();

// ------------------------------------------------------------------ cores (as do documento modelo)

type Cor = [number, number, number];
const hex = (h: string): Cor => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

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

// ------------------------------------------------------------------ página

const LARGURA = 595.28;
const ALTURA = 841.89;
const ESQ = 40;
const DIR = 555.28;
const MIOLO = DIR - ESQ;
const TOPO_DO_CONTEUDO = 84;
const FIM_DO_CONTEUDO = 790;

class Pagina {
  ops: string[] = [];
  usaLogo = false;
  rascunho = false;
  secao: string;
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
}

// ------------------------------------------------------------------ montagem

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function dataDoDocumento(v: string | Date | undefined): Date {
  const d = v instanceof Date ? v : v ? new Date(v) : new Date();
  return isNaN(d.getTime()) ? new Date() : d;
}

const dois = (n: number) => (n < 10 ? `0${n}` : String(n));
const caixaAlta = (t: string) => String(t || "").toLocaleUpperCase("pt-BR");

/** Quanto ocupa um parágrafo (altura em pt). */
const alturaDe = (t: string, fonte: Fonte, tamanho: number, largura: number, entrelinha: number) => quebrarLinhas(t, fonte, tamanho, largura).length * entrelinha;

class Documento {
  paginas: Pagina[] = [];
  y = TOPO_DO_CONTEUDO;
  cliente: string;
  rascunho: boolean;
  constructor(cliente: string, rascunho: boolean) {
    this.cliente = cliente;
    this.rascunho = rascunho;
  }

  atual(): Pagina {
    return this.paginas[this.paginas.length - 1];
  }

  /** Página interna com o cabeçalho do documento modelo. */
  nova(secao: string, direita = "PRODUÇÃO AUDIOVISUAL", rascunho = this.rascunho): Pagina {
    const p = new Pagina(secao);
    p.rascunho = rascunho;
    this.paginas.push(p);
    p.retangulo(0, 0, 4, ALTURA, CORES.verde);
    p.texto(ESQ, 44, caixaAlta(this.cliente).slice(0, 48), "F2", 7.6, CORES.cinza);
    p.logo(242.6, 23, 110);
    p.textoADireita(DIR - 12, 44, rascunho ? `RASCUNHO  /  ${direita}` : direita, "F2", 7.6, CORES.cinza);
    p.linha(ESQ, 66, MIOLO);
    this.y = TOPO_DO_CONTEUDO;
    return p;
  }

  /** Garante espaço; sem espaço, abre página com o mesmo cabeçalho e devolve true. */
  garantir(altura: number, secao: string, continuacao?: () => void): boolean {
    if (this.y + altura <= FIM_DO_CONTEUDO) return false;
    const anterior = this.atual();
    this.nova(secao, "PRODUÇÃO AUDIOVISUAL", anterior ? anterior.rascunho : this.rascunho);
    if (continuacao) continuacao();
    return true;
  }

  rodapes() {
    const total = this.paginas.length;
    this.paginas.forEach((p, i) => {
      p.linha(ESQ, 803, MIOLO);
      p.texto(ESQ, 821, `${caixaAlta(this.cliente).slice(0, 40)}  /  ${p.secao}`, "F1", 7.2, CORES.cinza);
      p.textoADireita(DIR, 821, `${dois(i + 1)} / ${dois(total)}`, "F1", 7.2, CORES.cinza);
    });
  }
}

function rotuloEmCima(p: Pagina, x: number, y: number, t: string, c: Cor = CORES.verdeEscuro) {
  p.texto(x, y, caixaAlta(t), "F2", 7.6, c);
}

/** Título de seção como no documento modelo: rótulo verde, título grande e traço verde. */
function tituloDeSecao(d: Documento, rotulo: string, titulo: string, apoio?: string) {
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

// ------------------------------------------------------------------ capa

function textoDaDinamica(itens: ItemDoPdf[]): { forte: string[]; leve: string[] } {
  const tipos = itens.map((i) => i.roteiro.tipo);
  if (tipos.length && tipos.every((t) => t === "cinema")) {
    return { forte: ["Uma cena por vez.", "Continuidade em tudo."], leve: ["Confira figurino, luz e objeto.", "Grave cada ação em mais de um take.", "Anote o que mudou entre as cenas."] };
  }
  if (tipos.length && tipos.every((t) => t === "tutorial")) {
    return { forte: ["Mostre o resultado.", "Um passo por vez."], leve: ["Deixe a ação visível na tela.", "Respire, grave e pause.", "Se errar, repita só aquele passo."] };
  }
  return { forte: ["Olhe para a lente.", "Fale uma parte por vez."], leve: ["Leia a próxima fala.", "Respire, grave e pause.", "Se errar, repita só aquela parte."] };
}

function capa(d: Documento, doc: DocumentoDeRoteiros, data: Date) {
  const p = new Pagina("PLANO DE PRODUÇÃO");
  d.paginas.push(p);
  p.retangulo(0, 0, 4, ALTURA, CORES.verde);
  p.logo(205.6, 35, 184);
  const mes = `${caixaAlta(MESES[data.getMonth()])} ${data.getFullYear()}`;
  rotuloEmCima(p, ESQ, 118, `Planejamento de conteúdo  /  ${mes}${d.rascunho ? "  /  RASCUNHO" : ""}`);
  const unico = doc.itens.length === 1;
  const titulo = unico ? "Roteiro de gravação" : "Plano de produção audiovisual";
  const linhasTitulo = quebrarLinhas(titulo, "F2", 32, 360);
  linhasTitulo.forEach((l, i) => p.texto(ESQ, 162 + i * 36, l, "F2", 32, CORES.tinta));
  let y = 162 + (linhasTitulo.length - 1) * 36 + 26;
  p.texto(ESQ, y, "Roteiros e direção de gravação", "F1", 11.2, CORES.cinza);
  y += 22;
  y = p.paragrafo(ESQ, y, doc.cliente, "F2", 16, CORES.tinta, MIOLO, 19);
  y += 4;
  p.texto(ESQ, y, `${data.getDate()} de ${MESES[data.getMonth()]} de ${data.getFullYear()}`, "F1", 9.1, CORES.cinza);
  y += 22;
  p.linha(ESQ, y, MIOLO);
  y += 32;
  const roteiros = doc.itens.map((i) => i.roteiro);
  const formato = roteiros.length ? roteiros[0].formato : "9:16";
  const colunas: Array<[string, string]> = [
    [dois(doc.itens.length), doc.itens.length === 1 ? "VÍDEO" : "VÍDEOS"],
    [faixaDeVarios(roteiros), doc.itens.length === 1 ? "DURAÇÃO" : "CADA VÍDEO"],
    [formato, formato === "9:16" ? "NA VERTICAL" : "FORMATO"],
  ];
  colunas.forEach(([valor, rotulo], i) => {
    const x = ESQ + i * 167;
    p.texto(x, y, valor, "F2", 24, CORES.tinta);
    p.texto(x, y + 24, rotulo, "F2", 7.6, CORES.verdeEscuro);
  });
  y += 52;
  // Caixa escura: dinâmica da gravação.
  const dinamica = textoDaDinamica(doc.itens);
  p.arredondado(ESQ, y, MIOLO, 92, 7, CORES.tinta);
  p.texto(ESQ + 18, y + 22, "DINÂMICA DA GRAVAÇÃO", "F2", 7.6, CORES.verdeClaro);
  dinamica.forte.forEach((l, i) => p.texto(ESQ + 18, y + 50 + i * 21, l, "F2", 17, CORES.branco));
  dinamica.leve.forEach((l, i) => p.texto(ESQ + 300, y + 36 + i * 14, l, "F1", 10.3, CORES.branco));
  y += 92 + 34;
  rotuloEmCima(p, ESQ, y, "Conteúdos desta gravação");
  y += 28;
  const cabem = Math.max(1, Math.floor((740 - y) / 52));
  doc.itens.slice(0, cabem).forEach((it, i) => {
    p.texto(ESQ, y + 6, dois(i + 1), "F2", 17, CORES.verde);
    p.texto(ESQ + 42, y, it.roteiro.titulo.slice(0, 70), "F2", 12, CORES.tinta);
    const sub = it.roteiro.subtitulo || (it.agenda && it.agenda.titulo) || modoDoTipo(it.roteiro.tipo).rotulo;
    p.texto(ESQ + 42, y + 19, sub.slice(0, 90), "F1", 9.2, CORES.cinza);
    if (it.status !== "aprovado" && it.status !== "gravado") p.textoADireita(DIR, y, "RASCUNHO", "F2", 7, CORES.cinza);
    if (i < Math.min(cabem, doc.itens.length) - 1) p.linha(ESQ + 42, y + 34, MIOLO - 42);
    y += 52;
  });
  if (doc.itens.length > cabem) {
    p.texto(ESQ + 42, y, `E mais ${doc.itens.length - cabem} ${doc.itens.length - cabem === 1 ? "vídeo" : "vídeos"} nas páginas seguintes.`, "F1", 9.2, CORES.cinza);
    y += 20;
  }
  const n = doc.itens.length;
  const guia = n === 1
    ? "Página 2: roteiro de fala. Depois: roteiro técnico, direção, publicação e captação."
    : `Páginas 2 em diante: um roteiro de fala por vídeo. Depois: roteiro técnico, direção por vídeo, publicação, captação e fontes.`;
  p.paragrafo(ESQ, Math.max(y + 6, 752), guia, "F1", 9.1, CORES.cinza, MIOLO, 12);
}

// ------------------------------------------------------------------ roteiro de fala (uma página por vídeo)

function paginaDeFala(d: Documento, it: ItemDoPdf, i: number) {
  const r = it.roteiro;
  const secao = `ROTEIRO ${dois(i + 1)}`;
  const rascunho = it.status !== "aprovado" && it.status !== "gravado";
  const p0 = d.nova(secao, "PRODUÇÃO AUDIOVISUAL", rascunho);
  rotuloEmCima(p0, ESQ, d.y, `Vídeo ${dois(i + 1)}${rascunho ? "  /  rascunho" : ""}`);
  p0.textoADireita(DIR - 88, d.y, faixaDeDuracao(r), "F1", 8.5, CORES.cinza);
  d.y += 34;
  const linhasTitulo = quebrarLinhas(r.titulo, "F2", 25, MIOLO);
  linhasTitulo.forEach((l, k) => p0.texto(ESQ, d.y + k * 29, l, "F2", 25, CORES.tinta));
  d.y += (linhasTitulo.length - 1) * 29 + 20;
  if (r.subtitulo) d.y = p0.paragrafo(ESQ, d.y, r.subtitulo, "F1", 9.7, CORES.cinza, MIOLO, 12.5) + 6;
  if (r.logline) d.y = p0.paragrafo(ESQ, d.y, `Premissa: ${r.logline}`, "F1", 9.2, CORES.cinza, MIOLO, 12.5) + 4;
  d.y += 8;

  const largura = MIOLO - 62;
  r.blocos.forEach((b, k) => {
    const primeiro = k === 0;
    const ultimo = k === r.blocos.length - 1 && r.blocos.length > 1;
    const fonteFala: Fonte = primeiro ? "F2" : "F1";
    const fundo = primeiro ? CORES.tinta : ultimo ? CORES.cartaoVerde : CORES.cartao;
    const continuar = () => {
      rotuloEmCima(d.atual(), ESQ, d.y, `Vídeo ${dois(i + 1)}  /  continuação`);
      d.y += 20;
    };
    // O bloco vai inteiro para a página seguinte; só o que não cabe numa página
    // inteira continua em partes, com o mesmo número e a mesma função.
    let resto = quebrarLinhas(b.fala || "(sem fala neste bloco)", fonteFala, 11.2, largura);
    const cabemNumaPagina = Math.floor((FIM_DO_CONTEUDO - TOPO_DO_CONTEUDO - 20 - 47) / 14.6);
    let parte = 0;
    while (resto.length) {
      d.garantir(Math.min(resto.length, cabemNumaPagina) * 14.6 + 47, secao, continuar);
      const cabem = Math.max(1, Math.floor((FIM_DO_CONTEUDO - d.y - 47) / 14.6));
      const agora = resto.slice(0, cabem);
      resto = resto.slice(cabem);
      const altura = 30 + agora.length * 14.6 + 10;
      const p = d.atual();
      p.arredondado(ESQ, d.y, MIOLO, altura, 6, fundo);
      p.texto(ESQ + 12, d.y + 22, dois(b.ordem), "F2", 12, primeiro ? CORES.branco : CORES.verdeEscuro);
      p.texto(ESQ + 46, d.y + 16, caixaAlta(b.funcao) + (parte > 0 ? "  (continuação)" : ""), "F2", 7, primeiro ? CORES.verdeClaro : CORES.verdeEscuro);
      agora.forEach((l, n) => p.texto(ESQ + 46, d.y + 33 + n * 14.6, l, fonteFala, 11.2, primeiro ? CORES.branco : CORES.tinta));
      d.y += altura + 7;
      parte++;
    }
  });

  // Aberturas alternativas: as outras duas opções de gancho, para gravar e testar.
  const outras = r.ganchos.filter((_, k) => k !== r.gancho_escolhido);
  if (outras.length) {
    const textos = outras.map((g, k) => `${String.fromCharCode(66 + k)}) ${g.texto}${g.mecanismo ? ` (${g.mecanismo})` : ""}`);
    const altura = 18 + textos.reduce((s, t) => s + alturaDe(t, "F1", 9.2, MIOLO - 24, 12.4) + 4, 0);
    d.garantir(altura + 10, secao);
    const p = d.atual();
    rotuloEmCima(p, ESQ, d.y + 8, "Aberturas para testar");
    let y = d.y + 24;
    for (const t of textos) y = p.paragrafo(ESQ + 12, y, t, "F1", 9.2, CORES.cinza, MIOLO - 24, 12.4) + 4;
    d.y = y + 6;
  }

  // Cena e edição, em duas colunas (como no documento modelo).
  const dir = r.direcao;
  const cena = [dir.enquadramento, dir.ambiente, dir.luz].filter(Boolean).join(". ") || "A definir com a equipe.";
  const naTela = r.blocos.filter((b) => b.texto_na_tela).map((b) => b.texto_na_tela);
  const edicao = [naTela.length ? `Na tela: ${naTela.slice(0, 3).join(" / ")}` : "", r.cta ? `Chamada: ${r.cta}` : ""].filter(Boolean).join(". ") || "Cortes limpos e legendas em até duas linhas.";
  const meia = (MIOLO - 20) / 2;
  const altura = 30 + Math.max(alturaDe(cena, "F1", 9.1, meia, 12.2), alturaDe(edicao, "F1", 9.1, meia, 12.2));
  d.garantir(altura + 16, secao);
  const p = d.atual();
  p.linha(ESQ, d.y + 4, MIOLO);
  rotuloEmCima(p, ESQ, d.y + 22, "Cena", CORES.verdeEscuro);
  rotuloEmCima(p, ESQ + meia + 20, d.y + 22, "Edição", CORES.verdeEscuro);
  p.paragrafo(ESQ, d.y + 38, cena, "F1", 9.1, CORES.cinza, meia, 12.2);
  p.paragrafo(ESQ + meia + 20, d.y + 38, edicao, "F1", 9.1, CORES.cinza, meia, 12.2);
  d.y += altura + 16;
}

// ------------------------------------------------------------------ roteiro técnico

function paginasTecnicas(d: Documento, itens: ItemDoPdf[]) {
  const secao = "ROTEIRO TÉCNICO";
  d.nova(secao);
  tituloDeSecao(d, "Roteiro técnico", "Tempo, imagem e texto na tela", "Mesma revisão das falas. Cada bloco com o tempo estimado, o que a câmera mostra, o texto na tela e a imagem de apoio.");
  itens.forEach((it, i) => {
    const r = it.roteiro;
    d.garantir(60, secao);
    const p0 = d.atual();
    p0.texto(ESQ, d.y + 4, `${dois(i + 1)}  ${r.titulo}`.slice(0, 80), "F2", 12, CORES.tinta);
    d.y += 22;
    let inicio = 0;
    r.blocos.forEach((b) => {
      const fim = inicio + (Number(b.segundos) || 0);
      const linhas = [
        b.visual ? `Imagem: ${b.visual}` : "",
        b.texto_na_tela ? `Na tela: ${b.texto_na_tela}` : "",
        b.broll ? `Apoio: ${b.broll}` : "",
      ].filter(Boolean);
      if (!linhas.length) linhas.push("Pessoa para a câmera, sem apoio.");
      const largura = MIOLO - 118;
      const altura = 14 + linhas.reduce((s, l) => s + alturaDe(l, "F1", 9, largura, 12) + 2, 0) + 8;
      d.garantir(altura + 5, secao, () => {
        d.atual().texto(ESQ, d.y + 4, `${dois(i + 1)}  ${r.titulo}  (continuação)`.slice(0, 90), "F2", 10, CORES.tinta);
        d.y += 20;
      });
      const p = d.atual();
      p.arredondado(ESQ, d.y, MIOLO, altura, 5, CORES.cartao);
      p.texto(ESQ + 12, d.y + 17, `${inicio} a ${fim}s`, "F2", 9, CORES.verdeEscuro);
      p.texto(ESQ + 12, d.y + 30, caixaAlta(b.funcao).slice(0, 18), "F2", 6.8, CORES.cinza);
      let y = d.y + 17;
      for (const l of linhas) y = p.paragrafo(ESQ + 106, y, l, "F1", 9, CORES.tinta, largura, 12) + 2;
      d.y += altura + 5;
      inicio = fim;
    });
    d.y += 12;
  });
}

// ------------------------------------------------------------------ direção por vídeo

function paginaDeDirecao(d: Documento, itens: ItemDoPdf[]) {
  const secao = "PLANOS DE GRAVAÇÃO";
  d.nova(secao);
  tituloDeSecao(d, "Direção por vídeo", "O que captar em cada cena", "Grave todas as falas primeiro. Faça as imagens de apoio ao final.");
  itens.forEach((it, i) => {
    const r = it.roteiro;
    const dir = r.direcao;
    const largura = MIOLO - 78;
    const linhaVerde = [dir.ambiente, dir.enquadramento].filter(Boolean).join(" • ") || modoDoTipo(r.tipo).rotulo;
    const corpo = [dir.orientacoes.join(" "), dir.camera ? `Câmera: ${dir.camera}.` : "", dir.luz ? `Luz: ${dir.luz}.` : ""].filter(Boolean).join(" ") || modoDoTipo(r.tipo).cuidados;
    const extra = [dir.figurino ? `Figurino: ${dir.figurino}` : "", dir.objetos ? `Objetos: ${dir.objetos}` : ""].filter(Boolean).join(". ");
    const apoio = r.broll.length ? `Imagem de apoio: ${r.broll.join("; ")}` : "";
    const altura =
      24 + alturaDe(r.titulo, "F2", 12, largura, 15) + alturaDe(linhaVerde, "F2", 8, largura, 11) + 6 + alturaDe(corpo, "F1", 9.2, largura, 12.4) +
      (extra ? alturaDe(extra, "F1", 8.6, largura, 11.6) + 4 : 0) + (apoio ? alturaDe(apoio, "F1", 8, largura, 11) + 8 : 0) + 12;
    d.garantir(altura + 8, secao);
    const p = d.atual();
    p.arredondado(ESQ, d.y, MIOLO, altura, 6, CORES.cartao);
    p.texto(ESQ + 14, d.y + 32, dois(i + 1), "F2", 20, CORES.verde);
    let y = p.paragrafo(ESQ + 64, d.y + 22, r.titulo, "F2", 12, CORES.tinta, largura, 15);
    y = p.paragrafo(ESQ + 64, y + 2, linhaVerde, "F2", 8, CORES.verdeEscuro, largura, 11) + 6;
    y = p.paragrafo(ESQ + 64, y, corpo, "F1", 9.2, CORES.tinta, largura, 12.4);
    if (extra) y = p.paragrafo(ESQ + 64, y + 4, extra, "F1", 8.6, CORES.tinta, largura, 11.6);
    if (apoio) p.paragrafo(ESQ + 64, y + 10, apoio, "F1", 8, CORES.cinza, largura, 11);
    d.y += altura + 8;
  });
  const caixa = "Grave cada ação por 6 a 8 segundos, com a câmera estável. Faça uma tomada mais aberta e outra de detalhe. Na edição, use apenas 2 a 3 segundos com a voz por cima. Não é preciso falar durante essas imagens.";
  const altura = 34 + alturaDe(caixa, "F1", 9.2, MIOLO - 28, 12.6) + 12;
  d.garantir(altura + 4, secao);
  const p = d.atual();
  p.arredondado(ESQ, d.y, MIOLO, altura, 6, CORES.cartaoVerde);
  rotuloEmCima(p, ESQ + 14, d.y + 20, "Como gravar as imagens de apoio");
  p.paragrafo(ESQ + 14, d.y + 38, caixa, "F1", 9.2, CORES.tinta, MIOLO - 28, 12.6);
  d.y += altura + 8;
}

// ------------------------------------------------------------------ publicação (legenda e CTA)

function paginaDePublicacao(d: Documento, itens: ItemDoPdf[]) {
  const secao = "PUBLICAÇÃO";
  d.nova(secao);
  tituloDeSecao(d, "Publicação", "Legenda e chamada de cada vídeo", "Texto do post e chamada final. Confira com o cliente antes de publicar.");
  itens.forEach((it, i) => {
    const r = it.roteiro;
    const largura = MIOLO - 28;
    const cta = r.cta ? `Chamada: ${r.cta}` : "Chamada: a definir.";
    const legenda = r.legenda || "Legenda a escrever.";
    const tags = r.hashtags.join(" ");
    const altura = 26 + alturaDe(cta, "F2", 9.2, largura, 12.4) + 6 + alturaDe(legenda, "F1", 9.2, largura, 12.6) + (tags ? alturaDe(tags, "F1", 8.4, largura, 11.4) + 6 : 0) + 12;
    d.garantir(Math.min(altura, 300) + 8, secao);
    // Legenda muito longa: vai em partes, sem cortar texto.
    const p = d.atual();
    if (d.y + altura > FIM_DO_CONTEUDO) {
      p.texto(ESQ, d.y + 4, `${dois(i + 1)}  ${r.titulo}`.slice(0, 80), "F2", 12, CORES.tinta);
      d.y += 22;
      d.y = d.atual().paragrafo(ESQ, d.y, cta, "F2", 9.2, CORES.verdeEscuro, MIOLO, 12.4) + 6;
      for (const l of quebrarLinhas(legenda, "F1", 9.2, MIOLO)) {
        d.garantir(13, secao);
        d.atual().texto(ESQ, d.y, l, "F1", 9.2, CORES.tinta);
        d.y += 12.6;
      }
      if (tags) {
        d.garantir(24, secao);
        d.y = d.atual().paragrafo(ESQ, d.y + 4, tags, "F1", 8.4, CORES.cinza, MIOLO, 11.4);
      }
      d.y += 12;
      return;
    }
    p.arredondado(ESQ, d.y, MIOLO, altura, 6, CORES.cartao);
    p.texto(ESQ + 14, d.y + 20, `${dois(i + 1)}  ${r.titulo}`.slice(0, 80), "F2", 12, CORES.tinta);
    let y = p.paragrafo(ESQ + 14, d.y + 38, cta, "F2", 9.2, CORES.verdeEscuro, largura, 12.4) + 6;
    y = p.paragrafo(ESQ + 14, y, legenda, "F1", 9.2, CORES.tinta, largura, 12.6);
    if (tags) p.paragrafo(ESQ + 14, y + 6, tags, "F1", 8.4, CORES.cinza, largura, 11.4);
    d.y += altura + 8;
  });
}

// ------------------------------------------------------------------ captação, assinatura e fontes

function paginaFinal(d: Documento, doc: DocumentoDeRoteiros) {
  const secao = "CAPTAÇÃO E EDIÇÃO";
  d.nova(secao);
  tituloDeSecao(d, "Orientações de produção", "Captação e acabamento", "Preparação da gravação, identidade visual e finalização dos vídeos.");
  const n = doc.itens.length;
  const minutos = n * 12;
  const cartoes: Array<[string, string, string]> = [
    ["10 min", "PREPARAÇÃO", "Teste de luz e áudio"],
    [`${minutos} min`, n === 1 ? "UM VÍDEO" : `${n} VÍDEOS`, "Cerca de 12 min por vídeo"],
    [`${Math.max(6, n * 3)} min`, "IMAGENS DE APOIO", "Mesa, mãos e ambiente"],
  ];
  const w = (MIOLO - 24) / 3;
  const p = d.atual();
  cartoes.forEach(([valor, rotulo, apoio], i) => {
    const x = ESQ + i * (w + 12);
    p.arredondado(x, d.y, w, 72, 6, CORES.cartao);
    p.texto(x + 14, d.y + 28, valor, "F2", 18, CORES.tinta);
    p.texto(x + 14, d.y + 46, rotulo, "F2", 7.2, CORES.verdeEscuro);
    p.texto(x + 14, d.y + 61, apoio, "F1", 8, CORES.cinza);
  });
  d.y += 96;
  const ugc = doc.itens.some((i) => i.roteiro.tipo === "ugc");
  const passos: Array<[string, string]> = [
    ["Antes de apertar gravar", "Celular vertical e fixo na altura dos olhos. Microfone próximo. Grave um teste de 10 segundos e escute. Use 4K se estiver disponível e estável."],
    ["Durante as falas", "Deixe 2 segundos antes e depois de cada parte. Faça duas versões da abertura. Mantenha posição e tom entre os cortes. Olhar sempre na lente."],
    ["Na edição", ugc
      ? "Cortes curtos e naturais, sem efeito que esconda o produto. Legendas em até duas linhas. Nada de depoimento ou resultado que não aconteceu."
      : "Cortes limpos e aproximações discretas. Legendas em até duas linhas. Música abaixo da voz. Até duas imagens de apoio por vídeo, sem dados de clientes."],
  ];
  passos.forEach(([titulo, corpo], i) => {
    const altura = 20 + alturaDe(corpo, "F1", 9.2, MIOLO - 34, 12.6) + 12;
    d.garantir(altura, secao);
    const pp = d.atual();
    pp.texto(ESQ, d.y + 14, dois(i + 1), "F2", 13, CORES.verde);
    pp.texto(ESQ + 34, d.y + 12, titulo, "F2", 11, CORES.tinta);
    pp.paragrafo(ESQ + 34, d.y + 30, corpo, "F1", 9.2, CORES.cinza, MIOLO - 34, 12.6);
    d.y += altura;
  });
  d.y += 8;
  // Assinatura nos vídeos (caixa escura).
  const assinatura = [doc.cliente, doc.assinatura || ""].filter(Boolean);
  d.garantir(96, secao);
  const pa = d.atual();
  pa.arredondado(ESQ, d.y, MIOLO, 70, 7, CORES.tinta);
  pa.texto(ESQ + 16, d.y + 20, "ASSINATURA NOS VÍDEOS", "F2", 7.6, CORES.verdeClaro);
  pa.texto(ESQ + 16, d.y + 40, assinatura[0].slice(0, 80), "F2", 11, CORES.branco);
  if (assinatura[1]) pa.texto(ESQ + 16, d.y + 58, assinatura[1].slice(0, 110), "F1", 8.8, CORES.branco);
  d.y += 92;
  const aviso = "Use a identidade do cliente nos vídeos. Preserve as ressalvas das falas e confira o texto com o cliente antes da gravação. Sem promessas de resultado, depoimento inventado ou exposição de casos reais.";
  d.y = d.atual().paragrafo(ESQ, d.y, aviso, "F1", 8.8, CORES.cinza, MIOLO, 12) + 14;

  // Pendências (rascunho mantém) e fontes.
  const pendencias: string[] = [];
  doc.itens.forEach((it, i) => it.roteiro.pendencias.forEach((x) => pendencias.push(`Vídeo ${dois(i + 1)}: ${x}`)));
  if (pendencias.length) {
    d.garantir(40, secao);
    rotuloEmCima(d.atual(), ESQ, d.y, "Pendências antes de gravar");
    d.y += 16;
    for (const x of pendencias) {
      const h = alturaDe(x, "F1", 8.8, MIOLO - 12, 11.8);
      d.garantir(h + 3, secao);
      d.y = d.atual().paragrafo(ESQ + 12, d.y, x, "F1", 8.8, CORES.tinta, MIOLO - 12, 11.8) + 3;
    }
    d.y += 10;
  }
  const fontes: string[] = [];
  doc.itens.forEach((it) => it.roteiro.fontes.forEach((f) => {
    if (fontes.indexOf(f) < 0) fontes.push(f);
  }));
  d.garantir(40, secao);
  rotuloEmCima(d.atual(), ESQ, d.y, "Base editorial e fontes");
  d.y += 16;
  const base = fontes.length ? `Planejamento alinhado ao contexto e à linha editorial da marca. Fontes: ${fontes.join("; ")}.` : "Planejamento alinhado ao contexto e à linha editorial da marca.";
  d.garantir(alturaDe(base, "F1", 8.8, MIOLO, 11.8) + 4, secao);
  d.y = d.atual().paragrafo(ESQ, d.y, base, "F1", 8.8, CORES.cinza, MIOLO, 11.8) + 10;
  // Revisão e hash de cada vídeo: a exportação identifica exatamente o que foi exportado.
  const revisoes = doc.itens.map((it, i) => `Vídeo ${dois(i + 1)}: revisão ${it.versao} (${ROTULO_DO_STATUS[it.status] || it.status}), ${duracaoEstimada(it.roteiro).palavras} palavras, código ${it.hash}`);
  d.garantir(20 + revisoes.length * 11, secao);
  rotuloEmCima(d.atual(), ESQ, d.y, "Revisões exportadas");
  d.y += 14;
  for (const r of revisoes) {
    d.garantir(12, secao);
    d.atual().texto(ESQ, d.y, r, "F1", 8, CORES.verdeEscuro);
    d.y += 11;
  }
}

// ------------------------------------------------------------------ montagem final

function montarBytes(paginas: Pagina[], titulo: string, assunto: string): Uint8Array {
  const partes: Uint8Array[] = [];
  const offsets: number[] = [];
  let tamanho = 0;
  const escrever = (b: Uint8Array | string) => {
    const bytes = typeof b === "string" ? bytesDoTexto(b) : b;
    partes.push(bytes);
    tamanho += bytes.length;
  };
  // Números dos objetos: 1 catálogo, 2 páginas, 3 F1, 4 F2, 5 logo, 6 máscara, 7 info, depois página+conteúdo.
  const primeiraPagina = 8;
  const idsDasPaginas = paginas.map((_, i) => primeiraPagina + i * 2);
  const total = primeiraPagina + paginas.length * 2 - 1;
  const objeto = (n: number, corpo: Uint8Array | string) => {
    offsets[n] = tamanho;
    escrever(`${n} 0 obj\n`);
    escrever(corpo);
    escrever("\nendobj\n");
  };
  escrever("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  objeto(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objeto(2, `<< /Type /Pages /Kids [${idsDasPaginas.map((n) => `${n} 0 R`).join(" ")}] /Count ${paginas.length} >>`);
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
  objeto(7, `<< /Title ${literal(titulo)} /Subject ${literal(assunto)} /Producer ${literal("Aceleriq OS, Mesa Roteiros")} /Creator ${literal("Aceleriq OS")} >>`);
  paginas.forEach((p, i) => {
    const idPagina = idsDasPaginas[i];
    const conteudo = p.ops.join("\n");
    objeto(
      idPagina,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LARGURA} ${ALTURA}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Im1 5 0 R >> >> /Contents ${idPagina + 1} 0 R >>`,
    );
    objeto(idPagina + 1, `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`);
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
 * Gera o PDF (bytes) dos roteiros, na ordem recebida. Não altera nenhum
 * texto: o que sai é a versão pedida de cada roteiro.
 */
export function gerarPdfDeRoteiros(doc: DocumentoDeRoteiros): Uint8Array {
  if (!doc.itens.length) throw new Error("Nenhum roteiro para exportar.");
  const data = dataDoDocumento(doc.data);
  const rascunho = doc.itens.some((i) => i.status !== "aprovado" && i.status !== "gravado");
  const d = new Documento(doc.cliente || "Cliente", rascunho);
  capa(d, doc, data);
  doc.itens.forEach((it, i) => paginaDeFala(d, it, i));
  paginasTecnicas(d, doc.itens);
  paginaDeDirecao(d, doc.itens);
  paginaDePublicacao(d, doc.itens);
  paginaFinal(d, doc);
  d.rodapes();
  const titulo = doc.itens.length === 1 ? `Roteiro: ${doc.itens[0].roteiro.titulo}` : `Plano de produção audiovisual: ${doc.cliente}`;
  const assunto = doc.itens.map((it) => `r${it.versao}:${it.hash}`).join(" ");
  return montarBytes(d.paginas, titulo, assunto);
}

/** Nome do arquivo: roteiro-cliente-titulo-r3.pdf, sem acento nem espaço. */
export function nomeDoArquivoPdf(cliente: string, itens: ItemDoPdf[]): string {
  const limpar = (t: string) =>
    String(t || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
  const base = itens.length === 1 ? `roteiro-${limpar(cliente)}-${limpar(itens[0].roteiro.titulo)}-r${itens[0].versao}` : `roteiros-${limpar(cliente)}-${itens.length}-videos`;
  return `${base.replace(/-+/g, "-")}.pdf`;
}

// ------------------------------------------------------------------ leitura (testes e conferência)

/**
 * Textos das páginas, na ordem em que foram desenhados (lê os literais dos
 * fluxos, que ficam sem compressão). Serve para conferir que o PDF tem os
 * blocos, sem depender de leitor de PDF.
 */
export function textosDoPdf(bytes: Uint8Array): string[] {
  let bruto = "";
  for (let i = 0; i < bytes.length; i++) bruto += String.fromCharCode(bytes[i]);
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
  let bruto = "";
  for (let i = 0; i < bytes.length; i++) bruto += String.fromCharCode(bytes[i]);
  const m = /\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(bruto);
  return m ? Number(m[1]) : 0;
}
