/**
 * Mundo real no Estúdio Ads (pedido do dono em 02/10/2026: "quando falar de
 * coisa real, usar fonte, imagem e logo reais; pesquisar na internet para
 * montar certo, como tutorial e configuração, e recriar idêntico"). Puro: sem
 * Deno e sem banco; a rede entra por quem chama (o servidor passa a busca
 * segura e o chamarTexto com pesquisaWeb; o teste passa falsos). Sem travessão.
 *
 * - MARCAS_REAIS e entidadesReais: apps, produtos e serviços conhecidos que a
 *   copy ou a arte citam (Instagram, WhatsApp, Pix, iFood...).
 * - pedeTutorial e precisaPesquisar: quando o anúncio fala de passo a passo,
 *   configuração ou de uma marca real, a copy só sai depois da pesquisa.
 * - pesquisarFatosReais: uma chamada com busca web (modelo de leitura,
 *   raciocínio baixo, custo contado) que devolve fatos, passos com os nomes
 *   exatos da tela e as fontes citadas.
 * - Logos reais: Simple Icons (ícone em SVG, licença CC0 do desenho; a marca é
 *   de quem a registrou) e Wikimedia Commons (arquivo com a licença lida da
 *   própria página). O logo nunca é redesenhado pelo gerador: entra por
 *   código, por cima da arte (LogosReais.tsx, canvas no navegador).
 */

export type MarcaReal = {
  id: string;
  nome: string;
  /** Padrão sem acento e em minúsculas. */
  padrao: RegExp;
  /** Slug do Simple Icons (null quando o Simple Icons não tem). */
  simpleIcons: string | null;
  /** Busca no Wikimedia Commons (sempre há uma, para o PNG/SVG oficial). */
  busca: string;
};

