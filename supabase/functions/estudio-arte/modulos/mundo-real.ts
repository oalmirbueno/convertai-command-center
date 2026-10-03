/**
 * Mundo real na arte (02/10, dono: "quando falar de coisas REAIS tem que usar
 * fontes, imagens e logos reais e PESQUISAR NA INTERNET para montar certo; às
 * vezes um tutorial ou uma configuração, e recriar idêntico na arte").
 *
 * Causa: o diretor tinha a regra "você não pesquisa na internet" e nenhuma
 * fonte de logo real; em tutorial ("como configurar X", "passo a passo no app
 * Y") ele escrevia menus e botões de memória e o gerador desenhava a logo da
 * marca citada (logo falsa).
 *
 * Agora, quando o pedido, o post ou o item falam de produto, app, marca ou
 * tela real:
 * 1. o diretor escreve com a pesquisa web ligada (o mesmo pesquisaWeb do
 *    chamarTexto das outras mesas), com os nomes de menus, botões e a ordem
 *    exatos da documentação oficial, e devolve as fontes;
 * 2. as logos das marcas citadas vêm do Wikimedia Commons (a imagem PNG que o
 *    próprio Commons gera do SVG, com a licença) e entram COLADAS PELO CÓDIGO
 *    num canto da lâmina, pelo caminho da vitrine de logos
 *    (modulos/vitrine-na-arte.ts): o gerador nunca desenha logo de terceiro;
 * 3. o Simple Icons (cdn.jsdelivr.net/npm/simple-icons) fica como a fonte do
 *    SVG oficial da marca na nota de fontes (a função não rasteriza SVG);
 * 4. print de tela real só da equipe (Compor) ou de documentação oficial com
 *    licença; sem isso, a tela é recriada em estilo plano com os rótulos
 *    exatos, sem imitar a logo.
 *
 * Puro (sem Deno nem npm): a função e os testes leem o mesmo arquivo.
 * Sem lookbehind, propriedade Unicode ou grupo nomeado em regex (Safari 11).
 */

import type { Area } from "./vitrine-de-logos.ts";

const semAcento = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Marcas, apps e sistemas que mais aparecem em tutorial e configuração (nome como vai na nota). */
export const MARCAS_CONHECIDAS: Array<[RegExp, string]> = [
  [/\bwhats ?app\b|\bwpp\b|\bzap\b/, "WhatsApp"],
  [/\binstagram\b|\binsta\b/, "Instagram"],
  [/\bfacebook\b/, "Facebook"],
  [/\btik ?tok\b/, "TikTok"],
  [/\byoutube\b/, "YouTube"],
  [/\bgmail\b/, "Gmail"],
  [/\bgoogle (meu negocio|perfil da empresa|maps|agenda|drive|ads|analytics)\b/, "Google"],
  [/\bgoogle\b/, "Google"],
  [/\biphone\b|\bios\b/, "Apple"],
  [/\bandroid\b/, "Android"],
  [/\bwindows\b/, "Windows"],
  [/\bexcel\b/, "Microsoft Excel"],
  [/\bcanva\b/, "Canva"],
  [/\bcapcut\b/, "CapCut"],
  [/\bchat ?gpt\b|\bopenai\b/, "ChatGPT"],
  [/\bmercado livre\b/, "Mercado Livre"],
  [/\bmercado pago\b/, "Mercado Pago"],
  [/\bshopee\b/, "Shopee"],
  [/\bifood\b/, "iFood"],
  [/\buber\b/, "Uber"],
  [/\bnubank\b/, "Nubank"],
  [/\bpicpay\b/, "PicPay"],
  [/\bpix\b/, "Pix"],
  [/\bspotify\b/, "Spotify"],
  [/\bnetflix\b/, "Netflix"],
  [/\blinkedin\b/, "LinkedIn"],
  [/\btelegram\b/, "Telegram"],
  [/\bamazon\b/, "Amazon"],
  [/\bnotion\b/, "Notion"],
  [/\bgov\.?br\b/, "gov.br"],
];

/** Sinal forte de tela real: configuração de app, toque e clique, versão. */
const TELA_REAL = /configurac(ao|oes) d[oae]|toque em|clique em|abra o (app|aplicativo)|no (app|aplicativo|celular)\b|atualizac(ao|oes) do (app|sistema)|versao [0-9]/;
/** Sinal fraco (passo a passo de maquiagem também é passo a passo): só vale com uma marca citada. */
const TUTORIAL = /como (configurar|ativar|desativar|usar|instalar|mudar|alterar|cadastrar|criar|fazer|baixar|emitir|agendar|liberar|bloquear|conectar|recuperar|limpar)|passo a passo|tutorial/;

