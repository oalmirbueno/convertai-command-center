/**
 * Conta de anúncios, desempenho do cliente e evolução (Mesa Ads v4, frente E).
 *
 * Tipos e normalizadores das partes novas de conta_ao_vivo (saldo da conta,
 * comparação com o período anterior, série diária, conjuntos) e das ações
 * desempenho_cliente e evolucao. Arquivo próprio para não misturar com o
 * resto de adsApi.ts, que outras abas usam. Normalização tolerante: resposta
 * velha (sem os campos novos) vira lista vazia ou null, nunca erro.
 */
import { chamarAds } from "./adsApi";

export const PERIODOS_DA_CONTA_V4 = [7, 14, 30, 60, 90] as const;
export type PeriodoDaConta = (typeof PERIODOS_DA_CONTA_V4)[number];

const lista = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
const txt = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
export const numOuNada = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};

// ------------------------------------------------------------------ conta (partes novas)

export interface SaldoDaConta {
  external_account_id: string;
  nome: string;
  numero: string;
  moeda: string;
  status: string;
  gasto_total: number | null;
  saldo_a_pagar: number | null;
  limite_de_gasto: number | null;
  restante_do_limite: number | null;
  saldo_disponivel: number | null;
  pre_paga: boolean | null;
  pagamento: string;
  empresa: string;
  coletado_em: string | null;
  erro: string;
}

export interface Comparacao {
  gasto_pct: number | null;
  resultados_pct: number | null;
  custo_por_resultado_pct: number | null;
  ctr_link_pct: number | null;
  cpm_pct: number | null;
  alcance_pct: number | null;
}

export interface PontoDaConta {
  dia: string;
  gasto: number;
  resultados: number;
  cliques_link: number;
  custo_por_resultado: number | null;
}

export interface ExtrasDaConta {
  contas: SaldoDaConta[];
  comparacao: Comparacao | null;
  serie: PontoDaConta[];
  resultado_rotulo: string;
  roas: number | null;
  valor_conversao: number | null;
  alcance: number | null;
  cpc_link: number | null;
  /** Rótulo do resultado por anúncio e por campanha (ad_id/campaign_id). */
  rotuloPorId: Record<string, string>;
  formatoPorAd: Record<string, string>;
  conjuntoPorAd: Record<string, string>;
}

export function normalizarSaldo(bruto: unknown): SaldoDaConta {
  const c = obj(bruto);
  return {
    external_account_id: txt(c.external_account_id),
    nome: txt(c.nome),
    numero: txt(c.numero),
    moeda: txt(c.moeda),
    status: txt(c.status),
    gasto_total: numOuNada(c.gasto_total),
    saldo_a_pagar: numOuNada(c.saldo_a_pagar),
    limite_de_gasto: numOuNada(c.limite_de_gasto),
    restante_do_limite: numOuNada(c.restante_do_limite),
    saldo_disponivel: numOuNada(c.saldo_disponivel),
    pre_paga: typeof c.pre_paga === "boolean" ? c.pre_paga : null,
    pagamento: txt(c.pagamento),
    empresa: txt(c.empresa),
    coletado_em: c.coletado_em ? String(c.coletado_em) : null,
    erro: txt(c.erro),
  };
}

/** As partes novas da resposta de conta_ao_vivo (a parte antiga continua em normalizarConta). */
export function extrasDaConta(bruto: unknown): ExtrasDaConta {
  const r = obj(bruto);
  const t = obj(r.totais);
  const c = obj(r.comparacao);
  const temComparacao = Object.keys(c).length > 0;
  const rotuloPorId: Record<string, string> = {};
  const formatoPorAd: Record<string, string> = {};
  const conjuntoPorAd: Record<string, string> = {};
  for (const a of lista(r.anuncios)) {
    const o = obj(a);
    const id = txt(o.ad_id);
    if (!id) continue;
    const rot = txt(obj(o.metricas).resultado_rotulo);
    if (rot) rotuloPorId[id] = rot;
    if (txt(o.formato)) formatoPorAd[id] = txt(o.formato);
    if (txt(o.conjunto)) conjuntoPorAd[id] = txt(o.conjunto);
  }
  for (const k of lista(r.campanhas)) {
    const o = obj(k);
    const rot = txt(obj(o.metricas).resultado_rotulo);
    if (txt(o.campaign_id) && rot) rotuloPorId[txt(o.campaign_id)] = rot;
  }
  return {
    contas: lista(r.contas).map(normalizarSaldo).filter((x) => !!x.external_account_id),
    comparacao: temComparacao
      ? {
          gasto_pct: numOuNada(c.gasto_pct),
          resultados_pct: numOuNada(c.resultados_pct),
          custo_por_resultado_pct: numOuNada(c.custo_por_resultado_pct),
          ctr_link_pct: numOuNada(c.ctr_link_pct),
          cpm_pct: numOuNada(c.cpm_pct),
          alcance_pct: numOuNada(c.alcance_pct),
        }
      : null,
    serie: lista(r.serie).map((p) => {
      const o = obj(p);
      return {
        dia: txt(o.dia),
        gasto: numOuNada(o.gasto) || 0,
        resultados: numOuNada(o.resultados) || 0,
        cliques_link: numOuNada(o.cliques_link) || 0,
        custo_por_resultado: numOuNada(o.custo_por_resultado),
      };
    }).filter((p) => !!p.dia),
    resultado_rotulo: txt(t.resultado_rotulo) || txt(obj(r.resultado_principal).rotulo) || "Resultados",
    roas: numOuNada(t.roas),
    valor_conversao: numOuNada(t.valor_conversao),
    alcance: numOuNada(t.alcance),
    cpc_link: numOuNada(t.cpc_link),
    rotuloPorId,
    formatoPorAd,
    conjuntoPorAd,
  };
}