export const MARCAS_REAIS: MarcaReal[] = [
  { id: "instagram", nome: "Instagram", padrao: /\binstagram\b|\binsta\b|\breels?\b|\bstories\b/, simpleIcons: "instagram", busca: "Instagram logo 2022" },
  { id: "whatsapp", nome: "WhatsApp", padrao: /\bwhats ?app\b|\bzap\b|\bwpp\b/, simpleIcons: "whatsapp", busca: "WhatsApp logo" },
  { id: "facebook", nome: "Facebook", padrao: /\bfacebook\b/, simpleIcons: "facebook", busca: "Facebook logo 2023" },
  { id: "meta", nome: "Meta", padrao: /\bmeta ads\b|\bgerenciador de anuncios\b|\bmeta business\b/, simpleIcons: "meta", busca: "Meta Platforms logo" },
  { id: "google", nome: "Google", padrao: /\bgoogle\b(?! (maps|meu negocio|ads|drive|planilhas|sheets|chrome))/, simpleIcons: "google", busca: "Google 2015 logo" },
  { id: "googlemaps", nome: "Google Maps", padrao: /\bgoogle maps\b|\bmaps do google\b/, simpleIcons: "googlemaps", busca: "Google Maps icon 2020" },
  { id: "googlemeunegocio", nome: "Perfil da Empresa no Google", padrao: /\bgoogle meu negocio\b|\bperfil da empresa no google\b|\bgoogle business\b/, simpleIcons: "google", busca: "Google Business Profile logo" },
  { id: "googleads", nome: "Google Ads", padrao: /\bgoogle ads\b/, simpleIcons: "googleads", busca: "Google Ads logo" },
  { id: "googlesheets", nome: "Planilhas Google", padrao: /\bgoogle (sheets|planilhas)\b|\bplanilhas google\b/, simpleIcons: "googlesheets", busca: "Google Sheets logo 2020" },
  { id: "googledrive", nome: "Google Drive", padrao: /\bgoogle drive\b/, simpleIcons: "googledrive", busca: "Google Drive icon 2020" },
  { id: "gmail", nome: "Gmail", padrao: /\bgmail\b/, simpleIcons: "gmail", busca: "Gmail icon 2020" },
  { id: "youtube", nome: "YouTube", padrao: /\byoutube\b/, simpleIcons: "youtube", busca: "YouTube logo 2017" },
  { id: "tiktok", nome: "TikTok", padrao: /\btik ?tok\b/, simpleIcons: "tiktok", busca: "TikTok logo" },
  { id: "threads", nome: "Threads", padrao: /\bthreads\b/, simpleIcons: "threads", busca: "Threads (app) logo" },
  { id: "linkedin", nome: "LinkedIn", padrao: /\blinkedin\b/, simpleIcons: "linkedin", busca: "LinkedIn logo 2021" },
  { id: "pinterest", nome: "Pinterest", padrao: /\bpinterest\b/, simpleIcons: "pinterest", busca: "Pinterest logo" },
  { id: "telegram", nome: "Telegram", padrao: /\btelegram\b/, simpleIcons: "telegram", busca: "Telegram logo" },
  { id: "ifood", nome: "iFood", padrao: /\bifood\b/, simpleIcons: "ifood", busca: "iFood logo" },
  { id: "mercadolivre", nome: "Mercado Livre", padrao: /\bmercado livre\b/, simpleIcons: null, busca: "Mercado Livre logo" },
  { id: "mercadopago", nome: "Mercado Pago", padrao: /\bmercado pago\b/, simpleIcons: "mercadopago", busca: "Mercado Pago logo" },
  { id: "shopee", nome: "Shopee", padrao: /\bshopee\b/, simpleIcons: "shopee", busca: "Shopee logo" },
  { id: "amazon", nome: "Amazon", padrao: /\bamazon\b/, simpleIcons: "amazon", busca: "Amazon logo" },
  { id: "nubank", nome: "Nubank", padrao: /\bnubank\b/, simpleIcons: "nubank", busca: "Nubank logo 2021" },
  { id: "picpay", nome: "PicPay", padrao: /\bpicpay\b/, simpleIcons: "picpay", busca: "PicPay logo" },
  { id: "pagseguro", nome: "PagSeguro", padrao: /\bpagseguro\b|\bpagbank\b/, simpleIcons: "pagseguro", busca: "PagBank logo" },
  { id: "pix", nome: "Pix", padrao: /\bpix\b/, simpleIcons: "pix", busca: "Logo Pix" },
  { id: "canva", nome: "Canva", padrao: /\bcanva\b/, simpleIcons: "canva", busca: "Canva logo" },
  { id: "chatgpt", nome: "ChatGPT", padrao: /\bchat ?gpt\b|\bopenai\b/, simpleIcons: "openai", busca: "ChatGPT logo" },
  { id: "apple", nome: "Apple", padrao: /\biphone\b|\bipad\b|\bmacbook\b|\bios\b|\bapple\b/, simpleIcons: "apple", busca: "Apple logo black" },
  { id: "android", nome: "Android", padrao: /\bandroid\b/, simpleIcons: "android", busca: "Android robot 2023" },
  { id: "windows", nome: "Windows", padrao: /\bwindows\b/, simpleIcons: "windows", busca: "Windows logo 2021" },
  { id: "excel", nome: "Microsoft Excel", padrao: /\bexcel\b/, simpleIcons: "microsoftexcel", busca: "Microsoft Office Excel 2019" },
  { id: "uber", nome: "Uber", padrao: /\buber\b/, simpleIcons: "uber", busca: "Uber logo 2018" },
  { id: "spotify", nome: "Spotify", padrao: /\bspotify\b/, simpleIcons: "spotify", busca: "Spotify logo with text" },
  { id: "netflix", nome: "Netflix", padrao: /\bnetflix\b/, simpleIcons: "netflix", busca: "Netflix 2015 logo" },
  { id: "shopify", nome: "Shopify", padrao: /\bshopify\b/, simpleIcons: "shopify", busca: "Shopify logo 2018" },
  { id: "airbnb", nome: "Airbnb", padrao: /\bairbnb\b/, simpleIcons: "airbnb", busca: "Airbnb logo" },
  { id: "booking", nome: "Booking.com", padrao: /\bbooking\b/, simpleIcons: "bookingdotcom", busca: "Booking.com logo" },
  { id: "waze", nome: "Waze", padrao: /\bwaze\b/, simpleIcons: "waze", busca: "Waze logo" },
  { id: "zoom", nome: "Zoom", padrao: /\bzoom\b/, simpleIcons: "zoom", busca: "Zoom Communications logo" },
  { id: "notion", nome: "Notion", padrao: /\bnotion\b/, simpleIcons: "notion", busca: "Notion app logo" },
  { id: "samsung", nome: "Samsung", padrao: /\bsamsung\b|\bgalaxy\b/, simpleIcons: "samsung", busca: "Samsung Logo" },
  { id: "xiaomi", nome: "Xiaomi", padrao: /\bxiaomi\b|\bredmi\b/, simpleIcons: "xiaomi", busca: "Xiaomi logo 2021" },
];

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Marcas reais citadas no texto (cada uma uma vez, na ordem da lista). */
export function entidadesReais(texto: string): MarcaReal[] {
  const s = semAcento(String(texto || ""));
  if (!s.trim()) return [];
  const achadas = MARCAS_REAIS.filter((m) => m.padrao.test(s));
  // "Google" genérico sai quando já há um produto Google mais específico.
  const especificos = achadas.some((m) => m.id !== "google" && /^google|^gmail/.test(m.id));
  return achadas.filter((m) => !(m.id === "google" && especificos));
}

