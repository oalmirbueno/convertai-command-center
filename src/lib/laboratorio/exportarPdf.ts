import type { PDFFont } from "pdf-lib";
import type { DocumentoDoProjeto } from "./exportar";

/** Quebra por largura real, inclusive caminhos e palavras sem espaços. Nenhum conteúdo é truncado. */
export function linhasDoPdf(texto: string, largura: number, medir: (s: string) => number): string[] {
  if (!texto) return [""];
  const linhas: string[] = [];
  let atual = "";
  for (const palavra of texto.split(/\s+/)) {
    if (!palavra) continue;
    if (atual && medir(`${atual} ${palavra}`) <= largura) { atual += ` ${palavra}`; continue; }
    if (atual) { linhas.push(atual); atual = ""; }
    if (medir(palavra) <= largura) { atual = palavra; continue; }
    // O texto pode conter IDs, URLs e JSON sem espaços: esses trechos também cabem na página.
    for (const c of Array.from(palavra)) {
      if (atual && medir(atual + c) > largura) { linhas.push(atual); atual = ""; }
      atual += c;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

function textoNaFonte(texto: string, caracteres: Set<number>): { texto: string; substituicoes: number } {
  let substituicoes = 0;
  const seguro = Array.from(texto.normalize("NFC")).map((c) => {
    const cp = c.codePointAt(0)!;
    if (c === "\t") return "    ";
    if (cp < 32 || cp >= 0xd800 && cp <= 0xdfff || cp === 0xfffe || cp === 0xffff) return "";
    if (caracteres.has(cp)) return c;
    substituicoes += 1;
    return `[U+${cp.toString(16).toUpperCase()}]`;
  }).join("");
  return { texto: seguro, substituicoes };
}

async function fonteDoPainel(): Promise<Uint8Array> {
  const resposta = await fetch("/editor/fontes/Figtree-Variable.ttf", { credentials: "omit", cache: "force-cache" });
  if (!resposta.ok) throw new Error("Não foi possível carregar a fonte do PDF. Tente novamente.");
  return new Uint8Array(await resposta.arrayBuffer());
}

/** PDF verdadeiro montado no navegador. Motor e fonte só carregam ao pedir o download. */
export async function pdfDoProjeto(documento: DocumentoDoProjeto, fonteBytes?: Uint8Array): Promise<Blob> {
  const [{ PDFDocument, rgb }, { default: fontkit }, bytes] = await Promise.all([import("pdf-lib"), import("@pdf-lib/fontkit"), fonteBytes ? Promise.resolve(fonteBytes) : fonteDoPainel()]);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fonte: PDFFont = await pdf.embedFont(bytes, { subset: true });
  const caracteres = new Set(fonte.getCharacterSet());
  pdf.setTitle(documento.titulo);
  pdf.setSubject("Documentação do Canvas do Laboratório");
  pdf.setCreator("Aceleriq Laboratório");
  pdf.setLanguage("pt-BR");
  const largura = 595.28;
  const altura = 841.89;
  const margem = 48;
  const util = largura - margem * 2;
  const rodape = 45;
  let pagina = pdf.addPage([largura, altura]);
  let y = altura - 58;
  let simbolos = 0;
  const novaPagina = () => { pagina = pdf.addPage([largura, altura]); y = altura - 58; };
  for (const original of documento.markdown.split("\n")) {
    if (!original.trim()) { y -= 5; continue; }
    const cabecalho = /^(#{1,4}) (.+)$/.exec(original);
    const nivel = cabecalho ? cabecalho[1].length : 0;
    const tamanho = nivel === 1 ? 24 : nivel === 2 ? 16 : nivel === 3 ? 13 : nivel === 4 ? 11.5 : 10.5;
    const entrelinha = tamanho * 1.45;
    const antes = nivel ? nivel === 1 ? 0 : 13 : 0;
    const convertido = textoNaFonte(cabecalho ? cabecalho[2] : original, caracteres);
    simbolos += convertido.substituicoes;
    const linhas = linhasDoPdf(convertido.texto, util, (t) => fonte.widthOfTextAtSize(t, tamanho));
    // Um título não fica sozinho no pé: reserva pelo menos duas linhas de conteúdo após ele.
    if (y - antes - entrelinha * Math.min(linhas.length + (nivel ? 2 : 0), 4) < rodape + 18) novaPagina();
    y -= antes;
    for (const linha of linhas) {
      if (y - entrelinha < rodape) novaPagina();
      pagina.drawText(linha, { x: margem, y, font: fonte, size: tamanho, color: nivel ? rgb(0.07, 0.07, 0.07) : rgb(0.15, 0.15, 0.15) });
      y -= entrelinha;
    }
    y -= nivel ? 5 : 3;
  }
  if (simbolos) {
    const aviso = "Símbolos sem desenho na fonte aparecem como [U+XXXX]. O documento Word, o Markdown e a base JSON preservam o texto original completo.";
    const linhas = linhasDoPdf(aviso, util, (t) => fonte.widthOfTextAtSize(t, 9));
    if (y - linhas.length * 13 < rodape) novaPagina();
    for (const linha of linhas) { pagina.drawText(linha, { x: margem, y, font: fonte, size: 9, color: rgb(0.35, 0.35, 0.35) }); y -= 13; }
  }
  const total = pdf.getPageCount();
  const cabecalho = textoNaFonte("Aceleriq Laboratório", caracteres).texto;
  for (const [indice, folha] of pdf.getPages().entries()) {
    folha.drawText(cabecalho, { x: margem, y: altura - 28, font: fonte, size: 8, color: rgb(0.4, 0.4, 0.4) });
    const numero = `${indice + 1} / ${total}`;
    folha.drawText(numero, { x: largura - margem - fonte.widthOfTextAtSize(numero, 8), y: 25, font: fonte, size: 8, color: rgb(0.4, 0.4, 0.4) });
  }
  return new Blob([Uint8Array.from(await pdf.save())], { type: "application/pdf" });
}