// ------------------------------------------------------------------ evolução

export type CanalDaEvolucao = "anuncios" | "organico";

export interface ItemDaEvolucao {
  id: string;
  canal: CanalDaEvolucao;
  nome: string;
  imagem_url: string | null;
  link: string | null;
  motivo: string;
  numeros: Record<string, number | string | null>;
}

export interface TesteDaEvolucao {
  titulo: string;
  canal: CanalDaEvolucao;
  hipotese: string;
  como: string;
  metrica: string;
  criterio: string;
  base_id: string | null;
}

export interface AprendizadoDaEvolucao {
  canal: CanalDaEvolucao;
  tipo: "repetir" | "evitar";
  texto: string;
}

export interface LeituraDaEvolucao {
  periodo: { inicio: string; fim: string } | null;
  vencedores: ItemDaEvolucao[];
  manter: ItemDaEvolucao[];
  descartar: ItemDaEvolucao[];
  observar: ItemDaEvolucao[];
  destaques: ItemDaEvolucao[];
  abaixo: ItemDaEvolucao[];
  sinais: ItemDaEvolucao[];
  proximos_testes: TesteDaEvolucao[];
  aprendizados: AprendizadoDaEvolucao[];
  limites: string[];
  explicacao: { resumo: string; porItem: Record<string, string>; atencao: string[] } | null;
  memorias: { gravadas: number; repetidas: number; erro: string };
  custo_usd: number;
}

const canalDe = (v: unknown): CanalDaEvolucao => (v === "organico" ? "organico" : "anuncios");

function itens(v: unknown): ItemDaEvolucao[] {
  return lista(v)
    .map((x) => {
      const o = obj(x);
      const numeros: Record<string, number | string | null> = {};
      const n = obj(o.numeros);
      for (const k of Object.keys(n)) {
        const val = n[k];
        numeros[k] = typeof val === "number" || typeof val === "string" ? val : null;
      }
      return {
        id: txt(o.id),
        canal: canalDe(o.canal),
        nome: txt(o.nome) || "Sem nome",
        imagem_url: txt(o.imagem_url) || null,
        link: txt(o.link) || null,
        motivo: txt(o.motivo),
        numeros,
      };
    })
    .filter((i) => !!i.id);
}

export function normalizarEvolucao(bruto: unknown): LeituraDaEvolucao {
  const r = obj(bruto);
  const l = obj(r.leitura);
  const conteudo = obj(l.conteudo);
  const p = obj(l.periodo);
  const e = obj(r.explicacao);
  const porItem: Record<string, string> = {};
  for (const x of lista(e.por_item)) {
    const o = obj(x);
    if (txt(o.id) && txt(o.explicacao)) porItem[txt(o.id)] = txt(o.explicacao);
  }
  const m = obj(r.memorias);
  return {
    periodo: p.inicio && p.fim ? { inicio: txt(p.inicio), fim: txt(p.fim) } : null,
    vencedores: itens(l.vencedores),
    manter: itens(l.manter),
    descartar: itens(l.descartar),
    observar: itens(l.observar),
    destaques: itens(conteudo.destaques),
    abaixo: itens(conteudo.abaixo),
    sinais: itens(conteudo.sinais),
    proximos_testes: lista(l.proximos_testes)
      .map((x) => {
        const o = obj(x);
        return {
          titulo: txt(o.titulo),
          canal: canalDe(o.canal),
          hipotese: txt(o.hipotese),
          como: txt(o.como),
          metrica: txt(o.metrica),
          criterio: txt(o.criterio),
          base_id: txt(o.base_id) || null,
        };
      })
      .filter((t) => !!t.titulo),
    aprendizados: lista(l.aprendizados)
      .map((x) => {
        const o = obj(x);
        return { canal: canalDe(o.canal), tipo: (o.tipo === "evitar" ? "evitar" : "repetir") as "repetir" | "evitar", texto: txt(o.texto) };
      })
      .filter((a) => !!a.texto),
    limites: lista(l.limites).map(txt).filter(Boolean),
    explicacao: Object.keys(e).length
      ? { resumo: txt(e.resumo), porItem, atencao: lista(e.atencao).map(txt).filter(Boolean) }
      : null,
    memorias: { gravadas: numOuNada(m.gravadas) || 0, repetidas: numOuNada(m.repetidas) || 0, erro: txt(m.erro) },
    custo_usd: numOuNada(r.custo_usd) || 0,
  };
}

