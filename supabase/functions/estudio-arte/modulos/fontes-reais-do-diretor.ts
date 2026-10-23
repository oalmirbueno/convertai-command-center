/** Biblioteca complementar de fontes reais. Não gera arte, não substitui fotos e não aprova. */
import { urlPublicaSegura } from "../links.ts";
import { arquivoDoCommons, lerInfoDoCommons, urlDaBuscaNoCommons, urlDaInfoDaFotoNoCommons, type LogoDoCommons } from "./mundo-real.ts";

export interface FonteRealDoDiretor {
  caminho: string;
  nome: string;
  fonte_url: string;
  licenca: string;
  autor: string | null;
  tipo: "imagem" | "logo";
  /** 23/10: de qual banco veio (a matéria de notícia mostra o veículo no crédito). */
  banco?: BancoDaFonteReal;
}
export type BancoDaFonteReal = "wikimedia" | "openverse" | "noticias" | "pexels";
export interface CardComFontesReais {
  ordem: number;
  texto_exato: string;
  fontes_reais?: FonteRealDoDiretor[];
}
export interface TrabalhoComFontesReais {
  id: string;
  client_id: string;
  status: string;
  tipo?: string | null;
  entrega_status?: string | null;
  direcao: { cards: CardComFontesReais[] };
  cards: Array<{ ordem: number; versao: number }>;
}
export interface ResultadoReal {
  arquivo: string;
  nome: string;
  url: string;
  miniatura_url: string;
  fonte_url: string;
  licenca: string;
  autor: string | null;
  /** 23/10: o banco do resultado (a tela mostra a etiqueta) e a data da matéria, quando é notícia. */
  banco?: BancoDaFonteReal;
  data?: string;
  /** O resumo da matéria no RSS (o gráfico por IA lê os números daqui). */
  resumo?: string;
}
type Erro = (status: number, codigo: string, mensagem: string, detalhes?: Record<string, unknown>) => Error;
export interface DepsDasFontesReais<C, T extends TrabalhoComFontesReais> {
  erro: Erro;
  json: (body: unknown) => Response;
  trabalhoComAcesso: (ch: C, id: string) => Promise<T>;
  mutarTrabalho: (id: string, mudar: (t: T) => Record<string, unknown>) => Promise<T>;
  jsonDoCommons: (url: string) => Promise<unknown>;
  /** Openverse (21/10, Template): a mesma leitura JSON, só da API pública api.openverse.org. Sem ela, só a Wikimedia. */
  jsonDoOpenverse?: (url: string) => Promise<unknown>;
  /**
   * 23/10: texto de uma página pública (RSS de notícias do Bing e o HTML da matéria, para ler a og:image).
   * O adaptador valida URL e DNS público em CADA redirecionamento e lê só o começo da página.
   */
  textoDaWeb?: (url: URL, limite: number) => Promise<{ url: URL; texto: string } | null>;
  /** 23/10: Pexels Fotos com a chave do cofre; null/ausente sem a chave. */
  jsonDoPexels?: ((url: string) => Promise<unknown>) | null;
  /** Há a chave do Pexels? Sem esta função, vale a presença de jsonDoPexels. */
  temPexels?: () => Promise<boolean>;
  /** 23/10: o Jev ordena os achados pelo texto da lâmina (só quando a tela pede, com o custo já confirmado). */
  perguntarJev?: (t: T, state: unknown, questions: Record<string, unknown>) => Promise<{ answers: Record<string, { choice?: string; confidence?: number }>; custoUsd: number }>;
  /** O adaptador valida URL e DNS público em CADA redirecionamento, sem cookies. */
  buscarImagem: (url: URL, limite: number, permitir: (url: URL) => boolean) => Promise<{ url: URL; bytes: Uint8Array } | null>;
  validarImagem: (bytes: Uint8Array, limite: number) => "image/png" | "image/jpeg" | "image/webp" | null;
  /** Caminho exclusivo por chamada, nunca sobrescreve outro arquivo. */
  guardarImagem: (t: T, bytes: Uint8Array, mime: string) => Promise<string>;
  descartarUpload: (caminho: string) => Promise<void>;
  ehPostDeFotos: (t: T) => boolean;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_FONTES_REAIS = 8;
export const MAX_BYTES_FONTE_REAL = 6 * 1024 * 1024;
const FECHADOS = new Set(["entregue", "aprovado", "agendado", "arquivado", "aguardando_agencia", "aguardando_cliente"]);
const objeto = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

/** Não persistir chaves de acesso nem tentar obter telas de conta em uma sessão pública. */
export function urlDaFonteReal(bruto: unknown): URL | null {
  const u = urlPublicaSegura(bruto);
  if (!u) return null;
  // Somente unicast global em literal IPv6; multicast/reservados não são fontes públicas.
  if (u.hostname.startsWith("[") && (!/^\[[23][0-9a-f]{0,3}:/i.test(u.hostname) || /^\[2001:db8:/i.test(u.hostname))) return null;
  let caminho: string;
  try { caminho = decodeURIComponent(u.pathname); } catch { return null; }
  if (/(^|\/)(login|signin|sign-in|auth|oauth|dashboard|account|conta|painel)(\/|$)/i.test(caminho)) return null;
  for (const k of u.searchParams.keys()) {
    if (/(token|secret|password|passwd|api.?key|auth|signature|credential|session|cookie|x-amz|x-goog)/i.test(k)) return null;
  }
  u.hash = "";
  return u;
}

function tipoDoPedido(v: unknown, erro: Erro): "imagem" | "logo" {
  if (v === undefined || v === "imagem") return "imagem";
  if (v === "logo") return "logo";
  throw erro(400, "tipo_fonte_real_invalido", "Escolha imagem do assunto ou logo.");
}

/** Consulta sempre visível e editável na tela; nenhum campo privado é enviado implicitamente. */
export function consultaDaFonteReal(v: unknown, erro: Erro): string {
  if (typeof v !== "string" || v.length > 200 || Array.from(v).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw erro(400, "consulta_fonte_real_invalida", "Informe um assunto público de até 200 caracteres para pesquisar.");
  const consulta = v.replace(/\s+/g, " ").trim();
  if (consulta.length < 2 || /https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(consulta)) throw erro(400, "consulta_fonte_real_invalida", "Use o assunto ou a marca, sem links ou dados de contato.");
  return consulta;
}

function cardEditavel<T extends TrabalhoComFontesReais>(t: T, ordem: number, d: Pick<DepsDasFontesReais<unknown, T>, "erro" | "ehPostDeFotos">): CardComFontesReais {
  if (FECHADOS.has(t.status) || FECHADOS.has(t.entrega_status || "")) throw d.erro(409, "trabalho_entregue", "Este trabalho está entregue ou em aprovação. Reabra para corrigir antes de adicionar uma fonte.");
  if (t.tipo === "ads" || d.ehPostDeFotos(t)) throw d.erro(409, "fonte_real_indisponivel", "As fontes do Diretor estão disponíveis para artes e carrosséis do Estúdio.");
  const card = t.direcao.cards.find((c) => c.ordem === ordem);
  if (!card) throw d.erro(404, "card_inexistente", "Esta lâmina não existe na direção do trabalho.");
  return card;
}

function conferirBase<T extends TrabalhoComFontesReais>(t: T, ordem: number, esperado: number, textoBase: string, d: Pick<DepsDasFontesReais<unknown, T>, "erro" | "ehPostDeFotos">): CardComFontesReais {
  const card = cardEditavel(t, ordem, d);
  if (Math.max(0, ...t.cards.filter((c) => c.ordem === ordem).map((c) => c.versao)) !== esperado) throw d.erro(409, "fonte_real_concorrente", "A lâmina mudou. Atualize o trabalho antes de adicionar a imagem.");
  if ((card.texto_exato || "") !== textoBase) throw d.erro(409, "texto_fonte_real_alterado", "O assunto da lâmina mudou. Confira o texto novo antes de adicionar a imagem.");
  return card;
}

const paginaDoCommons = (arquivo: string) => `https://commons.wikimedia.org/wiki/${encodeURIComponent(arquivo.replace(/ /g, "_"))}`;
const nomeDoArquivo = (arquivo: string) => arquivo.replace(/^File:/i, "").replace(/\.(svg|png|jpe?g|webp)$/i, "").slice(0, 160);
const resultadoDoCommons = (info: LogoDoCommons): ResultadoReal => ({
  arquivo: info.arquivo, nome: nomeDoArquivo(info.arquivo), url: info.url, miniatura_url: info.url,
  fonte_url: paginaDoCommons(info.arquivo), licenca: info.licenca, autor: info.autor,
});

/** Openverse (21/10, Template do Estúdio): busca pública sem chave, só licenças de uso comercial. */
export const API_DO_OPENVERSE = "https://api.openverse.org/v1/images/";
const PREFIXO_OPENVERSE = "openverse:";
const ID_OPENVERSE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function urlDaBuscaNoOpenverse(consulta: string, tipo: "imagem" | "logo"): string {
  const qs = new URLSearchParams({ q: tipo === "logo" ? `${consulta} logo` : consulta, page_size: "8", license_type: "commercial", mature: "false" });
  return `${API_DO_OPENVERSE}?${qs.toString()}`;
}
/** Licença legível: cc0, pdm e as CC com a versão. */
export function rotuloDaLicencaDoOpenverse(codigo: unknown, versao: unknown): string {
  const c = typeof codigo === "string" ? codigo.toLowerCase().trim() : "";
  if (!c) return "licença não informada; confira a autorização de uso";
  if (c === "cc0") return "CC0 1.0";
  if (c === "pdm") return "Domínio público";
  const v = typeof versao === "string" && /^[0-9.]{1,5}$/.test(versao) ? ` ${versao}` : "";
  return `CC ${c.toUpperCase()}${v}`;
}
/** Um item da API do Openverse como resultado da busca; sem URL pública segura, fica de fora. */
export function resultadoDoOpenverse(bruto: unknown): ResultadoReal | null {
  const o = objeto(bruto);
  if (typeof o.id !== "string" || !ID_OPENVERSE.test(o.id)) return null;
  const imagem = urlDaFonteReal(o.url);
  if (!imagem) return null;
  const pagina = urlDaFonteReal(o.foreign_landing_url);
  const miniatura = urlDaFonteReal(o.thumbnail);
  const semHtml = (v: unknown) => (typeof v === "string" ? v.replace(/<[^>]*>/g, "").replace(/[<>\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 160) : "");
  const titulo = semHtml(o.title);
  const autor = semHtml(o.creator);
  return {
    arquivo: `${PREFIXO_OPENVERSE}${o.id.toLowerCase()}`,
    nome: titulo || "Imagem do Openverse",
    url: imagem.href,
    miniatura_url: (miniatura || imagem).href,
    fonte_url: (pagina || new URL(`https://openverse.org/image/${o.id.toLowerCase()}`)).href,
    licenca: rotuloDaLicencaDoOpenverse(o.license, o.license_version),
    autor: autor || null,
  };
}

// ------------------------------------------------------------------ notícias (23/10)

/**
 * Imagens de notícias reais (23/10, dono: "pode buscar imagens de notícias mesmo e não só Wikipedia"): o RSS do
 * Bing Notícias traz a matéria, o veículo, a data e a miniatura. Ao usar, a imagem vem da própria matéria
 * (og:image), com o veículo no crédito; sem ela, a miniatura do Bing. Imagem de matéria é do veículo:
 * a tela avisa que é uso editorial, com crédito.
 */
export const LICENCA_DA_NOTICIA = "Imagem da matéria (direitos do veículo). Use com crédito, em contexto de notícia";
export const PREFIXO_NOTICIA = "noticia:";
export function urlDaBuscaDeNoticias(consulta: string): string {
  const qs = new URLSearchParams({ q: consulta, format: "rss", setlang: "pt-BR", cc: "BR" });
  return `https://www.bing.com/news/search?${qs.toString()}`;
}
const ID_DA_IMAGEM_DO_BING = /^[A-Za-z0-9._-]{4,120}$/;
export const urlDaImagemDoBing = (id: string, w = 1200, h = 675) => `https://www.bing.com/th?id=${encodeURIComponent(id)}&pid=News&w=${w}&h=${h}&c=14`;
const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodificarEntidades(v: string): string {
  return v.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 31 && n < 0x10ffff ? String.fromCodePoint(n) : "";
    }
    return ENTIDADES[e.toLowerCase()] ?? m;
  });
}
const limparTexto = (v: string, max: number) => decodificarEntidades(v.replace(/<!\[CDATA\[|\]\]>/g, "")).replace(/<[^>]*>/g, "").replace(/[<>\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const campoDoItem = (item: string, tag: string) => {
  const i = item.toLowerCase().indexOf(`<${tag.toLowerCase()}>`);
  if (i < 0) return "";
  const resto = item.slice(i + tag.length + 2);
  const f = resto.toLowerCase().indexOf(`</${tag.toLowerCase()}>`);
  return f < 0 ? "" : resto.slice(0, f);
};

/** O link da matéria: o Bing embrulha no apiclick (parâmetro url); só https público. */
export function linkDaMateria(bruto: string): URL | null {
  const texto = decodificarEntidades(bruto.trim());
  let u: URL;
  try { u = new URL(texto); } catch { return null; }
  if (/(^|\.)bing\.com$/i.test(u.hostname)) {
    const dentro = u.searchParams.get("url");
    return dentro ? urlDaFonteReal(dentro) : null;
  }
  return urlDaFonteReal(u.href);
}

/** O arquivo de um resultado de notícia: a matéria e a miniatura, para reler na fonte ao usar. */
export const arquivoDaNoticia = (materia: string, imagemId: string) => `${PREFIXO_NOTICIA}${encodeURIComponent(materia)}|${imagemId}`;
export function lerArquivoDaNoticia(v: string): { materia: URL; imagemId: string } | null {
  if (v.indexOf(PREFIXO_NOTICIA) !== 0 || v.length > 2400) return null;
  const resto = v.slice(PREFIXO_NOTICIA.length), corte = resto.lastIndexOf("|");
  if (corte < 1) return null;
  let materia: URL | null = null;
  try { materia = urlDaFonteReal(decodeURIComponent(resto.slice(0, corte))); } catch { return null; }
  const imagemId = resto.slice(corte + 1);
  if (!materia || (imagemId && !ID_DA_IMAGEM_DO_BING.test(imagemId))) return null;
  return { materia, imagemId };
}

/** Os itens do RSS do Bing Notícias com imagem e link de matéria válidos. */
export function noticiasDoRss(xml: string): ResultadoReal[] {
  const saida: ResultadoReal[] = [];
  for (const m of xml.split(/<item>/i).slice(1)) {
    const item = m.split(/<\/item>/i)[0];
    const materia = linkDaMateria(campoDoItem(item, "link"));
    const imagem = decodificarEntidades(campoDoItem(item, "News:Image")).trim();
    let imagemId = "";
    try { imagemId = new URL(imagem).searchParams.get("id") || ""; } catch { imagemId = ""; }
    if (!materia || !ID_DA_IMAGEM_DO_BING.test(imagemId)) continue;
    if (saida.some((r) => r.fonte_url === materia.href)) continue;
    const veiculo = limparTexto(campoDoItem(item, "News:Source"), 60) || materia.hostname.replace(/^www\./, "");
    const quando = new Date(limparTexto(campoDoItem(item, "pubDate"), 60));
    saida.push({
      arquivo: arquivoDaNoticia(materia.href, imagemId), nome: limparTexto(campoDoItem(item, "title"), 160) || "Matéria",
      url: urlDaImagemDoBing(imagemId), miniatura_url: urlDaImagemDoBing(imagemId, 480, 270),
      fonte_url: materia.href, licenca: LICENCA_DA_NOTICIA, autor: veiculo, banco: "noticias",
      ...(limparTexto(campoDoItem(item, "description"), 400) ? { resumo: limparTexto(campoDoItem(item, "description"), 400) } : {}),
      ...(Number.isFinite(quando.getTime()) ? { data: quando.toISOString().slice(0, 10) } : {}),
    });
  }
  return saida;
}

/** As metas da matéria (og:image, og:site_name e og:title), em qualquer ordem de atributos. */
export function metasDaMateria(html: string, base: URL): { imagem: URL | null; veiculo: string; titulo: string } {
  const metas: Record<string, string> = {};
  const re = /<meta\s[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const nome = (/(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag) || [])[1];
    const conteudo = (/content\s*=\s*["']([^"']*)["']/i.exec(tag) || [])[1];
    if (nome && conteudo !== undefined && !metas[nome.toLowerCase()]) metas[nome.toLowerCase()] = conteudo;
  }
  let imagem: URL | null = null;
  for (const k of ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]) {
    if (imagem || !metas[k]) continue;
    try { imagem = urlDaFonteReal(new URL(decodificarEntidades(metas[k]), base).href); } catch { imagem = null; }
  }
  return { imagem, veiculo: limparTexto(metas["og:site_name"] || "", 60), titulo: limparTexto(metas["og:title"] || metas["twitter:title"] || "", 160) };
}

// ------------------------------------------------------------------ Pexels Fotos (23/10, com a chave)

export const API_DO_PEXELS_FOTOS = "https://api.pexels.com/v1/";
const PREFIXO_PEXELS = "pexels:";
export function urlDaBuscaNoPexels(consulta: string): string {
  const qs = new URLSearchParams({ query: consulta, per_page: "8", locale: "pt-BR" });
  return `${API_DO_PEXELS_FOTOS}search?${qs.toString()}`;
}
const semMarcacao = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[<>\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "");
/** Uma foto do Pexels (licença Pexels, uso comercial livre), com o fotógrafo no crédito. */
export function resultadoDoPexels(bruto: unknown): ResultadoReal | null {
  const o = objeto(bruto);
  if (typeof o.id !== "number" || !Number.isInteger(o.id)) return null;
  const src = objeto(o.src);
  const imagem = urlDaFonteReal(src.large2x) || urlDaFonteReal(src.large) || urlDaFonteReal(src.original);
  const pagina = urlDaFonteReal(o.url);
  if (!imagem || !pagina) return null;
  const autor = semMarcacao(o.photographer, 120);
  return {
    arquivo: `${PREFIXO_PEXELS}${o.id}`, nome: semMarcacao(o.alt, 160) || `Foto do Pexels ${o.id}`, url: imagem.href,
    miniatura_url: (urlDaFonteReal(src.medium) || imagem).href, fonte_url: pagina.href,
    licenca: "Licença Pexels (uso comercial livre)", autor: autor || null, banco: "pexels",
  };
}

// ------------------------------------------------------------------ todos os bancos + Jev (23/10)

/** Intercala as listas (um de cada banco por vez), sem repetir a mesma página. */
export function intercalar(listas: ResultadoReal[][], max: number): ResultadoReal[] {
  const saida: ResultadoReal[] = [];
  for (let i = 0; saida.length < max && listas.some((l) => l.length > i); i++) {
    for (const l of listas) if (l[i] && saida.length < max && !saida.some((r) => r.fonte_url === l[i].fonte_url)) saida.push(l[i]);
  }
  return saida;
}

const ROTULO_DO_BANCO: Record<BancoDaFonteReal, string> = { noticias: "foto de matéria de notícia", pexels: "foto de banco de imagens", openverse: "imagem livre do Openverse", wikimedia: "arquivo da Wikimedia" };

/** A pergunta do Jev: qual achado mostra melhor o que a lâmina diz (pelo título, fonte e tipo de cada um). */
export function perguntaDaMelhorImagem(resultados: ResultadoReal[]): { type: "choice"; instructions: string; criteria: Record<string, string> } {
  const criteria: Record<string, string> = {};
  resultados.forEach((r, i) => {
    criteria[`r${i + 1}`] = `Imagem ${i + 1}: "${r.nome}" (${r.banco ? ROTULO_DO_BANCO[r.banco] : "imagem da internet"}${r.banco === "noticias" && r.autor ? `, ${r.autor}` : ""}).`;
  });
  return {
    type: "choice",
    instructions: "Escolha a imagem que melhor ilustra o texto da lâmina (`lamina.texto`) e a busca (`busca`) num carrossel de Instagram: a que mostra o assunto concreto, atual e reconhecível. Prefira a foto da matéria quando o texto fala de um fato recente e a foto de banco quando é uma ideia geral. Evite mapa, diagrama, brasão ou documento quando o texto não fala disso.",
    criteria,
  };
}

/** Uma recusa no callback CAS prova que esta chamada não anexou seu upload. */
class RecusaDaFonte extends Error { constructor(readonly motivo: unknown) { super("fonte_recusada_antes_da_gravacao"); } }
class FonteJaGuardada<T> extends Error { constructor(readonly trabalho: T, readonly fonte: FonteRealDoDiretor) { super("fonte_ja_guardada"); } }

export function acoesDasFontesReais<C, T extends TrabalhoComFontesReais>(d: DepsDasFontesReais<C, T>) {
  function identificadores(corpo: Record<string, unknown>) {
    if (typeof corpo.trabalho_id !== "string" || !UUID.test(corpo.trabalho_id) || typeof corpo.ordem !== "number" || !Number.isInteger(corpo.ordem) || corpo.ordem < 1) throw d.erro(400, "pedido_fonte_real_invalido", "Informe o trabalho e a lâmina da imagem.");
    return { id: corpo.trabalho_id, ordem: corpo.ordem };
  }
  const precisaPrint = () => d.erro(422, "imagem_real_precisa_print", "Esse link não fornece uma imagem pública direta. Envie uma captura atual em Fotos para usar a tela exata no Template.", { precisa_print: true });

  async function buscar(ch: C, corpo: Record<string, unknown>): Promise<Response> {
    const { id, ordem } = identificadores(corpo);
    const t = await d.trabalhoComAcesso(ch, id);
    cardEditavel(t, ordem, d);
    const consulta = consultaDaFonteReal(corpo.consulta, d.erro);
    const tipo = tipoDoPedido(corpo.tipo, d.erro);
    if (corpo.banco === "noticias" || corpo.banco === "pexels" || corpo.banco === "todos") return buscarMais(t, ordem, consulta, tipo, corpo);
    if (corpo.banco === "openverse") {
      if (!d.jsonDoOpenverse) throw d.erro(501, "openverse_indisponivel", "A busca no Openverse não está disponível. Use a Wikimedia.");
      let lista: unknown;
      try { lista = await d.jsonDoOpenverse(urlDaBuscaNoOpenverse(consulta, tipo)); } catch { throw d.erro(502, "busca_imagem_real_indisponivel", "O Openverse não respondeu (ele aceita poucas buscas por minuto). Tente em instantes ou use a Wikimedia."); }
      const itens = objeto(lista).results;
      const resultados = (Array.isArray(itens) ? itens : []).map(resultadoDoOpenverse).filter((r): r is ResultadoReal => !!r).slice(0, 6);
      return d.json({ consulta, banco: "openverse", resultados, avisos: ["Só licenças de uso comercial. Confira a fonte, a autoria e a licença antes de usar; algumas pedem o crédito do autor."], custo_usd: 0 });
    }
    const url = new URL(urlDaBuscaNoCommons(consulta));
    url.searchParams.set("srlimit", "8");
    url.searchParams.set("srsearch", tipo === "logo" ? `${consulta} logo` : consulta);
    let busca: unknown;
    try { busca = await d.jsonDoCommons(url.href); } catch { throw d.erro(502, "busca_imagem_real_indisponivel", "A Wikimedia não respondeu. Tente novamente ou envie uma imagem em Fotos."); }
    const encontrados = objeto(objeto(busca).query).search;
    const arquivos = [...new Set((Array.isArray(encontrados) ? encontrados : []).map((v) => arquivoDoCommons(objeto(v).title)).filter((a): a is string => !!a))].slice(0, 8);
    const infos = await Promise.allSettled(arquivos.map(async (arquivo) => lerInfoDoCommons(await d.jsonDoCommons(urlDaInfoDaFotoNoCommons(arquivo)), arquivo)));
    const resultados = infos.flatMap((v) => v.status === "fulfilled" && v.value ? [resultadoDoCommons(v.value)] : []).slice(0, 6);
    return d.json({ consulta, resultados, avisos: ["Confira a fonte e a licença antes de usar. Fotografias e marcas podem exigir autorização adicional.", ...(infos.some((v) => v.status === "rejected") ? ["Algumas fontes não responderam; os resultados disponíveis estão abaixo."] : [])], custo_usd: 0 });
  }

  async function buscarNoticias(consulta: string): Promise<ResultadoReal[]> {
    if (!d.textoDaWeb) throw d.erro(501, "noticias_indisponivel", "A busca de notícias não está disponível agora.");
    const r = await d.textoDaWeb(new URL(urlDaBuscaDeNoticias(consulta)), 400_000);
    if (!r) throw new Error("rss");
    return noticiasDoRss(r.texto).slice(0, 8);
  }
  async function buscarPexels(consulta: string, tipo: "imagem" | "logo"): Promise<ResultadoReal[]> {
    if (!d.jsonDoPexels || tipo === "logo") return [];
    const r = objeto(await d.jsonDoPexels(urlDaBuscaNoPexels(consulta)));
    return (Array.isArray(r.photos) ? r.photos : []).map(resultadoDoPexels).filter((x): x is ResultadoReal => !!x).slice(0, 8);
  }
  async function buscarOpenverse(consulta: string, tipo: "imagem" | "logo"): Promise<ResultadoReal[]> {
    if (!d.jsonDoOpenverse) return [];
    const itens = objeto(await d.jsonDoOpenverse(urlDaBuscaNoOpenverse(consulta, tipo))).results;
    return (Array.isArray(itens) ? itens : []).map(resultadoDoOpenverse).filter((r): r is ResultadoReal => !!r).map((r) => ({ ...r, banco: "openverse" as const })).slice(0, 6);
  }
  async function buscarCommons(consulta: string, tipo: "imagem" | "logo"): Promise<ResultadoReal[]> {
    const url = new URL(urlDaBuscaNoCommons(consulta));
    url.searchParams.set("srlimit", "8");
    url.searchParams.set("srsearch", tipo === "logo" ? `${consulta} logo` : consulta);
    const encontrados = objeto(objeto(await d.jsonDoCommons(url.href)).query).search;
    const arquivos = [...new Set((Array.isArray(encontrados) ? encontrados : []).map((v) => arquivoDoCommons(objeto(v).title)).filter((a): a is string => !!a))].slice(0, 6);
    const infos = await Promise.allSettled(arquivos.map(async (arquivo) => lerInfoDoCommons(await d.jsonDoCommons(urlDaInfoDaFotoNoCommons(arquivo)), arquivo)));
    return infos.flatMap((v) => v.status === "fulfilled" && v.value ? [{ ...resultadoDoCommons(v.value), banco: "wikimedia" as const }] : []);
  }

  /** Notícias, Pexels ou todos os bancos juntos; com `ordenar: "jev"`, o Jev põe a melhor para a lâmina primeiro. */
  async function buscarMais(t: T, ordem: number, consulta: string, tipo: "imagem" | "logo", corpo: Record<string, unknown>): Promise<Response> {
    const avisos: string[] = [];
    const comPexels = !!d.jsonDoPexels && (d.temPexels ? await d.temPexels().catch(() => false) : true);
    const card = t.direcao.cards.find((c) => c.ordem === ordem);
    if (corpo.banco === "noticias") {
      if (!d.textoDaWeb) throw d.erro(501, "noticias_indisponivel", "A busca de notícias não está disponível agora.");
      let resultados: ResultadoReal[] = [];
      try { resultados = await buscarNoticias(consulta); } catch { throw d.erro(502, "busca_imagem_real_indisponivel", "As notícias não responderam agora. Tente em instantes ou use outro banco."); }
      return d.json({ consulta, banco: "noticias", resultados, avisos: ["Fotos de matérias reais: são do veículo. Use com o crédito, em contexto de notícia, e não em anúncio."], custo_usd: 0 });
    }
    if (corpo.banco === "pexels") {
      if (!comPexels) throw d.erro(503, "pexels_sem_chave", "Sem a chave do Pexels no cofre (PEXELS_API_KEY). Use Notícias, Wikimedia ou Openverse.");
      let resultados: ResultadoReal[] = [];
      try { resultados = await buscarPexels(consulta, tipo); } catch { throw d.erro(502, "busca_imagem_real_indisponivel", "O Pexels não respondeu agora. Tente em instantes."); }
      return d.json({ consulta, banco: "pexels", resultados, avisos: ["Licença Pexels: uso comercial livre; o crédito do fotógrafo fica guardado."], custo_usd: 0 });
    }
    // Todos: os bancos em paralelo, intercalados; o que não responder fica de fora com aviso.
    const nomes = ["Notícias", "Pexels", "Wikimedia", "Openverse"];
    const partes = await Promise.allSettled([
      tipo === "logo" || !d.textoDaWeb ? Promise.resolve([] as ResultadoReal[]) : buscarNoticias(consulta),
      comPexels ? buscarPexels(consulta, tipo) : Promise.resolve([] as ResultadoReal[]),
      buscarCommons(consulta, tipo),
      buscarOpenverse(consulta, tipo),
    ]);
    const listas = partes.map((p) => (p.status === "fulfilled" ? p.value : []));
    const falharam = partes.map((p, i) => (p.status === "rejected" ? nomes[i] : "")).filter(Boolean);
    if (falharam.length) avisos.push(`Sem resposta agora: ${falharam.join(", ")}.`);
    if (!comPexels && tipo === "imagem") avisos.push("Sem a chave do Pexels: as fotos de banco vêm da Wikimedia e do Openverse.");
    let resultados = intercalar(listas, 12);
    let custo = 0;
    let melhor: { indice: number; confianca: number | null; por: "jev" } | null = null;
    if (corpo.ordenar === "jev" && d.perguntarJev && resultados.length > 1) {
      try {
        const res = await d.perguntarJev(t, { lamina: { texto: (card?.texto_exato || "").replace(/\*\*/g, "").slice(0, 1200) }, busca: consulta }, { melhor: perguntaDaMelhorImagem(resultados) });
        custo = Math.round((Number(res.custoUsd) || 0) * 1e6) / 1e6;
        const r = res.answers.melhor;
        const i = r && typeof r.choice === "string" && /^r\d{1,2}$/.test(r.choice) ? Number(r.choice.slice(1)) - 1 : -1;
        if (i >= 0 && i < resultados.length) {
          resultados = [resultados[i], ...resultados.filter((_, k) => k !== i)];
          melhor = { indice: 0, confianca: typeof r?.confidence === "number" ? Math.round(r.confidence * 100) / 100 : null, por: "jev" };
        }
      } catch { avisos.push("O Jev não respondeu: a ordem é a dos bancos."); }
    }
    if (resultados.some((r) => r.banco === "noticias")) avisos.push("Fotos de matérias são do veículo: use com o crédito, em contexto de notícia.");
    return d.json({ consulta, banco: "todos", resultados, melhor, avisos, custo_usd: custo });
  }

  async function aplicar(ch: C, corpo: Record<string, unknown>): Promise<Response> {
    const { id, ordem } = identificadores(corpo);
    if (typeof corpo.versao_esperada !== "number" || !Number.isInteger(corpo.versao_esperada) || corpo.versao_esperada < 0 || typeof corpo.texto_base !== "string" || corpo.texto_base.length > 20_000) throw d.erro(400, "base_fonte_real_invalida", "Informe a versão e o texto da lâmina que está editando.");
    const esperado = corpo.versao_esperada, textoBase = corpo.texto_base;
    const t = await d.trabalhoComAcesso(ch, id);
    const card = conferirBase(t, ordem, esperado, textoBase, d);
    const tipo = tipoDoPedido(corpo.tipo, d.erro);
    const temArquivo = typeof corpo.arquivo === "string" && !!corpo.arquivo.trim();
    const temUrl = typeof corpo.url === "string" && !!corpo.url.trim();
    if (temArquivo === temUrl) throw d.erro(400, "fonte_real_invalida", "Escolha um resultado da busca ou um link direto de imagem.");
    let url: URL, fonte: Omit<FonteRealDoDiretor, "caminho">;
    let reserva: URL | null = null;
    const arquivoBruto = temArquivo ? (corpo.arquivo as string).trim() : "";
    const doOpenverse = temArquivo && arquivoBruto.toLowerCase().indexOf(PREFIXO_OPENVERSE) === 0;
    if (temArquivo && arquivoBruto.indexOf(PREFIXO_NOTICIA) === 0) {
      // Notícia: a matéria é relida na fonte (og:image, veículo e título); a miniatura do Bing é a reserva.
      const lido = lerArquivoDaNoticia(arquivoBruto);
      if (!lido) throw d.erro(400, "arquivo_fonte_real_invalido", "Escolha uma notícia válida da busca.");
      const pagina = d.textoDaWeb ? await d.textoDaWeb(lido.materia, 600_000).catch(() => null) : null;
      const metas = pagina ? metasDaMateria(pagina.texto, pagina.url) : { imagem: null, veiculo: "", titulo: "" };
      const doBing = lido.imagemId ? new URL(urlDaImagemDoBing(lido.imagemId)) : null;
      const primeira = metas.imagem || doBing;
      if (!primeira) throw d.erro(422, "arquivo_fonte_real_indisponivel", "Esta matéria não tem uma imagem pública. Escolha outra.");
      reserva = metas.imagem ? doBing : null;
      url = primeira;
      fonte = { nome: metas.titulo || "Imagem da matéria", fonte_url: lido.materia.href, licenca: LICENCA_DA_NOTICIA, autor: metas.veiculo || lido.materia.hostname.replace(/^www\./, ""), tipo, banco: "noticias" };
    } else if (temArquivo && arquivoBruto.indexOf(PREFIXO_PEXELS) === 0) {
      const idPexels = arquivoBruto.slice(PREFIXO_PEXELS.length);
      if (!/^\d{1,12}$/.test(idPexels) || !d.jsonDoPexels) throw d.erro(400, "arquivo_fonte_real_invalido", "Escolha uma foto válida do Pexels.");
      let item: ResultadoReal | null;
      try { item = resultadoDoPexels(await d.jsonDoPexels(`${API_DO_PEXELS_FOTOS}photos/${idPexels}`)); } catch { throw d.erro(502, "fonte_real_indisponivel", "Não foi possível conferir a origem desta foto. Tente novamente."); }
      if (!item) throw d.erro(422, "arquivo_fonte_real_indisponivel", "O Pexels não disponibiliza esta foto.");
      url = new URL(item.url);
      fonte = { nome: item.nome, fonte_url: item.fonte_url, licenca: item.licenca, autor: item.autor, tipo, banco: "pexels" };
    } else if (doOpenverse) {
      // O item é relido na API: licença, autor e arquivo nunca vêm da tela.
      const idOpenverse = (corpo.arquivo as string).trim().slice(PREFIXO_OPENVERSE.length).toLowerCase();
      if (!ID_OPENVERSE.test(idOpenverse) || !d.jsonDoOpenverse) throw d.erro(400, "arquivo_fonte_real_invalido", "Escolha uma imagem válida do Openverse.");
      let item: ResultadoReal | null;
      try { item = resultadoDoOpenverse(await d.jsonDoOpenverse(`${API_DO_OPENVERSE}${idOpenverse}/`)); } catch { throw d.erro(502, "fonte_real_indisponivel", "Não foi possível conferir a origem desta imagem. Tente novamente."); }
      if (!item) throw d.erro(422, "arquivo_fonte_real_indisponivel", "O Openverse não disponibiliza um arquivo público para esta imagem.");
      url = new URL(item.url);
      fonte = { nome: item.nome, fonte_url: item.fonte_url, licenca: item.licenca, autor: item.autor, tipo, banco: "openverse" };
    } else if (temArquivo) {
      const arquivo = arquivoDoCommons(corpo.arquivo);
      if (!arquivo) throw d.erro(400, "arquivo_fonte_real_invalido", "Escolha um arquivo de imagem válido da Wikimedia.");
      let info: LogoDoCommons | null;
      try { info = lerInfoDoCommons(await d.jsonDoCommons(urlDaInfoDaFotoNoCommons(arquivo)), arquivo); } catch { throw d.erro(502, "fonte_real_indisponivel", "Não foi possível conferir a origem desta imagem. Tente novamente."); }
      if (!info) throw d.erro(422, "arquivo_fonte_real_indisponivel", "A fonte não disponibiliza PNG, JPEG ou WebP para esta imagem.");
      const resultado = resultadoDoCommons(info);
      url = new URL(resultado.url);
      fonte = { nome: resultado.nome, fonte_url: resultado.fonte_url, licenca: resultado.licenca, autor: resultado.autor, tipo, banco: "wikimedia" };
    } else {
      const publica = urlDaFonteReal(corpo.url);
      if (!publica) throw precisaPrint();
      url = publica;
      let nome = "Imagem pública";
      try { nome = Array.from(decodeURIComponent(url.pathname.split("/").pop() || "")).filter((c) => c !== "<" && c !== ">" && c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127).join("").replace(/\.(png|jpe?g|webp)$/i, "").trim().slice(0, 160) || nome; } catch { /* nome genérico sem URL inválida */ }
      fonte = { nome, fonte_url: url.href, licenca: "licença não informada; confira a autorização de uso", autor: null, tipo };
    }
    const resposta = (trabalho: T, f: FonteRealDoDiretor, repetido = false) => d.json({ trabalho, fonte: f, custo_usd: 0, ...(repetido ? { ja_guardada: true } : {}) });
    const anterior = card.fontes_reais?.find((f) => f.fonte_url === fonte.fonte_url);
    if (anterior) return resposta(t, anterior, true);
    if ((card.fontes_reais?.length || 0) >= MAX_FONTES_REAIS) throw d.erro(409, "limite_fontes_reais", "Esta lâmina já tem oito fontes reais. Use uma das imagens disponíveis no Template.");
    let baixada = await d.buscarImagem(url, MAX_BYTES_FONTE_REAL, (u) => !!urlDaFonteReal(u.href));
    let mime = baixada && urlDaFonteReal(baixada.url.href) ? d.validarImagem(baixada.bytes, MAX_BYTES_FONTE_REAL) : null;
    // Notícia: a og:image da matéria falhou (formato ou bloqueio); a miniatura grande do Bing entra no lugar.
    if (!mime && reserva) {
      baixada = await d.buscarImagem(reserva, MAX_BYTES_FONTE_REAL, (u) => !!urlDaFonteReal(u.href));
      mime = baixada && urlDaFonteReal(baixada.url.href) ? d.validarImagem(baixada.bytes, MAX_BYTES_FONTE_REAL) : null;
    }
    if (!baixada || !mime) throw precisaPrint();
    // A origem de imagem direta acompanha o destino final; Commons sempre conserva a página da licença.
    if (!temArquivo) fonte.fonte_url = urlDaFonteReal(baixada.url.href)!.href;
    const caminho = await d.guardarImagem(t, baixada.bytes, mime);
    const nova: FonteRealDoDiretor = { caminho, ...fonte };
    try {
      const gravado = await d.mutarTrabalho(t.id, (atual) => {
        try {
          if (atual.client_id !== t.client_id) throw d.erro(409, "cliente_fonte_real_alterado", "O cliente do trabalho mudou. Abra o trabalho novamente.");
          const atualCard = conferirBase(atual, ordem, esperado, textoBase, d);
          const repetido = atualCard.fontes_reais?.find((f) => f.fonte_url === nova.fonte_url);
          if (repetido) throw new FonteJaGuardada(atual, repetido);
          if ((atualCard.fontes_reais?.length || 0) >= MAX_FONTES_REAIS) throw d.erro(409, "limite_fontes_reais", "Esta lâmina já tem oito fontes reais.");
          return { direcao: { ...atual.direcao, cards: atual.direcao.cards.map((c) => c.ordem === ordem ? { ...c, fontes_reais: [...(c.fontes_reais || []), nova] } : c) } };
        } catch (e) { if (e instanceof FonteJaGuardada) throw e; throw new RecusaDaFonte(e); }
      });
      return resposta(gravado, nova);
    } catch (e) {
      if (e instanceof FonteJaGuardada || e instanceof RecusaDaFonte) await d.descartarUpload(caminho).catch(() => undefined);
      if (e instanceof FonteJaGuardada) return resposta((e as FonteJaGuardada<T>).trabalho, e.fonte, true);
      if (e instanceof RecusaDaFonte) throw e.motivo;
      // Resultado de rede/UPDATE ambíguo: conservar, pois o commit pode ter ocorrido.
      throw e;
    }
  }
  return { imagens_reais_buscar: buscar, imagem_real_aplicar: aplicar };
}
