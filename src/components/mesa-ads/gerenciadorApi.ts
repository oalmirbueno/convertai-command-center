/**
 * Gerenciador ao vivo (frente AD, 28/09): tipos, normalização tolerante e as
 * chamadas gerenciador_ler e gerenciador_acao da mesa-ads. O servidor lê a
 * Meta na hora (status, entrega, verba, gasto de hoje) e junta os números do
 * período; a tela só mostra, filtra e pede as ações (pausar, ativar, verba,
 * renomear), que passam pelo mesmo caminho do agente (relê, faz, relê de novo).
 */
import { chamarAds } from "./adsApi";
import { chaveDoPeriodo, corpoDoPeriodo, type PeriodoDaConsulta } from "./periodoDaConta";

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
  /** Frente AD3: alcance aproximado e cliques no link (para as colunas e a linha de total). */
  alcance: number | null;
  cliques_link: number | null;
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
    alcance: num(m.alcance),
    cliques_link: num(m.cliques_link),
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

export const chaveDoGerenciador = (clientId: string, periodo: PeriodoDaConsulta) => ["mesa", "ads", "gerenciador", clientId, chaveDoPeriodo(periodo)] as const;

export async function lerGerenciador(clientId: string, periodo: PeriodoDaConsulta, aoVivo = false): Promise<LeituraDoGerenciador> {
  const corpo: Record<string, unknown> = { client_id: clientId, ...corpoDoPeriodo(periodo) };
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

// ------------------------------------------------------------------ frente AD3 (28/09)
//
// Pedido do dono: "igual ao Gerenciador de Anúncios da Meta, organizadinho: campanha, conjunto e anúncio
// com cores diferentes, sem muito texto; clicar e abrir, ver o criativo, avaliar e analisar; na linha,
// Pausar, Retomar e Otimizar; gerar o relatório ali e ele já aparecer em Relatórios".

/** Todos os itens de um nível (o que a aba Campanhas, Conjuntos ou Anúncios mostra), dentro da campanha ou do conjunto escolhido. */
export function nosDoNivel(campanhas: NoNoGerenciador[], nivel: NivelNoGerenciador, dentroDe: string | null = null): NoNoGerenciador[] {
  const campanhaEscolhida = dentroDe ? campanhas.filter((c) => c.id === dentroDe) : [];
  const conjuntoEscolhido = dentroDe && !campanhaEscolhida.length ? ([] as NoNoGerenciador[]).concat(...campanhas.map((c) => c.filhos.filter((g) => g.id === dentroDe))) : [];
  const base = campanhaEscolhida.length ? campanhaEscolhida : campanhas;
  if (nivel === "campanha") return base;
  const conjuntos = conjuntoEscolhido.length ? conjuntoEscolhido : ([] as NoNoGerenciador[]).concat(...base.map((c) => c.filhos));
  if (nivel === "conjunto") return conjuntos;
  return ([] as NoNoGerenciador[]).concat(...conjuntos.map((g) => g.filhos));
}

/** Acha um item em qualquer nível da árvore. */
export function acharNo(campanhas: NoNoGerenciador[], id: string): NoNoGerenciador | null {
  for (const c of campanhas) {
    if (c.id === id) return c;
    for (const g of c.filhos) {
      if (g.id === id) return g;
      for (const a of g.filhos) if (a.id === id) return a;
    }
  }
  return null;
}

export interface TotalDaLista {
  quantos: number;
  gasto: number;
  impressoes: number;
  resultados: number | null;
  resultado_rotulo: string | null;
  custo_por_resultado: number | null;
  ctr_link: number | null;
  cpm: number | null;
  verba_diaria: number | null;
  hoje: number | null;
}

/**
 * A linha de total da tabela (como a da Meta): gasto e impressões somados; resultados só quando todos
 * medem a mesma coisa (conversa com clique não soma); CTR e CPM recalculados sobre a soma; verba diária
 * somada dos itens ativos com verba própria. Alcance não soma (a mesma pessoa aparece em vários).
 */
export function totalDaLista(nos: NoNoGerenciador[]): TotalDaLista {
  const ms = nos.map((n) => n.metricas).filter((m): m is MetricasNoGerenciador => !!m);
  const gasto = Math.round(ms.reduce((s, m) => s + m.gasto, 0) * 100) / 100;
  const impressoes = ms.reduce((s, m) => s + m.impressoes, 0);
  const rotulos = ms.filter((m) => m.resultados > 0).map((m) => m.resultado_rotulo);
  const unico = rotulos.length && rotulos.every((r) => r === rotulos[0]) ? rotulos[0] : null;
  const resultados = !rotulos.length ? 0 : unico ? ms.reduce((s, m) => s + m.resultados, 0) : null;
  const comCliques = ms.filter((m) => m.cliques_link !== null);
  const cliques = comCliques.reduce((s, m) => s + (m.cliques_link || 0), 0);
  const impComCliques = comCliques.reduce((s, m) => s + m.impressoes, 0);
  const ativos = nos.filter((n) => (n.efetivo || n.status || "").toUpperCase() === "ACTIVE" && n.orcamento_diario_brl !== null);
  const comHoje = nos.filter((n) => n.hoje);
  return {
    quantos: nos.length,
    gasto,
    impressoes,
    resultados,
    resultado_rotulo: unico,
    custo_por_resultado: resultados && resultados > 0 ? Math.round((gasto / resultados) * 100) / 100 : null,
    ctr_link: impComCliques > 0 ? Math.round((cliques / impComCliques) * 10000) / 100 : null,
    cpm: impressoes > 0 ? Math.round((gasto / impressoes) * 100000) / 100 : null,
    verba_diaria: ativos.length ? Math.round(ativos.reduce((s, n) => s + (n.orcamento_diario_brl || 0), 0) * 100) / 100 : null,
    hoje: comHoje.length ? Math.round(comHoje.reduce((s, n) => s + (n.hoje ? n.hoje.gasto : 0), 0) * 100) / 100 : null,
  };
}

const NOME_DO_NIVEL: Record<NivelNoGerenciador, string> = { campanha: "a campanha", conjunto: "o conjunto", anuncio: "o anúncio" };
const virgula = (v: number) => String(v).replace(".", ",");

function brlCurto(v: number): string {
  const partes = Math.abs(v).toFixed(2).split(".");
  return `${v < 0 ? "-" : ""}R$ ${partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${partes[1]}`;
}

/**
 * O pedido que o "Otimizar" leva ao agente (entra no campo; nada roda sem o clique): parte do que já
 * roda neste item, sem criar do zero; reforçar o que funciona e um experimento por vez.
 */
export function pedidoDeOtimizar(n: NoNoGerenciador, periodo: string): string {
  const m = n.metricas;
  const numeros = m
    ? ` Números ${periodo}: ${brlCurto(m.gasto)} gastos, ${m.resultados} ${m.resultado_rotulo.toLowerCase()}${m.custo_por_resultado !== null ? ` a ${brlCurto(m.custo_por_resultado)} cada` : ""}${m.ctr_link !== null ? `, CTR ${virgula(m.ctr_link)}%` : ""}${m.frequencia !== null ? `, frequência ${virgula(m.frequencia)}` : ""}.`
    : "";
  return `Otimizar ${NOME_DO_NIVEL[n.nivel]} "${n.nome}" (id ${n.id}) sem criar nada do zero: parta do que já roda, reforce o que está funcionando e proponha um experimento por vez.${numeros}`;
}

// ---- o anúncio aberto (gerenciador_anuncio)

export interface RankingNaTela {
  valor: string;
  rotulo: string;
  tom: "bom" | "medio" | "ruim";
}

export interface AnuncioAberto {
  ad_id: string;
  nome: string;
  criativo: {
    titulo: string | null;
    corpo: string | null;
    descricao: string | null;
    cta: string | null;
    destino: string | null;
    imagem_url: string | null;
    video: { fonte: string | null; capa: string | null; duracao_s: number | null; link: string | null } | null;
  };
  links: { previa: string | null; instagram: string | null; meta: string | null };
  qualidade: { qualidade: RankingNaTela | null; engajamento: RankingNaTela | null; conversao: RankingNaTela | null };
  aprendizado: { estado: "aprendendo" | "concluido" | "limitado"; rotulo: string; motivo: string | null } | null;
  fonte: "meta_ao_vivo" | "coleta";
  aviso: string | null;
  lido_em: string | null;
}

const https = (v: unknown) => (typeof v === "string" && /^https:\/\//.test(v) ? v : null);
const TONS = ["bom", "medio", "ruim"];
function ranking(v: unknown): RankingNaTela | null {
  const o = obj(v);
  if (!txt(o.rotulo)) return null;
  return { valor: txt(o.valor), rotulo: txt(o.rotulo), tom: (TONS.indexOf(o.tom) >= 0 ? o.tom : "medio") as RankingNaTela["tom"] };
}

export function normalizarAnuncioAberto(bruto: unknown): AnuncioAberto | null {
  const r = obj(obj(bruto).anuncio);
  if (!txt(r.ad_id)) return null;
  const c = obj(r.criativo);
  const v = c.video ? obj(c.video) : null;
  const l = obj(r.links);
  const q = obj(r.qualidade);
  const a = r.aprendizado ? obj(r.aprendizado) : null;
  const estado = a && (a.estado === "aprendendo" || a.estado === "concluido" || a.estado === "limitado") ? (a.estado as "aprendendo" | "concluido" | "limitado") : null;
  return {
    ad_id: txt(r.ad_id),
    nome: txt(r.nome) || txt(r.ad_id),
    criativo: {
      titulo: txt(c.titulo) || null,
      corpo: txt(c.corpo) || null,
      descricao: txt(c.descricao) || null,
      cta: txt(c.cta) || null,
      destino: txt(c.destino) || null,
      imagem_url: https(c.imagem_url),
      video: v && (https(v.fonte) || https(v.capa)) ? { fonte: https(v.fonte), capa: https(v.capa), duracao_s: num(v.duracao_s), link: https(v.link) } : null,
    },
    links: { previa: https(l.previa), instagram: https(l.instagram), meta: /^https:\/\/(business|www)\.facebook\.com\//.test(txt(l.meta)) ? txt(l.meta) : null },
    qualidade: { qualidade: ranking(q.qualidade), engajamento: ranking(q.engajamento), conversao: ranking(q.conversao) },
    aprendizado: a && estado ? { estado, rotulo: txt(a.rotulo), motivo: txt(a.motivo) || null } : null,
    fonte: r.fonte === "coleta" ? "coleta" : "meta_ao_vivo",
    aviso: txt(r.aviso) || null,
    lido_em: txt(r.lido_em) || null,
  };
}

export const chaveDoAnuncioAberto = (clientId: string, adId: string, periodo: PeriodoDaConsulta) => ["mesa", "ads", "anuncio-aberto", clientId, adId, chaveDoPeriodo(periodo)] as const;

export async function lerAnuncioAberto(clientId: string, adId: string, periodo: PeriodoDaConsulta): Promise<AnuncioAberto | null> {
  return normalizarAnuncioAberto(await chamarAds<any>("gerenciador_anuncio", { client_id: clientId, ad_id: adId, ...corpoDoPeriodo(periodo) }));
}

export interface ItemDoDiagnostico {
  chave: "qualidade" | "fadiga" | "aprendizado";
  rotulo: string;
  valor: string;
  tom: "bom" | "medio" | "ruim" | "neutro";
  dica: string | null;
}

/**
 * O diagnóstico curto do anúncio aberto, em regra fixa: qualidade (ranking da Meta), fadiga (frequência
 * e o CTR da segunda metade do período contra a primeira) e aprendizado do conjunto. Sem dado, diz que
 * não há leitura em vez de adivinhar.
 */
export function diagnosticoCurto(e: {
  qualidade: AnuncioAberto["qualidade"] | null;
  aprendizado: AnuncioAberto["aprendizado"] | null;
  frequencia: number | null;
  ctr_var_pct: number | null;
  impressoes: number;
}): ItemDoDiagnostico[] {
  const q = e.qualidade ? e.qualidade.qualidade || e.qualidade.engajamento || e.qualidade.conversao : null;
  const itens: ItemDoDiagnostico[] = [];
  itens.push(
    q
      ? { chave: "qualidade", rotulo: "Qualidade", valor: q.rotulo, tom: q.tom, dica: "Ranking da Meta contra anúncios que disputam o mesmo público no período." }
      : { chave: "qualidade", rotulo: "Qualidade", valor: e.impressoes < 500 ? "Pouca entrega para avaliar" : "Sem ranking da Meta", tom: "neutro", dica: "A Meta só dá o ranking com volume (cerca de 500 impressões no período)." },
  );
  const f = e.frequencia;
  const caiu = e.ctr_var_pct !== null && e.ctr_var_pct <= -20;
  if (f === null && e.ctr_var_pct === null) itens.push({ chave: "fadiga", rotulo: "Fadiga", valor: "Sem leitura", tom: "neutro", dica: null });
  else if (f !== null && ((f >= 3 && caiu) || f >= 4)) itens.push({ chave: "fadiga", rotulo: "Fadiga", valor: "Cansando o público", tom: "ruim", dica: `Frequência ${virgula(f)}${caiu ? " e o clique caindo" : ""}: hora de variar o criativo.` });
  else if ((f !== null && f >= 2.5) || caiu) itens.push({ chave: "fadiga", rotulo: "Fadiga", valor: "Atenção", tom: "medio", dica: caiu ? "O clique caiu na segunda metade do período." : `Frequência ${virgula(f as number)}: o público já viu algumas vezes.` });
  else itens.push({ chave: "fadiga", rotulo: "Fadiga", valor: "Sem sinal", tom: "bom", dica: f !== null ? `Frequência ${virgula(f)}.` : null });
  const a = e.aprendizado;
  itens.push(
    a
      ? { chave: "aprendizado", rotulo: "Aprendizado", valor: a.rotulo, tom: a.estado === "concluido" ? "bom" : a.estado === "aprendendo" ? "medio" : "ruim", dica: a.motivo }
      : { chave: "aprendizado", rotulo: "Aprendizado", valor: "Sem leitura", tom: "neutro", dica: null },
  );
  return itens;
}

// ---- relatório de anúncios do período (relatorio_ads_gerar)

export interface RelatorioGerado {
  id: string;
  titulo: string;
  link: string;
  projeto: string;
  atualizado: boolean;
  resumo: string;
}

export async function gerarRelatorioDeAnuncios(clientId: string, periodo: PeriodoDaConsulta): Promise<RelatorioGerado | null> {
  const r = obj(obj(await chamarAds<any>("relatorio_ads_gerar", { client_id: clientId, ...corpoDoPeriodo(periodo) })).relatorio);
  if (!txt(r.id)) return null;
  const link = txt(r.link);
  return {
    id: txt(r.id),
    titulo: txt(r.titulo),
    link: /^\/relatorios\/[0-9a-f-]{36}$/.test(link) ? link : `/relatorios/${txt(r.id)}`,
    projeto: txt(obj(r.projeto).nome),
    atualizado: !!r.atualizado,
    resumo: txt(r.resumo),
  };
}
