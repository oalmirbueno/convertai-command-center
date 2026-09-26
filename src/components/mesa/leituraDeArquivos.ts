/**
 * Arquivos e ZIP no agente do Mês (dono, 26/09: "dá pra enviar zip e ele lê,
 * e também arquivos"). Tudo é lido AQUI, no navegador: o servidor recebe só o
 * texto (e as imagens seguem pelo caminho de sempre, como anexo de imagem).
 *
 * - Texto (.txt, .md, .csv, .tsv, .json, .xml, .html, .yaml, .srt, .vtt): direto.
 * - Word (.docx), planilha (.xlsx) e apresentação (.pptx): abertos com o jszip
 *   (já no projeto) e o texto sai do XML de dentro.
 * - PDF: pdfjs-dist (já no projeto), página por página.
 * - ZIP: aberto com o jszip; cada arquivo de dentro passa pelas mesmas regras
 *   (ZIP dentro de ZIP não abre). Imagens de dentro viram anexos de imagem.
 * - O que não dá para ler volta com o motivo, para a tela mostrar.
 *
 * Compatível com Safari 11 / Chrome 64: FileReader em vez de File.arrayBuffer
 * e Blob.text, regex sem lookbehind nem grupo nomeado. As bibliotecas só
 * baixam quando um arquivo desses é anexado.
 */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";

export const MAX_BYTES_DO_ZIP = 50 * 1024 * 1024;
export const MAX_BYTES_DO_ARQUIVO = 50 * 1024 * 1024;
export const MAX_ARQUIVOS_NO_ZIP = 200;
/** Arquivo de dentro do ZIP descompactado (proteção contra ZIP-bomba). */
export const MAX_BYTES_DESCOMPACTADO = 40 * 1024 * 1024;
/** Espelho de MAX_CHARS_POR_ARQUIVO e MAX_CHARS_DOS_ARQUIVOS em supabase/functions/agente-calendario/agente-mes-v2.ts. */
export const MAX_CHARS_POR_ARQUIVO = 400_000;
export const MAX_CHARS_DOS_ARQUIVOS = 1_200_000;
export const MAX_PAGINAS_DO_PDF = 300;

export type TipoDeArquivo = "texto" | "planilha" | "pdf" | "word" | "apresentacao" | "zip" | "imagem" | "antigo" | "desconhecido";

export interface ArquivoLidoNaTela {
  id: string;
  nome: string;
  tipo: TipoDeArquivo;
  tamanho: number;
  caracteres: number;
  /** Nome do ZIP de onde saiu. */
  origem: string | null;
  texto: string;
  cortado: boolean;
}

export interface ArquivoNaoLidoNaTela {
  id: string;
  nome: string;
  motivo: string;
  tamanho: number | null;
  origem: string | null;
}

export interface ResultadoDaLeitura {
  lidos: ArquivoLidoNaTela[];
  naoLidos: ArquivoNaoLidoNaTela[];
  /** Imagens (soltas não entram aqui; estas saíram de dentro de ZIP) para subir como anexo de imagem. */
  imagens: File[];
}

const TEXTO = /\.(txt|md|markdown|csv|tsv|json|xml|html?|ya?ml|srt|vtt|log|rtf)$/i;
const PLANILHA_TEXTO = /\.(csv|tsv)$/i;

export function extensaoDe(nome: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(String(nome || ""));
  return m ? m[1].toLowerCase() : "";
}

/** O que é o arquivo, pelo nome e pelo tipo. */
export function tipoDoArquivo(nome: string, mime?: string | null): TipoDeArquivo {
  const ext = extensaoDe(nome);
  const m = String(mime || "").toLowerCase();
  if (ext === "zip" || m === "application/zip" || m === "application/x-zip-compressed") return "zip";
  if (ext === "pdf" || m === "application/pdf") return "pdf";
  if (ext === "docx") return "word";
  if (ext === "xlsx") return "planilha";
  if (ext === "pptx") return "apresentacao";
  if (ext === "doc" || ext === "xls" || ext === "ppt") return "antigo";
  if (ext === "jpg" || ext === "jpeg" || ext === "png" || ext === "webp" || m === "image/jpeg" || m === "image/png" || m === "image/webp") return "imagem";
  if (PLANILHA_TEXTO.test(nome)) return "planilha";
  if (TEXTO.test(nome) || m.indexOf("text/") === 0 || m === "application/json") return "texto";
  return "desconhecido";
}

