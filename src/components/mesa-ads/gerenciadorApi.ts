/**
 * Gerenciador ao vivo (frente AD, 28/09): tipos, normalização tolerante e as
 * chamadas gerenciador_ler e gerenciador_acao da mesa-ads. O servidor lê a
 * Meta na hora (status, entrega, verba, gasto de hoje) e junta os números do
 * período; a tela só mostra, filtra e pede as ações (pausar, ativar, verba,
 * renomear), que passam pelo mesmo caminho do agente (relê, faz, relê de novo).
 */
import { chamarAds } from "./adsApi";

export type NivelNoGerenciador = "campanha" | "conjunto" | "anuncio";
export type EstadoDaEntrega = "entregando" | "ativo_sem_entrega" | "ativo" | "pausado" | "em_analise" | "reprovado" | "com_problema" | "encerrado" | "conta_travada";
export type FiltroDoGerenciador = "entregando" | "ativos" | "todos";

export interface MetricasNoGerenciador {
  gasto: number;
  impressoes: number;
  resultados: number;
  resultado_rotulo: string;
  custo_por_resultado: number | null;
  ctr_link: number | null;
  cpm: number | null;
  frequencia: number | null;
}

export interface MarcaNoGerenciador {
  acao_id: string;
  origem: "rotina" | "agente" | "equipe";
  tipo: string;
  estado: "feita" | "falhou" | "desfeita";
  resumo: string;
  quando: string;
  pode_desfazer: boolean;
}

export interface NoNoGerenciador {
  nivel: NivelNoGerenciador;
  id: string;
  nome: string;
  conta: string;
  campaign_id: string | null;
  adset_id: string | null;
  status: string | null;
  efetivo: string | null;
  entrega: { estado: EstadoDaEntrega; rotulo: string; motivo: string | null };
  objetivo: string | null;
  otimizacao: string | null;
  orcamento_diario_brl: number | null;
  orcamento_total_brl: number | null;
  metricas: MetricasNoGerenciador | null;
  hoje: { gasto: number; impressoes: number } | null;
  link_meta: string;
  marca: MarcaNoGerenciador | null;
  filhos: NoNoGerenciador[];
}

export interface ContaNaTela {
  id: string;
  nome: string;
  moeda: string | null;
  situacao: { codigo: number | null; rotulo: string; travada: boolean; motivo: string | null; o_que_fazer: string | null };
  saldo_a_pagar_brl: number | null;
  gasto_total_brl: number | null;
  link_meta: string;
  link_cobranca: string;
  fonte: "meta_ao_vivo" | "coleta";
  lido_em: string | null;
  aviso: string | null;
}

export interface PlataformaNaTela {
  id: string;
  nome: string;
  conectada: boolean;
  lida: boolean;
  motivo: string | null;
}

export interface ResumoNaTela {
  campanhas: number;
  campanhas_ativas: number;
  campanhas_entregando: number;
  conjuntos_ativos: number;
  anuncios: number;
  anuncios_ativos: number;
  anuncios_entregando: number;
  anuncios_com_problema: number;
  gasto_hoje: number | null;
  impressoes_hoje: number | null;
  gasto_periodo: number;
  resultados_periodo: number;
  alertas: string[];
}

export interface LeituraDoGerenciador {
  plataformas: PlataformaNaTela[];
  contas: ContaNaTela[];
  campanhas: NoNoGerenciador[];
  resumo: ResumoNaTela;
  periodo: { inicio: string; fim: string; dias: number } | null;
  fonte: "meta_ao_vivo" | "misto" | "coleta";
  lido_em: string | null;
  sincronizado_em: string | null;
  gestao: { disponivel: boolean; motivo: string | null } | null;
  avisos: string[];
  gravada_em: string | null;
}

