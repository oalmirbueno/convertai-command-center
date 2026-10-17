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
 *
 * 17/10 (dono: "se eu falei de uma campanha no Meta Ads tem que aparecer o
 * gerenciador; se falei de uma marca, a logo realista correta; se falei de um
 * famoso, a imagem dele; não se limite a esses"): o mundo real liga também
 * quando a peça mostra uma ferramenta (gerenciador de anúncios, painel,
 * dashboard), cita uma marca de verdade como assunto ou uma pessoa pública
 * (o Jev decide o que as palavras não decidem). A foto da pessoa pública vem
 * do Wikimedia Commons (a imagem principal do verbete da Wikipédia, com a
 * licença) e entra COLADA PELO CÓDIGO numa área da lâmina, como as logos: o
 * gerador nunca desenha o rosto de uma pessoa real.
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
  // 17/10: ferramentas de anúncio e de negócio (a tela delas aparece na peça) e marcas que viram assunto.
  [/\bmeta ads\b|\bgerenciador de anuncios\b|\bbusiness suite\b|\bfacebook ads\b/, "Meta"],
  [/\btiktok ads\b/, "TikTok"],
  [/\bshopify\b/, "Shopify"],
  [/\bhotmart\b/, "Hotmart"],
  [/\bkiwify\b/, "Kiwify"],
  [/\brd station\b/, "RD Station"],
  [/\bhubspot\b/, "HubSpot"],
  [/\btrello\b/, "Trello"],
  [/\bslack\b/, "Slack"],
  [/\bzoom\b/, "Zoom"],
  [/\bpinterest\b/, "Pinterest"],
  [/\bthreads\b/, "Threads"],
  [/\btwitter\b/, "X"],
  [/\bkwai\b/, "Kwai"],
  [/\bdiscord\b/, "Discord"],
  [/\bgemini\b/, "Google Gemini"],
  [/\bclaude\b|\banthropic\b/, "Claude"],
  [/\bmidjourney\b/, "Midjourney"],
  [/\bsamsung\b/, "Samsung"],
  [/\bcoca[ -]?cola\b/, "Coca-Cola"],
  [/\bnike\b/, "Nike"],
  [/\badidas\b/, "Adidas"],
  [/\bmc ?donald'?s\b/, "McDonald's"],
  [/\bstarbucks\b/, "Starbucks"],
  [/\bmagalu\b|\bmagazine luiza\b/, "Magalu"],
  [/\bairbnb\b/, "Airbnb"],
  [/\bpaypal\b/, "PayPal"],
  [/\bstripe\b/, "Stripe"],
  [/\bitau\b/, "Itaú"],
  [/\bbradesco\b/, "Bradesco"],
  [/\bsantander\b/, "Santander"],
];

/** 17/10: a peça mostra a tela de uma ferramenta (o gerenciador, o painel, o relatório): a tela é recriada fiel. */
const FERRAMENTA_NA_TELA = /gerenciador de anuncios|meta ads|facebook ads|google ads|tiktok ads|business suite|google analytics|search console|campanha (no|na|do|da|de) (meta|facebook|instagram|google|tiktok)|painel d[oae] (meta|google|instagram|shopify)|dashboard d[oae]|relatorio d[oae] (meta|google|instagram)/;

/** Sinal forte de tela real: configuração de app, toque e clique, versão. */
const TELA_REAL = /configurac(ao|oes) d[oae]|toque em|clique em|abra o (app|aplicativo)|atualizac(ao|oes) do (app|sistema)|versao [0-9]/;
/**
 * Sinal fraco (passo a passo de maquiagem também é passo a passo): só vale com uma marca citada. Marca sozinha
 * ("chame no WhatsApp", "siga no Instagram") é CTA, não mundo real: quem decide esse caso é o Jev (arte rápida).
 */
const TUTORIAL = /como (configurar|ativar|desativar|usar|instalar|mudar|alterar|cadastrar|criar|fazer|baixar|emitir|agendar|liberar|bloquear|conectar|recuperar|limpar)|passo a passo|tutorial|no (app|aplicativo)\b|configurac/;

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
  return { real: tutorial || FERRAMENTA_NA_TELA.test(s), tutorial, marcas: marcas.slice(0, 6) };
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

/**
 * 17/10: as perguntas do Estúdio quando as palavras não decidem (item da agenda, não só a arte rápida):
 * a peça depende de algo real (marca, ferramenta, tela) e a peça fala de uma pessoa pública que deveria aparecer.
 */
export function perguntasDoMundoRealNoEstudio(): Record<string, { type: "noul"; instructions: string; criteria: { true: string; false: string } }> {
  return {
    mundo_real: {
      type: "noul",
      instructions: "O conteúdo em `pedido` mostra ou explica algo REAL de outra empresa que a arte precisa mostrar fiel ao que existe: a tela de uma ferramenta (gerenciador de anúncios do Meta, Google Ads, painel, relatório, app), uma marca de verdade como assunto (logo, produto, comparação entre marcas) ou um passo a passo de um sistema?",
      criteria: {
        true: "A peça fala de uma campanha no Meta Ads, de um recurso de um app, de uma marca ou produto real de outra empresa, ou ensina a usar um sistema: mostrar a tela, a logo ou o produto real deixa a arte certa.",
        false: "A peça é só sobre a marca do cliente, uma dica do nicho, um conceito ou uma oferta, sem precisar mostrar tela, logo ou produto de outra empresa (citar \"chame no WhatsApp\" não conta).",
      },
    },
    pessoa_publica: {
      type: "noul",
      instructions: "O conteúdo em `pedido` fala de uma PESSOA PÚBLICA real e identificada pelo nome (artista, atleta, influenciador, empresário, apresentador) que a arte deveria mostrar para fazer sentido?",
      criteria: {
        true: "A peça é sobre o que essa pessoa fez, disse ou lançou, ou usa o caso dela como exemplo central, e quem vê espera reconhecer a pessoa.",
        false: "Não cita pessoa pública pelo nome, ou cita só de passagem, ou a pessoa é do cliente (dono, equipe, cliente dele).",
      },
    },
  };
}

export const INSTRUCOES_DO_MUNDO_REAL = `MUNDO REAL (o pedido fala de produto, app, marca ou tela real; a pesquisa na web está ligada para você)
- Pesquise antes de escrever: a documentação oficial ou a central de ajuda da empresa (versão atual, Brasil, português) e, só se faltar, uma fonte confiável recente. Monte os passos EXATAMENTE como estão: nomes de menus, abas, botões e opções com a grafia da tela, na ordem certa, um passo por linha ("Abra o WhatsApp", "Toque em Configurações > Privacidade"). Diferença entre iPhone e Android: diga qual vale ou separe.
- Nunca invente menu, botão, preço, especificação nem versão. O que você não confirmou fica fora e vira aviso em \`avisos_para_a_equipe\`.
- fontes_da_pesquisa: as páginas que você usou (título e endereço), as oficiais primeiro.
- marcas_reais: cada marca de outra empresa que aparece na peça (nome oficial; arquivo_wikimedia com o nome exato do arquivo da logo no Wikimedia Commons, como "File:WhatsApp.svg", quando você achou; senão vazio; laminas com as ordens onde ela aparece). A logo dessas marcas é colada pelo CÓDIGO num canto da lâmina: no layout, NÃO desenhe nem descreva a logo de outra empresa, não escreva o nome dela em estilo de logo e deixe o canto de cima à direita calmo. O nome da marca pode aparecer no texto normal ("no WhatsApp").
- Tela de app: sem print enviado pela equipe, a lâmina mostra a tela recriada em estilo plano e limpo (moldura de celular simples, os rótulos e a ordem exatos), sem copiar ícones nem a logo da empresa. Com print da equipe (Compor), use o print.
- Fonte real: quando a tela ou a marca tem fonte conhecida e livre (Google Fonts, como Roboto no Android ou Inter), diga em tratamento; senão, as fontes do cliente.
- Ferramenta na tela (17/10): falou de campanha no Meta Ads, Google Ads, relatório ou painel, uma lâmina MOSTRA a tela de verdade dessa ferramenta, recriada em estilo plano e fiel: o nome real da tela ("Gerenciador de Anúncios"), as abas e colunas reais (no Meta: Campanhas, Conjuntos de anúncios, Anúncios; Veiculação, Resultados, Alcance, Custo por resultado, Valor usado), números plausíveis e coerentes com o texto, num notebook ou celular quando ajudar. Pesquise a interface atual antes.
- Marca como assunto: a logo oficial vem do Commons (marcas_reais) e o produto ou a embalagem aparecem como são de verdade (forma, cores, rótulo), sem inventar versão.
- pessoas_reais (17/10): cada pessoa pública que a peça precisa mostrar (nome como no verbete da Wikipédia em português; arquivo_wikimedia com o "File:..." de uma foto dela no Commons, quando você achou; laminas onde ela aparece, no máximo 2). A foto real dela entra COLADA PELO CÓDIGO num quadro da lâmina: em layout.imagem descreva o quadro de foto (moldura, lado oposto ao texto) e o resto da cena, e NUNCA desenhe nem descreva o rosto dessa pessoa. Só para conteúdo informativo ou de notícia sobre ela; nunca como se ela endossasse a marca (avise em avisos_para_a_equipe que o uso de imagem de pessoa pública em anúncio pede autorização).
- Tema e referência real: use elementos reais e reconhecíveis do assunto (o objeto real, o lugar real, o ícone real do app), não um genérico de banco de imagens.`;

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
  pessoas_reais: {
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

// ------------------------------------------------------------------ pessoa pública (foto real do Commons)

/** Até quantas pessoas públicas por peça, e até quantas lâminas cada uma. */
export const MAX_PESSOAS_REAIS = 2;
/** Largura da foto pedida ao Commons. */
export const LARGURA_DA_FOTO_REAL = 1080;
export const MAX_BYTES_DA_FOTO_REAL = 6 * 1024 * 1024;

/** As pessoas públicas da direção, limpas (nome, arquivo do Commons, até 2 lâminas que existem; sem lâmina: a capa). */
export function normalizarPessoasReais(bruto: unknown, ordens: number[]): MarcaReal[] {
  return normalizarMarcasReais(bruto, ordens).slice(0, MAX_PESSOAS_REAIS).map((p) => ({ ...p, laminas: p.laminas.slice(0, 2) }));
}

/** O verbete da Wikipédia em português (e a imagem principal dele): o caminho para a foto quando o diretor não achou o arquivo. */
export const urlDaImagemDoVerbete = (nome: string) =>
  `https://pt.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=pageimages&piprop=name&titles=${encodeURIComponent(nome)}`;

/** O nome do arquivo da imagem principal do verbete ("File:..."), ou null. */
export function arquivoDoVerbete(json: unknown): string | null {
  const q = json && typeof json === "object" ? (json as Record<string, any>).query : null;
  const p = q && Array.isArray(q.pages) ? q.pages[0] : null;
  if (!p || p.missing || typeof p.pageimage !== "string") return null;
  return arquivoDoCommons(p.pageimage.replace(/_/g, " "));
}

/** A informação da foto no Commons com a largura de foto (a da logo é menor). */
export const urlDaInfoDaFotoNoCommons = (arquivo: string) => urlDaInfoDoCommons(arquivo).replace(`iiurlwidth=${LARGURA_DA_LOGO_REAL}`, `iiurlwidth=${LARGURA_DA_FOTO_REAL}`);

/**
 * O quadro da foto da pessoa pública, do lado oposto ao texto da lâmina (fração do quadro final).
 * Texto à esquerda: foto à direita; à direita: à esquerda; no topo: embaixo; na base: em cima; no centro: canto de cima à direita.
 */
export function areaDaPessoaReal(zona: string): Area {
  const z = String(zona || "");
  if (/esquerda/.test(z)) return { x0: 0.53, y0: 0.2, x1: 0.94, y1: 0.8 };
  if (/direita/.test(z)) return { x0: 0.06, y0: 0.2, x1: 0.47, y1: 0.8 };
  if (/^topo/.test(z)) return { x0: 0.2, y0: 0.5, x1: 0.8, y1: 0.93 };
  if (/^base/.test(z)) return { x0: 0.2, y0: 0.07, x1: 0.8, y1: 0.5 };
  return { x0: 0.62, y0: 0.06, x1: 0.94, y1: 0.4 };
}

/** Frase do prompt da lâmina: o quadro que fica liso para a foto real entrar pelo código. */
export function fraseDaPessoaReal(area: Area, nome: string): string {
  const pct = (n: number) => Math.round(n * 100);
  return `FOTO REAL (${nome}): a foto verdadeira dessa pessoa entra depois, colada pelo código, num quadro de ${pct(area.x0)}% a ${pct(area.x1)}% da largura e de ${pct(area.y0)}% a ${pct(area.y1)}% da altura. Deixe esse quadro como um painel liso numa cor da paleta, sem texto, sem desenho e sem pessoa; a composição conversa com ele (como uma foto de revista na página). Não desenhe ${nome} nem ninguém parecido em lugar nenhum da arte.`;
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
  tipo: "pesquisa" | "logo" | "icone" | "foto";
  licenca?: string | null;
}

/** As fontes da peça (pesquisa da web, as do diretor, logos com licença e o SVG oficial), sem repetir, até 12. */
export function notaDasFontes(e: {
  daWeb?: Array<{ url?: string; titulo?: string; title?: string }>;
  doDiretor?: unknown;
  logos?: LogoDoCommons[];
  icones?: Array<{ nome: string; url: string }>;
  fotos?: Array<LogoDoCommons & { pessoa: string }>;
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
  for (const f of e.fotos || []) juntar({ titulo: `Foto de ${f.pessoa}: ${f.arquivo.replace(/^File:/, "")}${f.autor ? ` (${f.autor})` : ""}`, url: f.pagina || f.url, tipo: "foto", licenca: f.licenca });
  return saida;
}
