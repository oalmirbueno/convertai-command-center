/**
 * Leitura pública do site e do Instagram do cliente (19/10/2026), para o
 * núcleo da marca começar com o que a marca já diz de si. O servidor busca a
 * página pública (sem login, com tempo limite); aqui fica só o que é puro:
 * normalizar o link, recusar endereço interno e tirar do HTML o título, a
 * descrição, a cor do tema, os títulos da página e um trecho do texto.
 *
 * O que vem da página é dado, nunca instrução (vai para a IA dentro de DADOS).
 * Puro: sem Deno, sem banco (a tela, a função e os testes usam o mesmo arquivo).
 * Regex só na sintaxe antiga (Safari 11). Sem travessão.
 */

export type LeituraDoLink = {
  url: string;
  titulo: string;
  descricao: string;
  cor_do_tema: string | null;
  titulos: string[];
  texto: string;
};

export type LeituraWeb = { site: LeituraDoLink | null; instagram: LeituraDoLink | null; bio: string | null; lido_em: string; avisos: string[] };

/** Endereço interno ou de rede local: o servidor nunca busca. */
export function hostBloqueado(host: string): boolean {
  const h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h === "0.0.0.0" || h === "::" || h === "::1") return true;
  if (/\.(local|localhost|internal|lan|home|corp|intranet)$/.test(h)) return true;
  if (h === "metadata.google.internal" || h === "metadata") return true;
  const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (ip) {
    const a = Number(ip[1]);
    const b = Number(ip[2]);
    if (a === 10 || a === 127 || a === 0 || a >= 224) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  // IPv6 local (fc00::/7, fe80::/10) e IPv4 mapeado.
  if (h.indexOf(":") >= 0 && (/^f[cd]/.test(h) || /^fe[89ab]/.test(h) || /^::ffff:/.test(h))) return true;
  return false;
}

/** Link de site em forma segura (https:// quando falta; só http e https; nada interno). */
export function normalizarSite(v: unknown): string | null {
  let s = String(v == null ? "" : v).trim();
  if (!s || /\s/.test(s)) return null;
  if (/instagram\.com/i.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s.replace(/^\/+/, "")}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  if (hostBloqueado(u.hostname) || u.hostname.indexOf(".") < 0) return null;
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  return u.toString();
}

/** @usuario, usuario ou o link do perfil viram https://www.instagram.com/usuario/. */
export function normalizarInstagram(v: unknown): string | null {
  const s = String(v == null ? "" : v).trim();
  if (!s) return null;
  const doLink = /instagram\.com\/([A-Za-z0-9._]{1,30})/i.exec(s);
  const usuario = doLink ? doLink[1] : s.replace(/^@/, "");
  if (!/^[A-Za-z0-9._]{1,30}$/.test(usuario)) return null;
  if (["p", "reel", "reels", "explore", "stories", "accounts"].indexOf(usuario.toLowerCase()) >= 0) return null;
  return `https://www.instagram.com/${usuario}/`;
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x27": "'", ccedil: "ç", atilde: "ã", otilde: "õ", aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", acirc: "â", ecirc: "ê", ocirc: "ô", agrave: "à" };

function decodificar(s: string): string {
  return s
    .replace(/&#(\d{1,6});/g, (_m, n) => {
      const c = Number(n);
      return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : " ";
    })
    .replace(/&#x([0-9a-f]{1,6});/gi, (_m, n) => {
      const c = parseInt(n, 16);
      return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : " ";
    })
    .replace(/&([a-z0-9#]{2,8});/gi, (m, n) => (Object.prototype.hasOwnProperty.call(ENTIDADES, n.toLowerCase()) ? ENTIDADES[n.toLowerCase()] : m));
}

const limpar = (s: string, max: number) => decodificar(String(s || "")).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Valor de uma meta (name ou property), em qualquer ordem dos atributos. */
function meta(html: string, chave: string): string {
  const re = /<meta\s[^>]*>/gi;
  let m: RegExpExecArray | null;
  const alvo = chave.toLowerCase();
  while ((m = re.exec(html))) {
    const tag = m[0];
    const nome = /(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!nome || nome[1].toLowerCase() !== alvo) continue;
    const conteudo = /content\s*=\s*"([^"]*)"/i.exec(tag) || /content\s*=\s*'([^']*)'/i.exec(tag);
    if (conteudo) return conteudo[1];
  }
  return "";
}

/** Título, descrição, cor do tema, títulos (h1 e h2) e um trecho do texto visível. */
export function lerHtml(html: string, url: string): LeituraDoLink {
  const h = String(html || "").slice(0, 600_000);
  const semScript = h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<svg[\s\S]*?<\/svg>/gi, " ");
  const tituloTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(h);
  const titulo = limpar(meta(h, "og:title") || (tituloTag ? tituloTag[1] : ""), 160);
  const descricao = limpar(meta(h, "og:description") || meta(h, "description") || meta(h, "twitter:description"), 400);
  const cor = meta(h, "theme-color").trim();
  const titulos: string[] = [];
  const reT = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi;
  let m: RegExpExecArray | null;
  while ((m = reT.exec(semScript)) && titulos.length < 8) {
    const t = limpar(m[1], 140);
    if (t.length >= 3 && titulos.indexOf(t) < 0) titulos.push(t);
  }
  const corpo = /<body[^>]*>([\s\S]*)<\/body>/i.exec(semScript);
  const texto = limpar(corpo ? corpo[1] : semScript, 1500);
  return { url, titulo, descricao, cor_do_tema: /^#[0-9a-f]{3,8}$/i.test(cor) ? cor.toUpperCase() : null, titulos, texto };
}

/** Linha curta da leitura para o núcleo (o que a marca diz de si). */
export function resumoDaLeitura(l: LeituraDoLink | null | undefined): string {
  if (!l) return "";
  const partes = [l.titulo, l.descricao].filter(Boolean);
  if (!partes.length && l.titulos.length) partes.push(l.titulos.slice(0, 3).join("; "));
  return partes.join(". ").slice(0, 400);
}
