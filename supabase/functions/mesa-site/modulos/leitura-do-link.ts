/**
 * Ler a página do cliente pelo link (Mesa Site, 19/10/2026, o que aprendemos
 * com o Gravyx: "Cliente criado! Página de vendas lida."). O dono cola o link
 * do site atual, do Instagram ou da página de vendas; o servidor busca a
 * página pública e devolve o que achou (nome, oferta, serviços, depoimentos,
 * cores aparentes, contatos e as imagens principais). Nada é gravado aqui: a
 * tela mostra o que foi lido e o dono confirma o que vai para o briefing.
 *
 * Regras:
 *  - só endereço público (urlPublica), conferido de novo a cada redirecionamento;
 *  - respeita o robots.txt do site (grupo do nosso agente ou o "*"; robots
 *    fora do ar com erro 5xx ou sem resposta = não lê, como manda a RFC 9309);
 *  - prazo e teto de tamanho em tudo; só HTML; sem navegador, sem IA, sem custo;
 *  - nada de log com o endereço ou o conteúdo.
 *
 * Extração por regra fixa (sem julgamento): metadados, títulos, blocos com
 * nome de serviço/depoimento, cores escritas no HTML e links de contato.
 * O `fetch` chega por parâmetro (testes com fetch falso).
 */
import { urlPublica } from "../../_shared/referencias-do-site.ts";

export const AGENTE_DA_LEITURA = "AceleriqPainel";
export const MAX_BYTES_DA_PAGINA_LIDA = 1_500_000;
export const MAX_BYTES_DO_ROBOTS = 200_000;
export const PRAZO_DA_PAGINA_MS = 12_000;
export const PRAZO_DO_ROBOTS_MS = 5_000;
const MAX_REDIRECIONAMENTOS = 4;

export type ContatosLidos = { whatsapp: string | null; telefone: string | null; email: string | null; instagram: string | null };

export type LeituraDoLink = {
  url: string;
  host: string;
  nome: string;
  titulo: string;
  descricao: string;
  titulos: string[];
  servicos: string[];
  depoimentos: string[];
  cores: string[];
  imagens: Array<{ url: string; alt: string }>;
  logo: string | null;
  contatos: ContatosLidos;
};

export type ResultadoDaLeitura = { leitura: LeituraDoLink | null; motivo: string | null };

// ------------------------------------------------------------------ texto

const ENTIDADES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", ndash: "-", mdash: "-", hellip: "...", laquo: '"', raquo: '"', ldquo: '"', rdquo: '"', lsquo: "'", rsquo: "'" };

export function decodificar(s: string): string {
  return String(s || "")
    .replace(/&#x([0-9a-f]{1,6});/gi, (_m, h: string) => {
      const n = parseInt(h, 16);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
    })
    .replace(/&#(\d{1,7});/g, (_m, d: string) => {
      const n = parseInt(d, 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
    })
    .replace(/&([a-z]+);/gi, (m, nome: string) => (ENTIDADES[nome.toLowerCase()] !== undefined ? ENTIDADES[nome.toLowerCase()] : m))
    .replace(/\s+/g, " ")
    .trim();
}

/** O texto visível de um pedaço de HTML. */
export function textoDoHtml(fragmento: string): string {
  return decodificar(String(fragmento || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "));
}

/** Tira comentários, scripts, estilos e svg (o que não é texto da página). */
function semCodigo(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/gi, " ");
}

function atributo(tag: string, nome: string): string | null {
  const re = new RegExp(`\\s${nome}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>"']+))`, "i");
  const m = re.exec(tag);
  if (!m) return null;
  return decodificar(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] || "");
}

function meta(html: string, chave: string): string | null {
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const nome = (atributo(tag, "name") || atributo(tag, "property") || atributo(tag, "itemprop") || "").toLowerCase();
    if (nome === chave) {
      const v = atributo(tag, "content");
      if (v) return v.slice(0, 500);
    }
  }
  return null;
}

function absoluta(v: string | null, base: string): string | null {
  if (!v) return null;
  try {
    const u = new URL(v, base).toString();
    return urlPublica(u) ? u : null;
  } catch {
    return null;
  }
}

const unicos = (lista: string[], max: number) => {
  const vistos: Record<string, true> = {};
  const saida: string[] = [];
  for (const x of lista) {
    const k = x.toLowerCase();
    if (!x || vistos[k]) continue;
    vistos[k] = true;
    saida.push(x);
    if (saida.length >= max) break;
  }
  return saida;
};

