/**
 * Trending (21/10/2026): manchetes REAIS por assunto, pelo RSS público do Google Notícias (sem login, sem
 * custo). Puro e testável no vitest: montar a URL, ler o XML, filtrar pela recência e o cache curto.
 * Nunca inventa manchete nem data: item sem título, sem link https ou sem data válida sai da lista.
 */

export type Recencia = "24h" | "7d" | "30d";

export const RECENCIAS: Record<Recencia, { horas: number; quando: string }> = {
  "24h": { horas: 24, quando: "1d" },
  "7d": { horas: 24 * 7, quando: "7d" },
  "30d": { horas: 24 * 30, quando: "30d" },
};

export const LIMITE_DE_NOTICIAS = 20;
export const CACHE_DAS_NOTICIAS_MS = 10 * 60 * 1000;

export interface Noticia {
  titulo: string;
  fonte: string;
  fonte_url: string | null;
  link: string;
  /** Data real da matéria (pubDate do RSS), em ISO. */
  data: string;
}

export function recenciaValida(v: unknown): Recencia {
  return v === "24h" || v === "30d" ? v : "7d";
}

/** Assunto livre: sem controle, espaços juntos, até 80 caracteres. */
export function assuntoValido(v: unknown): string {
  if (typeof v !== "string") return "";
  let s = "";
  for (const c of v) s += c.charCodeAt(0) < 32 ? " " : c;
  return s.split(" ").filter(Boolean).join(" ").slice(0, 80).trim();
}

export function urlDoGoogleNoticias(assunto: string, recencia: Recencia): string {
  const q = `${assunto} when:${RECENCIAS[recencia].quando}`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodificar(t: string): string {
  return t.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (inteiro, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    const v = ENTIDADES[e.toLowerCase()];
    return v === undefined ? inteiro : v;
  });
}

function conteudoDa(bloco: string, tag: string): { texto: string; atributos: string } | null {
  const abre = new RegExp(`<${tag}(\\s[^>]*)?>`, "i").exec(bloco);
  if (!abre) return null;
  const inicio = abre.index + abre[0].length;
  const fim = bloco.toLowerCase().indexOf(`</${tag.toLowerCase()}>`, inicio);
  if (fim < 0) return null;
  let bruto = bloco.slice(inicio, fim).trim();
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(bruto);
  if (cdata) bruto = cdata[1];
  else bruto = decodificar(bruto);
  return { texto: bruto.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), atributos: abre[1] || "" };
}

const https = (u: string | null | undefined) => (u && u.indexOf("https://") === 0 ? u : null);

/** Lê o RSS (Google Notícias ou outro RSS 2.0) e devolve até `limite` notícias válidas, na ordem do arquivo. */
export function lerRssDeNoticias(xml: string, limite = LIMITE_DE_NOTICIAS): Noticia[] {
  const saida: Noticia[] = [];
  const vistos: Record<string, true> = {};
  const itens = String(xml || "").split(/<item[\s>]/i).slice(1);
  for (const pedaco of itens) {
    if (saida.length >= limite) break;
    const bloco = pedaco.split(/<\/item>/i)[0];
    const titulo = conteudoDa(bloco, "title")?.texto || "";
    const link = https(conteudoDa(bloco, "link")?.texto);
    const quando = conteudoDa(bloco, "pubDate")?.texto || "";
    const ms = Date.parse(quando);
    const fonteTag = conteudoDa(bloco, "source");
    const fonte = fonteTag?.texto || "";
    const urlDaFonte = fonteTag ? /url="([^"]+)"/i.exec(fonteTag.atributos) : null;
    if (!titulo || !link || !Number.isFinite(ms)) continue;
    // O Google põe " - Fonte" no fim do título; a fonte já vem à parte.
    const sufixo = fonte ? ` - ${fonte}` : "";
    const limpo = sufixo && titulo.length > sufixo.length && titulo.slice(-sufixo.length) === sufixo ? titulo.slice(0, -sufixo.length).trim() : titulo;
    const chave = limpo.toLowerCase();
    if (vistos[chave]) continue;
    vistos[chave] = true;
    saida.push({ titulo: limpo.slice(0, 300), fonte: fonte.slice(0, 80) || "Fonte não informada", fonte_url: https(urlDaFonte ? decodificar(urlDaFonte[1]) : null), link: link.slice(0, 1000), data: new Date(ms).toISOString() });
  }
  return saida;
}

/** Só o que cabe na recência (a data real da matéria), mais novas primeiro. */
export function filtrarPorRecencia<T extends { data: string }>(itens: T[], recencia: Recencia, agoraMs: number): T[] {
  const desde = agoraMs - RECENCIAS[recencia].horas * 3_600_000;
  return itens
    .filter((n) => {
      const ms = Date.parse(n.data);
      return Number.isFinite(ms) && ms >= desde && ms <= agoraMs + 3_600_000;
    })
    .sort((a, b) => Date.parse(b.data) - Date.parse(a.data));
}