let sequencia = 0;
const novoId = (p: string) => {
  sequencia += 1;
  return `${p}${Date.now().toString(36)}${sequencia}`;
};

function lerComo(blob: Blob, modo: "texto" | "bytes"): Promise<string | ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string | ArrayBuffer);
    r.onerror = () => reject(r.error || new Error("Não deu para abrir o arquivo."));
    if (modo === "texto") r.readAsText(blob);
    else r.readAsArrayBuffer(blob);
  });
}

async function carregarZip(): Promise<any> {
  const mod: any = await import("jszip");
  return mod.default || mod;
}

let pdfjsPronto: Promise<any> | null = null;
function carregarPdfjs(): Promise<any> {
  if (!pdfjsPronto) {
    pdfjsPronto = import("pdfjs-dist").then((pdfjs: any) => {
      if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
      return pdfjs;
    });
    pdfjsPronto.catch(() => {
      pdfjsPronto = null;
    });
  }
  return pdfjsPronto;
}

/** Entidades XML mais comuns e numéricas. */
export function decodificarXml(s: string): string {
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Texto do word/document.xml de um .docx: um parágrafo por linha, tabulações e quebras preservadas. */
export function textoDoDocx(xml: string): string {
  const corpo = String(xml || "").replace(/<w:tab\/>/g, "\t").replace(/<w:br\/>/g, "\n");
  const paragrafos = corpo.split(/<\/w:p>/);
  const linhas = paragrafos.map((p) => {
    const partes: string[] = [];
    const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|(\t)|(\n)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(p))) partes.push(m[1] !== undefined ? decodificarXml(m[1]) : m[2] ? "\t" : "\n");
    return partes.join("");
  });
  return linhas.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Coluna (A=0, B=1, AA=26...) da referência de célula "B12". */
export function colunaDaCelula(ref: string): number {
  const letras = (/^([A-Z]+)/i.exec(String(ref || "")) || ["", ""])[1].toUpperCase();
  let n = 0;
  for (let i = 0; i < letras.length; i++) n = n * 26 + (letras.charCodeAt(i) - 64);
  return Math.max(0, n - 1);
}

/** Textos compartilhados de uma planilha (xl/sharedStrings.xml). */
export function textosCompartilhados(xml: string): string[] {
  const saida: string[] = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(xml || "")))) {
    const partes: string[] = [];
    const rt = /<t(?:\s[^>]*)?>([^<]*)<\/t>/g;
    let t: RegExpExecArray | null;
    while ((t = rt.exec(m[1]))) partes.push(decodificarXml(t[1]));
    saida.push(partes.join(""));
  }
  return saida;
}

