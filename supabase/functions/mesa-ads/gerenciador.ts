/**
 * Gerenciador ao vivo (frente AD, 28/09). Pedido do dono: "abrir a telinha do
 * gerenciador de anúncios mesmo dentro do painel, mostrando o gerenciador real
 * da Meta, para fazer tudo por um lugar só: quais campanhas estão ativas,
 * quais estão rodando, e monitorar em tempo real".
 *
 * A Meta não deixa embutir o Gerenciador de Anúncios (iframe bloqueado). Aqui
 * fica o que é puro para montar uma tela fiel a ele: a árvore campanha,
 * conjunto e anúncio lida na Graph API na hora, com o status real, a entrega
 * (effective_status mais a situação da conta e as impressões de hoje) e o
 * motivo quando não entrega, os números do período (da coleta do painel), o
 * gasto de hoje (lido na Meta), o link para o mesmo item no Gerenciador da
 * Meta e a marca da última ação do agente, da rotina ou da equipe.
 *
 * Sem Deno e sem banco: testado no Vitest. Nada de token aqui.
 */

export type NivelDoGerenciador = "campanha" | "conjunto" | "anuncio";

export type EstadoDeEntrega =
  | "entregando"
  | "ativo_sem_entrega"
  | "ativo"
  | "pausado"
  | "em_analise"
  | "reprovado"
  | "com_problema"
  | "encerrado"
  | "conta_travada";

export type Entrega = { estado: EstadoDeEntrega; rotulo: string; motivo: string | null };

export type MetricasDoNo = {
  gasto: number;
  impressoes: number;
  resultados: number;
  resultado_rotulo: string;
  custo_por_resultado: number | null;
  ctr_link: number | null;
  cpm: number | null;
  frequencia: number | null;
  cliques_link: number;
};

export type HojeDoNo = { gasto: number; impressoes: number };

export type MarcaDoNo = {
  acao_id: string;
  origem: string;
  tipo: string;
  estado: string;
  resumo: string;
  quando: string;
  pode_desfazer: boolean;
};

export type NoDoGerenciador = {
  nivel: NivelDoGerenciador;
  id: string;
  nome: string;
  conta: string;
  campaign_id: string | null;
  adset_id: string | null;
  /** O que a equipe ligou ou desligou (configured status). */
  status: string | null;
  /** O que a Meta diz que vale agora (effective_status). */
  efetivo: string | null;
  entrega: Entrega;
  objetivo: string | null;
  otimizacao: string | null;
  orcamento_diario_brl: number | null;
  orcamento_total_brl: number | null;
  metricas: MetricasDoNo | null;
  hoje: HojeDoNo | null;
  link_meta: string;
  marca: MarcaDoNo | null;
  filhos: NoDoGerenciador[];
};

export type CampanhaLida = {
  id: string;
  nome: string;
  status: string | null;
  efetivo: string | null;
  objetivo: string | null;
  orcamento_diario_brl: number | null;
  orcamento_total_brl: number | null;
  fim: string | null;
  problemas: string[];
};

export type ConjuntoLido = {
  id: string;
  nome: string;
  campaign_id: string | null;
  status: string | null;
  efetivo: string | null;
  orcamento_diario_brl: number | null;
  orcamento_total_brl: number | null;
  otimizacao: string | null;
  fim: string | null;
  problemas: string[];
};

export type AnuncioLido = {
  id: string;
  nome: string;
  campaign_id: string | null;
  adset_id: string | null;
  status: string | null;
  efetivo: string | null;
  problemas: string[];
  revisao: string[];
};

export type SituacaoDaConta = {
  codigo: number | null;
  rotulo: string;
  travada: boolean;
  /** Por que não entrega (conta travada) ou o alerta (prazo de carência). */
  motivo: string | null;
  /** O que fazer, em uma frase. */
  o_que_fazer: string | null;
};

