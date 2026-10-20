/**
 * Laboratório: leitor de PDF simples e de Word (.docx), sem biblioteca e sem binário (20/10/2026).
 *
 * - PDF: lê o texto embutido nos fluxos de conteúdo (sem filtro ou FlateDecode, pelo
 *   DecompressionStream do próprio runtime) e os operadores de texto Tj, TJ, ' e ". Não faz OCR nem
 *   lê fonte com codificação própria (CID sem tabela): nesses casos o texto sai ruim e a conferência
 *   devolve vazio (quem chamou diz lido: false).
 * - DOCX: abre o zip (diretório central), pega word/document.xml (guardado ou deflate) e tira o texto
 *   dos parágrafos.
 *
 * Puro (só Web APIs: DecompressionStream, TextDecoder): roda no Deno e no teste.
 */

/** Teto do texto lido de um documento (o contrato do ler_documento devolve até 16.000). */
export const TETO_DO_TEXTO = 16_000;
/** Não abre arquivo maior que isso (PDF ou Word) no servidor. */
export const MAX_BYTES_DO_LEITOR = 8 * 1024 * 1024;

async function descomprimir(bytes: Uint8Array, formato: "deflate" | "deflate-raw"): Promise<Uint8Array | null> {
  try {
    const fluxo = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream(formato));
    return new Uint8Array(await new Response(fluxo).arrayBuffer());
  } catch {
    return null;
  }
}

const latin1 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, Array.from(b.subarray(i, i + 8192)));
  return s;
};