/** Cache curto em memória da função (por assunto + recência; as notícias são públicas). */
export class CacheCurto<T> {
  private mapa = new Map<string, { em: number; valor: T }>();
  constructor(private ttlMs: number, private maximo = 200) {}
  ler(chave: string, agora: number): T | null {
    const v = this.mapa.get(chave);
    if (!v) return null;
    if (agora - v.em > this.ttlMs) {
      this.mapa.delete(chave);
      return null;
    }
    return v.valor;
  }
  guardar(chave: string, valor: T, agora: number) {
    if (this.mapa.size >= this.maximo) {
      const primeira = this.mapa.keys().next();
      if (!primeira.done) this.mapa.delete(primeira.value);
    }
    this.mapa.set(chave, { em: agora, valor });
  }
}

/** Assuntos sugeridos do cliente: o segmento do cadastro e os títulos do "em alta no nicho" (sem repetir). */
export function assuntosSugeridos(segmento: unknown, titulosDoNicho: unknown[], maximo = 6): string[] {
  const saida: string[] = [];
  const vistos: Record<string, true> = {};
  for (const bruto of [segmento].concat(titulosDoNicho)) {
    const a = assuntoValido(bruto).slice(0, 60);
    const k = a.toLowerCase();
    if (a.length < 3 || vistos[k]) continue;
    vistos[k] = true;
    saida.push(a);
    if (saida.length >= maximo) break;
  }
  return saida;
}

// ------------------------------------------------------------------ datas do hype para o Jev

export interface DataParaOJev {
  id: string;
  titulo: string;
  tipo: string;
  quando: string;
}

/** Até 40 datas, com id simples (a-z, 0-9, -) e textos curtos. */
export function datasParaOJev(bruto: unknown): DataParaOJev[] {
  if (!Array.isArray(bruto)) return [];
  const saida: DataParaOJev[] = [];
  const vistos: Record<string, true> = {};
  for (const x of bruto) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    if (!/^[a-z0-9-]{1,60}$/.test(id) || vistos[id]) continue;
    const titulo = assuntoValido(o.titulo).slice(0, 120);
    if (!titulo) continue;
    vistos[id] = true;
    saida.push({ id, titulo, tipo: assuntoValido(o.tipo).slice(0, 40), quando: assuntoValido(o.quando).slice(0, 80) });
    if (saida.length >= 40) break;
  }
  return saida;
}

/** Níveis do Score: quanto a data serve a ESTE cliente (do pior para o melhor). */
export const NIVEIS_DA_DATA = [
  "Não serve: a data não tem relação com o negócio nem com o público deste cliente, ou seria oportunista falar dela.",
  "Serve pouco: dá para citar a data, mas o público do cliente não espera nada da marca nela.",
  "Serve: o público do cliente vive a data e a marca tem uma ligação natural para um conteúdo.",
  "Serve muito: data central para o negócio deste cliente (vendas, público ou profissão dele), vale campanha.",
];

export const ROTULO_DO_NIVEL_DA_DATA = ["Não serve a este cliente", "Serve pouco a este cliente", "Serve a este cliente", "Serve muito a este cliente"];

// ------------------------------------------------------------------ cabe no marketing do cliente? (21/10/2026)

/** Palavras que marcam assunto que não serve para marca (tragédia, crime, política partidária). Sem acento, minúsculas. */
const PALAVRAS_SENSIVEIS = [
  "morte", "morre", "morreu", "mortos", "morta", "obito", "tragedia", "acidente", "assassin", "homicidio", "feminicidio", "estupro",
  "chacina", "tiroteio", "baleado", "sequestro", "atentado", "terroris", "guerra", "massacre", "desabamento", "enchente", "incendio",
  "suicid", "velorio", "luto", "eleicao", "eleicoes", "candidato", "partido", "deputado", "senador", "vereador", "prefeito", "governador",
  "presidente lula", "bolsonaro", "stf", "impeachment", "cpi ", "corrupcao", "propina", "preso", "prisao", "policia", "delegacia",
];

const semAcentoServidor = (t: string) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Corte em código (vale mesmo sem o Jev): manchete com termo de tragédia, crime ou política partidária. */
export function assuntoSensivel(titulo: string): boolean {
  // Começo de palavra: "luto" não pega "absoluto".
  const t = ` ${semAcentoServidor(titulo).replace(/[^a-z0-9]+/g, " ").trim()} `;
  return PALAVRAS_SENSIVEIS.some((p) => t.indexOf(` ${p}`) >= 0);
}

export type CabeNoMarketing = "serve" | "talvez" | "nao_serve";

export interface Julgamento {
  cabe: CabeNoMarketing;
  /** Linha curta: por que serve (ou por que saiu). */
  motivo: string;
  sensivel: boolean;
}

