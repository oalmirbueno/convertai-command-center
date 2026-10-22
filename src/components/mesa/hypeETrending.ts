/**
 * Hype e Trending no Mês (21/10/2026): chamadas ao agente-calendario e as regras puras de juntar itens para
 * a campanha. A semente segue o contrato de sementeDaCampanha.ts (quem lê é a aba Campanhas).
 */
import { chamarFuncao } from "@/lib/mesa/api";
import type { Hype } from "./mesaV4Api";
import { linkSeguro, dominioDoLink, ROTULO_DA_JANELA } from "./mesaV4Api";
import type { DataDoHype } from "./datasDoHype";
import { quandoDaData, ROTULO_DO_TIPO_DE_DATA } from "./datasDoHype";
import type { HypeDaSemente, SementeDaCampanha, TrendDaSemente } from "./sementeDaCampanha";

// ------------------------------------------------------------------ trending (notícias)

export type Recencia = "24h" | "7d" | "30d";
export const RECENCIAS: { valor: Recencia; rotulo: string; horas: number }[] = [
  { valor: "24h", rotulo: "24 h", horas: 24 },
  { valor: "7d", rotulo: "7 dias", horas: 24 * 7 },
  { valor: "30d", rotulo: "30 dias", horas: 24 * 30 },
];

export interface Noticia {
  titulo: string;
  fonte: string;
  fonte_url: string | null;
  link: string;
  /** Data real da matéria (ISO). */
  data: string;
  /** 21/10: "cabe no marketing deste cliente?" (Jev no servidor + corte de assunto sensível). Null: sem julgamento. */
  julgamento?: { cabe: "serve" | "talvez" | "nao_serve"; motivo: string; sensivel: boolean } | null;
}

/** Custo do Jev embutido na busca de notícias (um pedido por lote de até 20 manchetes): à vista no botão. */
export const CUSTO_DO_JEV_NAS_NOTICIAS_USD = 0.002;
/** Custo do Jev que ordena as datas para o cliente (uma vez por semana). */
export const CUSTO_DO_JEV_NAS_DATAS_USD = 0.001;

/** Separa as manchetes: as que servem (e as sem julgamento) à vista; as que não servem, escondidas. */
export function separarNoticias(itens: Noticia[]): { visiveis: Noticia[]; descartadas: Noticia[] } {
  const descartadas = itens.filter((n) => n.julgamento && n.julgamento.cabe === "nao_serve");
  const peso = (n: Noticia) => (!n.julgamento ? 2 : n.julgamento.cabe === "serve" ? 0 : 1);
  const visiveis = itens.filter((n) => !(n.julgamento && n.julgamento.cabe === "nao_serve"))
    .map((n, i) => ({ n, i })).sort((a, b) => peso(a.n) - peso(b.n) || a.i - b.i).map((x) => x.n);
  return { visiveis, descartadas };
}

export interface RespostaDoTrending {
  assunto: string;
  recencia: Recencia;
  itens: Noticia[];
  sugeridos: string[];
  buscado_em: string;
  fonte?: string;
  sem_assunto?: boolean;
  custo_usd?: number;
  jev_erro?: string | null;
}

export const buscarTrending = (clientId: string, assunto: string, recencia: Recencia) =>
  chamarFuncao<RespostaDoTrending>("agente-calendario", assunto.trim()
    ? { acao: "buscar_trending", client_id: clientId, assunto: assunto.trim(), recencia }
    : { acao: "buscar_trending", client_id: clientId, recencia });

/** Filtro local: só o que cabe na recência (pela data real) e, se escolhida, só a fonte. */
export function filtrarNoticias(itens: Noticia[], filtros: { recencia: Recencia; fonte: string }, agoraMs: number): Noticia[] {
  const r = RECENCIAS.find((x) => x.valor === filtros.recencia) || RECENCIAS[1];
  const desde = agoraMs - r.horas * 3_600_000;
  return itens.filter((n) => {
    const ms = Date.parse(n.data);
    if (!Number.isFinite(ms) || ms < desde) return false;
    return !filtros.fonte || n.fonte === filtros.fonte;
  });
}

