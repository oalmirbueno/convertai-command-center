/**
 * Resultados claros da Mesa Ads (pedido do dono em 26/09/2026: "deixar mais
 * claro, está confuso"). Tudo puro e em código, a partir de conta_ao_vivo:
 * - o grupo do objetivo de cada anúncio (mensagem, vendas, cadastro, tráfego,
 *   engajamento, alcance) com o rótulo certo do resultado;
 * - as abas simples: Ativos agora, Melhores anúncios, Melhores criativos,
 *   Todos e Para descartar;
 * - o resumo do topo (investimento, resultado principal, custo por resultado
 *   e tendência) do objetivo escolhido;
 * - a peça: a mesma arte rodando em vários anúncios vira um criativo só.
 * "Melhor" compara o custo por resultado com a mediana do MESMO tipo de
 * resultado (custo por conversa não se compara com custo por clique).
 * Compatível com Safari 11 e Chrome 64.
 */
import { chamarAds, normalizarConta, type AnuncioAoVivo, type CampanhaAoVivo, type ContaAoVivo } from "./adsApi";
import { extrasDaConta, type ExtrasDaConta } from "./contaApi";

export type GrupoDeObjetivo = "mensagem" | "vendas" | "cadastro" | "trafego" | "engajamento" | "alcance";

export const GRUPOS_DE_OBJETIVO: { valor: GrupoDeObjetivo; rotulo: string; resultado: string; tipos: string[]; pertoDaVenda: boolean }[] = [
  { valor: "mensagem", rotulo: "Mensagem", resultado: "Conversas iniciadas", tipos: ["mensagens"], pertoDaVenda: true },
  { valor: "vendas", rotulo: "Vendas", resultado: "Compras", tipos: ["compras"], pertoDaVenda: true },
  { valor: "cadastro", rotulo: "Cadastro", resultado: "Cadastros", tipos: ["leads"], pertoDaVenda: true },
  { valor: "trafego", rotulo: "Tráfego", resultado: "Visitas e cliques", tipos: ["visitas", "cliques_link"], pertoDaVenda: false },
  { valor: "engajamento", rotulo: "Engajamento", resultado: "Engajamentos", tipos: ["engajamento", "video"], pertoDaVenda: false },
  { valor: "alcance", rotulo: "Alcance", resultado: "Pessoas alcançadas", tipos: ["alcance"], pertoDaVenda: false },
];

export const grupoDe = (v: string | null | undefined) => GRUPOS_DE_OBJETIVO.filter((g) => g.valor === v)[0] || null;

export function grupoDoTipo(tipo: string | null | undefined): GrupoDeObjetivo | null {
  if (!tipo) return null;
  const g = GRUPOS_DE_OBJETIVO.filter((x) => x.tipos.indexOf(tipo) >= 0)[0];
  return g ? g.valor : null;
}

export interface CriativoLigado {
  id: string;
  nome: string;
  origem: "ligado" | "mesma_peca";
}

export interface AnuncioDoResultado extends AnuncioAoVivo {
  grupo: GrupoDeObjetivo | null;
  resultado_tipo: string;
  resultado_rotulo: string;
  peca: string;
  criativo: CriativoLigado | null;
  formato: string;
  conjunto: string;
}

export interface CampanhaDoResultado extends CampanhaAoVivo {
  grupo: GrupoDeObjetivo | null;
  resultado_rotulo: string;
}

export interface MixDaConta {
  por_grupo: { grupo: GrupoDeObjetivo; rotulo: string; gasto: number; pct: number; resultados: number; custo_por_resultado: number | null; resultado_rotulo: string }[];
  perto_da_venda_pct: number;
  alertas: string[];
}

export interface Tendencia {
  gasto_pct: number | null;
  resultados_pct: number | null;
  custo_por_resultado_pct: number | null;
}

export interface ResultadosDaConta {
  conta: ContaAoVivo;
  anuncios: AnuncioDoResultado[];
  campanhas: CampanhaDoResultado[];
  mix: MixDaConta | null;
  tendencia: Tendencia | null;
  resultado_rotulo: string;
}

const lista = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
const txt = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};

/** Grupo pelo que o servidor mandou; sem ele (resposta velha), pelo tipo de resultado. */
function grupoDaLinha(o: Record<string, any>): GrupoDeObjetivo | null {
  const g = txt(o.grupo);
  if (grupoDe(g)) return g as GrupoDeObjetivo;
  return grupoDoTipo(txt(obj(o.metricas).resultado_tipo));
}

