/**
 * O mínimo de MIME que o correio precisa (19/11/2026): cabeçalhos com acento (RFC 2047), as partes de
 * uma mensagem, base64 e quoted-printable, e o texto que a tela mostra. O HTML do remetente nunca
 * volta cru: vira texto. Sem import: roda na função (Deno) e no vitest.
 */

const decodificar = (bytes: Uint8Array, charset: string): string => {
  const c = String(charset || "utf-8").toLowerCase().replace(/^"|"$/g, "");
  try {
    return new TextDecoder(c === "latin1" ? "iso-8859-1" : c).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
};

export function base64ParaBytes(texto: string): Uint8Array {
  const limpo = String(texto || "").replace(/[^A-Za-z0-9+/=]/g, "");
  try {
    const bin = atob(limpo);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array(0);
  }
}

export function quotedPrintableParaBytes(texto: string, emCabecalho = false): Uint8Array {
  const t = emCabecalho ? texto.replace(/_/g, " ") : texto.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "=" && /^[0-9A-Fa-f]{2}$/.test(t.slice(i + 1, i + 3))) {
      out.push(parseInt(t.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const cod = t.charCodeAt(i);
      if (cod < 128) out.push(cod);
      else for (const b of new TextEncoder().encode(ch)) out.push(b);
    }
  }
  return new Uint8Array(out);
}

/** "=?UTF-8?B?...?=" e "=?iso-8859-1?Q?...?=" viram texto; o resto fica como está. */
export function cabecalhoLegivel(valor: string): string {
  return String(valor || "")
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, charset: string, tipo: string, dados: string) =>
      decodificar(tipo.toUpperCase() === "B" ? base64ParaBytes(dados) : quotedPrintableParaBytes(dados, true), charset))
    .replace(/\s+/g, " ")
    .trim();
}

/** Cabeçalhos de um bloco "Nome: valor" (com continuação em linha que começa por espaço). */
export function lerCabecalhos(bloco: string): Record<string, string> {
  const saida: Record<string, string> = {};
  let atual = "";
  for (const linha of String(bloco || "").split(/\r?\n/)) {
    if (/^[ \t]/.test(linha) && atual) {
      saida[atual] += " " + linha.trim();
      continue;
    }
    const i = linha.indexOf(":");
    if (i <= 0) continue;
    atual = linha.slice(0, i).trim().toLowerCase();
    saida[atual] = saida[atual] ? `${saida[atual]}, ${linha.slice(i + 1).trim()}` : linha.slice(i + 1).trim();
  }
  return saida;
}

