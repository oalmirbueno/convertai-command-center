/**
 * Post do Instagram na arte rápida (02/10, dono: "colar o link de um post e
 * usar como referência, como conteúdo ou os dois").
 *
 * Sem login: o Instagram entrega as og:tags (capa, autor e legenda) e a
 * página "embed/captioned" do post (com as imagens do carrossel) ao robô de
 * prévia de links do Facebook. Aqui ficam só as regras puras (o código do
 * post no link, a leitura das páginas e o host permitido das imagens); a
 * busca de verdade, com tempo e teto de bytes, fica em `lerPostDoInstagram`,
 * que recebe o fetch (o teste passa um falso).
 *
 * Sem import de Deno nem de npm: a tela, a função e os testes leem o mesmo
 * arquivo. Sem lookbehind, propriedade Unicode ou grupo nomeado em regex (Safari 11).
 */

export const UA_DO_INSTAGRAM = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
/** Imagens do carrossel do post que entram no pedido. */
export const MAX_IMAGENS_DO_POST = 10;
/** Teto de cada imagem baixada do post. */
export const MAX_BYTES_DA_IMAGEM_DO_POST = 8 * 1024 * 1024;
/** Teto da página lida (HTML). */
export const MAX_BYTES_DA_PAGINA_DO_POST = 3 * 1024 * 1024;
export const MAX_CHARS_DA_LEGENDA = 2_200;

export const MODOS_DO_POST = ["referencia_e_conteudo", "so_conteudo", "so_referencia"] as const;
export type ModoDoPost = (typeof MODOS_DO_POST)[number];
export const ROTULO_DO_MODO_DO_POST: Record<ModoDoPost, string> = {
  referencia_e_conteudo: "Referência e conteúdo",
  so_conteudo: "Só o conteúdo",
  so_referencia: "Só a referência",
};
export const DICA_DO_MODO_DO_POST: Record<ModoDoPost, string> = {
  referencia_e_conteudo: "Usa a ideia e o texto do post e as imagens como inspiração, refeitos com a marca do cliente.",
  so_conteudo: "Usa só o texto do post (a legenda), reescrito na voz da marca. As imagens do post não entram.",
  so_referencia: "Usa só o visual do post como inspiração. O texto da arte vem do seu pedido.",
};

export const modoDoPostValido = (v: unknown): ModoDoPost | null => ((MODOS_DO_POST as readonly string[]).indexOf(String(v)) >= 0 ? (v as ModoDoPost) : null);
export const usaConteudoDoPost = (m: ModoDoPost) => m !== "so_referencia";
export const usaImagensDoPost = (m: ModoDoPost) => m !== "so_conteudo";

export interface CodigoDoPost {
  codigo: string;
  tipo: "p" | "reel" | "tv";
}

const CODIGO = /^[A-Za-z0-9_-]{5,40}$/;

/** O código do post num link do Instagram (instagram.com/p/<código>/, /reel/, /reels/, /tv/, com ou sem o @ antes), ou null. */
export function codigoDoPostDoInstagram(bruto: unknown): CodigoDoPost | null {
  let u: URL;
  try {
    const t = String(bruto == null ? "" : bruto).trim();
    if (!t) return null;
    u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  if (host !== "instagram.com" && host !== "instagr.am") return null;
  const partes = u.pathname.split("/").filter(Boolean);
  for (let i = 0; i < partes.length - 1; i++) {
    const p = partes[i].toLowerCase();
    if (p === "p" || p === "reel" || p === "reels" || p === "tv") {
      const codigo = partes[i + 1];
      if (!CODIGO.test(codigo)) return null;
      return { codigo, tipo: p === "reels" ? "reel" : (p as CodigoDoPost["tipo"]) };
    }
  }
  return null;
}

export const enderecoDoPost = (c: CodigoDoPost) => `https://www.instagram.com/${c.tipo}/${c.codigo}/`;
/** A página embed do post: traz as imagens do carrossel (o reel usa o mesmo caminho /p/). */
export const enderecoDoEmbed = (c: CodigoDoPost) => `https://www.instagram.com/p/${c.codigo}/embed/captioned/`;

/** Imagem do post só do CDN do Instagram ou do Facebook, por https. */
export function hostDaImagemPermitido(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
    const h = u.hostname.toLowerCase();
    return h === "cdninstagram.com" || h.slice(-17) === ".cdninstagram.com" || h === "fbcdn.net" || h.slice(-10) === ".fbcdn.net";
  } catch {
    return false;
  }
}

