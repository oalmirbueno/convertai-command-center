import { ehTexto, LIMITES_DA_IMPORTACAO, normalizarCaminho, PASTAS_FORA, type AnaliseDaImportacao, type ArquivoDaImportacao } from "../../../supabase/functions/mesa-site/modulos/importacao-do-site";
import { LIMITES_DO_EDITOR } from "../../../supabase/functions/mesa-site/modulos/editor-de-codigo";

/**
 * Arquivos no navegador para a Mesa Site (Gravyx, 19/10/2026): ler o que a
 * pessoa escolheu para importar (zip, pasta ou um HTML), montar o zip limpo
 * que sobe para o Storage e abrir o zip do código para o editor. O jszip só
 * carrega aqui, sob demanda (fora do pacote principal do painel).
 */

export type ArquivoLocal = ArquivoDaImportacao & { dados: () => Promise<Uint8Array> };

type Jszip = {
  loadAsync: (d: Blob | ArrayBuffer | Uint8Array) => Promise<Jszip>;
  forEach: (fn: (rel: string, e: EntradaDoJszip) => void) => void;
  file: (nome: string, dados: Uint8Array) => void;
  generateAsync: (o: Record<string, unknown>) => Promise<Blob>;
};
type EntradaDoJszip = { dir: boolean; name: string; async: (t: "uint8array") => Promise<Uint8Array>; _data?: { uncompressedSize?: number } };

async function jszip(): Promise<{ new (): Jszip; loadAsync: Jszip["loadAsync"] }> {
  const m: any = await import("jszip");
  return (m && m.default) || m;
}

/** Blob.text() e Blob.arrayBuffer() só existem do Safari 14 em diante: o FileReader vale do Safari 11. */
function lerBlob(f: Blob, como: "texto" | "bytes"): Promise<string | Uint8Array> {
  return new Promise((resolver, rejeitar) => {
    const r = new FileReader();
    r.onerror = () => rejeitar(new Error("Não consegui ler o arquivo."));
    r.onload = () => resolver(como === "texto" ? String(r.result || "") : new Uint8Array(r.result as ArrayBuffer));
    if (como === "texto") r.readAsText(f, "utf-8");
    else r.readAsArrayBuffer(f);
  });
}
const lerTexto = (f: Blob) => lerBlob(f, "texto") as Promise<string>;
const lerBytes = (f: Blob) => lerBlob(f, "bytes") as Promise<Uint8Array>;

const decodificador = () => new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });
const dentroDeFora = (caminho: string) => caminho.split("/").some((p) => PASTAS_FORA.indexOf(p) >= 0);

/** Um zip escolhido pela pessoa: lista com tamanhos e o texto dos arquivos de texto pequenos. */
export async function lerZipLocal(f: File): Promise<ArquivoLocal[]> {
  if (f.size > LIMITES_DA_IMPORTACAO.zipBytes) throw new Error(`O zip tem mais de ${Math.round(LIMITES_DA_IMPORTACAO.zipBytes / (1024 * 1024))} MB.`);
  const Z = await jszip();
  const zip = await Z.loadAsync(f);
  const entradas: EntradaDoJszip[] = [];
  zip.forEach((_rel, e) => {
    if (!e.dir) entradas.push(e);
  });
  const dec = decodificador();
  const saida: ArquivoLocal[] = [];
  for (const e of entradas) {
    const caminho = e.name;
    const dados = () => e.async("uint8array");
    // Dependência e cache não são lidos (só contados): o zip de um projeto com node_modules abre rápido.
    if (dentroDeFora(caminho)) {
      saida.push({ caminho, bytes: (e._data && e._data.uncompressedSize) || 0, texto: null, dados });
      continue;
    }
    const bytes = await e.async("uint8array");
    const texto = ehTexto(caminho) && bytes.length <= LIMITES_DA_IMPORTACAO.textoVarridoBytes ? dec.decode(bytes) : null;
    saida.push({ caminho, bytes: bytes.length, texto, dados: async () => bytes });
  }
  return saida;
}