/** Texto que parece texto de verdade (letras e espaço), não lixo de fonte codificada. */
export function pareceTexto(t: string): boolean {
  const s = t.replace(/\s+/g, " ").trim();
  if (s.length < 20) return false;
  const bons = (s.match(/[A-Za-zÀ-ÿ0-9 .,;:!?()%$@'"\-]/g) || []).length;
  const letras = (s.match(/[A-Za-zÀ-ÿ]/g) || []).length;
  return bons / s.length >= 0.85 && letras / s.length >= 0.45;
}

// ------------------------------------------------------------------ PDF

/** Uma string literal de PDF: (texto com \( \) \\ \n e octal). */
function stringLiteral(s: string, i: number): { valor: string; fim: number } {
  let nivel = 1;
  let out = "";
  let j = i + 1;
  while (j < s.length && nivel > 0) {
    const c = s[j];
    if (c === "\\") {
      const n = s[j + 1];
      if (n === "n") out += "\n";
      else if (n === "r") out += "\r";
      else if (n === "t") out += "\t";
      else if (n === "b" || n === "f") out += "";
      else if (n >= "0" && n <= "7") {
        let oct = n;
        let k = j + 2;
        while (k < j + 4 && s[k] >= "0" && s[k] <= "7") oct += s[k++];
        out += String.fromCharCode(parseInt(oct, 8));
        j = k;
        continue;
      } else if (n === "\r" || n === "\n") out += "";
      else out += n;
      j += 2;
      continue;
    }
    if (c === "(") nivel++;
    if (c === ")") {
      nivel--;
      if (nivel === 0) break;
    }
    out += c;
    j++;
  }
  return { valor: out, fim: j + 1 };
}

function stringHex(h: string): string {
  const limpo = h.replace(/[^0-9a-fA-F]/g, "");
  const par = limpo.length % 2 ? `${limpo}0` : limpo;
  let out = "";
  // UTF-16BE com BOM, ou byte a byte.
  if (/^feff/i.test(par)) {
    for (let i = 4; i + 3 < par.length; i += 4) out += String.fromCharCode(parseInt(par.slice(i, i + 4), 16));
    return out;
  }
  for (let i = 0; i < par.length; i += 2) out += String.fromCharCode(parseInt(par.slice(i, i + 2), 16));
  return out;
}

/** O texto dos operadores de um fluxo de conteúdo (Tj, TJ, ' e "), com quebra nas mudanças de linha. */
export function textoDoConteudo(conteudo: string): string {
  const partes: string[] = [];
  let i = 0;
  let pendentes: string[] = [];
  const s = conteudo;
  while (i < s.length) {
    const c = s[i];
    if (c === "(") {
      const r = stringLiteral(s, i);
      pendentes.push(r.valor);
      i = r.fim;
      continue;
    }
    if (c === "<" && s[i + 1] !== "<") {
      const fim = s.indexOf(">", i);
      if (fim < 0) break;
      pendentes.push(stringHex(s.slice(i + 1, fim)));
      i = fim + 1;
      continue;
    }
    if (c === "[") {
      // TJ: strings e ajustes; ajuste grande vira espaço.
      let j = i + 1;
      let linha = "";
      while (j < s.length && s[j] !== "]") {
        if (s[j] === "(") {
          const r = stringLiteral(s, j);
          linha += r.valor;
          j = r.fim;
        } else if (s[j] === "<") {
          const fim = s.indexOf(">", j);
          if (fim < 0) break;
          linha += stringHex(s.slice(j + 1, fim));
          j = fim + 1;
        } else {
          const m = /^-?\d+(\.\d+)?/.exec(s.slice(j, j + 12));
          if (m) {
            if (Number(m[0]) < -180) linha += " ";
            j += m[0].length;
          } else j++;
        }
      }
      pendentes = [linha];
      i = j + 1;
      continue;
    }
    const op = /^(Tj|TJ|T\*|Td|TD|Tm|ET|'|")(?=[\s\[(<\/]|$)/.exec(s.slice(i, i + 3));
    if (op && (i === 0 || /\s/.test(s[i - 1]) || s[i - 1] === ")" || s[i - 1] === "]" || s[i - 1] === ">")) {
      const nome = op[1];
      if (nome === "Tj" || nome === "TJ" || nome === "'" || nome === '"') {
        if (nome === "'" || nome === '"') partes.push("\n");
        partes.push(pendentes.join(""));
      } else if (nome === "T*" || nome === "TD" || nome === "Td" || nome === "Tm") partes.push("\n");
      else if (nome === "ET") partes.push("\n");
      pendentes = [];
      i += nome.length;
      continue;
    }
    i++;
  }
  return partes.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

/** Texto embutido de um PDF simples; vazio quando não deu (imagem escaneada, fonte codificada, criptografia). */
export async function textoDoPdf(bytes: Uint8Array): Promise<string> {
  if (bytes.length > MAX_BYTES_DO_LEITOR) return "";
  const s = latin1(bytes);
  if (s.indexOf("%PDF") < 0 || /\/Encrypt\s/.test(s)) return "";
  const textos: string[] = [];
  const re = /<<((?:(?!>>\s*stream)[\s\S]){0,2000})>>\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  let total = 0;
  while ((m = re.exec(s)) && total < TETO_DO_TEXTO * 2) {
    const dicionario = m[1];
    const inicio = m.index + m[0].length;
    const fim = s.indexOf("endstream", inicio);
    if (fim < 0) break;
    re.lastIndex = fim;
    // Imagem, fonte embutida e metadados não têm texto de página.
    if (/\/Subtype\s*\/Image|\/FontFile|\/Length1|\/Type\s*\/(XRef|Metadata|ObjStm)|\/Subtype\s*\/XML/.test(dicionario)) continue;
    // O fim de linha antes de "endstream" não é do fluxo (o zlib recusa byte sobrando).
    let fimDosDados = fim;
    if (bytes[fimDosDados - 1] === 0x0a) fimDosDados--;
    if (bytes[fimDosDados - 1] === 0x0d) fimDosDados--;
    let corpo = bytes.subarray(inicio, Math.max(inicio, fimDosDados));
    if (/\/Filter\s*\/FlateDecode|\/Filter\s*\[\s*\/FlateDecode\s*\]/.test(dicionario)) {
      const d = await descomprimir(corpo, "deflate");
      if (!d) continue;
      corpo = d;
    } else if (/\/Filter/.test(dicionario)) continue;
    const conteudo = latin1(corpo);
    if (!/\bBT\b/.test(conteudo)) continue;
    const t = textoDoConteudo(conteudo);
    if (t) {
      textos.push(t);
      total += t.length;
    }
  }
  const junto = textos.join("\n\n").slice(0, TETO_DO_TEXTO);
  return pareceTexto(junto) ? junto : "";
}

// ------------------------------------------------------------------ DOCX

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

/** Um arquivo de dentro de um zip (pelo diretório central), ou null. */
export async function arquivoDoZip(zip: Uint8Array, nome: string): Promise<Uint8Array | null> {
  let fimDoDir = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (u32(zip, i) === 0x06054b50) {
      fimDoDir = i;
      break;
    }
  }
  if (fimDoDir < 0) return null;
  const entradas = u16(zip, fimDoDir + 10);
  let p = u32(zip, fimDoDir + 16);
  const dec = new TextDecoder();
  for (let k = 0; k < entradas && p + 46 <= zip.length; k++) {
    if (u32(zip, p) !== 0x02014b50) return null;
    const metodo = u16(zip, p + 10);
    const tamanho = u32(zip, p + 20);
    const nLen = u16(zip, p + 28);
    const eLen = u16(zip, p + 30);
    const cLen = u16(zip, p + 32);
    const local = u32(zip, p + 42);
    const n = dec.decode(zip.subarray(p + 46, p + 46 + nLen));
    if (n === nome) {
      if (u32(zip, local) !== 0x04034b50) return null;
      const inicio = local + 30 + u16(zip, local + 26) + u16(zip, local + 28);
      const dados = zip.subarray(inicio, inicio + tamanho);
      if (metodo === 0) return dados;
      if (metodo === 8) return await descomprimir(dados, "deflate-raw");
      return null;
    }
    p += 46 + nLen + eLen + cLen;
  }
  return null;
}

/** Texto de um .docx (parágrafos em linhas); vazio quando não é um Word que dá para ler. */
export async function textoDoDocx(bytes: Uint8Array): Promise<string> {
  if (bytes.length > MAX_BYTES_DO_LEITOR) return "";
  const xml = await arquivoDoZip(bytes, "word/document.xml");
  if (!xml) return "";
  const s = new TextDecoder().decode(xml);
  const texto = s
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return texto.slice(0, TETO_DO_TEXTO);
}

/** É PDF? É Word? (pelo tipo ou pela extensão) */
export const ehPdf = (mime: string, nome: string) => /pdf/i.test(mime || "") || /\.pdf$/i.test(nome || "");
export const ehDocx = (mime: string, nome: string) => /wordprocessingml/i.test(mime || "") || /\.docx$/i.test(nome || "");