function decodificarHtml(s: string): string {
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

/** As og:tags da página (property ou name, atributos em qualquer ordem). */
function metas(html: string): Record<string, string> {
  const saida: Record<string, string> = {};
  const tags = html.slice(0, 800_000).match(/<meta\s[^>]*>/gi) || [];
  for (const tag of tags) {
    const attrs: Record<string, string> = {};
    const re = /([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(tag))) attrs[m[1].toLowerCase()] = decodificarHtml(m[3] != null ? m[3] : m[4] || "").trim();
    const chave = (attrs.property || attrs.name || "").toLowerCase();
    if (chave && attrs.content && !saida[chave]) saida[chave] = attrs.content;
  }
  return saida;
}

export interface PaginaDoPost {
  capa: string | null;
  legenda: string;
  autor: string | null;
}

/**
 * A página do post: a capa (og:image), o autor e a legenda. A og:description
 * vem como `N likes, N comments - autor on data: "legenda"` (ou em português,
 * `curtidas`, `comentários`, `em`); a og:title, como `Nome on Instagram: "legenda"`.
 * Null quando a página não traz as og:tags (o Instagram bloqueou).
 */
export function lerPaginaDoPost(html: string): PaginaDoPost | null {
  const m = metas(String(html || ""));
  const capa = m["og:image"] && hostDaImagemPermitido(m["og:image"]) ? m["og:image"] : null;
  const descricao = m["og:description"] || "";
  const titulo = m["og:title"] || "";
  if (!capa && !descricao && !titulo) return null;
  let autor: string | null = null;
  let legenda = "";
  const d = descricao.match(/^[\s\S]*?\s-\s+@?([A-Za-z0-9._]{1,30})\s+(?:on|em|el)\s+[^:]{3,60}:\s*([\s\S]*)$/);
  if (d) {
    autor = d[1];
    legenda = d[2];
  } else {
    const t = titulo.match(/:\s*([\s\S]+)$/);
    if (t) legenda = t[1];
  }
  if (!autor) {
    const url = m["og:url"] || "";
    const a = url.match(/instagram\.com\/([A-Za-z0-9._]{1,30})\/(?:p|reel|tv)\//);
    if (a) autor = a[1];
  }
  legenda = legenda.trim().replace(/^["“]/, "").replace(/["”]\.?$/, "").trim();
  return { capa, legenda: legenda.slice(0, MAX_CHARS_DA_LEGENDA), autor };
}

/** Tira as barras de escape do JSON embutido no HTML (vem escapado duas ou três vezes). */
export function desescapar(s: string): string {
  let atual = s;
  for (let i = 0; i < 4; i++) {
    const proximo = atual
      .replace(/\\+\//g, "/")
      .replace(/\\+u0026/gi, "&")
      .replace(/\\+u003d/gi, "=")
      .replace(/\\+u0025/gi, "%")
      .replace(/\\+"/g, "\"");
    if (proximo === atual) break;
    atual = proximo;
  }
  return atual.replace(/&amp;/g, "&");
}

/**
 * As imagens do carrossel na página embed (edge_sidecar_to_children com um
 * display_url por lâmina), na ordem, sem repetir, até MAX_IMAGENS_DO_POST.
 * Post de uma imagem só (sem sidecar): a imagem do embed. Vazio quando nada.
 */
export function imagensDoEmbed(html: string): string[] {
  const limpo = desescapar(String(html || ""));
  const vistos: Record<string, true> = {};
  const saida: string[] = [];
  const juntar = (url: string) => {
    const u = url.replace(/&amp;/g, "&");
    const chave = u.split("?")[0];
    if (!hostDaImagemPermitido(u) || vistos[chave]) return;
    vistos[chave] = true;
    saida.push(u);
  };
  const inicio = limpo.indexOf("edge_sidecar_to_children");
  if (inicio >= 0) {
    const trecho = limpo.slice(inicio);
    const re = /"display_url"\s*:\s*"(https:[^"\s]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(trecho)) && saida.length < MAX_IMAGENS_DO_POST) juntar(m[1]);
    if (saida.length) return saida;
  }
  const img = limpo.match(/<img[^>]+class="[^"]*EmbeddedMediaImage[^"]*"[^>]*>/i);
  if (img) {
    const src = img[0].match(/\ssrc="([^"]+)"/i);
    if (src) juntar(src[1]);
  }
  if (!saida.length) {
    const d = limpo.match(/"display_url"\s*:\s*"(https:[^"\s]+)"/);
    if (d) juntar(d[1]);
  }
  return saida.slice(0, MAX_IMAGENS_DO_POST);
}

