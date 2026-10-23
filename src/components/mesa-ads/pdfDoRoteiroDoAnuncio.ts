import {
  ALTURA,
  CORES,
  caixaAlta,
  dataDoDocumento,
  dois,
  DocumentoPdf,
  ESQ,
  type Fonte,
  MESES,
  MIOLO,
  montarPdf,
  Pagina,
  quebrarLinhas,
  rotuloEmCima,
  tituloDeSecao,
} from "../../../supabase/functions/_shared/pdf-base";
import { segundosDaFala, type Roteiro } from "../../../supabase/functions/_shared/roteiro-modelo";

/**
 * PDF do roteiro de anúncio em vídeo (Mesa Ads > Estúdio > Vídeo > Gravar),
 * para a equipe gravar: capa com cliente, oferta e formato; tabela de cenas
 * (plano e ação, fala, texto na tela, tempo); direção (ambientação, figurino,
 * objetos, ritmo e corte) e o teleprompter. No modo "só a fala" sai a capa e
 * o teleprompter. Mesmo padrão do documento da casa (pdf-base.ts: A4, faixa
 * verde, logo, rodapé "02 / 05"), montado no navegador; nada vai para a rede.
 * Texto nunca é cortado: linha que não cabe vai para a página seguinte.
 * Compatível com Safari 11. Sem travessão.
 */

export type DocumentoDoAnuncio = {
  cliente: string;
  roteiro: Roteiro;
  modo: "completo" | "fala";
  criativo: string;
  oferta: string | null;
  cta: string | null;
  /** "Versão 2, nota 4,1 contra 3,6: mais forte em gancho." */
  porque?: string | null;
  estrutura?: string | null;
  referencias?: Array<{ titulo: string; url: string }>;
  versao: number;
  rascunho: boolean;
  data?: string | Date;
};

const SECAO = "ROTEIRO DO ANÚNCIO";

/** O roteiro saiu só com a fala (teleprompter)? Vale para quem reabre sem saber o modo. */
export const ehSoFala = (r: Roteiro) => r.blocos.length > 0 && r.blocos.every((b) => !b.visual && !b.texto_na_tela && !b.broll);

/** Tempo de leitura em voz alta (2,5 palavras por segundo), cena a cena e no total. */
export function tempoDeLeitura(r: Roteiro): { porCena: number[]; total: number } {
  const porCena = r.blocos.map((b) => (b.fala.trim() ? segundosDaFala(b.fala) : 0));
  return { porCena, total: porCena.reduce((a, b) => a + b, 0) };
}

function capa(d: DocumentoPdf, doc: DocumentoDoAnuncio, data: Date) {
  const r = doc.roteiro;
  const p = new Pagina(SECAO);
  p.rascunho = doc.rascunho;
  d.paginas.push(p);
  p.retangulo(0, 0, 4, ALTURA, CORES.verde);
  p.logo(205.6, 35, 184);
  rotuloEmCima(p, ESQ, 118, `Anúncio em vídeo  /  ${caixaAlta(MESES[data.getMonth()])} ${data.getFullYear()}${doc.rascunho ? "  /  RASCUNHO" : ""}`);
  const titulo = doc.modo === "fala" ? "Texto da fala para gravar" : "Roteiro para gravar o anúncio";
  const linhas = quebrarLinhas(titulo, "F2", 30, 420);
  linhas.forEach((l, i) => p.texto(ESQ, 162 + i * 34, l, "F2", 30, CORES.tinta));
  let y = 162 + (linhas.length - 1) * 34 + 26;
  y = p.paragrafo(ESQ, y, doc.criativo, "F1", 11.2, CORES.cinza, MIOLO, 14) + 8;
  y = p.paragrafo(ESQ, y, doc.cliente, "F2", 16, CORES.tinta, MIOLO, 19) + 4;
  p.texto(ESQ, y, `${data.getDate()} de ${MESES[data.getMonth()]} de ${data.getFullYear()}  /  versão ${doc.versao}`, "F1", 9.1, CORES.cinza);
  y += 22;
  p.linha(ESQ, y, MIOLO);
  y += 32;
  const leitura = tempoDeLeitura(r);
  const colunas: Array<[string, string]> = [
    [r.formato || "9:16", r.formato === "9:16" ? "REELS E STORIES" : r.formato === "4:5" ? "FEED" : "HORIZONTAL"],
    [`${r.duracao_alvo_s}s`, `FALA LIDA EM ~${leitura.total}s`],
    [dois(r.blocos.length), r.blocos.length === 1 ? "CENA" : "CENAS"],
  ];
  colunas.forEach(([valor, rotulo], i) => {
    const x = ESQ + i * 172;
    p.texto(x, y, valor, "F2", 24, CORES.tinta);
    p.texto(x, y + 24, rotulo, "F2", 7.6, CORES.verdeEscuro);
  });
  y += 58;
  const linhaDaCapa = (rotulo: string, valor: string | null | undefined) => {
    if (!valor) return;
    rotuloEmCima(p, ESQ, y, rotulo);
    y = p.paragrafo(ESQ, y + 16, valor, "F1", 10.6, CORES.tinta, MIOLO, 14) + 14;
  };
  linhaDaCapa("Oferta", doc.oferta);
  linhaDaCapa("Chamada final (CTA)", r.cta || doc.cta);
  linhaDaCapa("Estrutura", [doc.estrutura || r.subtitulo, doc.porque].filter(Boolean).join(". "));
  const gancho = r.ganchos[r.gancho_escolhido];
  if (gancho && y < 660) {
    const h = 26 + quebrarLinhas(gancho.texto, "F2", 14, MIOLO - 36).length * 18;
    p.arredondado(ESQ, y, MIOLO, h + 10, 7, CORES.tinta);
    p.texto(ESQ + 18, y + 20, "GANCHO DOS 3 PRIMEIROS SEGUNDOS", "F2", 7.6, CORES.verdeClaro);
    p.paragrafo(ESQ + 18, y + 40, gancho.texto, "F2", 14, CORES.branco, MIOLO - 36, 18);
    y += h + 30;
  }
  const guia = doc.modo === "fala"
    ? "Página 2: teleprompter, cena por cena, com o tempo de leitura."
    : "Página 2: tabela de cenas. Depois: direção de gravação e teleprompter.";
  p.paragrafo(ESQ, Math.max(y, 752), guia, "F1", 9.1, CORES.cinza, MIOLO, 12);
}