/** Linhas de uma aba (xl/worksheets/sheetN.xml), células separadas por " | " na posição da coluna. */
export function linhasDaAba(xml: string, compartilhados: string[]): string[] {
  const linhas: string[] = [];
  const reLinha = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let l: RegExpExecArray | null;
  while ((l = reLinha.exec(String(xml || "")))) {
    const celulas: string[] = [];
    const reCel = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let c: RegExpExecArray | null;
    while ((c = reCel.exec(l[1]))) {
      const attrs = c[1] || "";
      const dentro = c[2] || "";
      const ref = (/\br="([A-Z]+\d+)"/i.exec(attrs) || ["", ""])[1];
      const tipo = (/\bt="([a-zA-Z]+)"/.exec(attrs) || ["", ""])[1];
      let valor = "";
      if (tipo === "inlineStr") {
        const partes: string[] = [];
        const rt = /<t(?:\s[^>]*)?>([^<]*)<\/t>/g;
        let t: RegExpExecArray | null;
        while ((t = rt.exec(dentro))) partes.push(decodificarXml(t[1]));
        valor = partes.join("");
      } else {
        const v = /<v>([^<]*)<\/v>/.exec(dentro);
        if (v) valor = tipo === "s" ? compartilhados[Number(v[1])] || "" : decodificarXml(v[1]);
      }
      const col = ref ? colunaDaCelula(ref) : celulas.length;
      while (celulas.length < col) celulas.push("");
      celulas[col] = valor.replace(/\s+/g, " ").trim();
    }
    while (celulas.length && !celulas[celulas.length - 1]) celulas.pop();
    if (celulas.length) linhas.push(celulas.join(" | "));
  }
  return linhas;
}

/** Texto de um slide (ppt/slides/slideN.xml): um parágrafo por linha. */
export function textoDoSlide(xml: string): string {
  return String(xml || "")
    .split(/<\/a:p>/)
    .map((p) => {
      const partes: string[] = [];
      const re = /<a:t>([^<]*)<\/a:t>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(p))) partes.push(decodificarXml(m[1]));
      return partes.join("");
    })
    .filter((x) => x.trim())
    .join("\n");
}

const numeroNoNome = (n: string) => Number((/(\d+)\.xml$/.exec(n) || ["", "0"])[1]);

/** Arquivos de dentro de um pacote Office (docx, xlsx, pptx) ou de um ZIP, já abertos. */
type Pacote = { file: (nome: string) => any; files: Record<string, any> };

async function textoDoPacoteOffice(zip: Pacote, tipo: TipoDeArquivo): Promise<string> {
  const ler = async (n: string) => {
    const f = zip.file(n);
    return f ? String(await f.async("string")) : "";
  };
  const nomes = Object.keys(zip.files);
  if (tipo === "word") return textoDoDocx(await ler("word/document.xml"));
  if (tipo === "apresentacao") {
    const slides = nomes.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => numeroNoNome(a) - numeroNoNome(b));
    const partes: string[] = [];
    for (let i = 0; i < slides.length; i++) {
      const t = textoDoSlide(await ler(slides[i]));
      if (t) partes.push(`Lâmina ${i + 1}:\n${t}`);
    }
    return partes.join("\n\n");
  }
  // Planilha: cada aba com o nome dela.
  const compartilhados = textosCompartilhados(await ler("xl/sharedStrings.xml"));
  const workbook = await ler("xl/workbook.xml");
  const nomesDasAbas: string[] = [];
  const reAba = /<sheet\b[^>]*\bname="([^"]*)"/g;
  let a: RegExpExecArray | null;
  while ((a = reAba.exec(workbook))) nomesDasAbas.push(decodificarXml(a[1]));
  const abas = nomes.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((x, y) => numeroNoNome(x) - numeroNoNome(y));
  const partes: string[] = [];
  for (let i = 0; i < abas.length; i++) {
    const linhas = linhasDaAba(await ler(abas[i]), compartilhados);
    if (linhas.length) partes.push(`Aba ${nomesDasAbas[i] || i + 1}:\n${linhas.join("\n")}`);
  }
  return partes.join("\n\n");
}

async function textoDoPdf(bytes: ArrayBuffer, maxChars: number): Promise<string> {
  const pdfjs = await carregarPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  const paginas: string[] = [];
  let total = 0;
  const n = Math.min(doc.numPages, MAX_PAGINAS_DO_PDF);
  for (let i = 1; i <= n; i++) {
    const pagina = await doc.getPage(i);
    const conteudo = await pagina.getTextContent();
    const t = (conteudo.items as Array<{ str?: string; hasEOL?: boolean }>).map((it) => `${it.str || ""}${it.hasEOL ? "\n" : " "}`).join("").trim();
    paginas.push(`Página ${i}:\n${t}`);
    total += t.length;
    if (total > maxChars) break;
  }
  return paginas.join("\n\n");
}