export function fontesDasNoticias(itens: Noticia[]): string[] {
  const vistas: Record<string, true> = {};
  const saida: string[] = [];
  itens.forEach((n) => {
    if (n.fonte && !vistas[n.fonte]) {
      vistas[n.fonte] = true;
      saida.push(n.fonte);
    }
  });
  return saida.sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** "21/10 · 14:05" ou "há 3 h" (até 24 h), sempre da data real da matéria. */
export function quandoDaNoticia(iso: string, agoraMs: number): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const horas = Math.floor((agoraMs - ms) / 3_600_000);
  if (horas >= 0 && horas < 1) return "há menos de 1 h";
  if (horas >= 1 && horas < 24) return `há ${horas} h`;
  const d = new Date(ms);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Pedido ao agente do mês a partir da notícia (o mesmo caminho do hype: pedido_livre). */
export function mensagemDaNoticia(n: Noticia): string {
  const data = n.data.slice(0, 10).split("-").reverse().join("/");
  return [
    `Um conteúdo a partir da notícia em alta "${n.titulo}" (${n.fonte}, ${data}).`,
    `Matéria: ${n.link}`,
    "Leia o fato da notícia e ligue ao negócio deste cliente com naturalidade; não invente número nem detalhe que não está na matéria.",
    `Gancho do momento: Nicho: ${n.titulo}.`,
  ].join(" ");
}

/** Pedido ao agente do mês a partir de uma data do calendário. */
export function mensagemDaData(d: DataDoHype): string {
  return [
    `Um conteúdo para a data "${d.titulo}" (${quandoDaData(d)}).`,
    `Por que importa: ${d.porQue}`,
    `Ideia: ${d.comoUsar}`,
    `Gancho do momento: Hype: ${d.titulo}.`,
  ].join(" ");
}

// ------------------------------------------------------------------ hype (relevância pelo Jev)

export interface NotaDaData {
  nota: number | null;
  nivel: string | null;
}

export interface RespostaDasNotas {
  notas: Record<string, NotaDaData>;
  /** Segmento do cadastro (a regra sem Jev usa). */
  segmento?: string | null;
  jev_erro?: string;
  custo_usd?: number;
}

export const ordenarDatasDoHype = (clientId: string, datas: DataDoHype[]) =>
  chamarFuncao<RespostaDasNotas>("agente-calendario", {
    acao: "ordenar_datas_do_hype",
    client_id: clientId,
    datas: datas.slice(0, 40).map((d) => ({ id: d.id, titulo: d.titulo, tipo: ROTULO_DO_TIPO_DE_DATA[d.tipo], quando: quandoDaData(d) })),
  });

/** Ordem: pela data (padrão) ou pela nota do Jev (sem nota vai para o fim, na ordem da data). */
export function ordenarDatas(datas: DataDoHype[], notas: Record<string, NotaDaData> | null, modo: "data" | "relevancia"): DataDoHype[] {
  if (modo === "data" || !notas) return datas.slice();
  const nota = (d: DataDoHype) => {
    const n = notas[d.id];
    return n && typeof n.nota === "number" ? n.nota : -1;
  };
  return datas.map((d, i) => ({ d, i })).sort((a, b) => nota(b.d) - nota(a.d) || a.i - b.i).map((x) => x.d);
}

// ------------------------------------------------------------------ juntar para a campanha

export const MAXIMO_POR_LISTA = 6;

export interface ItemJuntado {
  chave: string;
  hype?: HypeDaSemente;
  trend?: TrendDaSemente;
}

export const chaveDaData = (d: DataDoHype) => `data:${d.id}:${d.pico}`;
export const chaveDaLeitura = (indice: number) => `leitura:${indice}`;
export const chaveDaNoticia = (n: Noticia) => `noticia:${n.link}`;

export function juntadoDaData(d: DataDoHype, nota?: NotaDaData | null): ItemJuntado {
  return {
    chave: chaveDaData(d),
    hype: { titulo: d.titulo, quando: quandoDaData(d).slice(0, 60), por_que_agora: [d.porQue, nota && nota.nivel ? `${nota.nivel} (Jev).` : ""].filter(Boolean).join(" "), como_usar: d.comoUsar },
  };
}

/** Item da leitura da semana: o hype vira hype (com o índice); o "em alta no nicho" vira trend. */
export function juntadoDaLeitura(h: Hype, indice: number, pesquisadoEm: string | null): ItemJuntado {
  if (h.tipo === "nicho") {
    const url = linkSeguro(h.fonte);
    return {
      chave: chaveDaLeitura(indice),
      trend: {
        titulo: h.titulo,
        fonte: url ? dominioDoLink(url) : undefined,
        url: url || undefined,
        data: pesquisadoEm ? `pesquisa de ${pesquisadoEm.slice(8, 10)}/${pesquisadoEm.slice(5, 7)}` : undefined,
        resumo: [h.sinal, h.o_que_e].filter(Boolean).join(" · ") || undefined,
      },
    };
  }
  return {
    chave: chaveDaLeitura(indice),
    hype: { titulo: h.titulo, quando: ROTULO_DA_JANELA[String(h.janela || "")] || undefined, por_que_agora: h.por_que_agora, como_usar: h.como_usar, indice },
  };
}

export function juntadoDaNoticia(n: Noticia): ItemJuntado {
  return { chave: chaveDaNoticia(n), trend: { titulo: n.titulo, fonte: n.fonte, url: n.link, data: n.data, resumo: undefined } };
}

/** Marca ou desmarca. Cada lista (hypes, trends) aceita até 6, o limite da semente. */
export function alternarJuntado(lista: ItemJuntado[], item: ItemJuntado): ItemJuntado[] {
  if (lista.some((x) => x.chave === item.chave)) return lista.filter((x) => x.chave !== item.chave);
  if (!podeJuntar(lista, item)) return lista;
  return lista.concat(item);
}

export function podeJuntar(lista: ItemJuntado[], item: ItemJuntado): boolean {
  if (lista.some((x) => x.chave === item.chave)) return true;
  const mesmos = lista.filter((x) => (item.hype ? !!x.hype : !!x.trend)).length;
  return mesmos < MAXIMO_POR_LISTA;
}

export function sementeDaSelecao(lista: ItemJuntado[], pedido: string): Omit<SementeDaCampanha, "criada_em"> {
  const p = pedido.trim();
  return {
    hypes: lista.filter((x) => x.hype).map((x) => x.hype as HypeDaSemente),
    trends: lista.filter((x) => x.trend).map((x) => x.trend as TrendDaSemente),
    ...(p ? { pedido: p } : {}),
  };
}
