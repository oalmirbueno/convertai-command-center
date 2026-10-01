/**
 * Números da Meta na Conta da Mesa Ads (frente ADM, 01/10/2026). Pedido do
 * dono: "os números não estão marcando correto: está engajamento 5, mas só
 * chegou 1 mensagem; tem que ser os números certinhos, ter os objetivos para
 * escolher, puxar todas as métricas, escolher o que ver e puxar por horário".
 *
 * Tudo aqui é leitura e forma (puro, testável): o servidor (mesa-ads,
 * metricas_meta e metricas_por_hora) lê a Meta com a janela do Gerenciador e
 * manda o catálogo (nome e definição de cada métrica) junto. A tela só
 * escolhe o que mostrar. Compatível com Safari 11 e Chrome 64.
 */
import { brl, chamarAds, decimal, inteiro, porcento } from "./adsApi";
import { corpoDoPeriodo, chaveDoPeriodo, type PeriodoDaConsulta } from "./periodoDaConta";

export type NivelDaMetrica = "conta" | "campanha" | "conjunto" | "anuncio";
export type IdDoObjetivo = "mensagens" | "leads" | "trafego" | "engajamento" | "vendas" | "reconhecimento" | "video" | "seguidores";
export type FormatoDaMetrica = "brl" | "inteiro" | "pct" | "decimal";

export const NIVEIS_DA_METRICA: { valor: NivelDaMetrica; rotulo: string }[] = [
  { valor: "conta", rotulo: "Conta" },
  { valor: "campanha", rotulo: "Campanhas" },
  { valor: "conjunto", rotulo: "Conjuntos" },
  { valor: "anuncio", rotulo: "Anúncios" },
];

/** A ordem do seletor (o servidor manda as definições; esta é só a lista, para o seletor aparecer antes da leitura). */
export const OBJETIVOS_DO_SELETOR: { valor: IdDoObjetivo | ""; rotulo: string }[] = [
  { valor: "", rotulo: "Todos" },
  { valor: "mensagens", rotulo: "Mensagens" },
  { valor: "leads", rotulo: "Leads" },
  { valor: "trafego", rotulo: "Tráfego" },
  { valor: "engajamento", rotulo: "Engajamento" },
  { valor: "vendas", rotulo: "Vendas" },
  { valor: "reconhecimento", rotulo: "Reconhecimento" },
  { valor: "video", rotulo: "Vídeo" },
  { valor: "seguidores", rotulo: "Seguidores" },
];

export interface MetricaDoCatalogo {
  id: string;
  rotulo: string;
  ajuda: string;
  formato: FormatoDaMetrica;
  bomQuandoSobe: boolean;
}

export interface DefinicaoDoObjetivo {
  id: IdDoObjetivo;
  rotulo: string;
  ajuda: string;
  resultado: string;
  colunas: string[];
}

export type Numeros = Record<string, number | null>;

export interface ItemDaMetrica {
  nivel: NivelDaMetrica;
  id: string;
  nome: string;
  campanha: string | null;
  conjunto: string | null;
  objetivo: IdDoObjetivo | null;
  resultado: string | null;
  resultado_rotulo: string;
  numeros: Numeros;
}

export interface TotalDoObjetivo {
  objetivo: IdDoObjetivo;
  rotulo: string;
  campanhas: number;
  resultado: string | null;
  resultado_rotulo: string;
  por_resultado: { metrica: string; rotulo: string; valor: number }[];
  numeros: Numeros;
}

export interface LeituraDasMetricas {
  fonte: "meta_ao_vivo" | "coleta";
  janela: string;
  periodo: { inicio: string; fim: string } | null;
  total: { numeros: Numeros; resultado: string | null; resultado_rotulo: string; misto: boolean; por_resultado: { metrica: string; rotulo: string; valor: number }[] };
  objetivos: TotalDoObjetivo[];
  itens: ItemDaMetrica[];
  catalogo: MetricaDoCatalogo[];
  definicoes: DefinicaoDoObjetivo[];
  colunasDeTodos: string[];
  avisos: string[];
  lidoEm: string | null;
}

export interface FaixaDoTempo {
  indice: number;
  rotulo: string;
  gasto: number;
  impressoes: number;
  cliques_link: number;
  conversas: number;
  leads: number;
  compras: number;
  resultados: number | null;
  custo_por_resultado: number | null;
}

export interface MelhorHorario {
  melhor: { indice: number; rotulo: string; valor: number; custo: number | null } | null;
  faixa: { inicio: number; fim: number; rotulo: string; valor: number; pct: number } | null;
  pouco_volume: boolean;
}

export interface LeituraNoTempo {
  fonte: "meta_ao_vivo" | "coleta";
  medida: { chave: "resultados" | "conversas" | "cliques_link"; rotulo: string };
  hora: { faixas: FaixaDoTempo[]; melhor: MelhorHorario } | null;
  diaDaSemana: { faixas: FaixaDoTempo[]; melhor: MelhorHorario } | null;
  avisos: string[];
}