const TUTORIAL = /\btutorial\b|passo a passo|\bcomo (configurar|ativar|desativar|usar o|usar a|instalar|cadastrar|conectar|liberar|vincular|habilitar)\b|\bconfigura(r|cao|coes) (do|da|no|na|de)\b|\batalho\b|\bnova funcao\b|\bfuncao nova\b|\batualizacao do (app|aplicativo)\b/;

/** O pedido ou o ângulo fala de passo a passo, configuração ou tela de app. */
export const pedeTutorial = (texto: string) => TUTORIAL.test(semAcento(String(texto || "")));

/**
 * Pesquisa antes de escrever quando o ASSUNTO (ângulo, pedido da equipe ou
 * referência) é tutorial ou marca real. Marca citada só de passagem na copy
 * ("pague no Pix") ganha o logo, mas não a pesquisa paga.
 */
export function precisaPesquisar(assunto: string): boolean {
  return pedeTutorial(assunto) || entidadesReais(assunto).length > 0;
}

// ------------------------------------------------------------ pesquisa web

export type FonteReal = { titulo: string; url: string };
export type PesquisaReal = {
  fatos: string[];
  passos: string[];
  /** Nomes exatos de botões, menus e telas como aparecem no app (para recriar idêntico). */
  nomes_exatos: string[];
  alertas: string[];
  fontes: FonteReal[];
  pesquisado_em: string;
};

export const ESQUEMA_PESQUISA_REAL = {
  nome: "pesquisa_do_mundo_real",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["fatos", "passos", "nomes_exatos", "alertas"],
    properties: {
      fatos: { type: "array", items: { type: "string" } },
      passos: { type: "array", items: { type: "string" } },
      nomes_exatos: { type: "array", items: { type: "string" } },
      alertas: { type: "array", items: { type: "string" } },
    },
  },
};

export const SISTEMA_DA_PESQUISA = [
  "Você pesquisa na internet, para a agência Aceleriq, os fatos reais que um anúncio vai citar (apps, produtos, configurações, passo a passo).",
  "- Use a busca web e prefira a fonte oficial (central de ajuda, site do fabricante, documentação) e a versão atual em português do Brasil.",
  "- fatos: frases curtas e verificáveis. passos: o passo a passo atual, na ordem, com os nomes exatos da tela. nomes_exatos: os rótulos de botões, menus e telas exatamente como aparecem.",
  "- alertas: o que mudou recentemente, o que varia por versão, país ou aparelho, e o que não deu para confirmar.",
  "- Nunca invente passo ou nome de botão: sem fonte, deixe de fora e diga em alertas. Sem travessão. Responda só com o JSON pedido.",
].join("\n");

export type ChamarPesquisa = (p: { sistema: string; texto: string; esquema: typeof ESQUEMA_PESQUISA_REAL }) => Promise<{ json: unknown; custoUsd: number; saldoUsd: number | null; fontes?: { url?: string; titulo?: string }[] }>;

const listaDeTextos = (v: unknown, max: number, tam = 300) =>
  (Array.isArray(v) ? v : []).map((x) => String(x == null ? "" : x).replace(/\s+/g, " ").trim().slice(0, tam)).filter(Boolean).slice(0, max);