/** Um parâmetro do cabeçalho: charset, boundary, name, filename. */
export function parametro(valor: string, nome: string): string {
  const m = new RegExp(`(?:^|;)\\s*${nome}\\*?=("([^"]*)"|[^;]+)`, "i").exec(String(valor || ""));
  if (!m) return "";
  const bruto = (m[2] !== undefined ? m[2] : m[1]).trim();
  // nome*=utf-8''arquivo%20novo.pdf
  const rfc2231 = /^([^']*)'[^']*'(.*)$/.exec(bruto);
  if (rfc2231) {
    try {
      return decodeURIComponent(rfc2231[2]);
    } catch {
      return rfc2231[2];
    }
  }
  return cabecalhoLegivel(bruto);
}

/** HTML de remetente vira texto corrido (sem script, sem estilo, com quebras de linha). */
export function htmlParaTexto(html: string): string {
  return String(html || "")
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface Parte {
  cabecalhos: Record<string, string>;
  corpo: string;
}

/** Separa cabeçalho e corpo de uma mensagem ou de uma parte. */
export function separar(bruto: string): Parte {
  const m = /\r?\n\r?\n/.exec(bruto);
  if (!m) return { cabecalhos: lerCabecalhos(bruto), corpo: "" };
  return { cabecalhos: lerCabecalhos(bruto.slice(0, m.index)), corpo: bruto.slice(m.index + m[0].length) };
}

function bytesDoCorpo(p: Parte): Uint8Array {
  const codificacao = String(p.cabecalhos["content-transfer-encoding"] || "").toLowerCase();
  if (codificacao === "base64") return base64ParaBytes(p.corpo);
  if (codificacao === "quoted-printable") return quotedPrintableParaBytes(p.corpo);
  // 7bit/8bit/binary: a mensagem chegou como latin1 (um byte por caractere).
  const out = new Uint8Array(p.corpo.length);
  for (let i = 0; i < p.corpo.length; i++) out[i] = p.corpo.charCodeAt(i) & 0xff;
  return out;
}

export interface MensagemLida {
  texto: string;
  html: boolean;
  /** O HTML original, limpo de script e evento, com as imagens embutidas (cid:) já resolvidas. */
  conteudo_html: string | null;
  anexos: Array<{ nome: string; tamanho: number }>;
}

/**
 * HTML do remetente sem o que executa: script, evento (onclick...), javascript:, iframe, object,
 * embed e meta refresh. A tela ainda mostra dentro de um iframe sandbox sem script: duas travas.
 */
export function htmlSeguro(html: string): string {
  return String(html || "")
    .replace(/<(script|iframe|object|embed|applet|frame|frameset|noscript)[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?(script|iframe|object|embed|applet|frame|frameset|base)\b[^>]*>/gi, "")
    .replace(/<meta[^>]+http-equiv\s*=\s*["']?refresh[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|action|formaction|xlink:href)\s*=\s*("|')\s*(javascript|vbscript|data:text\/html)[^"']*\2/gi, '$1=$2#$2')
    .replace(/(href|src)\s*=\s*(javascript|vbscript):[^\s>]*/gi, '$1="#"');
}

/** Percorre as partes e devolve o texto (preferindo text/plain) e a lista de anexos. */
export function lerCorpo(bruto: string): MensagemLida {
  let plano = "";
  let html = "";
  const anexos: MensagemLida["anexos"] = [];
  // Imagens embutidas (src="cid:..."): viram data: no HTML, até 3 MB no total.
  const embutidas: Record<string, string> = {};
  let bytesEmbutidos = 0;
  const andar = (p: Parte, profundidade: number) => {
    if (profundidade > 8) return;
    const tipo = String(p.cabecalhos["content-type"] || "text/plain").toLowerCase();
    const disposicao = String(p.cabecalhos["content-disposition"] || "");
    if (tipo.startsWith("multipart/")) {
      const fronteira = parametro(p.cabecalhos["content-type"] || "", "boundary");
      if (!fronteira) return;
      const pedacos = p.corpo.split(new RegExp(`\\r?\\n?--${fronteira.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?\\s*\\r?\\n`));
      for (const pedaco of pedacos.slice(1)) if (pedaco.trim()) andar(separar(pedaco), profundidade + 1);
      return;
    }
    const nome = parametro(disposicao, "filename") || parametro(p.cabecalhos["content-type"] || "", "name");
    const cid = String(p.cabecalhos["content-id"] || "").replace(/^<|>$/g, "").trim();
    if (cid && tipo.startsWith("image/") && !/^attachment/i.test(disposicao)) {
      const bytes = bytesDoCorpo(p);
      if (bytesEmbutidos + bytes.length <= 3_000_000) {
        bytesEmbutidos += bytes.length;
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        embutidas[cid.toLowerCase()] = `data:${tipo.split(";")[0]};base64,${btoa(bin)}`;
      }
      return;
    }
    if (nome || /^attachment/i.test(disposicao)) {
      anexos.push({ nome: nome || "anexo", tamanho: bytesDoCorpo(p).length });
      return;
    }
    const charset = parametro(p.cabecalhos["content-type"] || "", "charset") || "utf-8";
    if (tipo.startsWith("text/plain") && !plano) plano = decodificar(bytesDoCorpo(p), charset);
    else if (tipo.startsWith("text/html") && !html) html = decodificar(bytesDoCorpo(p), charset);
  };
  andar(separar(bruto), 0);
  const texto = plano ? plano.replace(/\r\n/g, "\n").trim() : htmlParaTexto(html);
  let conteudo_html: string | null = null;
  if (html && html.length <= 2_000_000) {
    conteudo_html = htmlSeguro(html).replace(/(src\s*=\s*["']?)cid:([^"'\s>]+)/gi, (m, ini: string, id: string) => {
      const d = embutidas[decodeURIComponent(id).toLowerCase()];
      return d ? `${ini}${d}` : m;
    });
  }
  return { texto: texto.slice(0, 200_000), html: !plano && !!html, conteudo_html, anexos };
}

/** "Fulano <fulano@x.com>" ou só o endereço, legível. */
export const remetenteLegivel = (valor: string) => cabecalhoLegivel(valor).replace(/^"|"(?=\s*<)/g, "").slice(0, 300);

/** Assunto em UTF-8 para o cabeçalho (=?UTF-8?B?...?= quando tem acento). */
export function cabecalhoCodificado(texto: string): string {
  const t = String(texto || "").replace(/[\r\n]+/g, " ");
  if (/^[\x20-\x7e]*$/.test(t)) return t;
  const bytes = new TextEncoder().encode(t);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `=?UTF-8?B?${btoa(bin)}?=`;
}

/** Corpo em base64, em linhas de 76 caracteres. */
export function corpoBase64(texto: string): string {
  const bytes = new TextEncoder().encode(String(texto || "").replace(/\r?\n/g, "\r\n"));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return (btoa(bin).match(/.{1,76}/g) || []).join("\r\n");
}