export type ContaNoGerenciador = {
  id: string;
  nome: string;
  moeda: string | null;
  situacao: SituacaoDaConta;
  saldo_a_pagar_brl: number | null;
  gasto_total_brl: number | null;
  link_meta: string;
  link_cobranca: string;
  fonte: "meta_ao_vivo" | "coleta";
  lido_em: string | null;
  aviso: string | null;
};

const ID_META = /^[0-9]{3,30}$/;
const limpo = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").replace(/[–—]/g, ",").trim().slice(0, max) : "");
const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const numero = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Valor em centavos da Meta (texto) em reais; zero continua zero (saldo zerado é informação). */
export function centavosEmReais(v: unknown): number | null {
  const n = numero(v);
  return n === null ? null : Math.round(n) / 100;
}

/** Orçamento da Meta (centavos) em reais; zero ou vazio = sem orçamento neste nível. */
export function orcamentoEmReais(v: unknown): number | null {
  const n = numero(v);
  return n === null || n <= 0 ? null : Math.round(n) / 100;
}

// ------------------------------------------------------------------ conta

/**
 * account_status da Meta: 1 ativa, 2 desativada, 3 saldo em aberto, 7 análise
 * de risco, 8 acerto pendente, 9 carência, 100 em fechamento, 101 fechada.
 * Travada = a Meta não entrega nada da conta enquanto durar.
 */
const SITUACOES: Record<number, { rotulo: string; travada: boolean; motivo: string | null; o_que_fazer: string | null }> = {
  1: { rotulo: "Ativa", travada: false, motivo: null, o_que_fazer: null },
  2: { rotulo: "Desativada", travada: true, motivo: "A conta de anúncios está desativada na Meta: nada entrega.", o_que_fazer: "Veja a Qualidade da conta no Gerenciador de Anúncios e peça revisão." },
  3: {
    rotulo: "Saldo em aberto",
    travada: true,
    motivo: "A conta tem pagamento pendente na Meta (saldo em aberto): nada entrega e a Meta recusa mudanças até quitar.",
    o_que_fazer: "Quite em Cobrança e pagamentos do Gerenciador de Anúncios e clique em Atualizar agora.",
  },
  7: { rotulo: "Em análise de risco", travada: true, motivo: "A Meta está analisando o risco da conta: nada entrega até terminar.", o_que_fazer: "Aguarde a análise ou veja a Qualidade da conta." },
  8: { rotulo: "Acerto pendente", travada: true, motivo: "A conta tem um acerto de pagamento pendente na Meta: nada entrega até resolver.", o_que_fazer: "Confira em Cobrança e pagamentos do Gerenciador de Anúncios." },
  9: { rotulo: "Prazo de carência", travada: false, motivo: "A conta está no prazo de carência de pagamento: ainda entrega, mas trava se não pagar.", o_que_fazer: "Confira em Cobrança e pagamentos." },
  100: { rotulo: "Em fechamento", travada: true, motivo: "A conta está em fechamento na Meta.", o_que_fazer: null },
  101: { rotulo: "Fechada", travada: true, motivo: "A conta foi fechada na Meta.", o_que_fazer: null },
  202: { rotulo: "Fechada", travada: true, motivo: "A conta foi fechada na Meta.", o_que_fazer: null },
};

export function situacaoDaConta(codigo: unknown): SituacaoDaConta {
  const n = numero(codigo);
  if (n === null) return { codigo: null, rotulo: "Sem leitura", travada: false, motivo: null, o_que_fazer: null };
  const s = SITUACOES[n];
  if (!s) return { codigo: n, rotulo: `Situação ${n}`, travada: false, motivo: null, o_que_fazer: null };
  return { codigo: n, ...s };
}

// ------------------------------------------------------------------ links

const BASE_DO_GERENCIADOR = "https://business.facebook.com/adsmanager/manage/";