/** Títulos de navegação e de bloco que não dizem nada sobre o negócio. */
const GENERICO = /^(home|in[ií]cio|menu|contato|contatos|fale conosco|sobre|sobre n[oó]s|quem somos|blog|faq|perguntas frequentes|depoimentos|servi[cç]os|produtos|nossos servi[cç]os|nossos produtos|saiba mais|ver mais|leia mais|clique aqui|enviar|entrar|login|carrinho|buscar|pesquisar|redes sociais|siga-nos|endere[cç]o|localiza[cç][aã]o|newsletter|links|copyright|todos os direitos reservados)$/i;

function textosDasTags(html: string, tags: string, min: number, max: number, limite: number): string[] {
  const re = new RegExp(`<(${tags})\\b[^>]*>([\\s\\S]*?)<\\/\\1\\s*>`, "gi");
  const saida: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && saida.length < limite * 3) {
    const t = textoDoHtml(m[2]);
    if (t.length >= min && t.length <= max && !GENERICO.test(t)) saida.push(t);
  }
  return unicos(saida, limite);
}

/** Os blocos (section/div/ul/article) cujo class ou id fala do assunto: até ~8000 caracteres depois de cada abertura. */
function blocos(html: string, assunto: RegExp): string[] {
  const re = /<(section|div|ul|ol|article|aside)\b[^>]*>/gi;
  const saida: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && saida.length < 6) {
    const tag = m[0];
    const nomes = `${atributo(tag, "class") || ""} ${atributo(tag, "id") || ""}`;
    if (!assunto.test(nomes)) continue;
    saida.push(html.slice(m.index, m.index + 8000));
    re.lastIndex = m.index + 8000;
  }
  return saida;
}

// ------------------------------------------------------------------ cores

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

export function normalizarCor(v: string): string | null {
  const s = String(v || "").trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return `#${m[1].charAt(0)}${m[1].charAt(0)}${m[1].charAt(1)}${m[1].charAt(1)}${m[1].charAt(2)}${m[1].charAt(2)}`;
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) return `#${m[1]}`;
  m = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/.exec(s);
  if (m) return `#${hex2(Number(m[1]))}${hex2(Number(m[2]))}${hex2(Number(m[3]))}`;
  return null;
}

/** Diferença entre o canal mais alto e o mais baixo (cinza, branco e preto ficam perto de zero). */
function saturacao(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/** As cores escritas no HTML (tema, estilos da página, style dos elementos): as com cor primeiro, por frequência. */
export function coresAparentes(html: string, max = 6): string[] {
  const contagem: Record<string, number> = {};
  const somar = (c: string | null, peso: number) => {
    if (c) contagem[c] = (contagem[c] || 0) + peso;
  };
  somar(normalizarCor(meta(html, "theme-color") || ""), 50);
  somar(normalizarCor(meta(html, "msapplication-tilecolor") || ""), 20);
  const trechos: string[] = [];
  const estilos = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = estilos.exec(html)) && trechos.length < 40) trechos.push(m[1].slice(0, 200_000));
  const inline = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi;
  while ((m = inline.exec(html)) && trechos.length < 2000) trechos.push(m[2] !== undefined ? m[2] : m[3] || "");
  const cor = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\([^)]{5,40}\)/gi;
  for (const t of trechos) {
    let c: RegExpExecArray | null;
    while ((c = cor.exec(t))) somar(normalizarCor(c[0]), 1);
  }
  const todas = Object.keys(contagem).sort((a, b) => contagem[b] - contagem[a]);
  const comCor = todas.filter((c) => saturacao(c) >= 24);
  const neutras = todas.filter((c) => saturacao(c) < 24);
  return comCor.concat(neutras).slice(0, max);
}

// ------------------------------------------------------------------ contatos