// Colunas da tabela de cenas: nº, tempo, plano e ação, fala, texto na tela.
const COLUNAS = [
  { rotulo: "Nº", largura: 24 },
  { rotulo: "Tempo", largura: 40 },
  { rotulo: "Plano e ação", largura: 140 },
  { rotulo: "Fala", largura: 196 },
  { rotulo: "Texto na tela", largura: 115 },
];
const CORPO = 8.6;
const ENTRE = 11;

function cabecalhoDaTabela(d: DocumentoPdf) {
  const p = d.atual();
  let x = ESQ;
  p.retangulo(ESQ, d.y - 12, MIOLO, 20, CORES.cartaoVerde);
  COLUNAS.forEach((c) => {
    p.texto(x + 4, d.y + 1, caixaAlta(c.rotulo), "F2", 7.2, CORES.verdeEscuro);
    x += c.largura;
  });
  d.y += 18;
}

function tabelaDeCenas(d: DocumentoPdf, r: Roteiro) {
  d.nova(SECAO);
  tituloDeSecao(d, "Cenas", "Tabela de cenas", "Enquadramento e plano, fala, texto na tela e tempo de cada cena. Grave cada cena em mais de um take.");
  cabecalhoDaTabela(d);
  let inicio = 0;
  r.blocos.forEach((b, i) => {
    const celulas: Array<{ t: string; f: Fonte }> = [
      { t: dois(i + 1), f: "F2" },
      { t: `${inicio}-${inicio + b.segundos}s`, f: "F1" },
      { t: [b.funcao ? caixaAlta(b.funcao) : "", b.visual, b.broll ? `Apoio: ${b.broll}` : ""].filter(Boolean).join("\n"), f: "F1" },
      { t: b.fala || "(sem fala)", f: i === 0 ? "F2" : "F1" },
      { t: b.texto_na_tela || "", f: "F2" },
    ];
    inicio += b.segundos;
    const linhas = celulas.map((c, k) => c.t.split("\n").reduce((acc: string[], parte) => acc.concat(quebrarLinhas(parte, c.f, CORPO, COLUNAS[k].largura - 8)), []));
    const altura = Math.max.apply(null, linhas.map((l) => l.length)) * ENTRE + 12;
    d.garantir(altura, SECAO, () => cabecalhoDaTabela(d));
    const p = d.atual();
    let x = ESQ;
    linhas.forEach((ls, k) => {
      const cor = k === 2 && ls.length ? CORES.cinza : CORES.tinta;
      ls.forEach((l, j) => p.texto(x + 4, d.y + j * ENTRE, l, j === 0 && k === 2 && b.funcao ? "F2" : celulas[k].f, CORPO, j === 0 && k === 2 && b.funcao ? CORES.verdeEscuro : cor));
      x += COLUNAS[k].largura;
    });
    d.y += altura - 4;
    p.linha(ESQ, d.y - 8, MIOLO);
    d.y += 4;
  });
}