export interface PedidoDoMundoReal {
  real: boolean;
  tutorial: boolean;
  marcas: string[];
}

/** O pedido, o post ou o item falam de produto, app, marca ou tela real (pelas palavras; sem rede). */
export function mundoRealPelaRegra(textos: Array<string | null | undefined>): PedidoDoMundoReal {
  const s = semAcento(textos.filter(Boolean).join("\n"));
  const marcas: string[] = [];
  for (const [re, nome] of MARCAS_CONHECIDAS) if (re.test(s) && marcas.indexOf(nome) < 0) marcas.push(nome);
  const tela = TELA_REAL.test(s);
  const tutorial = tela || (marcas.length > 0 && TUTORIAL.test(s));
  return { real: tela || marcas.length > 0, tutorial, marcas: marcas.slice(0, 6) };
}

/** A pergunta ao Jev (Noul) quando as palavras não decidem: o pedido depende de informação real e atual de um produto, app, marca ou tela? */
export function perguntaDoMundoReal(): { type: "noul"; instructions: string; criteria: { true: string; false: string } } {
  return {
    type: "noul",
    instructions: "O pedido em `pedido` (com o conteúdo do post em `post_do_instagram`, quando houver) é sobre um produto, aplicativo, site, marca, sistema ou tela REAL de outra empresa, em que a arte precisa mostrar informação atual e exata dele (passo a passo, configuração, menus, botões, versões, especificações, a logo da marca)?",
    criteria: {
      true: "Tutorial ou configuração de um app ou sistema real (\"como ativar o Pix no Nubank\"), especificação de um produto real de outra marca, ou peça que mostra a marca ou a tela de outra empresa.",
      false: "Conteúdo da própria marca do cliente (oferta, serviço, dica do nicho, evento, institucional) sem depender de dado atual de outro produto ou app.",
    },
  };
}

/** Limiar do Noul do mundo real (sim a partir daqui). */
export const LIMIAR_DO_MUNDO_REAL = 0.6;

export const INSTRUCOES_DO_MUNDO_REAL = `MUNDO REAL (o pedido fala de produto, app, marca ou tela real; a pesquisa na web está ligada para você)
- Pesquise antes de escrever: a documentação oficial ou a central de ajuda da empresa (versão atual, Brasil, português) e, só se faltar, uma fonte confiável recente. Monte os passos EXATAMENTE como estão: nomes de menus, abas, botões e opções com a grafia da tela, na ordem certa, um passo por linha ("Abra o WhatsApp", "Toque em Configurações > Privacidade"). Diferença entre iPhone e Android: diga qual vale ou separe.
- Nunca invente menu, botão, preço, especificação nem versão. O que você não confirmou fica fora e vira aviso em \`avisos_para_a_equipe\`.
- fontes_da_pesquisa: as páginas que você usou (título e endereço), as oficiais primeiro.
- marcas_reais: cada marca de outra empresa que aparece na peça (nome oficial; arquivo_wikimedia com o nome exato do arquivo da logo no Wikimedia Commons, como "File:WhatsApp.svg", quando você achou; senão vazio; laminas com as ordens onde ela aparece). A logo dessas marcas é colada pelo CÓDIGO num canto da lâmina: no layout, NÃO desenhe nem descreva a logo de outra empresa, não escreva o nome dela em estilo de logo e deixe o canto de cima à direita calmo. O nome da marca pode aparecer no texto normal ("no WhatsApp").
- Tela de app: sem print enviado pela equipe, a lâmina mostra a tela recriada em estilo plano e limpo (moldura de celular simples, os rótulos e a ordem exatos), sem copiar ícones nem a logo da empresa. Com print da equipe (Compor), use o print.
- Fonte real: quando a tela ou a marca tem fonte conhecida e livre (Google Fonts, como Roboto no Android ou Inter), diga em tratamento; senão, as fontes do cliente.`;

/** Campos que o diretor devolve para o mundo real (entram no esquema da direção; vazios quando não é o caso). */
export const CAMPOS_DO_MUNDO_REAL = {
  marcas_reais: {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["nome", "arquivo_wikimedia", "laminas"],
      properties: {
        nome: { type: "string" },
        arquivo_wikimedia: { type: "string" },
        laminas: { type: "array", items: { type: "integer" } },
      },
    },
  },
  fontes_da_pesquisa: {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["titulo", "url"],
      properties: { titulo: { type: "string" }, url: { type: "string" } },
    },
  },
};

export interface MarcaReal {
  nome: string;
  arquivo: string | null;
  laminas: number[];
}

/** Máximo de marcas reais com logo colada numa peça. */
export const MAX_MARCAS_REAIS = 3;