export const evolucaoVazia = (l: LeituraDaEvolucao) =>
  !l.vencedores.length && !l.manter.length && !l.descartar.length && !l.observar.length && !l.destaques.length && !l.abaixo.length && !l.sinais.length;

export async function lerEvolucao(clientId: string, dias: number, explicar = false): Promise<LeituraDaEvolucao> {
  return normalizarEvolucao(await chamarAds("evolucao", { client_id: clientId, dias, explicar }));
}

// ------------------------------------------------------------------ desempenho do cliente

export interface DesempenhoDoCliente {
  periodo: { inicio: string; fim: string } | null;
  organico: {
    alcance_semanas: number | null;
    interacoes: number;
    curtidas: number;
    comentarios: number;
    salvos: number;
    compartilhamentos: number;
    posts: number;
    posts_medidos: number;
    seguidores: number | null;
    seguidores_variacao: number | null;
    melhores: { id: string; legenda: string; imagem_url: string | null; link: string | null; alcance: number | null; curtidas: number | null; comentarios: number | null; salvos: number | null; compartilhamentos: number | null; formato: string }[];
  };
  anuncios: { gasto: number; resultados: number; resultado_rotulo: string; custo_por_resultado: number | null; alcance: number | null; roas: number | null; conectada: boolean };
  somado: { alcance_aprox: number | null; interacoes: number; investimento: number; explicacao: string };
}

export function normalizarDesempenho(bruto: unknown): DesempenhoDoCliente | null {
  const r = obj(bruto);
  if (!r.organico && !r.anuncios) return null;
  const o = obj(r.organico);
  const tot = obj(o.totais);
  const a = obj(r.anuncios);
  const at = obj(a.totais);
  const s = obj(r.somado);
  const p = obj(r.periodo);
  const contas = lista(o.contas).map(obj);
  const seguidores = contas.reduce((t: number | null, c) => (numOuNada(c.seguidores) === null ? t : (t || 0) + (numOuNada(c.seguidores) || 0)), null);
  const variacao = contas.reduce((t: number | null, c) => (numOuNada(c.seguidores_variacao) === null ? t : (t || 0) + (numOuNada(c.seguidores_variacao) || 0)), null);
  return {
    periodo: p.inicio && p.fim ? { inicio: txt(p.inicio), fim: txt(p.fim) } : null,
    organico: {
      alcance_semanas: numOuNada(tot.alcance_semanas),
      interacoes: numOuNada(tot.interacoes) || 0,
      curtidas: numOuNada(tot.curtidas) || 0,
      comentarios: numOuNada(tot.comentarios) || 0,
      salvos: numOuNada(tot.salvos) || 0,
      compartilhamentos: numOuNada(tot.compartilhamentos) || 0,
      posts: numOuNada(tot.posts) || 0,
      posts_medidos: numOuNada(tot.posts_medidos) || 0,
      seguidores,
      seguidores_variacao: variacao,
      melhores: lista(o.melhores_posts).map((x) => {
        const q = obj(x);
        return {
          id: txt(q.media_id),
          legenda: txt(q.caption),
          imagem_url: txt(q.imagem_url) || null,
          link: txt(q.permalink) || null,
          alcance: numOuNada(q.reach),
          curtidas: numOuNada(q.like_count),
          comentarios: numOuNada(q.comments_count),
          salvos: numOuNada(q.saved),
          compartilhamentos: numOuNada(q.shares),
          formato: txt(q.media_type),
        };
      }).filter((x) => !!x.id),
    },
    anuncios: {
      gasto: numOuNada(at.gasto) || 0,
      resultados: numOuNada(at.resultados) || 0,
      resultado_rotulo: txt(at.resultado_rotulo) || "Resultados",
      custo_por_resultado: numOuNada(at.custo_por_resultado),
      alcance: numOuNada(at.alcance_aprox),
      roas: numOuNada(at.roas),
      conectada: a.conectada !== false,
    },
    somado: {
      alcance_aprox: numOuNada(s.alcance_aprox),
      interacoes: numOuNada(s.interacoes) || 0,
      investimento: numOuNada(s.investimento) || 0,
      explicacao: txt(s.explicacao),
    },
  };
}

export async function lerDesempenho(clientId: string, dias: number): Promise<DesempenhoDoCliente | null> {
  return normalizarDesempenho(await chamarAds("desempenho_cliente", { client_id: clientId, dias }));
}

export const chavesConta = {
  evolucao: (clientId: string, dias: number) => ["mesa", "urls", "ads-evolucao", clientId, dias] as const,
  desempenho: (clientId: string, dias: number) => ["mesa", "urls", "ads-desempenho", clientId, dias] as const,
};