function contatosDaPagina(html: string, base: string): ContatosLidos {
  const hrefs: string[] = [];
  const re = /<a\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && hrefs.length < 600) {
    const h = atributo(m[0], "href");
    if (h) hrefs.push(h.trim());
  }
  let whatsapp: string | null = null;
  let telefone: string | null = null;
  let email: string | null = null;
  let instagram: string | null = null;
  for (const h of hrefs) {
    if (!whatsapp) {
      const w = /wa\.me\/(\+?\d{8,15})/i.exec(h) || /whatsapp\.com\/send\?[^#]*phone=(\+?\d{8,15})/i.exec(h);
      if (w) whatsapp = w[1].replace(/\D/g, "");
    }
    if (!telefone && /^tel:/i.test(h)) {
      const t = decodificar(h.slice(4)).replace(/[^\d+]/g, "");
      if (t.replace(/\D/g, "").length >= 8) telefone = t;
    }
    if (!email && /^mailto:/i.test(h)) {
      const e = h.slice(7).split("?")[0].trim();
      if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)) email = e.toLowerCase();
    }
    if (!instagram) {
      const i = /instagram\.com\/([a-z0-9._]{2,30})/i.exec(h);
      if (i && !/^(p|reel|reels|explore|stories|accounts)$/i.test(i[1])) instagram = `@${i[1]}`;
    }
  }
  // Instagram lido direto (o próprio perfil).
  if (!instagram) {
    const i = /^https?:\/\/(www\.)?instagram\.com\/([a-z0-9._]{2,30})/i.exec(base);
    if (i) instagram = `@${i[2]}`;
  }
  return { whatsapp, telefone, email, instagram };
}

// ------------------------------------------------------------------ imagens

function imagensDaPagina(html: string, base: string): { imagens: Array<{ url: string; alt: string }>; logo: string | null } {
  const imagens: Array<{ url: string; alt: string }> = [];
  let logo: string | null = null;
  const og = absoluta(meta(html, "og:image") || meta(html, "twitter:image"), base);
  if (og) imagens.push({ url: og, alt: "Imagem de compartilhamento" });
  const re = /<img\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && imagens.length < 6) {
    const tag = m[0];
    const bruto = atributo(tag, "src") || atributo(tag, "data-src") || ((atributo(tag, "srcset") || "").split(",")[0] || "").trim().split(" ")[0];
    const url = absoluta(bruto || null, base);
    if (!url) continue;
    const alt = (atributo(tag, "alt") || "").slice(0, 160);
    const nomes = `${url} ${alt} ${atributo(tag, "class") || ""} ${atributo(tag, "id") || ""}`;
    if (/logo|marca/i.test(nomes)) {
      if (!logo) logo = url;
      continue;
    }
    const largura = Number(atributo(tag, "width") || 0);
    if ((largura && largura < 120) || /\.svg(\?|#|$)|\.gif(\?|#|$)|icon|sprite|pixel|tracking|avatar|emoji|spinner|loader/i.test(nomes)) continue;
    if (imagens.some((i) => i.url === url)) continue;
    imagens.push({ url, alt });
  }
  return { imagens, logo };
}

// ------------------------------------------------------------------ extração

/** Tudo o que dá para tirar do HTML (puro: o teste chama direto). */
export function extrairDaPagina(html: string, url: string): LeituraDoLink {
  const bruto = String(html || "").slice(0, MAX_BYTES_DA_PAGINA_LIDA);
  const limpo = semCodigo(bruto);
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }
  const tituloDaAba = (() => {
    const t = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(bruto);
    return t ? textoDoHtml(t[1]).slice(0, 200) : "";
  })();
  const h1 = textosDasTags(limpo, "h1", 2, 200, 1)[0] || "";
  const ogTitulo = meta(bruto, "og:title") || "";
  const nomeDoSite = meta(bruto, "og:site_name") || meta(bruto, "application-name") || "";
  const primeiraParte = (tituloDaAba || ogTitulo).split(/\s[|–—·:-]\s/)[0].trim();
  const nome = (nomeDoSite || primeiraParte || h1 || host).slice(0, 120);
  const descricao = (meta(bruto, "description") || meta(bruto, "og:description") || meta(bruto, "twitter:description") || "").slice(0, 400);

  const doServico = blocos(limpo, /servi[cç]|produt|solu[cç]|plano|tratament|especialidad|procediment|cardapio|card[aá]pio|curso|pacote|offer|service|product|pricing/i);
  const servicos = unicos(
    doServico
      .map((b) => textosDasTags(b, "h3|h4|li|strong", 3, 90, 12))
      .reduce<string[]>((a, l) => a.concat(l), [])
      .concat(textosDasTags(limpo, "h3", 3, 90, 12)),
    12,
  );
  const doDepoimento = blocos(limpo, /depoiment|testimon|review|avalia[cç]|feedback|cliente-diz|clientes-dizem/i);
  const depoimentos = unicos(
    textosDasTags(limpo, "blockquote", 20, 400, 6).concat(doDepoimento.map((b) => textosDasTags(b, "p|q", 30, 400, 6)).reduce<string[]>((a, l) => a.concat(l), [])),
    6,
  );
  const { imagens, logo } = imagensDaPagina(bruto, url);
  return {
    url,
    host,
    nome,
    titulo: h1 || ogTitulo || tituloDaAba,
    descricao,
    titulos: textosDasTags(limpo, "h2", 3, 160, 10),
    servicos,
    depoimentos,
    cores: coresAparentes(bruto),
    imagens,
    logo,
    contatos: contatosDaPagina(bruto, url),
  };
}