/** Nome de arquivo do Commons limpo ("File:..."), ou null (sem extensão de imagem, com barra ou endereço). */
export function arquivoDoCommons(v: unknown): string | null {
  let s = String(v == null ? "" : v).trim();
  if (!s) return null;
  const doLink = s.match(/commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/i);
  if (doLink) {
    try {
      s = decodeURIComponent(doLink[1]).replace(/_/g, " ");
    } catch {
      return null;
    }
  }
  s = s.replace(/^(arquivo|ficheiro|image|file)\s*:\s*/i, "");
  if (!/\.(svg|png|jpe?g|webp)$/i.test(s) || /[\/\\#?<>[\]{}|]/.test(s) || s.length > 200) return null;
  return `File:${s}`;
}

/** As marcas reais da direção, limpas: nome, arquivo do Commons e lâminas que existem (sem lâmina: a capa). */
export function normalizarMarcasReais(bruto: unknown, ordens: number[]): MarcaReal[] {
  const lista = (Array.isArray(bruto) ? bruto : []).filter((m) => m && typeof m === "object") as Record<string, unknown>[];
  const vistos: Record<string, true> = {};
  const saida: MarcaReal[] = [];
  for (const m of lista) {
    const nome = String(m.nome == null ? "" : m.nome).replace(/\s+/g, " ").trim().slice(0, 60);
    const chave = semAcento(nome);
    if (!nome || vistos[chave]) continue;
    vistos[chave] = true;
    const laminas = (Array.isArray(m.laminas) ? m.laminas : []).map(Number).filter((o) => ordens.indexOf(o) >= 0);
    saida.push({ nome, arquivo: arquivoDoCommons(m.arquivo_wikimedia), laminas: laminas.length ? Array.from(new Set(laminas)).sort((a, b) => a - b) : ordens.slice(0, 1) });
    if (saida.length >= MAX_MARCAS_REAIS) break;
  }
  return saida;
}

// ------------------------------------------------------------------ Simple Icons (SVG oficial, na nota)

/** O slug do Simple Icons pelo nome da marca (as regras do projeto: + vira plus, . vira dot, & vira and, sem acento e sem espaço). */
export function slugDoSimpleIcons(nome: string): string {
  return semAcento(nome)
    .replace(/\+/g, "plus")
    .replace(/\./g, "dot")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
}

export const urlDoSimpleIcons = (slug: string) => `https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/${slug}.svg`;

// ------------------------------------------------------------------ Wikimedia Commons (PNG com licença)

const API_DO_COMMONS = "https://commons.wikimedia.org/w/api.php";
/** Largura da logo pedida ao Commons (a miniatura em PNG que ele gera do SVG). */
export const LARGURA_DA_LOGO_REAL = 640;
export const MAX_BYTES_DA_LOGO_REAL = 3 * 1024 * 1024;

export const urlDaInfoDoCommons = (arquivo: string) =>
  `${API_DO_COMMONS}?action=query&format=json&formatversion=2&prop=imageinfo&iiprop=url%7Cmime%7Cextmetadata&iiurlwidth=${LARGURA_DA_LOGO_REAL}&titles=${encodeURIComponent(arquivo)}`;

export const urlDaBuscaNoCommons = (nome: string) =>
  `${API_DO_COMMONS}?action=query&format=json&formatversion=2&list=search&srnamespace=6&srlimit=8&srsearch=${encodeURIComponent(`${nome} logo`)}`;

/** Só a imagem servida pelo Commons, por https. */
export function hostDoCommonsPermitido(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443") && u.hostname.toLowerCase() === "upload.wikimedia.org";
  } catch {
    return false;
  }
}

export interface LogoDoCommons {
  arquivo: string;
  url: string;
  pagina: string | null;
  licenca: string;
  autor: string | null;
}

const semHtml = (s: unknown) => String(s == null ? "" : s).replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();

/** A resposta do imageinfo: a miniatura PNG (ou a própria imagem raster), a página e a licença; null sem imagem. */
export function lerInfoDoCommons(json: unknown, arquivo: string): LogoDoCommons | null {
  const q = json && typeof json === "object" ? (json as Record<string, any>).query : null;
  const paginas = q && Array.isArray(q.pages) ? q.pages : [];
  const p = paginas[0];
  if (!p || p.missing || !Array.isArray(p.imageinfo) || !p.imageinfo.length) return null;
  const ii = p.imageinfo[0] || {};
  const raster = /^image\/(png|jpeg|webp)$/.test(String(ii.mime || ""));
  const url = String(ii.thumburl || (raster ? ii.url : "") || "");
  if (!url || !hostDoCommonsPermitido(url)) return null;
  const meta = ii.extmetadata || {};
  const licenca = semHtml(meta.LicenseShortName && meta.LicenseShortName.value) || semHtml(meta.License && meta.License.value) || "licença não informada";
  const autor = semHtml(meta.Artist && meta.Artist.value) || null;
  return { arquivo, url, pagina: typeof ii.descriptionurl === "string" ? ii.descriptionurl : null, licenca: licenca.slice(0, 80), autor: autor ? autor.slice(0, 120) : null };
}

/**
 * O arquivo da logo na busca do Commons, escolhido em código: o título tem o
 * nome da marca e a palavra "logo" (ou "icon"), SVG antes de PNG; null sem um
 * que sirva (não chuta).
 */
export function escolherNaBusca(json: unknown, nome: string): string | null {
  const q = json && typeof json === "object" ? (json as Record<string, any>).query : null;
  const lista = q && Array.isArray(q.search) ? (q.search as Array<{ title?: string }>) : [];
  const alvo = semAcento(nome).replace(/[^a-z0-9]/g, "");
  if (alvo.length < 2) return null;
  const candidatos = lista
    .map((r) => String(r.title || ""))
    .filter((t) => /^File:/i.test(t) && /\.(svg|png)$/i.test(t))
    .filter((t) => {
      const s = semAcento(t);
      return s.replace(/[^a-z0-9]/g, "").indexOf(alvo) >= 0 && /logo|icon|logotipo|wordmark/.test(s) && !/(fake|parody|parodia|concept|unofficial|fan)/.test(s);
    })
    .sort((a, b) => Number(/\.svg$/i.test(b)) - Number(/\.svg$/i.test(a)) || a.length - b.length);
  return candidatos[0] || null;
}

/** Área da logo da marca real no quadro final: o canto de cima à direita, pequena. */
export const AREA_DA_LOGO_REAL: Area = { x0: 0.74, y0: 0.045, x1: 0.94, y1: 0.145 };

/** Frase do prompt da lâmina: o canto que fica calmo para a logo real entrar pelo código. */
export function fraseDaLogoReal(area: Area, nomes: string[]): string {
  const pct = (n: number) => Math.round(n * 100);
  const lista = nomes.filter(Boolean).join(", ") || "da marca citada";
  return `LOGO REAL (${lista}): a logo oficial entra depois, colada pelo código, no canto de ${pct(area.x0)}% a ${pct(area.x1)}% da largura e de ${pct(area.y0)}% a ${pct(area.y1)}% da altura. Deixe esse canto calmo e liso, sem texto, sem ícone e sem logo. Não desenhe a logo de ${lista} em lugar nenhum da arte.`;
}

// ------------------------------------------------------------------ nota de fontes

export interface FonteDoResultado {
  titulo: string;
  url: string;
  tipo: "pesquisa" | "logo" | "icone";
  licenca?: string | null;
}

/** As fontes da peça (pesquisa da web, as do diretor, logos com licença e o SVG oficial), sem repetir, até 12. */
export function notaDasFontes(e: {
  daWeb?: Array<{ url?: string; titulo?: string; title?: string }>;
  doDiretor?: unknown;
  logos?: LogoDoCommons[];
  icones?: Array<{ nome: string; url: string }>;
}): FonteDoResultado[] {
  const saida: FonteDoResultado[] = [];
  const vistos: Record<string, true> = {};
  const juntar = (f: FonteDoResultado) => {
    let u: URL;
    try {
      u = new URL(f.url);
    } catch {
      return;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") return;
    const chave = `${u.hostname}${u.pathname}`.replace(/\/$/, "");
    if (vistos[chave] || saida.length >= 12) return;
    vistos[chave] = true;
    saida.push({ ...f, titulo: String(f.titulo || u.hostname).replace(/\s+/g, " ").trim().slice(0, 140), url: u.toString().slice(0, 500) });
  };
  const doDiretor = (Array.isArray(e.doDiretor) ? e.doDiretor : []).filter((x) => x && typeof x === "object") as Array<Record<string, unknown>>;
  for (const f of doDiretor) juntar({ titulo: String(f.titulo || ""), url: String(f.url || ""), tipo: "pesquisa" });
  for (const f of e.daWeb || []) juntar({ titulo: String(f.titulo || f.title || ""), url: String(f.url || ""), tipo: "pesquisa" });
  for (const l of e.logos || []) juntar({ titulo: `Logo: ${l.arquivo.replace(/^File:/, "")}${l.autor ? ` (${l.autor})` : ""}`, url: l.pagina || l.url, tipo: "logo", licenca: l.licenca });
  for (const i of e.icones || []) juntar({ titulo: `Ícone oficial (SVG) de ${i.nome} no Simple Icons`, url: i.url, tipo: "icone" });
  return saida;
}