export const CRITERIOS_DO_CABE: Record<CabeNoMarketing, string> = {
  serve: "Serve: o assunto é do nicho ou do público deste cliente e a marca consegue falar dele com naturalidade em um post ou anúncio agora.",
  talvez: "Talvez: tem alguma ligação com o nicho ou o público, mas exige um ângulo forçado ou é fraco para o marketing deste cliente.",
  nao_serve: "Não serve: não tem relação com o negócio nem com o público deste cliente, ou falar disso pareceria oportunista.",
};

export const ANGULOS: Record<string, string> = {
  educar: "educar o público do cliente sobre o assunto",
  oferta: "puxar uma oferta ou promoção ligada à notícia",
  autoridade: "mostrar autoridade e novidade do setor",
  opiniao: "a marca comentar e dar a opinião dela",
  tendencia: "surfar uma tendência que o público está acompanhando",
};

/** Perguntas do Jev para o lote de manchetes: cabe (Choice), sensível (Noul) e o ângulo (Choice). */
export function perguntasDoCabe(qtd: number): Record<string, { type: "choice" | "noul"; instructions: string; criteria?: Record<string, string> | { true: string; false: string } }> {
  const q: Record<string, { type: "choice" | "noul"; instructions: string; criteria?: Record<string, string> | { true: string; false: string } }> = {};
  for (let i = 0; i < qtd; i += 1) {
    q[`c${i}`] = { type: "choice", instructions: `A manchete \`noticias[${i}]\` cabe no marketing da marca em \`cliente\`?`, criteria: { ...CRITERIOS_DO_CABE } };
    q[`s${i}`] = {
      type: "noul",
      instructions: `A manchete \`noticias[${i}]\` trata de tragédia, morte, crime, violência, desastre, política partidária ou outro assunto sensível em que uma marca não deve entrar?`,
      criteria: { true: "Sim, é assunto sensível para uma marca.", false: "Não, é um assunto seguro para uma marca comentar." },
    };
    q[`a${i}`] = { type: "choice", instructions: `Qual o melhor uso da manchete \`noticias[${i}]\` no marketing da marca em \`cliente\`?`, criteria: { ...ANGULOS } };
  }
  return q;
}

/** Junta as respostas do Jev com o corte em código. Sem resposta para o item: julgamento null (fica como veio). */
export function julgarNoticias<T extends { titulo: string }>(
  itens: T[],
  respostas: Record<string, { choice?: string; noul?: number }> | null,
): Array<T & { julgamento: Julgamento | null }> {
  return itens.map((n, i) => {
    const sensivelNoCodigo = assuntoSensivel(n.titulo);
    if (!respostas) {
      return { ...n, julgamento: sensivelNoCodigo ? { cabe: "nao_serve" as const, motivo: "Assunto sensível: não serve para marca.", sensivel: true } : null };
    }
    const c = respostas[`c${i}`]?.choice as CabeNoMarketing | undefined;
    const s = respostas[`s${i}`]?.noul;
    const a = respostas[`a${i}`]?.choice;
    const sensivel = sensivelNoCodigo || (typeof s === "number" && s >= 0.5);
    if (sensivel) return { ...n, julgamento: { cabe: "nao_serve" as const, motivo: "Assunto sensível: não serve para marca.", sensivel: true } };
    if (c !== "serve" && c !== "talvez" && c !== "nao_serve") return { ...n, julgamento: null };
    const motivo = c === "nao_serve" ? "Não tem relação com o negócio ou o público do cliente." : `${c === "serve" ? "Serve" : "Talvez sirva"} para ${a && ANGULOS[a] ? ANGULOS[a] : "falar com o público do cliente"}.`;
    return { ...n, julgamento: { cabe: c, motivo, sensivel: false } };
  });
}

/** Ordem: serve, talvez, sem julgamento, não serve; dentro de cada um, a ordem que veio (mais novas primeiro). */
export function ordenarPeloCabe<T extends { julgamento: Julgamento | null }>(itens: T[]): T[] {
  const peso = (j: Julgamento | null) => (!j ? 2 : j.cabe === "serve" ? 0 : j.cabe === "talvez" ? 1 : 3);
  return itens.map((n, i) => ({ n, i })).sort((x, y) => peso(x.n.julgamento) - peso(y.n.julgamento) || x.i - y.i).map((x) => x.n);
}

/** Assuntos do nicho para a busca automática: segmento, nicho/segmento do contexto da marca, produtos e o nicho lido. */
export function assuntosDoNicho(c: { segmento?: unknown; contexto?: Record<string, unknown> | null; titulosDoNicho?: unknown[] }, maximo = 6): string[] {
  const ctx = c.contexto || {};
  const curto = (v: unknown) => {
    if (typeof v !== "string") return "";
    const primeira = v.split(/[.;\n]/)[0];
    return primeira.split(" ").filter(Boolean).slice(0, 5).join(" ");
  };
  const lista: unknown[] = [c.segmento, ctx.nicho, ctx.segmento, curto(ctx.produtos), curto(ctx.negocio)];
  return assuntosSugeridos(lista[0], lista.slice(1).concat(c.titulosDoNicho || []), maximo);
}
