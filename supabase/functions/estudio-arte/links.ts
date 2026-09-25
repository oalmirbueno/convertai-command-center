/**
 * Links de referência colados no Estúdio (dono, 26/09: "colar link do
 * Pinterest, Behance ou endereço de imagem e ele reconhece"). Cópia das regras
 * puras da Mesa Ads (supabase/functions/mesa-ads/calculos.ts), como a Mesa
 * Foto já faz: cada função carrega o que usa, sem importar de outra função.
 * Só https público na porta padrão, sem usuário e senha, sem host interno.
 */

/** IPv4 de rede interna, reservada ou de metadados (bloqueado para busca no servidor). */
export function ipv4Interno(ip: string): boolean {
  const p = ip.split(".").map((x) => Number(x));
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19));
}

/** IPv6 interno (loopback, local, único local, IPv4 mapeado). */
export function ipv6Interno(ip: string): boolean {
  const h = ip.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::" || h === "::1") return true;
  if (/^f[cd]/.test(h) || /^fe[89ab]/.test(h)) return true;
  const mapeado = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapeado) return ipv4Interno(mapeado[1]);
  return h.startsWith("::ffff:") || h.startsWith("64:ff9b:");
}

/**
 * Só https público na porta padrão, sem usuário e senha, sem host interno.
 * Devolve a URL normalizada ou null.
 */
export function urlPublicaSegura(bruto: unknown): URL | null {
  if (typeof bruto !== "string" || !bruto.trim() || bruto.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(bruto.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  if (u.port && u.port !== "443") return null;
  const h = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!h) return null;
  if (h.startsWith("[")) return ipv6Interno(h) ? null : u;
  if (/^[\d.]+$/.test(h)) return ipv4Interno(h) ? null : u;
  if (!h.includes(".") || h === "localhost" || /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(h)) return null;
  return u;
}

export type TipoDeLink = "youtube" | "github" | "behance" | "instagram" | "pinterest" | "spotify" | "tiktok" | "imagem" | "pagina";

const EXT_IMAGEM = /\.(png|jpe?g|webp)$/i;

export function tipoDoLink(u: URL): TipoDeLink {
  const h = u.hostname.toLowerCase().replace(/^www\./, "");
  if (h === "youtu.be" || h === "youtube.com" || h.endsWith(".youtube.com")) return "youtube";
  if (h === "github.com") return "github";
  if (h === "behance.net" || h.endsWith(".behance.net")) return h.startsWith("mir-s3-cdn") ? "imagem" : "behance";
  if (h === "instagram.com" || h.endsWith(".instagram.com")) return "instagram";
  if (/(^|\.)pinterest\.[a-z.]{2,8}$/.test(h) || h === "pin.it") return "pinterest";
  if (h === "open.spotify.com" || h === "spotify.com") return "spotify";
  if (h === "tiktok.com" || h.endsWith(".tiktok.com")) return "tiktok";
  if (EXT_IMAGEM.test(u.pathname)) return "imagem";
  return "pagina";
}

/** Entidades HTML mais comuns. */
export function decodificarHtml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export type MetaTags = { titulo: string | null; descricao: string | null; imagem: string | null; site: string | null; tipo: string | null; imagens: string[] };

/** og:tags, twitter:tags e <title> de uma página (atributos em qualquer ordem). */
export function lerMetaTags(html: string, base?: string): MetaTags {
  const campos = new Map<string, string[]>();
  const trecho = html.slice(0, 600_000);
  const tags = trecho.match(/<meta\s[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const attrs: Record<string, string> = {};
    const re = /([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(tag))) attrs[m[1].toLowerCase()] = decodificarHtml(m[3] ?? m[4] ?? "").trim();
    const chave = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (!chave || !attrs.content) continue;
    const lista = campos.get(chave) ?? [];
    lista.push(attrs.content);
    campos.set(chave, lista);
  }
  const um = (...chaves: string[]) => {
    for (const c of chaves) {
      const v = campos.get(c)?.[0];
      if (v) return v;
    }
    return null;
  };
  const absoluta = (x: string) => {
    try {
      return new URL(x, base).toString();
    } catch {
      return null;
    }
  };
  const tituloTag = trecho.match(/<title[^>]*>([^<]{1,300})<\/title>/i);
  const titulo = um("og:title", "twitter:title") ?? (tituloTag ? decodificarHtml(tituloTag[1]).trim() : null);
  const imagens = [...new Set(
    [...(campos.get("og:image") ?? []), ...(campos.get("og:image:secure_url") ?? []), ...(campos.get("twitter:image") ?? []), ...(campos.get("twitter:image:src") ?? [])]
      .map(absoluta)
      .filter((x): x is string => !!x),
  )];
  return {
    titulo: titulo || null,
    descricao: um("og:description", "twitter:description", "description"),
    imagem: imagens[0] ?? null,
    site: um("og:site_name", "application-name"),
    tipo: um("og:type"),
    imagens,
  };
}

/** Ordem de preferência dos tamanhos de módulo do Behance (maior primeiro). */
const TAMANHOS_BEHANCE = ["source", "max_3840", "max_3840_webp", "fs", "fs_webp", "max_1200", "max_1200_webp", "1400", "1400_webp", "1400_opt_1", "hd", "disp", "disp_webp", "808", "max_808", "404", "max_632", "230"];

/** Imagens dos módulos de um projeto do Behance (o maior tamanho de cada uma, sem repetir). */
export function imagensDoBehance(html: string, max = 12): string[] {
  const texto = html.replace(/\\\//g, "/");
  const achados = texto.match(/https:\/\/mir-s3-cdn-cf\.behance\.net\/project_modules\/[^"'\s)\\<>]+/g) ?? [];
  const melhor = new Map<string, { url: string; rank: number }>();
  const ordem: string[] = [];
  for (const url of achados) {
    const partes = url.split("/");
    const tamanho = partes[4] ?? "";
    const arquivo = partes[partes.length - 1].split("?")[0];
    if (!arquivo || !EXT_IMAGEM.test(arquivo)) continue;
    const i = TAMANHOS_BEHANCE.indexOf(tamanho);
    const rank = i < 0 ? TAMANHOS_BEHANCE.length : i;
    const atual = melhor.get(arquivo);
    if (!atual) ordem.push(arquivo);
    if (!atual || rank < atual.rank) melhor.set(arquivo, { url, rank });
  }
  return ordem.slice(0, max).map((a) => melhor.get(a)!.url);
}

/** Confere no DNS que o host não aponta para rede interna (quando o runtime deixa resolver). */
export async function hostResolvePublico(host: string): Promise<boolean> {
  if (/^[\d.]+$/.test(host) || host.startsWith("[")) return true; // IP literal já conferido em urlPublicaSegura
  const resolver = (Deno as unknown as { resolveDns?: (h: string, t: "A" | "AAAA") => Promise<string[]> }).resolveDns;
  if (typeof resolver !== "function") return true;
  const [v4, v6] = await Promise.all([
    resolver(host, "A").catch(() => [] as string[]),
    resolver(host, "AAAA").catch(() => [] as string[]),
  ]);
  return !v4.some((ip) => ipv4Interno(ip)) && !v6.some((ip) => ipv6Interno(ip));
}