/** conta_ao_vivo inteiro (resposta nova ou velha) na forma das telas de resultado. */
export function lerResultadosDaConta(bruto: unknown): ResultadosDaConta {
  const r = obj(bruto);
  const conta = normalizarConta(bruto);
  const brutosPorId: Record<string, Record<string, any>> = {};
  lista(r.anuncios).forEach((a) => {
    const o = obj(a);
    const id = txt(o.ad_id) || txt(o.id);
    if (id) brutosPorId[id] = o;
  });
  const anuncios: AnuncioDoResultado[] = conta.anuncios.map((a) => {
    const o = brutosPorId[a.ad_id] || {};
    const m = obj(o.metricas);
    const c = obj(o.criativo);
    const grupo = grupoDaLinha(o);
    return {
      ...a,
      grupo,
      resultado_tipo: txt(m.resultado_tipo),
      resultado_rotulo: txt(m.resultado_rotulo) || (grupo ? grupoDe(grupo)!.resultado : "Resultados"),
      peca: txt(o.peca) || `ad:${a.ad_id}`,
      criativo: txt(c.id) ? { id: txt(c.id), nome: txt(c.nome) || "Criativo da Mesa Ads", origem: c.origem === "mesma_peca" ? "mesma_peca" : "ligado" } : null,
      formato: txt(o.formato),
      conjunto: txt(o.conjunto),
    };
  });
  const campanhasBrutas: Record<string, Record<string, any>> = {};
  lista(r.campanhas).forEach((c) => {
    const o = obj(c);
    if (txt(o.campaign_id)) campanhasBrutas[txt(o.campaign_id)] = o;
  });
  const campanhas: CampanhaDoResultado[] = conta.campanhas.map((c) => {
    const o = campanhasBrutas[c.campaign_id] || {};
    return { ...c, grupo: grupoDaLinha(o), resultado_rotulo: txt(obj(o.metricas).resultado_rotulo) || "Resultados" };
  });
  const mixBruto = obj(r.mix_objetivos);
  const mix: MixDaConta | null = Object.keys(mixBruto).length
    ? {
        por_grupo: lista(mixBruto.por_grupo)
          .map((g) => {
            const o = obj(g);
            return {
              grupo: txt(o.grupo) as GrupoDeObjetivo,
              rotulo: txt(o.rotulo),
              gasto: num(o.gasto) || 0,
              pct: num(o.pct) || 0,
              resultados: num(o.resultados) || 0,
              custo_por_resultado: num(o.custo_por_resultado),
              resultado_rotulo: txt(o.resultado_rotulo),
            };
          })
          .filter((g) => !!grupoDe(g.grupo)),
        perto_da_venda_pct: num(mixBruto.perto_da_venda_pct) || 0,
        alertas: lista(mixBruto.alertas).map(txt).filter(Boolean),
      }
    : null;
  const cmp = obj(r.comparacao);
  const tendencia: Tendencia | null = Object.keys(cmp).length
    ? { gasto_pct: num(cmp.gasto_pct), resultados_pct: num(cmp.resultados_pct), custo_por_resultado_pct: num(cmp.custo_por_resultado_pct) }
    : null;
  return {
    conta,
    anuncios,
    campanhas,
    mix,
    tendencia,
    resultado_rotulo: txt(obj(r.totais).resultado_rotulo) || txt(obj(r.resultado_principal).rotulo) || "Resultados",
  };
}

// ------------------------------------------------------------------ filtros e abas

export type AbaDeResultado = "ativos" | "melhores_anuncios" | "melhores_criativos" | "todos" | "descartar";

export const ABAS_DE_RESULTADO: { valor: AbaDeResultado; rotulo: string; dica: string }[] = [
  { valor: "ativos", rotulo: "Ativos agora", dica: "O que está rodando agora, do maior investimento para o menor." },
  { valor: "melhores_anuncios", rotulo: "Melhores anúncios", dica: "Custo por resultado abaixo da mediana do mesmo objetivo, com volume para confiar." },
  { valor: "melhores_criativos", rotulo: "Melhores criativos", dica: "A mesma arte somada em todos os anúncios em que roda." },
  { valor: "todos", rotulo: "Todos", dica: "Todos os anúncios do período." },
  { valor: "descartar", rotulo: "Para descartar", dica: "Gastam sem resultado ou muito acima do custo de referência (regra em código)." },
];

export const filtrarPorGrupo = <T extends { grupo: GrupoDeObjetivo | null }>(itens: T[], grupo: GrupoDeObjetivo | ""): T[] =>
  grupo ? itens.filter((a) => a.grupo === grupo) : itens;