/** O mesmo item no Gerenciador de Anúncios da Meta (conta, campanha, conjunto ou anúncio selecionado). */
export function linkDoGerenciador(conta: string, nivel?: NivelDoGerenciador | null, ids: { campanha?: string | null; conjunto?: string | null; anuncio?: string | null } = {}): string {
  const act = String(conta).replace(/^act_/, "");
  const partes = [`act=${encodeURIComponent(act)}`];
  if (ids.campanha && ID_META.test(ids.campanha)) partes.push(`selected_campaign_ids=${ids.campanha}`);
  if (ids.conjunto && ID_META.test(ids.conjunto)) partes.push(`selected_adset_ids=${ids.conjunto}`);
  if (ids.anuncio && ID_META.test(ids.anuncio)) partes.push(`selected_ad_ids=${ids.anuncio}`);
  const aba = nivel === "anuncio" ? "ads" : nivel === "conjunto" ? "adsets" : "campaigns";
  return `${BASE_DO_GERENCIADOR}${aba}?${partes.join("&")}`;
}

/** Cobrança e pagamentos da conta na Meta (para quitar o saldo em aberto). */
export function linkDaCobranca(conta: string): string {
  return `https://business.facebook.com/billing_hub/accounts/details?asset_id=${encodeURIComponent(String(conta).replace(/^act_/, ""))}`;
}

// ------------------------------------------------------------------ leitura da Graph

const dadosDaLista = (bruto: unknown): Record<string, unknown>[] => {
  const d = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>).data : null;
  return Array.isArray(d) ? (d.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : [];
};

/** A lista veio cortada? (a Meta manda paging.next quando há mais) */
export function listaCortada(bruto: unknown): boolean {
  const p = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>).paging : null;
  return !!(p && typeof p === "object" && typeof (p as Record<string, unknown>).next === "string");
}

/** issues_info da Meta em frases curtas (o resumo do erro, sem código). */
export function problemasDe(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const saida: string[] = [];
  for (const x of v) {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const t = limpo(o.error_summary, 160) || limpo(o.error_message, 200);
    if (t && saida.indexOf(t) < 0) saida.push(t);
  }
  return saida.slice(0, 3);
}

/** ad_review_feedback da Meta (global e por posicionamento) em frases curtas. */
export function revisaoDe(v: unknown): string[] {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const saida: string[] = [];
  for (const grupo of [o.global, o.placement_specific]) {
    if (!grupo || typeof grupo !== "object") continue;
    for (const [chave, valor] of Object.entries(grupo as Record<string, unknown>)) {
      const t = typeof valor === "string" ? limpo(valor, 220) : valor && typeof valor === "object" ? limpo(Object.values(valor as Record<string, unknown>).filter((x) => typeof x === "string").join(" "), 220) : "";
      const frase = t || limpo(chave, 120);
      if (frase && saida.indexOf(frase) < 0) saida.push(frase);
    }
  }
  return saida.slice(0, 3);
}

export function campanhasDaMeta(bruto: unknown): CampanhaLida[] {
  return dadosDaLista(bruto).filter((c) => ID_META.test(String(c.id ?? ""))).map((c) => ({
    id: String(c.id),
    nome: limpo(c.name, 200) || `Campanha ${c.id}`,
    status: texto(c.status),
    efetivo: texto(c.effective_status),
    objetivo: texto(c.objective),
    orcamento_diario_brl: orcamentoEmReais(c.daily_budget),
    orcamento_total_brl: orcamentoEmReais(c.lifetime_budget),
    fim: texto(c.stop_time),
    problemas: problemasDe(c.issues_info),
  }));
}

export function conjuntosDaMeta(bruto: unknown): ConjuntoLido[] {
  return dadosDaLista(bruto).filter((c) => ID_META.test(String(c.id ?? ""))).map((c) => ({
    id: String(c.id),
    nome: limpo(c.name, 200) || `Conjunto ${c.id}`,
    campaign_id: texto(c.campaign_id),
    status: texto(c.status),
    efetivo: texto(c.effective_status),
    orcamento_diario_brl: orcamentoEmReais(c.daily_budget),
    orcamento_total_brl: orcamentoEmReais(c.lifetime_budget),
    otimizacao: texto(c.optimization_goal),
    fim: texto(c.end_time),
    problemas: problemasDe(c.issues_info),
  }));
}