/** Fontes citadas pela busca, sem repetir url e só http(s). */
export function fontesLimpas(fontes: { url?: string; titulo?: string }[] | null | undefined, max = 8): FonteReal[] {
  const saida: FonteReal[] = [];
  for (const f of fontes ?? []) {
    const url = String((f && f.url) || "").trim();
    if (!/^https?:\/\//i.test(url) || saida.some((x) => x.url === url)) continue;
    let titulo = String((f && f.titulo) || "").replace(/\s+/g, " ").trim().slice(0, 160);
    if (!titulo) {
      try {
        titulo = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        titulo = url.slice(0, 80);
      }
    }
    saida.push({ titulo, url });
    if (saida.length >= max) break;
  }
  return saida;
}

/** Uma pesquisa com busca web sobre o que o anúncio cita. A falha sobe: quem chama decide. */
export async function pesquisarFatosReais(
  chamar: ChamarPesquisa,
  e: { assunto: string; entidades: MarcaReal[]; tutorial: boolean },
  agora = new Date().toISOString(),
): Promise<{ pesquisa: PesquisaReal; custoUsd: number; saldoUsd: number | null }> {
  const texto = [
    `O anúncio vai falar disto: ${String(e.assunto || "").slice(0, 1500)}`,
    e.entidades.length ? `Marcas e apps citados: ${e.entidades.map((m) => m.nome).join(", ")}.` : "",
    e.tutorial ? "É um passo a passo ou configuração: traga os passos atuais e os nomes exatos da tela." : "Traga os fatos atuais que o anúncio pode citar sem erro (nome certo, o que o app faz, onde fica).",
  ].filter(Boolean).join("\n");
  const r = await chamar({ sistema: SISTEMA_DA_PESQUISA, texto, esquema: ESQUEMA_PESQUISA_REAL });
  const j = (r.json && typeof r.json === "object" ? r.json : {}) as Record<string, unknown>;
  return {
    pesquisa: {
      fatos: listaDeTextos(j.fatos, 12),
      passos: listaDeTextos(j.passos, 12),
      nomes_exatos: listaDeTextos(j.nomes_exatos, 20, 80),
      alertas: listaDeTextos(j.alertas, 6),
      fontes: fontesLimpas(r.fontes),
      pesquisado_em: agora,
    },
    custoUsd: r.custoUsd,
    saldoUsd: r.saldoUsd,
  };
}

/** Bloco do prompt com o que foi pesquisado (vazio sem pesquisa). */
export function blocoDoMundoReal(p: PesquisaReal | null, entidades: MarcaReal[]): string {
  if (!p && !entidades.length) return "";
  const partes = ["MUNDO REAL (pesquisado na web; use os nomes exatamente assim):"];
  if (entidades.length) partes.push(`- Marcas citadas: ${entidades.map((m) => m.nome).join(", ")} (escreva o nome oficial; o logo real entra por código, nunca desenhe nem imite logo de terceiro).`);
  if (p && p.fatos.length) partes.push(`- Fatos: ${p.fatos.join(" | ")}`);
  if (p && p.passos.length) partes.push(`- Passo a passo atual: ${p.passos.map((x, i) => `${i + 1}) ${x}`).join(" ")}`);
  if (p && p.nomes_exatos.length) partes.push(`- Nomes exatos da tela: ${p.nomes_exatos.join(", ")}`);
  if (p && p.alertas.length) partes.push(`- Cuidado: ${p.alertas.join(" | ")}`);
  if (p && !p.fatos.length && !p.passos.length) partes.push("- A pesquisa não confirmou fatos: não cite passo, botão ou número do app.");
  return partes.join("\n");
}

// ------------------------------------------------------------ logos reais

export type LogoReal = {
  marca: string;
  nome: string;
  fonte: "Simple Icons" | "Wikimedia Commons";
  /** SVG ou PNG que o navegador desenha por cima da arte (CORS liberado nas duas fontes). */
  url: string;
  /** PNG pronto (Wikimedia: miniatura do SVG), quando há. */
  png_url: string | null;
  licenca: string;
  autor: string | null;
  pagina: string;
};

/** Versão fixa do Simple Icons (ícone removido numa versão nova não quebra o criativo velho). */
export const VERSAO_DO_SIMPLE_ICONS = "16";

export function logoDoSimpleIcons(m: MarcaReal): LogoReal | null {
  if (!m.simpleIcons) return null;
  return {
    marca: m.id,
    nome: m.nome,
    fonte: "Simple Icons",
    url: `https://cdn.jsdelivr.net/npm/simple-icons@${VERSAO_DO_SIMPLE_ICONS}/icons/${m.simpleIcons}.svg`,
    png_url: null,
    licenca: "CC0 1.0 (desenho do ícone); a marca pertence ao dono do registro, use só para citar o app",
    autor: null,
    pagina: `https://simpleicons.org/?q=${encodeURIComponent(m.simpleIcons)}`,
  };
}

/** O endereço da busca no Wikimedia Commons (arquivos de desenho, com licença e miniatura PNG). */
export function urlDaBuscaNoCommons(m: MarcaReal): string {
  const q = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `${m.busca} filetype:drawing`,
    gsrnamespace: "6",
    gsrlimit: "3",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "512",
    iiextmetadatafilter: "LicenseShortName|Artist|UsageTerms",
    origin: "*",
  });
  return `https://commons.wikimedia.org/w/api.php?${q.toString()}`;
}