const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
const lista = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || typeof v === "boolean" || !isFinite(Number(v)) ? null : Number(v));
const ESTADOS: EstadoDaEntrega[] = ["entregando", "ativo_sem_entrega", "ativo", "pausado", "em_analise", "reprovado", "com_problema", "encerrado", "conta_travada"];
const NIVEIS: NivelNoGerenciador[] = ["campanha", "conjunto", "anuncio"];
const ORIGENS = ["rotina", "agente", "equipe"];

function metricas(v: unknown): MetricasNoGerenciador | null {
  const m = obj(v);
  if (!Object.keys(m).length) return null;
  return {
    gasto: num(m.gasto) || 0,
    impressoes: num(m.impressoes) || 0,
    resultados: num(m.resultados) || 0,
    resultado_rotulo: txt(m.resultado_rotulo) || "Resultados",
    custo_por_resultado: num(m.custo_por_resultado),
    ctr_link: num(m.ctr_link),
    cpm: num(m.cpm),
    frequencia: num(m.frequencia),
  };
}

function marca(v: unknown): MarcaNoGerenciador | null {
  const m = obj(v);
  if (!txt(m.acao_id) || !txt(m.resumo)) return null;
  const estado = m.estado === "falhou" || m.estado === "desfeita" ? m.estado : "feita";
  return {
    acao_id: txt(m.acao_id),
    origem: (ORIGENS.indexOf(m.origem) >= 0 ? m.origem : "agente") as MarcaNoGerenciador["origem"],
    tipo: txt(m.tipo),
    estado,
    resumo: txt(m.resumo),
    quando: txt(m.quando),
    pode_desfazer: !!m.pode_desfazer,
  };
}

function no(v: unknown, profundidade = 0): NoNoGerenciador | null {
  const n = obj(v);
  if (!txt(n.id)) return null;
  const e = obj(n.entrega);
  const hoje = obj(n.hoje);
  return {
    nivel: (NIVEIS.indexOf(n.nivel) >= 0 ? n.nivel : "campanha") as NivelNoGerenciador,
    id: txt(n.id),
    nome: txt(n.nome) || txt(n.id),
    conta: txt(n.conta),
    campaign_id: txt(n.campaign_id) || null,
    adset_id: txt(n.adset_id) || null,
    status: txt(n.status) || null,
    efetivo: txt(n.efetivo) || null,
    entrega: {
      estado: (ESTADOS.indexOf(e.estado) >= 0 ? e.estado : "pausado") as EstadoDaEntrega,
      rotulo: txt(e.rotulo) || "Sem status",
      motivo: txt(e.motivo) || null,
    },
    objetivo: txt(n.objetivo) || null,
    otimizacao: txt(n.otimizacao) || null,
    orcamento_diario_brl: num(n.orcamento_diario_brl),
    orcamento_total_brl: num(n.orcamento_total_brl),
    metricas: metricas(n.metricas),
    hoje: Object.keys(hoje).length ? { gasto: num(hoje.gasto) || 0, impressoes: num(hoje.impressoes) || 0 } : null,
    link_meta: /^https:\/\/(business|www)\.facebook\.com\//.test(txt(n.link_meta)) ? txt(n.link_meta) : "",
    marca: marca(n.marca),
    filhos: profundidade < 2 ? lista(n.filhos).map((f) => no(f, profundidade + 1)).filter((f): f is NoNoGerenciador => !!f) : [],
  };
}

const RESUMO_VAZIO: ResumoNaTela = {
  campanhas: 0, campanhas_ativas: 0, campanhas_entregando: 0, conjuntos_ativos: 0, anuncios: 0, anuncios_ativos: 0,
  anuncios_entregando: 0, anuncios_com_problema: 0, gasto_hoje: null, impressoes_hoje: null, gasto_periodo: 0, resultados_periodo: 0, alertas: [],
};