const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
const lista = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};
const numeros = (v: unknown): Numeros => {
  const o = obj(v);
  const saida: Numeros = {};
  Object.keys(o).forEach((k) => {
    saida[k] = num(o[k]);
  });
  return saida;
};
const ehObjetivo = (v: unknown): v is IdDoObjetivo => OBJETIVOS_DO_SELETOR.some((o) => o.valor !== "" && o.valor === v);
const FORMATOS: FormatoDaMetrica[] = ["brl", "inteiro", "pct", "decimal"];

/** A resposta de metricas_meta na forma da tela (resposta incompleta não quebra). */
export function lerMetricas(bruto: unknown): LeituraDasMetricas {
  const r = obj(bruto);
  const t = obj(r.total);
  const porResultado = (v: unknown) => lista(v).map((x) => ({ metrica: txt(obj(x).metrica), rotulo: txt(obj(x).rotulo), valor: num(obj(x).valor) || 0 })).filter((x) => !!x.metrica);
  return {
    fonte: r.fonte === "coleta" ? "coleta" : "meta_ao_vivo",
    janela: txt(r.janela),
    periodo: txt(obj(r.periodo).inicio) ? { inicio: txt(obj(r.periodo).inicio), fim: txt(obj(r.periodo).fim) } : null,
    total: { numeros: numeros(t.numeros), resultado: txt(t.resultado) || null, resultado_rotulo: txt(t.resultado_rotulo) || "Resultados", misto: t.misto === true, por_resultado: porResultado(t.por_resultado) },
    objetivos: lista(r.objetivos)
      .map((x) => {
        const o = obj(x);
        return { objetivo: o.objetivo, rotulo: txt(o.rotulo), campanhas: num(o.campanhas) || 0, resultado: txt(o.resultado) || null, resultado_rotulo: txt(o.resultado_rotulo) || "Resultados", por_resultado: porResultado(o.por_resultado), numeros: numeros(o.numeros) };
      })
      .filter((o): o is TotalDoObjetivo => ehObjetivo(o.objetivo)),
    itens: lista(r.itens)
      .map((x) => {
        const o = obj(x);
        return {
          nivel: o.nivel as NivelDaMetrica,
          id: txt(o.id),
          nome: txt(o.nome) || txt(o.id),
          campanha: txt(o.campanha) || null,
          conjunto: txt(o.conjunto) || null,
          objetivo: ehObjetivo(o.objetivo) ? (o.objetivo as IdDoObjetivo) : null,
          resultado: txt(o.resultado) || null,
          resultado_rotulo: txt(o.resultado_rotulo) || "Resultados",
          numeros: numeros(o.numeros),
        };
      })
      .filter((i) => !!i.id),
    catalogo: lista(r.catalogo)
      .map((x) => {
        const o = obj(x);
        return { id: txt(o.id), rotulo: txt(o.rotulo), ajuda: txt(o.ajuda), formato: (FORMATOS.indexOf(o.formato) >= 0 ? o.formato : "inteiro") as FormatoDaMetrica, bomQuandoSobe: o.bomQuandoSobe !== false };
      })
      .filter((m) => !!m.id && !!m.rotulo),
    definicoes: lista(r.definicoes_de_objetivo)
      .map((x) => {
        const o = obj(x);
        return { id: o.id, rotulo: txt(o.rotulo), ajuda: txt(o.ajuda), resultado: txt(o.resultado), colunas: lista(o.colunas).map(txt).filter(Boolean) };
      })
      .filter((d): d is DefinicaoDoObjetivo => ehObjetivo(d.id)),
    colunasDeTodos: lista(r.colunas_de_todos).map(txt).filter(Boolean),
    avisos: lista(r.avisos).map(txt).filter(Boolean),
    lidoEm: txt(r.lido_em) || null,
  };
}

const faixas = (v: unknown): FaixaDoTempo[] =>
  lista(v).map((x) => {
    const o = obj(x);
    return {
      indice: num(o.indice) || 0,
      rotulo: txt(o.rotulo),
      gasto: num(o.gasto) || 0,
      impressoes: num(o.impressoes) || 0,
      cliques_link: num(o.cliques_link) || 0,
      conversas: num(o.conversas) || 0,
      leads: num(o.leads) || 0,
      compras: num(o.compras) || 0,
      resultados: num(o.resultados),
      custo_por_resultado: num(o.custo_por_resultado),
    };
  });

const melhor = (v: unknown): MelhorHorario => {
  const o = obj(v);
  const m = obj(o.melhor);
  const f = obj(o.faixa);
  return {
    melhor: txt(m.rotulo) ? { indice: num(m.indice) || 0, rotulo: txt(m.rotulo), valor: num(m.valor) || 0, custo: num(m.custo) } : null,
    faixa: txt(f.rotulo) ? { inicio: num(f.inicio) || 0, fim: num(f.fim) || 0, rotulo: txt(f.rotulo), valor: num(f.valor) || 0, pct: num(f.pct) || 0 } : null,
    pouco_volume: o.pouco_volume !== false,
  };
};