export function anunciosDaMeta(bruto: unknown): AnuncioLido[] {
  return dadosDaLista(bruto).filter((c) => ID_META.test(String(c.id ?? ""))).map((c) => ({
    id: String(c.id),
    nome: limpo(c.name, 200) || `Anúncio ${c.id}`,
    campaign_id: texto(c.campaign_id),
    adset_id: texto(c.adset_id),
    status: texto(c.status),
    efetivo: texto(c.effective_status),
    problemas: problemasDe(c.issues_info),
    revisao: revisaoDe(c.ad_review_feedback),
  }));
}

/** Insights de hoje por anúncio (level=ad, date_preset=today): gasto e impressões. */
export function hojeDaMeta(bruto: unknown): Map<string, HojeDoNo> {
  const mapa = new Map<string, HojeDoNo>();
  for (const l of dadosDaLista(bruto)) {
    const id = String(l.ad_id ?? "");
    if (!ID_META.test(id)) continue;
    const atual = mapa.get(id) ?? { gasto: 0, impressoes: 0 };
    atual.gasto = Math.round((atual.gasto + (numero(l.spend) ?? 0)) * 100) / 100;
    atual.impressoes += Math.round(numero(l.impressions) ?? 0);
    mapa.set(id, atual);
  }
  return mapa;
}

// ------------------------------------------------------------------ entrega

const ATIVOS = ["ACTIVE"];
const EM_ANALISE = ["PENDING_REVIEW", "IN_PROCESS", "PREAPPROVED"];