/** Resposta de gerenciador_ler, tolerante (servidor antigo ou campo faltando vira vazio, nunca erro). */
export function normalizarGerenciador(bruto: unknown): LeituraDoGerenciador {
  const r = obj(bruto);
  const res = obj(r.resumo);
  const p = obj(r.periodo);
  const g = r.gestao ? obj(r.gestao) : null;
  const resumo: ResumoNaTela = { ...RESUMO_VAZIO };
  (Object.keys(RESUMO_VAZIO) as (keyof ResumoNaTela)[]).forEach((k) => {
    if (k === "alertas") resumo.alertas = lista(res.alertas).map(txt).filter(Boolean);
    else if (k === "gasto_hoje" || k === "impressoes_hoje") resumo[k] = num(res[k]);
    else (resumo as any)[k] = num(res[k]) || 0;
  });
  return {
    plataformas: lista(r.plataformas).map((x) => {
      const o = obj(x);
      return { id: txt(o.id), nome: txt(o.nome), conectada: !!o.conectada, lida: !!o.lida, motivo: txt(o.motivo) || null };
    }).filter((x) => !!x.id),
    contas: lista(r.contas).map((x) => {
      const o = obj(x);
      const s = obj(o.situacao);
      return {
        id: txt(o.id),
        nome: txt(o.nome) || `Conta ${txt(o.id)}`,
        moeda: txt(o.moeda) || null,
        situacao: { codigo: num(s.codigo), rotulo: txt(s.rotulo) || "Sem leitura", travada: !!s.travada, motivo: txt(s.motivo) || null, o_que_fazer: txt(s.o_que_fazer) || null },
        saldo_a_pagar_brl: num(o.saldo_a_pagar_brl),
        gasto_total_brl: num(o.gasto_total_brl),
        link_meta: /^https:\/\/business\.facebook\.com\//.test(txt(o.link_meta)) ? txt(o.link_meta) : "",
        link_cobranca: /^https:\/\/business\.facebook\.com\//.test(txt(o.link_cobranca)) ? txt(o.link_cobranca) : "",
        fonte: (o.fonte === "coleta" ? "coleta" : "meta_ao_vivo") as ContaNaTela["fonte"],
        lido_em: txt(o.lido_em) || null,
        aviso: txt(o.aviso) || null,
      };
    }).filter((c) => !!c.id),
    campanhas: lista(r.campanhas).map((c) => no(c)).filter((c): c is NoNoGerenciador => !!c),
    resumo,
    periodo: txt(p.inicio) ? { inicio: txt(p.inicio), fim: txt(p.fim), dias: num(p.dias) || 0 } : null,
    fonte: (r.fonte === "coleta" || r.fonte === "misto" ? r.fonte : "meta_ao_vivo") as LeituraDoGerenciador["fonte"],
    lido_em: txt(r.lido_em) || null,
    sincronizado_em: txt(r.sincronizado_em) || null,
    gestao: g ? { disponivel: !!g.disponivel, motivo: txt(g.motivo) || null } : null,
    avisos: lista(r.avisos).map(txt).filter(Boolean),
    gravada_em: txt(r.gravada_em) || null,
  };
}

const ehAtivo = (n: NoNoGerenciador) => (n.efetivo || n.status || "").toUpperCase() === "ACTIVE" || n.entrega.estado === "entregando";

/**
 * Filtro da árvore: "entregando" (só o que a Meta está entregando hoje), "ativos" (ligados, entregando
 * ou não) e "todos". Um pai aparece quando ele ou algum filho passa; os filhos são filtrados também.
 */
export function filtrarArvore(campanhas: NoNoGerenciador[], filtro: FiltroDoGerenciador): NoNoGerenciador[] {
  if (filtro === "todos") return campanhas;
  const passa = (n: NoNoGerenciador) => (filtro === "entregando" ? n.entrega.estado === "entregando" : ehAtivo(n));
  const podar = (n: NoNoGerenciador): NoNoGerenciador | null => {
    const filhos = n.filhos.map(podar).filter((f): f is NoNoGerenciador => !!f);
    if (!passa(n) && !filhos.length) return null;
    return { ...n, filhos };
  };
  return campanhas.map(podar).filter((c): c is NoNoGerenciador => !!c);
}