const MIME_DA_IMAGEM: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Um arquivo de dentro do ZIP como File (para subir como anexo de imagem). */
function comoArquivo(bytes: Uint8Array | ArrayBuffer, nome: string): File | null {
  const tipo = MIME_DA_IMAGEM[extensaoDe(nome)];
  if (!tipo) return null;
  try {
    return new File([bytes], nome.split("/").pop() || nome, { type: tipo });
  } catch {
    return null;
  }
}

const tamanhoLegivel = (b: number) => (b >= 1024 * 1024 ? `${(b / (1024 * 1024)).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
export { tamanhoLegivel };

type Fonte = { nome: string; tamanho: number; origem: string | null; mime?: string | null; bytes: () => Promise<ArrayBuffer | Uint8Array>; texto: () => Promise<string> };

/** Lê uma fonte (arquivo solto ou de dentro do ZIP) conforme o tipo. */
async function lerFonte(f: Fonte, orcamento: { chars: number }, saida: ResultadoDaLeitura) {
  const tipo = tipoDoArquivo(f.nome, f.mime);
  const naoLido = (motivo: string) => saida.naoLidos.push({ id: novoId("n"), nome: f.nome, motivo, tamanho: f.tamanho, origem: f.origem });
  if (tipo === "antigo") return naoLido("Formato antigo: salve como .docx, .xlsx, .pptx ou PDF e anexe de novo.");
  if (tipo === "desconhecido") return naoLido("Formato que o agente não lê.");
  if (tipo === "zip") return naoLido(f.origem ? "ZIP dentro de ZIP não é aberto." : "ZIP não abriu.");
  if (tipo === "imagem") {
    const arq = comoArquivo(await f.bytes(), f.nome);
    if (arq) saida.imagens.push(arq);
    else naoLido("Imagem que não deu para abrir.");
    return;
  }
  if (orcamento.chars <= 0) return naoLido(`Limite de ${MAX_CHARS_DOS_ARQUIVOS.toLocaleString("pt-BR")} caracteres por pedido atingido.`);
  let texto = "";
  try {
    if (tipo === "texto" || (tipo === "planilha" && PLANILHA_TEXTO.test(f.nome))) texto = await f.texto();
    else if (tipo === "pdf") texto = await textoDoPdf((await f.bytes()) as ArrayBuffer, Math.min(MAX_CHARS_POR_ARQUIVO, orcamento.chars));
    else {
      const JSZip = await carregarZip();
      const pacote = await JSZip.loadAsync(await f.bytes());
      texto = await textoDoPacoteOffice(pacote, tipo);
    }
  } catch {
    return naoLido(tipo === "pdf" ? "PDF que não deu para ler (protegido ou só imagem)." : "Arquivo corrompido ou protegido.");
  }
  texto = String(texto || "").replace(/\u0000/g, "").trim();
  if (!texto) return naoLido(tipo === "pdf" ? "PDF sem texto (só imagem): mande as páginas como imagem." : "Arquivo sem texto.");
  const limite = Math.min(MAX_CHARS_POR_ARQUIVO, orcamento.chars);
  const cortado = texto.length > limite;
  if (cortado) texto = texto.slice(0, limite);
  orcamento.chars -= texto.length;
  saida.lidos.push({ id: novoId("l"), nome: f.nome, tipo, tamanho: f.tamanho, caracteres: texto.length, origem: f.origem, texto, cortado });
}

/** Abre o ZIP e lê o que dá de dentro, com os limites de tamanho e de quantidade. */
async function lerZip(arquivo: File, orcamento: { chars: number }, saida: ResultadoDaLeitura) {
  if (arquivo.size > MAX_BYTES_DO_ZIP) {
    saida.naoLidos.push({ id: novoId("n"), nome: arquivo.name, motivo: `ZIP acima de ${tamanhoLegivel(MAX_BYTES_DO_ZIP)}.`, tamanho: arquivo.size, origem: null });
    return;
  }
  let zip: Pacote;
  try {
    const JSZip = await carregarZip();
    zip = await JSZip.loadAsync(await lerComo(arquivo, "bytes"));
  } catch {
    saida.naoLidos.push({ id: novoId("n"), nome: arquivo.name, motivo: "ZIP que não abriu (corrompido ou com senha).", tamanho: arquivo.size, origem: null });
    return;
  }
  const entradas = Object.keys(zip.files)
    .map((n) => zip.files[n])
    .filter((e) => e && !e.dir && !/(^|\/)(__MACOSX|\.DS_Store)(\/|$)/.test(e.name) && !/(^|\/)\._/.test(e.name))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  entradas.forEach((e, i) => {
    if (i >= MAX_ARQUIVOS_NO_ZIP) saida.naoLidos.push({ id: novoId("n"), nome: e.name, motivo: `O ZIP passa de ${MAX_ARQUIVOS_NO_ZIP} arquivos: este ficou de fora.`, tamanho: null, origem: arquivo.name });
  });
  for (const e of entradas.slice(0, MAX_ARQUIVOS_NO_ZIP)) {
    const tamanho = Number(e._data && e._data.uncompressedSize) || 0;
    if (tamanho > MAX_BYTES_DESCOMPACTADO) {
      saida.naoLidos.push({ id: novoId("n"), nome: e.name, motivo: `Arquivo de dentro acima de ${tamanhoLegivel(MAX_BYTES_DESCOMPACTADO)}.`, tamanho, origem: arquivo.name });
      continue;
    }
    await lerFonte({
      nome: e.name,
      tamanho,
      origem: arquivo.name,
      bytes: () => e.async("uint8array"),
      texto: () => e.async("string"),
    }, orcamento, saida);
  }
}

/**
 * Lê os arquivos anexados (sem as imagens soltas, que seguem como anexo de
 * imagem). `jaUsados` são os caracteres já lidos em anexos anteriores do mesmo
 * pedido (o teto é por pedido).
 */
export async function lerArquivosDoAgente(arquivos: File[], jaUsados = 0): Promise<ResultadoDaLeitura> {
  const saida: ResultadoDaLeitura = { lidos: [], naoLidos: [], imagens: [] };
  const orcamento = { chars: Math.max(0, MAX_CHARS_DOS_ARQUIVOS - jaUsados) };
  for (const f of arquivos) {
    const tipo = tipoDoArquivo(f.name, f.type);
    if (tipo === "zip") {
      await lerZip(f, orcamento, saida);
      continue;
    }
    if (f.size > MAX_BYTES_DO_ARQUIVO) {
      saida.naoLidos.push({ id: novoId("n"), nome: f.name, motivo: `Arquivo acima de ${tamanhoLegivel(MAX_BYTES_DO_ARQUIVO)}.`, tamanho: f.size, origem: null });
      continue;
    }
    await lerFonte({
      nome: f.name,
      tamanho: f.size,
      origem: null,
      mime: f.type,
      bytes: async () => (await lerComo(f, "bytes")) as ArrayBuffer,
      texto: async () => String(await lerComo(f, "texto")),
    }, orcamento, saida);
  }
  return saida;
}

/** O que vai no corpo do pedido (planejar_mes): texto dos lidos e o motivo dos não lidos. */
export function arquivosParaOEnvio(lidos: ArquivoLidoNaTela[], naoLidos: ArquivoNaoLidoNaTela[]) {
  if (!lidos.length && !naoLidos.length) return null;
  return {
    lidos: lidos.map((a) => ({ nome: a.nome, tipo: a.tipo, tamanho: a.tamanho, origem: a.origem, texto: a.texto })),
    nao_lidos: naoLidos.map((a) => ({ nome: a.nome, motivo: a.motivo, tamanho: a.tamanho, origem: a.origem })),
  };
}