/** A resposta de metricas_por_hora na forma da tela. */
export function lerNoTempo(bruto: unknown): LeituraNoTempo {
  const r = obj(bruto);
  const m = obj(r.medida);
  const h = obj(r.hora);
  const d = obj(r.dia_da_semana);
  const chave = m.chave === "resultados" || m.chave === "conversas" ? m.chave : "cliques_link";
  return {
    fonte: r.fonte === "coleta" ? "coleta" : "meta_ao_vivo",
    medida: { chave, rotulo: txt(m.rotulo) || "Resultados" },
    hora: lista(h.faixas).length === 24 ? { faixas: faixas(h.faixas), melhor: melhor(h.melhor) } : null,
    diaDaSemana: lista(d.faixas).length === 7 ? { faixas: faixas(d.faixas), melhor: melhor(d.melhor) } : null,
    avisos: lista(r.avisos).map(txt).filter(Boolean),
  };
}

// ------------------------------------------------------------------ colunas

/** As colunas prontas do objetivo (Todos: as que valem para qualquer um). */
export function colunasPadrao(leitura: Pick<LeituraDasMetricas, "definicoes" | "colunasDeTodos">, objetivo: IdDoObjetivo | ""): string[] {
  if (!objetivo) return leitura.colunasDeTodos.slice();
  const d = leitura.definicoes.filter((x) => x.id === objetivo)[0];
  return d ? d.colunas.slice() : leitura.colunasDeTodos.slice();
}

/** As colunas escolhidas que o catálogo conhece, na ordem escolhida; nenhuma válida volta ao padrão. */
export function colunasValidas(escolhidas: string[] | null | undefined, catalogo: MetricaDoCatalogo[], padrao: string[]): string[] {
  const conhecidas = (escolhidas || []).filter((id, i, l) => catalogo.some((m) => m.id === id) && l.indexOf(id) === i);
  return conhecidas.length ? conhecidas : padrao.filter((id) => catalogo.some((m) => m.id === id));
}

/** Liga ou desliga uma coluna sem mudar a ordem das outras. */
export function alternarColuna(atuais: string[], id: string): string[] {
  return atuais.indexOf(id) >= 0 ? atuais.filter((x) => x !== id) : atuais.concat([id]);
}

/** Valor formatado como no Gerenciador ("-" quando a Meta não mediu). */
export function formatar(valor: number | null | undefined, formato: FormatoDaMetrica): string {
  if (formato === "brl") return brl(valor);
  if (formato === "pct") return porcento(valor);
  if (formato === "decimal") return decimal(valor);
  return inteiro(valor);
}

/** O número de uma métrica num item: "resultados" e "custo_por_resultado" seguem o resultado do item. */
export function valorDaColuna(n: Numeros, id: string): number | null {
  const v = n[id];
  return v === undefined ? null : v;
}

/** Rótulo da coluna "Resultados" quando todos os itens buscam o mesmo resultado (senão, "Resultados"). */
export function rotuloDosResultados(itens: { resultado: string | null; resultado_rotulo: string }[], padrao = "Resultados"): string {
  const r = itens.map((i) => i.resultado_rotulo).filter((x, i, l) => !!x && l.indexOf(x) === i);
  return r.length === 1 ? r[0] : padrao;
}

// ------------------------------------------------------------------ leitura

export const chaveDasMetricas = (clientId: string, periodo: PeriodoDaConsulta, nivel: NivelDaMetrica, objetivo: string) =>
  ["mesa", "ads-metricas", clientId, chaveDoPeriodo(periodo), nivel, objetivo] as const;
export const chaveDoTempo = (clientId: string, periodo: PeriodoDaConsulta, objetivo: string) => ["mesa", "ads-metricas-hora", clientId, chaveDoPeriodo(periodo), objetivo] as const;

export async function buscarMetricas(clientId: string, periodo: PeriodoDaConsulta, nivel: NivelDaMetrica, objetivo: IdDoObjetivo | "", aoVivo = false): Promise<LeituraDasMetricas> {
  const bruto = await chamarAds("metricas_meta", { client_id: clientId, nivel, objetivo: objetivo || undefined, ao_vivo: aoVivo || undefined, ...corpoDoPeriodo(periodo) });
  return lerMetricas(bruto);
}

export async function buscarNoTempo(clientId: string, periodo: PeriodoDaConsulta, objetivo: IdDoObjetivo | ""): Promise<LeituraNoTempo> {
  const bruto = await chamarAds("metricas_por_hora", { client_id: clientId, objetivo: objetivo || undefined, ...corpoDoPeriodo(periodo) });
  return lerNoTempo(bruto);
}