/** Quantos itens (de qualquer nível) cada filtro mostra: vai no rótulo do botão. */
export function contagemDoFiltro(campanhas: NoNoGerenciador[], filtro: FiltroDoGerenciador): number {
  return filtrarArvore(campanhas, filtro).length;
}

export const chaveDoGerenciador = (clientId: string, dias: number) => ["mesa", "ads", "gerenciador", clientId, dias] as const;

export async function lerGerenciador(clientId: string, dias: number, aoVivo = false): Promise<LeituraDoGerenciador> {
  const corpo: Record<string, unknown> = { client_id: clientId, dias };
  if (aoVivo) corpo.ao_vivo = true;
  return normalizarGerenciador(await chamarAds<any>("gerenciador_ler", corpo));
}

export type AcaoDoGerenciador = "pausar" | "ativar" | "orcamento" | "renomear";

export interface ResultadoDaAcaoNaTela {
  ok: boolean;
  motivo: string | null;
  feito_em: string | null;
  relido_em: string | null;
  antes: { status: string | null; orcamento_diario_brl: number | null; nome: string | null } | null;
  depois: { status: string | null; orcamento_diario_brl: number | null; nome: string | null } | null;
  resposta: Record<string, unknown> | null;
  resumo: string;
  acao_id: string | null;
}

function estado(v: unknown) {
  const o = obj(v);
  if (!Object.keys(o).length) return null;
  return { status: txt(o.status) || null, orcamento_diario_brl: num(o.orcamento_diario_brl), nome: txt(o.nome) || null };
}

export function normalizarResultadoDaAcao(bruto: unknown): ResultadoDaAcaoNaTela {
  const r = obj(bruto);
  const x = obj(r.resultado);
  return {
    ok: !!x.ok,
    motivo: txt(x.motivo) || null,
    feito_em: txt(x.feito_em) || null,
    relido_em: txt(x.relido_em) || null,
    antes: estado(x.antes),
    depois: estado(x.depois),
    resposta: Object.keys(obj(x.resposta)).length ? obj(x.resposta) : null,
    resumo: txt(r.resumo),
    acao_id: txt(r.acao_id) || null,
  };
}

/** Ação da equipe no Gerenciador (o servidor relê na Meta antes e depois; nada é feito às cegas). */
export async function agirNoGerenciador(clientId: string, n: NoNoGerenciador, tipo: AcaoDoGerenciador, valor?: { nome?: string; orcamento_diario_brl?: number }): Promise<ResultadoDaAcaoNaTela> {
  const corpo: Record<string, unknown> = { client_id: clientId, tipo, nivel: n.nivel, meta_id: n.id, nome_atual: n.nome };
  if (tipo === "renomear" && valor && valor.nome) corpo.nome = valor.nome;
  if (tipo === "orcamento" && valor && typeof valor.orcamento_diario_brl === "number") corpo.orcamento_diario_brl = valor.orcamento_diario_brl;
  return normalizarResultadoDaAcao(await chamarAds<any>("gerenciador_acao", corpo));
}

/** Faixa que o painel aceita para a verba (30% por vez, mínimo R$ 5), igual ao servidor. */
export function faixaDaVerba(atual: number | null): { min: number; max: number } | null {
  if (atual === null || !(atual > 0)) return null;
  return { min: Math.max(5, Math.ceil(atual * 0.7 * 100) / 100), max: Math.floor(atual * 1.3 * 100) / 100 };
}

/** "10:32" em São Paulo (o painel todo usa a hora de Brasília). */
export function horaDeBrasilia(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!isFinite(t)) return "";
  return new Date(t - 3 * 3600_000).toISOString().slice(11, 16);
}