// ------------------------------------------------------------------ robots.txt

function padraoDoRobots(p: string): RegExp {
  const fim = p.charAt(p.length - 1) === "$";
  const corpo = fim ? p.slice(0, -1) : p;
  const partes = corpo.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${partes.join(".*")}${fim ? "$" : ""}`);
}

/**
 * O robots.txt deixa o nosso agente ler este caminho? O grupo com o nosso nome
 * vale mais que o "*"; dentro do grupo, a regra mais comprida que casa decide
 * (empate: Allow). Sem grupo que se aplique: pode.
 */
export function robotsPermite(robots: string, caminho: string, agente = AGENTE_DA_LEITURA): boolean {
  type Grupo = { agentes: string[]; regras: Array<{ permite: boolean; padrao: string }> };
  const grupos: Grupo[] = [];
  let atual: Grupo | null = null;
  let lendoAgentes = false;
  for (const linhaBruta of String(robots || "").split(/\r\n|\r|\n/)) {
    const linha = linhaBruta.split("#")[0].trim();
    if (!linha) continue;
    const i = linha.indexOf(":");
    if (i < 0) continue;
    const chave = linha.slice(0, i).trim().toLowerCase();
    const valor = linha.slice(i + 1).trim();
    if (chave === "user-agent") {
      if (!atual || !lendoAgentes) {
        atual = { agentes: [], regras: [] };
        grupos.push(atual);
      }
      atual.agentes.push(valor.toLowerCase());
      lendoAgentes = true;
    } else if (chave === "allow" || chave === "disallow") {
      lendoAgentes = false;
      if (atual) atual.regras.push({ permite: chave === "allow", padrao: valor });
    } else lendoAgentes = false;
  }
  const nosso = agente.toLowerCase();
  const nossos = grupos.filter((g) => g.agentes.some((a) => a !== "*" && nosso.indexOf(a) >= 0));
  const aplicaveis = nossos.length ? nossos : grupos.filter((g) => g.agentes.indexOf("*") >= 0);
  if (!aplicaveis.length) return true;
  let melhor: { permite: boolean; tamanho: number } | null = null;
  for (const g of aplicaveis)
    for (const r of g.regras) {
      if (!r.padrao) continue; // "Disallow:" vazio libera tudo
      let casa = false;
      try {
        casa = padraoDoRobots(r.padrao).test(caminho);
      } catch {
        casa = false;
      }
      if (!casa) continue;
      const tamanho = r.padrao.length;
      if (!melhor || tamanho > melhor.tamanho || (tamanho === melhor.tamanho && r.permite)) melhor = { permite: r.permite, tamanho };
    }
  return melhor ? melhor.permite : true;
}

// ------------------------------------------------------------------ rede

/** O sinal de prazo (AbortSignal.timeout onde existe; senão, um controlador com relógio). */
function sinalDePrazo(ms: number): AbortSignal {
  const A = AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal };
  if (typeof A.timeout === "function") return A.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

async function lerLimitado(r: Response, max: number): Promise<Uint8Array | null> {
  if (!r.body) {
    const t = new TextEncoder().encode(await r.text());
    return t.length > max ? null : t;
  }
  const leitor = r.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await leitor.cancel().catch(() => {});
      return null;
    }
    partes.push(value);
  }
  const saida = new Uint8Array(total);
  let i = 0;
  for (const p of partes) {
    saida.set(p, i);
    i += p.length;
  }
  return saida;
}

/** GET seguindo redirecionamento à mão: cada salto passa de novo pela regra do endereço público. */
async function buscar(url: string, f: typeof fetch, prazoMs: number, aceita: string, antesDeCadaSalto?: (alvo: string) => Promise<string | null>): Promise<{ r: Response; url: string } | { motivo: string }> {
  let atual = url;
  for (let salto = 0; salto <= MAX_REDIRECIONAMENTOS; salto++) {
    const alvo = urlPublica(atual);
    if (!alvo) return { motivo: "o endereço não é público" };
    if (antesDeCadaSalto) {
      const barrado = await antesDeCadaSalto(alvo);
      if (barrado) return { motivo: barrado };
    }
    const r = await f(alvo, { headers: { "User-Agent": `${AGENTE_DA_LEITURA}/1.0 (+leitura do site do cliente)`, Accept: aceita }, redirect: "manual", signal: sinalDePrazo(prazoMs) });
    if (r.status >= 300 && r.status < 400) {
      const destino = r.headers.get("location");
      if (!destino) return { r, url: alvo };
      try {
        atual = new URL(destino, alvo).toString();
      } catch {
        return { motivo: "a página redirecionou para um endereço inválido" };
      }
      continue;
    }
    return { r, url: alvo };
  }
  return { motivo: "a página redirecionou vezes demais" };
}

/** O robots.txt da origem: null = pode ler; texto = o motivo de não ler. */
export async function conferirRobots(alvo: string, f: typeof fetch): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(alvo);
  } catch {
    return "o endereço não é válido";
  }
  const naoPermite = "o site não permite leitura automática (robots.txt)";
  try {
    const b = await buscar(`${u.origin}/robots.txt`, f, PRAZO_DO_ROBOTS_MS, "text/plain");
    if ("motivo" in b) return "não deu para ler as regras do site (robots.txt)";
    if (b.r.status >= 500) return "o site está fora do ar para leitura (robots.txt com erro)";
    if (b.r.status >= 400) return null; // sem robots.txt: pode
    const bytes = await lerLimitado(b.r, MAX_BYTES_DO_ROBOTS);
    if (!bytes) return null;
    return robotsPermite(new TextDecoder().decode(bytes), `${u.pathname}${u.search}`) ? null : naoPermite;
  } catch {
    return "não deu para ler as regras do site (robots.txt)";
  }
}

/** Aceita "cliente.com.br" ou "instagram.com/x" sem o https. */
export function linkDoDono(bruto: unknown): string | null {
  let s = String(bruto || "").trim();
  if (!s || s.length > 600) return null;
  if (/^@[a-z0-9._]{2,30}$/i.test(s)) s = `https://www.instagram.com/${s.slice(1)}/`;
  else if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return urlPublica(s);
}

