/**
 * Semente da campanha (21/10/2026, pedido do dono: "com base no hype e no trending eu conseguir juntar e criar
 * campanhas"). O Mês escolhe um ou mais hypes (datas e eventos) e trendings (notícias em alta) e abre a aba
 * Campanhas com a semente: a campanha nova já vem preenchida com o que foi juntado.
 *
 * Contrato entre o Mês (quem escreve) e Campanhas (quem lê). Guarda por cliente na sessão do navegador e é lida
 * uma vez (tirar). Sem sessionStorage (aba privada), a semente vive só na memória desta página.
 */

export interface HypeDaSemente {
  titulo: string;
  /** Data ou janela do hype ("29/11", "24/11 a 01/12"), como veio da leitura. */
  quando?: string;
  por_que_agora?: string;
  como_usar?: string;
  /** Índice na leitura gravada de hypes (para quem precisa reabrir o item original). */
  indice?: number;
}

export interface TrendDaSemente {
  titulo: string;
  fonte?: string;
  url?: string;
  /** Data real da matéria ou da pesquisa (nunca inventada). */
  data?: string;
  resumo?: string;
}

export interface SementeDaCampanha {
  hypes: HypeDaSemente[];
  trends: TrendDaSemente[];
  /** Pedido livre do dono junto com a seleção ("Black Friday com 30% no plano anual"). */
  pedido?: string;
  criada_em: string;
}

const PREFIXO = "mesa:semente-da-campanha:";
const naMemoria: Record<string, SementeDaCampanha> = {};

const limpar = (s: string | undefined, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : undefined);

/** Normaliza o que vier (limites de tamanho, no máximo 6 hypes e 6 trends); null quando não há nada. */
export function normalizarSemente(bruta: unknown): SementeDaCampanha | null {
  if (!bruta || typeof bruta !== "object") return null;
  const o = bruta as Record<string, unknown>;
  const lista = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") as Record<string, unknown>[] : []);
  const hypes: HypeDaSemente[] = lista(o.hypes)
    .map((h) => ({
      titulo: limpar(h.titulo as string, 160) || "",
      quando: limpar(h.quando as string, 60),
      por_que_agora: limpar(h.por_que_agora as string, 400),
      como_usar: limpar(h.como_usar as string, 400),
      indice: typeof h.indice === "number" && h.indice >= 0 ? Math.floor(h.indice) : undefined,
    }))
    .filter((h) => h.titulo)
    .slice(0, 6);
  const trends: TrendDaSemente[] = lista(o.trends)
    .map((t) => {
      const url = limpar(t.url as string, 600);
      return {
        titulo: limpar(t.titulo as string, 200) || "",
        fonte: limpar(t.fonte as string, 80),
        url: url && url.indexOf("https://") === 0 ? url : undefined,
        data: limpar(t.data as string, 40),
        resumo: limpar(t.resumo as string, 500),
      };
    })
    .filter((t) => t.titulo)
    .slice(0, 6);
  if (!hypes.length && !trends.length) return null;
  return { hypes, trends, pedido: limpar(o.pedido as string, 1000), criada_em: limpar(o.criada_em as string, 40) || new Date().toISOString() };
}

export function guardarSementeDaCampanha(clientId: string, semente: Omit<SementeDaCampanha, "criada_em"> & { criada_em?: string }) {
  const s = normalizarSemente({ ...semente, criada_em: semente.criada_em || new Date().toISOString() });
  if (!s) return;
  naMemoria[clientId] = s;
  try {
    window.sessionStorage.setItem(PREFIXO + clientId, JSON.stringify(s));
  } catch {
    /* aba privada: fica só na memória */
  }
}

/** Lê e apaga (uma vez). */
export function tirarSementeDaCampanha(clientId: string): SementeDaCampanha | null {
  let s: SementeDaCampanha | null = naMemoria[clientId] || null;
  delete naMemoria[clientId];
  try {
    const bruto = window.sessionStorage.getItem(PREFIXO + clientId);
    window.sessionStorage.removeItem(PREFIXO + clientId);
    if (bruto) s = normalizarSemente(JSON.parse(bruto)) || s;
  } catch {
    /* sem sessionStorage */
  }
  return s;
}

/** Título sugerido para a campanha a partir da semente ("Black Friday + Copa do Mundo"). */
export function tituloDaSemente(s: SementeDaCampanha): string {
  const nomes = s.hypes.map((h) => h.titulo).concat(s.trends.map((t) => t.titulo));
  if (!nomes.length) return "";
  return nomes.length === 1 ? nomes[0] : `${nomes[0]} + ${nomes.length - 1} ${nomes.length - 1 === 1 ? "tema" : "temas"}`;
}