/** Grupos que existem nos anúncios, com a contagem, na ordem de GRUPOS_DE_OBJETIVO. */
export function gruposPresentes(anuncios: { grupo: GrupoDeObjetivo | null }[]): { valor: GrupoDeObjetivo; rotulo: string; quantos: number }[] {
  return GRUPOS_DE_OBJETIVO.map((g) => ({ valor: g.valor, rotulo: g.rotulo, quantos: anuncios.filter((a) => a.grupo === g.valor).length })).filter((g) => g.quantos > 0);
}

const mediana = (valores: number[]): number | null => {
  if (!valores.length) return null;
  const v = valores.slice().sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/** Mediana do custo por resultado por tipo de resultado (só quem tem resultado). */
export function medianasPorTipo(itens: { resultado_tipo: string; metricas: { resultados: number | null; custo_por_resultado: number | null } }[]): Record<string, number> {
  const porTipo: Record<string, number[]> = {};
  itens.forEach((a) => {
    const c = a.metricas.custo_por_resultado;
    if (!a.resultado_tipo || !(a.metricas.resultados && a.metricas.resultados > 0) || c === null || !(c > 0)) return;
    (porTipo[a.resultado_tipo] = porTipo[a.resultado_tipo] || []).push(c);
  });
  const saida: Record<string, number> = {};
  Object.keys(porTipo).forEach((k) => {
    const m = mediana(porTipo[k]);
    if (m !== null) saida[k] = m;
  });
  return saida;
}

/** Volume mínimo para chamar de "melhor": 3 resultados ou 1.000 impressões com resultado. */
export const temVolume = (m: { resultados: number | null; impressoes: number | null }) =>
  !!m.resultados && m.resultados > 0 && ((m.resultados || 0) >= 3 || (m.impressoes || 0) >= 1000);

/** Índice de custo: custo por resultado dividido pela mediana do tipo (1 = na média; menor é melhor). */
export function indiceDeCusto(a: { resultado_tipo: string; metricas: { custo_por_resultado: number | null } }, medianas: Record<string, number>): number | null {
  const m = medianas[a.resultado_tipo];
  const c = a.metricas.custo_por_resultado;
  return m && c !== null && c > 0 ? Math.round((c / m) * 100) / 100 : null;
}

const porGasto = (a: { metricas: { gasto: number | null } }, b: { metricas: { gasto: number | null } }) => (b.metricas.gasto || 0) - (a.metricas.gasto || 0);

/** Os anúncios de cada aba (menos Melhores criativos, que agrupa por peça). */
export function anunciosDaAba(anuncios: AnuncioDoResultado[], aba: AbaDeResultado): AnuncioDoResultado[] {
  if (aba === "ativos") return anuncios.filter((a) => String(a.status).toUpperCase() === "ACTIVE").sort(porGasto);
  if (aba === "descartar") return anuncios.filter((a) => a.sinal === "pausar").sort(porGasto);
  if (aba === "melhores_anuncios") {
    const medianas = medianasPorTipo(anuncios);
    return anuncios
      .filter((a) => temVolume(a.metricas) && indiceDeCusto(a, medianas) !== null && (indiceDeCusto(a, medianas) as number) <= 1)
      .sort((a, b) => (indiceDeCusto(a, medianas) as number) - (indiceDeCusto(b, medianas) as number) || porGasto(a, b));
  }
  return anuncios.slice().sort(porGasto);
}

export interface PecaAgrupada {
  peca: string;
  nome: string;
  imagem_url: string | null;
  anuncios: AnuncioDoResultado[];
  ativos: number;
  criativo: CriativoLigado | null;
  grupo: GrupoDeObjetivo | null;
  resultado_tipo: string;
  resultado_rotulo: string;
  metricas: { gasto: number; impressoes: number; resultados: number; custo_por_resultado: number | null };
  indice: number | null;
}

/**
 * A mesma arte em vários anúncios vira uma peça, somada por tipo de
 * resultado (a peça que roda em mensagem e em engajamento aparece nas duas).
 * Ordem: índice de custo (com volume) e depois gasto.
 */
export function criativosAgrupados(anuncios: AnuncioDoResultado[]): PecaAgrupada[] {
  const grupos: Record<string, AnuncioDoResultado[]> = {};
  const ordem: string[] = [];
  anuncios.forEach((a) => {
    const k = `${a.peca}|${a.resultado_tipo}`;
    if (!grupos[k]) {
      grupos[k] = [];
      ordem.push(k);
    }
    grupos[k].push(a);
  });
  const pecas: PecaAgrupada[] = ordem.map((k) => {
    const l = grupos[k].slice().sort(porGasto);
    const gasto = l.reduce((s, a) => s + (a.metricas.gasto || 0), 0);
    const impressoes = l.reduce((s, a) => s + (a.metricas.impressoes || 0), 0);
    const resultados = l.reduce((s, a) => s + (a.metricas.resultados || 0), 0);
    const comCriativo = l.filter((a) => !!a.criativo)[0];
    const principal = l[0];
    return {
      peca: principal.peca,
      nome: comCriativo && comCriativo.criativo ? comCriativo.criativo.nome : principal.nome,
      imagem_url: (l.filter((a) => !!a.imagem_url)[0] || principal).imagem_url,
      anuncios: l,
      ativos: l.filter((a) => String(a.status).toUpperCase() === "ACTIVE").length,
      criativo: comCriativo ? comCriativo.criativo : null,
      grupo: principal.grupo,
      resultado_tipo: principal.resultado_tipo,
      resultado_rotulo: principal.resultado_rotulo,
      metricas: {
        gasto: Math.round(gasto * 100) / 100,
        impressoes,
        resultados,
        custo_por_resultado: resultados > 0 ? Math.round((gasto / resultados) * 100) / 100 : null,
      },
      indice: null,
    };
  });
  const medianas = medianasPorTipo(pecas);
  pecas.forEach((p) => {
    p.indice = temVolume(p.metricas) ? indiceDeCusto(p, medianas) : null;
  });
  return pecas.sort((a, b) => {
    if (a.indice !== null && b.indice !== null) return a.indice - b.indice || b.metricas.gasto - a.metricas.gasto;
    if (a.indice !== null) return -1;
    if (b.indice !== null) return 1;
    return b.metricas.gasto - a.metricas.gasto;
  });
}

// ------------------------------------------------------------------ resumo do topo

export interface ResumoDoTopo {
  investimento: number;
  resultados: number | null;
  rotulo: string;
  custo_por_resultado: number | null;
  tendencia: Tendencia | null;
  ativos: number;
  anuncios: number;
  /** Com vários objetivos misturados, o resultado não soma: a tela pede para escolher um. */
  misturado: boolean;
}

/**
 * Resumo do objetivo escolhido (ou da conta toda). A conta toda usa o
 * resultado principal do servidor; com um objetivo, soma só os anúncios dele.
 * A tendência (comparação com o período anterior) só existe para a conta toda.
 */
export function resumoDoTopo(dados: ResultadosDaConta, grupo: GrupoDeObjetivo | ""): ResumoDoTopo {
  const itens = filtrarPorGrupo(dados.anuncios, grupo);
  const ativos = itens.filter((a) => String(a.status).toUpperCase() === "ACTIVE").length;
  if (!grupo) {
    const t = dados.conta.totais;
    const tipos = gruposPresentes(dados.anuncios).length;
    return {
      investimento: t.gasto || 0,
      resultados: t.resultados,
      rotulo: dados.resultado_rotulo,
      custo_por_resultado: t.custo_por_resultado,
      tendencia: dados.tendencia,
      ativos,
      anuncios: itens.length,
      misturado: tipos > 1,
    };
  }
  const investimento = Math.round(itens.reduce((s, a) => s + (a.metricas.gasto || 0), 0) * 100) / 100;
  const resultados = itens.reduce((s, a) => s + (a.metricas.resultados || 0), 0);
  const g = grupoDe(grupo)!;
  const rotulos = itens.map((a) => a.resultado_rotulo).filter((x, i, l) => !!x && l.indexOf(x) === i);
  return {
    investimento,
    resultados,
    rotulo: rotulos.length === 1 ? rotulos[0] : g.resultado,
    custo_por_resultado: resultados > 0 ? Math.round((investimento / resultados) * (grupo === "alcance" ? 10000 : 100)) / (grupo === "alcance" ? 10000 : 100) : null,
    tendencia: null,
    ativos,
    anuncios: itens.length,
    misturado: false,
  };
}

// ------------------------------------------------------------------ leitura

/** Chave própria (o formato é outro que o da chave "ads-conta"); traz links que vencem: fora do cache do navegador. */
export const chaveDosResultados = (clientId: string, dias: number) => ["mesa", "urls", "ads-resultados", clientId, dias] as const;

export type ContaComResultados = ResultadosDaConta & { extras: ExtrasDaConta };

/** conta_ao_vivo lida uma vez para as abas Conta e Resultados (só JSON: vai para o cache). */
export async function lerContaComResultados(clientId: string, dias: number): Promise<ContaComResultados> {
  const bruto = await chamarAds("conta_ao_vivo", { client_id: clientId, dias });
  return { ...lerResultadosDaConta(bruto), extras: extrasDaConta(bruto) };
}