/** Lê a página do cliente: robots, prazo, teto e só HTML. Falha vira motivo em português. */
export async function lerLinkDoCliente(bruto: unknown, f: typeof fetch): Promise<ResultadoDaLeitura> {
  const url = linkDoDono(bruto);
  if (!url) return { leitura: null, motivo: "Esse link não é um endereço público válido." };
  const origensConferidas: Record<string, true> = {};
  try {
    const b = await buscar(url, f, PRAZO_DA_PAGINA_MS, "text/html,application/xhtml+xml", async (alvo) => {
      const origem = new URL(alvo).origin;
      if (origensConferidas[origem]) return null;
      origensConferidas[origem] = true;
      return conferirRobots(alvo, f);
    });
    if ("motivo" in b) {
      const instagram = /instagram\.com/i.test(url) && /robots/.test(b.motivo);
      return { leitura: null, motivo: instagram ? "O Instagram não permite leitura automática (robots.txt). Cole a bio e os destaques no briefing." : `Não deu para ler: ${b.motivo}.` };
    }
    if (!b.r.ok) return { leitura: null, motivo: `Não deu para ler: a página respondeu ${b.r.status}.` };
    const tipo = (b.r.headers.get("content-type") || "").toLowerCase();
    if (tipo && tipo.indexOf("html") < 0) return { leitura: null, motivo: "Não deu para ler: o link não é uma página (é um arquivo)." };
    const bytes = await lerLimitado(b.r, MAX_BYTES_DA_PAGINA_LIDA);
    if (!bytes) return { leitura: null, motivo: "Não deu para ler: a página é grande demais." };
    const leitura = extrairDaPagina(new TextDecoder().decode(bytes), b.url);
    const vazia = !leitura.titulo && !leitura.descricao && !leitura.servicos.length && !leitura.titulos.length;
    return { leitura, motivo: vazia ? "A página abriu, mas quase não tem texto no HTML (site montado só no navegador). Confira o que veio." : null };
  } catch (e) {
    return { leitura: null, motivo: e instanceof Error && /timeout|abort/i.test(`${e.name} ${e.message}`) ? "Não deu para ler: a página demorou demais." : "Não deu para ler: a página não abriu." };
  }
}
