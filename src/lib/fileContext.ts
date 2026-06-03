// Extract textual context from an attached file so the Voice Assistant can
// reason over the document together with the user's spoken/typed command.

import * as pdfjs from "pdfjs-dist";
// Vite handles the ?url import so the worker is bundled correctly.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";

(pdfjs as any).GlobalWorkerOptions.workerSrc = pdfWorker;

export type FileKind = "text" | "pdf" | "image" | "binary";

export interface FileContext {
  fileName: string;
  size: number;
  kind: FileKind;
  mime: string;
  text: string;           // extracted text (may be empty for images/binary)
  truncated: boolean;     // whether `text` was clipped
  charCount: number;      // raw extracted length before truncation
  warning?: string;
}

const MAX_CHARS = 12_000; // keep prompt + UI reasonable

const isText = (mime: string, name: string) =>
  mime.startsWith("text/") ||
  /\.(txt|md|markdown|csv|tsv|json|yaml|yml|log|xml|html|htm)$/i.test(name);

const isPdf = (mime: string, name: string) =>
  mime === "application/pdf" || /\.pdf$/i.test(name);

const isImage = (mime: string) => mime.startsWith("image/");

async function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

async function readPdf(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const doc = await (pdfjs as any).getDocument({ data: buf }).promise;
  const pages: string[] = [];
  const maxPages = Math.min(doc.numPages, 30);
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((it: any) => it.str).join(" ");
    pages.push(text);
    if (pages.join("\n").length > MAX_CHARS * 1.2) break;
  }
  return pages.join("\n\n");
}

export async function readFileContext(file: File): Promise<FileContext> {
  const mime = file.type || "";
  const name = file.name || "arquivo";
  const base: Omit<FileContext, "kind" | "text" | "truncated" | "charCount"> = {
    fileName: name, size: file.size, mime,
  };
  try {
    if (isText(mime, name)) {
      const raw = await readAsText(file);
      const truncated = raw.length > MAX_CHARS;
      return {
        ...base, kind: "text",
        text: truncated ? raw.slice(0, MAX_CHARS) : raw,
        truncated, charCount: raw.length,
      };
    }
    if (isPdf(mime, name)) {
      const raw = await readPdf(file);
      const truncated = raw.length > MAX_CHARS;
      return {
        ...base, kind: "pdf",
        text: truncated ? raw.slice(0, MAX_CHARS) : raw,
        truncated, charCount: raw.length,
      };
    }
    if (isImage(mime)) {
      return {
        ...base, kind: "image", text: "", truncated: false, charCount: 0,
        warning: "Imagens são anexadas, mas o texto não é extraído automaticamente.",
      };
    }
    return {
      ...base, kind: "binary", text: "", truncated: false, charCount: 0,
      warning: "Formato binário — anexo será salvo, mas não foi possível ler o conteúdo.",
    };
  } catch (err: any) {
    return {
      ...base, kind: "binary", text: "", truncated: false, charCount: 0,
      warning: err?.message || "Falha ao ler arquivo",
    };
  }
}

/** Short, single-line summary line for the UI / logs. */
export function describeContext(ctx: FileContext): string {
  if (ctx.kind === "image") return `🖼️ ${ctx.fileName}`;
  if (ctx.kind === "binary") return `📎 ${ctx.fileName}`;
  const kb = Math.round(ctx.size / 1024);
  return `📄 ${ctx.fileName} · ${ctx.charCount.toLocaleString()} chars${ctx.truncated ? " (truncado)" : ""} · ${kb}KB`;
}