function direcao(d: DocumentoPdf, r: Roteiro) {
  const dd = r.direcao;
  const itens: Array<[string, string]> = [
    ["Ambientação e cenário", dd.ambiente],
    ["Enquadramento", dd.enquadramento],
    ["Figurino", dd.figurino],
    ["Objetos em cena", dd.objetos],
    ["Luz", dd.luz],
    ["Câmera", dd.camera],
    ["Ritmo e corte", dd.orientacoes.join(" ")],
  ].filter((x) => !!x[1]) as Array<[string, string]>;
  if (!itens.length && !r.broll.length) return;
  d.nova(SECAO);
  tituloDeSecao(d, "Direção", "Direção de gravação");
  itens.concat(r.broll.length ? [["Imagens de apoio", r.broll.join("; ")]] : []).forEach(([rotulo, valor]) => {
    const altura = 18 + quebrarLinhas(valor, "F1", 10.2, MIOLO).length * 14 + 12;
    d.garantir(altura, SECAO);
    const p = d.atual();
    rotuloEmCima(p, ESQ, d.y, rotulo);
    d.y = p.paragrafo(ESQ, d.y + 16, valor, "F1", 10.2, CORES.tinta, MIOLO, 14) + 12;
  });
}

function teleprompter(d: DocumentoPdf, r: Roteiro) {
  d.nova(SECAO);
  const leitura = tempoDeLeitura(r);
  tituloDeSecao(d, "Teleprompter", "Texto da fala", `Leia em voz alta: cerca de ${leitura.total} segundos para ${r.duracao_alvo_s}s de anúncio. Uma cena por vez; se errar, repita só aquela cena.`);
  r.blocos.forEach((b, i) => {
    if (!b.fala.trim()) return;
    const linhas = quebrarLinhas(b.fala, "F2", 17, MIOLO);
    const altura = 20 + linhas.length * 23 + 18;
    d.garantir(altura, SECAO);
    const p = d.atual();
    rotuloEmCima(p, ESQ, d.y, `Cena ${dois(i + 1)}  /  ${b.funcao || "fala"}  /  ~${leitura.porCena[i]}s`);
    d.y += 22;
    linhas.forEach((l, k) => p.texto(ESQ, d.y + k * 23, l, "F2", 17, i === 0 ? CORES.verdeEscuro : CORES.tinta));
    d.y += linhas.length * 23 + 14;
  });
  if (r.cta) {
    const altura = 20 + quebrarLinhas(r.cta, "F2", 17, MIOLO).length * 23;
    d.garantir(altura, SECAO);
    const p = d.atual();
    rotuloEmCima(p, ESQ, d.y, "Chamada final");
    d.y = p.paragrafo(ESQ, d.y + 22, r.cta, "F2", 17, CORES.verde, MIOLO, 23) + 8;
  }
}

function fontes(d: DocumentoDoAnuncio, doc: DocumentoPdf) {
  const r = d.roteiro;
  const linhas = [
    ...r.pendencias.map((x) => `Confirmar antes de gravar: ${x}`),
    ...(d.referencias || []).map((x) => `Referência: ${x.titulo} (${x.url})`),
  ];
  if (!linhas.length) return;
  doc.garantir(60, SECAO);
  const p = doc.atual();
  doc.y += 10;
  rotuloEmCima(p, ESQ, doc.y, "Pendências e referências");
  doc.y += 16;
  linhas.forEach((l) => {
    const altura = quebrarLinhas(l, "F1", 9, MIOLO).length * 12 + 4;
    doc.garantir(altura, SECAO);
    doc.y = doc.atual().paragrafo(ESQ, doc.y, l, "F1", 9, CORES.cinza, MIOLO, 12) + 4;
  });
}

/** Bytes do PDF. Não altera o texto do roteiro: sai a versão recebida. */
export function gerarPdfDoAnuncio(doc: DocumentoDoAnuncio): Uint8Array {
  if (!doc.roteiro.blocos.length) throw new Error("O roteiro ainda não tem cenas.");
  const data = dataDoDocumento(doc.data);
  const d = new DocumentoPdf(doc.cliente || "Cliente", doc.rascunho, "ANÚNCIO EM VÍDEO");
  capa(d, doc, data);
  if (doc.modo === "completo") {
    tabelaDeCenas(d, doc.roteiro);
    direcao(d, doc.roteiro);
  }
  teleprompter(d, doc.roteiro);
  fontes(doc, d);
  d.rodapes();
  return montarPdf(d.paginas, { titulo: `Roteiro do anúncio: ${doc.roteiro.titulo}`, assunto: `${doc.modo} r${doc.versao}`, produtor: "Aceleriq OS, Mesa Ads" });
}

/** roteiro-anuncio-cliente-titulo-r2.pdf, sem acento nem espaço. */
export function nomeDoPdfDoAnuncio(cliente: string, titulo: string, versao: number): string {
  const limpar = (t: string) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `roteiro-anuncio-${limpar(cliente)}-${limpar(titulo.replace(/^An[uú]ncio\s*·\s*/i, ""))}-r${versao}.pdf`.replace(/-+/g, "-");
}