const semHtml = (s: unknown) => String(s == null ? "" : s).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 200);

/** Lê a resposta da busca do Commons: o primeiro resultado com url e licença. */
export function logoDaRespostaDoCommons(m: MarcaReal, resposta: unknown): LogoReal | null {
  const pages = (((resposta as Record<string, unknown> | null) || {}).query as Record<string, unknown> | undefined || {}).pages as Record<string, Record<string, unknown>> | undefined;
  if (!pages) return null;
  const lista = Object.keys(pages).map((k) => pages[k]).sort((a, b) => Number(a.index ?? 99) - Number(b.index ?? 99));
  for (const p of lista) {
    const info = (Array.isArray(p.imageinfo) ? p.imageinfo[0] : null) as Record<string, unknown> | null;
    const url = info && typeof info.url === "string" ? info.url : "";
    if (!/^https:\/\/upload\.wikimedia\.org\//.test(url)) continue;
    const meta = (info!.extmetadata || {}) as Record<string, { value?: unknown }>;
    const licenca = semHtml(meta.LicenseShortName && meta.LicenseShortName.value) || semHtml(meta.UsageTerms && meta.UsageTerms.value) || "veja a página do arquivo";
    const thumb = typeof info!.thumburl === "string" ? String(info!.thumburl) : null;
    const pagina = typeof info!.descriptionurl === "string" ? String(info!.descriptionurl) : `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(p.title || ""))}`;
    return {
      marca: m.id,
      nome: m.nome,
      fonte: "Wikimedia Commons",
      url: url.split("?")[0],
      png_url: thumb ? thumb.split("?")[0] : null,
      licenca: `${licenca}; a marca pertence ao dono do registro`,
      autor: semHtml(meta.Artist && meta.Artist.value) || null,
      pagina,
    };
  }
  return null;
}

export type BuscarJson = (url: string) => Promise<unknown | null>;

/**
 * Logos reais das marcas citadas (até `max` marcas): o ícone do Simple Icons
 * quando existe e o arquivo do Wikimedia Commons (com a licença da página).
 * Busca que falha não derruba nada: fica só o que veio.
 */
export async function resolverLogosReais(buscar: BuscarJson, marcas: MarcaReal[], max = 4): Promise<LogoReal[]> {
  const saida: LogoReal[] = [];
  for (const m of marcas.slice(0, max)) {
    const si = logoDoSimpleIcons(m);
    if (si) saida.push(si);
    try {
      const commons = logoDaRespostaDoCommons(m, await buscar(urlDaBuscaNoCommons(m)));
      if (commons) saida.push(commons);
    } catch {
      // Sem o Commons, fica o Simple Icons (ou nada) para esta marca.
    }
  }
  return saida;
}

/** O que a direção de arte leva: não desenhar logo de terceiro (entra por código). */
export function regraDosLogosParaArte(logos: LogoReal[]): string {
  const nomes = logos.map((l) => l.nome).filter((n, i, l) => l.indexOf(n) === i);
  if (!nomes.length) return "";
  return `LOGOS DE TERCEIROS (${nomes.join(", ")}): não desenhe, não imite e não escreva o logo dessas marcas na arte; deixe um respiro limpo num canto para o logo oficial, que entra por código depois. Interface de app, quando aparecer, segue os nomes exatos da pesquisa.`;
}

/** A nota de fontes para a tela e o pacote (pesquisa e logos com licença). */
export function notaDasFontes(p: PesquisaReal | null, logos: LogoReal[]): string[] {
  const linhas: string[] = [];
  for (const f of p ? p.fontes : []) linhas.push(`${f.titulo}: ${f.url}`);
  for (const l of logos) linhas.push(`Logo ${l.nome} (${l.fonte}, ${l.licenca}): ${l.pagina}`);
  return linhas;
}

/** O que fica gravado na copy do criativo (copy.mundo_real). */
export type MundoReal = { entidades: string[]; pesquisa: PesquisaReal | null; logos: LogoReal[]; fontes: string[] };

export function mundoRealParaGravar(entidades: MarcaReal[], pesquisa: PesquisaReal | null, logos: LogoReal[]): MundoReal | null {
  if (!entidades.length && !pesquisa) return null;
  return { entidades: entidades.map((m) => m.nome), pesquisa, logos, fontes: notaDasFontes(pesquisa, logos) };
}