/** Uma pasta escolhida (input com webkitdirectory): o caminho vem do webkitRelativePath. */
export async function lerPastaLocal(arquivos: FileList | File[]): Promise<ArquivoLocal[]> {
  const saida: ArquivoLocal[] = [];
  for (const f of Array.from(arquivos)) {
    const caminho = String((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name);
    const dados = () => lerBytes(f);
    if (dentroDeFora(caminho)) {
      saida.push({ caminho, bytes: f.size, texto: null, dados });
      continue;
    }
    const texto = ehTexto(caminho) && f.size <= LIMITES_DA_IMPORTACAO.textoVarridoBytes ? await lerTexto(f) : null;
    saida.push({ caminho, bytes: f.size, texto, dados });
  }
  return saida;
}

/** Um HTML só. */
export async function lerHtmlLocal(f: File): Promise<ArquivoLocal[]> {
  const texto = f.size <= LIMITES_DA_IMPORTACAO.textoVarridoBytes ? await lerTexto(f) : null;
  return [{ caminho: f.name, bytes: f.size, texto, dados: () => lerBytes(f) }];
}

/**
 * O zip limpo que sobe: só os arquivos que a análise deixou, já sem a pasta
 * raiz única (o worker abre e confere de novo).
 */
export async function montarZipDaImportacao(locais: ArquivoLocal[], analise: AnaliseDaImportacao, html: boolean): Promise<Blob> {
  const Z = await jszip();
  const zip = new Z();
  const porCaminho = new Map<string, ArquivoLocal>();
  for (const l of locais) {
    const c = normalizarCaminho(l.caminho);
    if (c) porCaminho.set(c, l);
  }
  for (const a of analise.arquivos) {
    const local = html ? locais[0] : porCaminho.get(`${analise.raiz}${a.caminho}`);
    if (!local) throw new Error(`O arquivo ${a.caminho} sumiu da leitura. Escolha de novo.`);
    zip.file(a.caminho, await local.dados());
  }
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 }, mimeType: "application/zip" });
  if (blob.size > LIMITES_DA_IMPORTACAO.zipBytes) throw new Error(`Comprimido, o site ainda passa de ${Math.round(LIMITES_DA_IMPORTACAO.zipBytes / (1024 * 1024))} MB.`);
  return blob;
}

/** sha256 em hexadecimal (a trava de concorrência do editor). */
export async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  const v = new Uint8Array(d);
  let s = "";
  for (let i = 0; i < v.length; i++) s += (v[i] < 16 ? "0" : "") + v[i].toString(16);
  return s;
}

export async function sha256DoTexto(texto: string): Promise<string> {
  return sha256(new TextEncoder().encode(texto));
}

export type ArquivoDoCodigo = {
  caminho: string;
  bytes: number;
  /** Texto do arquivo (null = binário ou grande demais para o editor). */
  texto: string | null;
  sha: string | null;
  /** O arquivo usava CRLF (a caixa de texto do navegador troca por LF; o Salvar devolve). */
  crlf: boolean;
};

/** O zip do código que o motor guardou (raiz = nome do projeto), aberto para o editor. */
export async function abrirZipDoCodigo(url: string): Promise<ArquivoDoCodigo[]> {
  const r = await fetch(url);
  if (!r.ok) throw new Error("O código guardado não baixou. Tente de novo.");
  const Z = await jszip();
  const zip = await Z.loadAsync(await r.arrayBuffer());
  const entradas: EntradaDoJszip[] = [];
  zip.forEach((_rel, e) => {
    if (!e.dir) entradas.push(e);
  });
  const dec = decodificador();
  const saida: ArquivoDoCodigo[] = [];
  for (const e of entradas) {
    const partes = e.name.split("/");
    const caminho = partes.length > 1 ? partes.slice(1).join("/") : e.name;
    if (!caminho) continue;
    const bytes = await e.async("uint8array");
    const editavel = ehTexto(caminho) && bytes.length <= LIMITES_DO_EDITOR.arquivoBytes;
    const texto = editavel ? dec.decode(bytes) : null;
    saida.push({ caminho, bytes: bytes.length, texto, sha: editavel ? await sha256(bytes) : null, crlf: !!texto && texto.indexOf("\r\n") >= 0 });
  }
  return saida.sort((a, b) => a.caminho.localeCompare(b.caminho));
}

/** O texto da caixa de volta ao jeito do arquivo (CRLF quando ele usava). */
export const comFimDeLinhaOriginal = (texto: string, crlf: boolean) => (crlf ? texto.split("\r\n").join("\n").split("\n").join("\r\n") : texto);

/** Nome do zip da importação (o caminho que a função aceita). */
export function caminhoDoZipDaImportacao(clientId: string): string {
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${clientId}/site/importacao/${id.toLowerCase()}.zip`;
}
