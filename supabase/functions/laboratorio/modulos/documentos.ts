/**
 * laboratorio: documentos anexados a um nó (campo `arquivos` do Contexto e do Agente), em funções
 * puras. A leitura (Storage, RLS) fica em ../documentos.ts.
 *
 * Não existe leitor de PDF nem de Word em _shared: texto puro (txt, md, csv, json, html, xml) entra
 * no contexto com teto; o resto entra só com o nome e o endereço, e o modelo é avisado disso.
 */

export type DocumentoDoNo = { id: string; nome: string; url: string; tipo: string; path: string };

/** No máximo 8 documentos por nó. */
export const MAX_DOCUMENTOS = 8;
/** Não baixa arquivo maior que isso para ler como texto. */
export const MAX_BYTES_LIDOS = 400 * 1024;
/** Teto de caracteres de cada documento e de todos juntos. */
export const TETO_POR_DOCUMENTO = 6000;
export const TETO_DOS_DOCUMENTOS = 16000;

const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Lê `dados.arquivos` como veio do canvas, descartando o que não serve. */
export function documentosDe(bruto: unknown): DocumentoDoNo[] {
  if (!Array.isArray(bruto)) return [];
  const saida: DocumentoDoNo[] = [];
  for (const item of bruto) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const nome = texto(o.nome, 200) || texto(o.name, 200);
    const path = texto(o.path, 500);
    const id = texto(o.id, 80);
    if (!nome && !path && !id) continue;
    saida.push({ id, nome: nome || path.split("/").pop() || "Documento", url: texto(o.url, 2000), tipo: texto(o.tipo, 120), path });
    if (saida.length >= MAX_DOCUMENTOS) break;
  }
  return saida;
}

/** Dá para ler como texto puro? (pelo tipo ou pela extensão) */
export function ehTextoPuro(mime: string, nome: string): boolean {
  const m = (mime || "").toLowerCase();
  if (m.indexOf("text/") === 0) return true;
  if (["application/json", "application/xml", "application/x-yaml", "application/yaml", "application/csv"].indexOf(m) >= 0) return true;
  return /\.(txt|md|markdown|csv|tsv|json|html?|xml|ya?ml)$/i.test(nome || "");
}

/** HTML vira texto corrido (sem script, estilo nem marcação). */
export function textoDoHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/(script|style)>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/** O que foi lido de cada documento: o texto, ou o motivo de não ter texto e o endereço. */
export type DocumentoLido = { nome: string; tipo: string; texto?: string; url?: string | null; motivo?: string };

/** O bloco que entra no contexto do nó, com o teto total. */
export function blocoDosDocumentos(lidos: DocumentoLido[]): string {
  if (!lidos.length) return "";
  const partes: string[] = [];
  let resta = TETO_DOS_DOCUMENTOS;
  for (const d of lidos) {
    if (d.texto && resta > 200) {
      const corte = d.texto.slice(0, Math.min(TETO_POR_DOCUMENTO, resta));
      resta -= corte.length;
      partes.push(`[Documento: ${d.nome}]\n${corte}${corte.length < d.texto.length ? "\n(…cortado)" : ""}`);
    } else {
      const onde = d.url ? ` Endereço: ${d.url}` : "";
      partes.push(`[Documento: ${d.nome}${d.tipo ? ` (${d.tipo})` : ""}] ${d.motivo || "Sem texto lido aqui."}${onde}`);
    }
  }
  return partes.join("\n\n");
}