export interface PostLido {
  codigo: string;
  tipo: CodigoDoPost["tipo"];
  url: string;
  autor: string | null;
  legenda: string;
  imagens: string[];
}

export class PostBloqueado extends Error {
  motivo: "link_invalido" | "bloqueado" | "sem_imagem";
  constructor(motivo: "link_invalido" | "bloqueado" | "sem_imagem") {
    super(motivo);
    this.motivo = motivo;
    this.name = "PostBloqueado";
  }
}

export const MENSAGEM_DO_POST: Record<PostBloqueado["motivo"], string> = {
  link_invalido: "Cole o link de um post ou reel do Instagram (instagram.com/p/... ou /reel/...).",
  bloqueado: "O Instagram não liberou este post agora (perfil privado ou bloqueio). Tire um print do post e envie como imagem.",
  sem_imagem: "O post abriu, mas sem imagem. Tire um print do post e envie como imagem.",
};

type BuscarTexto = (url: string) => Promise<string | null>;

/**
 * Lê o post sem login: a página (capa, autor e legenda) e o embed (as
 * imagens do carrossel). `buscar` devolve o HTML ou null (status fora de 2xx,
 * redirecionamento para o login, tempo esgotado). Lança PostBloqueado.
 */
export async function lerPostDoInstagram(link: unknown, buscar: BuscarTexto): Promise<PostLido> {
  const c = codigoDoPostDoInstagram(link);
  if (!c) throw new PostBloqueado("link_invalido");
  const [pagina, embed] = await Promise.all([
    buscar(enderecoDoPost(c)).catch(() => null),
    buscar(enderecoDoEmbed(c)).catch(() => null),
  ]);
  const lida = pagina ? lerPaginaDoPost(pagina) : null;
  const doEmbed = embed ? imagensDoEmbed(embed) : [];
  if (!lida && !doEmbed.length) throw new PostBloqueado("bloqueado");
  const imagens = doEmbed.length ? doEmbed : lida && lida.capa ? [lida.capa] : [];
  if (!imagens.length && !(lida && lida.legenda)) throw new PostBloqueado("sem_imagem");
  return { codigo: c.codigo, tipo: c.tipo, url: enderecoDoPost(c), autor: lida ? lida.autor : null, legenda: lida ? lida.legenda : "", imagens };
}

/** Caminho da imagem do post no bucket mesa (pasta do cliente). */
export const caminhoDaImagemDoPost = (clientId: string, codigo: string, n: number, ext: string) => `${clientId}/pedidos/instagram/${codigo}/${n}.${ext}`;
export const ehImagemDoPost = (clientId: string, caminho: string | null | undefined) => !!caminho && caminho.indexOf(`${clientId}/pedidos/instagram/`) === 0;