const dataCurta = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}` : iso;
};

/**
 * Entrega de um item, como o dono entende: entregando, ativo sem entrega
 * hoje, pausado (por quem), em análise, reprovado, com problema, encerrado ou
 * travado pela conta. Regra fixa em código (nunca IA).
 * `hojeImpressoes` null = sem leitura de hoje (a Meta não respondeu ou a
 * árvore veio da coleta): aí só dá para dizer "ativo".
 */
export function entregaDoNo(
  n: { nivel: NivelDoGerenciador; status: string | null; efetivo: string | null; hojeImpressoes: number | null; filhosAtivos: number | null; fim: string | null; problemas: string[]; revisao: string[] },
  conta: { travada: boolean; motivo: string | null } | null,
  agoraMs: number,
): Entrega {
  const efetivo = (n.efetivo || n.status || "").toUpperCase();
  const nome = n.nivel === "campanha" ? "campanha" : n.nivel === "conjunto" ? "conjunto" : "anúncio";
  if (efetivo === "DELETED" || efetivo === "ARCHIVED") return { estado: "encerrado", rotulo: efetivo === "DELETED" ? "Excluído" : "Arquivado", motivo: null };
  if (efetivo === "DISAPPROVED") {
    return { estado: "reprovado", rotulo: "Reprovado", motivo: n.revisao.length ? `A Meta reprovou: ${n.revisao.join(" ")}` : "A Meta reprovou este anúncio. O motivo aparece no Gerenciador da Meta." };
  }
  if (efetivo === "WITH_ISSUES") return { estado: "com_problema", rotulo: "Com problema", motivo: n.problemas.length ? n.problemas.join(" ") : "A Meta aponta um problema neste item. Veja no Gerenciador da Meta." };
  if (efetivo === "PENDING_BILLING_INFO") return { estado: "conta_travada", rotulo: "Falta pagamento", motivo: "A Meta espera uma forma de pagamento válida na conta." };
  if (EM_ANALISE.indexOf(efetivo) >= 0) return { estado: "em_analise", rotulo: "Em análise", motivo: "A Meta está revisando. Costuma levar até 24 horas." };
  if (efetivo === "CAMPAIGN_PAUSED") return { estado: "pausado", rotulo: "Pausado pela campanha", motivo: "A campanha deste item está pausada." };
  if (efetivo === "ADSET_PAUSED") return { estado: "pausado", rotulo: "Pausado pelo conjunto", motivo: "O conjunto deste anúncio está pausado." };
  if (efetivo === "PAUSED") return { estado: "pausado", rotulo: "Pausado", motivo: null };
  if (ATIVOS.indexOf(efetivo) < 0) return { estado: "pausado", rotulo: efetivo ? efetivo.toLowerCase().replace(/_/g, " ") : "Sem status", motivo: null };
  // Ativo daqui para baixo.
  const fim = n.fim ? Date.parse(n.fim) : NaN;
  if (Number.isFinite(fim) && fim < agoraMs) return { estado: "encerrado", rotulo: "Terminou", motivo: `A data final passou (${dataCurta(n.fim as string)}).` };
  if (conta && conta.travada) return { estado: "conta_travada", rotulo: "Não entrega", motivo: conta.motivo || "A conta de anúncios está travada na Meta." };
  if (n.filhosAtivos === 0) {
    return { estado: "ativo_sem_entrega", rotulo: "Ativo, sem entrega", motivo: n.nivel === "campanha" ? "Nenhum conjunto ativo nesta campanha." : "Nenhum anúncio ativo neste conjunto." };
  }
  if (n.hojeImpressoes === null) return { estado: "ativo", rotulo: "Ativo", motivo: n.problemas.length ? n.problemas.join(" ") : null };
  if (n.hojeImpressoes > 0) return { estado: "entregando", rotulo: "Entregando", motivo: null };
  return {
    estado: "ativo_sem_entrega",
    rotulo: "Ativo, sem entrega hoje",
    motivo: n.problemas.length
      ? n.problemas.join(" ")
      : `Nenhuma impressão hoje até agora neste ${nome}. Pode ser o horário de veiculação, a verba do dia já gasta, público pequeno ou a Meta ainda distribuindo.`,
  };
}

// ------------------------------------------------------------------ árvore

const ORDEM_DA_ENTREGA: EstadoDeEntrega[] = ["entregando", "ativo", "ativo_sem_entrega", "conta_travada", "com_problema", "reprovado", "em_analise", "pausado", "encerrado"];

function ordenar(a: NoDoGerenciador, b: NoDoGerenciador) {
  const d = ORDEM_DA_ENTREGA.indexOf(a.entrega.estado) - ORDEM_DA_ENTREGA.indexOf(b.entrega.estado);
  if (d !== 0) return d;
  const ga = a.metricas ? a.metricas.gasto : 0;
  const gb = b.metricas ? b.metricas.gasto : 0;
  return gb - ga || a.nome.localeCompare(b.nome);
}

const somaHoje = (filhos: NoDoGerenciador[]): HojeDoNo | null => {
  const com = filhos.filter((f) => f.hoje);
  if (!com.length) return null;
  return { gasto: Math.round(com.reduce((s, f) => s + (f.hoje as HojeDoNo).gasto, 0) * 100) / 100, impressoes: com.reduce((s, f) => s + (f.hoje as HojeDoNo).impressoes, 0) };
};

const ehAtivo = (n: { status: string | null; efetivo: string | null }) => (n.efetivo || n.status || "").toUpperCase() === "ACTIVE";

/**
 * Monta a árvore campanha, conjunto e anúncio de uma conta. `hoje` null =
 * sem leitura de hoje (entrega fica "ativo", sem afirmar que entrega). As
 * métricas do período vêm por id (campanha, conjunto e anúncio).
 */
export function montarArvore(e: {
  conta: string;
  situacao: SituacaoDaConta | null;
  campanhas: CampanhaLida[];
  conjuntos: ConjuntoLido[];
  anuncios: AnuncioLido[];
  hoje: Map<string, HojeDoNo> | null;
  metricas: { campanha: Map<string, MetricasDoNo>; conjunto: Map<string, MetricasDoNo>; anuncio: Map<string, MetricasDoNo> };
  marcas: Map<string, MarcaDoNo>;
  agoraMs: number;
}): { campanhas: NoDoGerenciador[]; sem_pai: number } {
  const conta = e.situacao ? { travada: e.situacao.travada, motivo: e.situacao.motivo } : null;
  const campanhaIds = new Set(e.campanhas.map((c) => c.id));
  const conjuntoDaCampanha = new Map(e.conjuntos.map((c) => [c.id, c.campaign_id]));
  let semPai = 0;

  const anunciosPorConjunto = new Map<string, NoDoGerenciador[]>();
  for (const a of e.anuncios) {
    const conjunto = a.adset_id;
    const campanha = a.campaign_id || (conjunto ? conjuntoDaCampanha.get(conjunto) ?? null : null);
    if (!conjunto || !campanha || !campanhaIds.has(campanha)) {
      semPai++;
      continue;
    }
    const hoje = e.hoje ? e.hoje.get(a.id) ?? { gasto: 0, impressoes: 0 } : null;
    const no: NoDoGerenciador = {
      nivel: "anuncio",
      id: a.id,
      nome: a.nome,
      conta: e.conta,
      campaign_id: campanha,
      adset_id: conjunto,
      status: a.status,
      efetivo: a.efetivo,
      entrega: entregaDoNo({ nivel: "anuncio", status: a.status, efetivo: a.efetivo, hojeImpressoes: hoje ? hoje.impressoes : null, filhosAtivos: null, fim: null, problemas: a.problemas, revisao: a.revisao }, conta, e.agoraMs),
      objetivo: null,
      otimizacao: null,
      orcamento_diario_brl: null,
      orcamento_total_brl: null,
      metricas: e.metricas.anuncio.get(a.id) ?? null,
      hoje,
      link_meta: linkDoGerenciador(e.conta, "anuncio", { campanha, conjunto, anuncio: a.id }),
      marca: e.marcas.get(a.id) ?? null,
      filhos: [],
    };
    anunciosPorConjunto.set(conjunto, (anunciosPorConjunto.get(conjunto) ?? []).concat([no]));
  }

  const conjuntosPorCampanha = new Map<string, NoDoGerenciador[]>();
  for (const c of e.conjuntos) {
    if (!c.campaign_id || !campanhaIds.has(c.campaign_id)) {
      semPai++;
      continue;
    }
    const filhos = (anunciosPorConjunto.get(c.id) ?? []).sort(ordenar);
    const hoje = e.hoje ? somaHoje(filhos) ?? { gasto: 0, impressoes: 0 } : null;
    const no: NoDoGerenciador = {
      nivel: "conjunto",
      id: c.id,
      nome: c.nome,
      conta: e.conta,
      campaign_id: c.campaign_id,
      adset_id: c.id,
      status: c.status,
      efetivo: c.efetivo,
      entrega: entregaDoNo({ nivel: "conjunto", status: c.status, efetivo: c.efetivo, hojeImpressoes: hoje ? hoje.impressoes : null, filhosAtivos: filhos.length ? filhos.filter(ehAtivo).length : null, fim: c.fim, problemas: c.problemas, revisao: [] }, conta, e.agoraMs),
      objetivo: null,
      otimizacao: c.otimizacao,
      orcamento_diario_brl: c.orcamento_diario_brl,
      orcamento_total_brl: c.orcamento_total_brl,
      metricas: e.metricas.conjunto.get(c.id) ?? null,
      hoje,
      link_meta: linkDoGerenciador(e.conta, "conjunto", { campanha: c.campaign_id, conjunto: c.id }),
      marca: e.marcas.get(c.id) ?? null,
      filhos,
    };
    conjuntosPorCampanha.set(c.campaign_id, (conjuntosPorCampanha.get(c.campaign_id) ?? []).concat([no]));
  }

  const campanhas = e.campanhas.map((c) => {
    const filhos = (conjuntosPorCampanha.get(c.id) ?? []).sort(ordenar);
    const hoje = e.hoje ? somaHoje(filhos) ?? { gasto: 0, impressoes: 0 } : null;
    const no: NoDoGerenciador = {
      nivel: "campanha",
      id: c.id,
      nome: c.nome,
      conta: e.conta,
      campaign_id: c.id,
      adset_id: null,
      status: c.status,
      efetivo: c.efetivo,
      entrega: entregaDoNo({ nivel: "campanha", status: c.status, efetivo: c.efetivo, hojeImpressoes: hoje ? hoje.impressoes : null, filhosAtivos: filhos.length ? filhos.filter(ehAtivo).length : null, fim: c.fim, problemas: c.problemas, revisao: [] }, conta, e.agoraMs),
      objetivo: c.objetivo,
      otimizacao: null,
      orcamento_diario_brl: c.orcamento_diario_brl,
      orcamento_total_brl: c.orcamento_total_brl,
      metricas: e.metricas.campanha.get(c.id) ?? null,
      hoje,
      link_meta: linkDoGerenciador(e.conta, "campanha", { campanha: c.id }),
      marca: e.marcas.get(c.id) ?? null,
      filhos,
    };
    return no;
  }).sort(ordenar);
  return { campanhas, sem_pai: semPai };
}

// ------------------------------------------------------------------ resumo e marcas

export type ResumoDoGerenciador = {
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
};

export function resumoDaArvore(campanhas: NoDoGerenciador[], contas: ContaNoGerenciador[]): ResumoDoGerenciador {
  const conjuntos = ([] as NoDoGerenciador[]).concat(...campanhas.map((c) => c.filhos));
  const anuncios = ([] as NoDoGerenciador[]).concat(...conjuntos.map((c) => c.filhos));
  const comHoje = campanhas.filter((c) => c.hoje);
  const alertas: string[] = [];
  for (const c of contas) if (c.situacao.motivo) alertas.push(`${c.nome}: ${c.situacao.motivo}`);
  const reprovados = anuncios.filter((a) => a.entrega.estado === "reprovado").length;
  if (reprovados) alertas.push(`${reprovados} ${reprovados === 1 ? "anúncio reprovado" : "anúncios reprovados"} pela Meta.`);
  const semEntrega = campanhas.filter((c) => c.entrega.estado === "ativo_sem_entrega");
  if (semEntrega.length) alertas.push(`${semEntrega.length === 1 ? `A campanha ${semEntrega[0].nome} está ativa` : `${semEntrega.length} campanhas estão ativas`} e sem entrega hoje.`);
  return {
    campanhas: campanhas.length,
    campanhas_ativas: campanhas.filter(ehAtivo).length,
    campanhas_entregando: campanhas.filter((c) => c.entrega.estado === "entregando").length,
    conjuntos_ativos: conjuntos.filter(ehAtivo).length,
    anuncios: anuncios.length,
    anuncios_ativos: anuncios.filter(ehAtivo).length,
    anuncios_entregando: anuncios.filter((a) => a.entrega.estado === "entregando").length,
    anuncios_com_problema: anuncios.filter((a) => a.entrega.estado === "reprovado" || a.entrega.estado === "com_problema").length,
    gasto_hoje: comHoje.length ? Math.round(comHoje.reduce((s, c) => s + (c.hoje as HojeDoNo).gasto, 0) * 100) / 100 : null,
    impressoes_hoje: comHoje.length ? comHoje.reduce((s, c) => s + (c.hoje as HojeDoNo).impressoes, 0) : null,
    gasto_periodo: Math.round(campanhas.reduce((s, c) => s + (c.metricas ? c.metricas.gasto : 0), 0) * 100) / 100,
    resultados_periodo: campanhas.reduce((s, c) => s + (c.metricas ? c.metricas.resultados : 0), 0),
    alertas: alertas.slice(0, 5),
  };
}

/**
 * A última ação em cada item (rotina, agente ou equipe), das linhas de
 * ads_rotina_acoes em ordem da mais nova: "Pausado pelo agente às 10:32".
 */
export function marcasDasAcoes(linhas: Record<string, unknown>[]): Map<string, MarcaDoNo> {
  const mapa = new Map<string, MarcaDoNo>();
  for (const l of linhas) {
    const alvo = l.alvo && typeof l.alvo === "object" ? (l.alvo as Record<string, unknown>) : null;
    const id = alvo ? String(alvo.meta_id ?? "") : "";
    if (!ID_META.test(id) || mapa.has(id)) continue;
    const estado = String(l.estado ?? "");
    if (["feita", "falhou", "desfeita"].indexOf(estado) < 0) continue;
    const prova = l.prova && typeof l.prova === "object" ? (l.prova as Record<string, unknown>) : {};
    mapa.set(id, {
      acao_id: String(l.id ?? ""),
      origem: prova.pela_equipe === true ? "equipe" : String(l.origem ?? "agente"),
      tipo: String(l.tipo ?? ""),
      estado,
      resumo: limpo(l.resumo, 300),
      quando: String(l.criado_em ?? ""),
      pode_desfazer: estado === "feita" && !!l.desfazer,
    });
  }
  return mapa;
}

// ------------------------------------------------------------------ para a Central (gravado)

/** A árvore enxuta que fica gravada (sem links nem marcas): a Central lê o estado e os números. */
export function arvoreCompacta(campanhas: NoDoGerenciador[], limites = { campanhas: 60, conjuntos: 150, anuncios: 300 }) {
  let conjuntos = 0;
  let anuncios = 0;
  const m = (x: MetricasDoNo | null) => (x ? { gasto: x.gasto, resultados: x.resultados, resultado_rotulo: x.resultado_rotulo, custo_por_resultado: x.custo_por_resultado, ctr_link: x.ctr_link, cpm: x.cpm, frequencia: x.frequencia } : null);
  const base = (n: NoDoGerenciador) => ({
    id: n.id,
    nome: n.nome,
    status: n.status,
    efetivo: n.efetivo,
    entrega: n.entrega.estado,
    motivo: n.entrega.motivo,
    orcamento_diario_brl: n.orcamento_diario_brl,
    hoje: n.hoje,
    metricas: m(n.metricas),
  });
  return campanhas.slice(0, limites.campanhas).map((c) => ({
    ...base(c),
    objetivo: c.objetivo,
    conjuntos: c.filhos.filter(() => conjuntos++ < limites.conjuntos).map((g) => ({
      ...base(g),
      anuncios: g.filhos.filter(() => anuncios++ < limites.anuncios).map(base),
    })),
  }));
}

/** Valida o pedido de ação da equipe no Gerenciador. Devolve o motivo da recusa, ou null. */
export function pedidoDaEquipeInvalido(p: Record<string, unknown>): string | null {
  if (["pausar", "ativar", "orcamento", "renomear"].indexOf(String(p.tipo)) < 0) return "Ação desconhecida. Pelo Gerenciador dá para pausar, ativar, mudar a verba diária e renomear.";
  if (["campanha", "conjunto", "anuncio"].indexOf(String(p.nivel)) < 0) return "Nível inválido.";
  if (!ID_META.test(String(p.meta_id ?? ""))) return "Item da Meta inválido.";
  if (p.tipo === "renomear") {
    const nome = limpo(p.nome, 400);
    if (!nome) return "Escreva o nome novo.";
    if (nome.length > 250) return "Nome longo demais (a Meta aceita até 250 caracteres).";
  }
  if (p.tipo === "orcamento") {
    if (p.nivel === "anuncio") return "Anúncio não tem verba própria: mude na campanha ou no conjunto.";
    const v = numero(p.orcamento_diario_brl);
    if (v === null || !(v > 0)) return "Informe a verba diária nova em reais.";
  }
  return null;
}
