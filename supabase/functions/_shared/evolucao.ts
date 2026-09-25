/**
 * Evolução do cliente: o que está funcionando, o que manter, o que descartar
 * e o que a Mesa aprende, somando o perfil orgânico do Instagram e os
 * anúncios da Meta (pedido do dono em 25/09/2026).
 *
 * Tudo aqui é regra em código, sem IA e sem Deno: a função mesa-ads usa, e o
 * teste do painel importa direto. A IA, quando entra, só EXPLICA a leitura
 * pronta (os números saem daqui, nunca dela).
 *
 * Três partes:
 * 1. Métricas completas de anúncio, com o resultado certo para o objetivo da
 *    campanha (mensagens, cadastros, compras, visitas, cliques, engajamento,
 *    visualizações de vídeo ou alcance), custo por resultado, valor de
 *    conversão e ROAS quando a Meta mediu.
 * 2. Regras de evolução: volume mínimo, comparação com a média da conta (por
 *    tipo de resultado) e com a média do perfil (por post).
 * 3. Leitura do banco (lerDesempenhoDoCliente): uma visão única de
 *    "desempenho do cliente" que junta orgânico e anúncios. O banco entra por
 *    um tipo estrutural (from/select/eq...), então qualquer função que tenha
 *    um cliente do supabase-js pode chamar.
 *
 * Sem travessão nos textos (regra do dono).
 */

// ------------------------------------------------------------------ tipos

/** Linha diária de anúncio (ads_creative_daily), com as colunas novas opcionais. */
export type LinhaDiariaAds = {
  ad_id: string;
  campaign_id?: string | null;
  adset_id?: string | null;
  adset_name?: string | null;
  campaign_name?: string | null;
  objective?: string | null;
  optimization_goal?: string | null;
  day: string;
  spend: number | string | null;
  impressions: number | string | null;
  reach?: number | string | null;
  clicks?: number | string | null;
  link_clicks?: number | string | null;
  frequency?: number | string | null;
  actions?: unknown;
  action_values?: unknown;
  purchase_roas?: unknown;
};

export type TipoDeResultado =
  | "mensagens"
  | "leads"
  | "compras"
  | "visitas"
  | "cliques_link"
  | "engajamento"
  | "video"
  | "alcance";

export const TIPOS_DE_RESULTADO: { tipo: TipoDeResultado; rotulo: string; singular: string; acoes: string[] }[] = [
  // Conversa iniciada; sem ela no dia, a conexão de mensagem (Direct e WhatsApp de alguns anúncios só registram esta).
  { tipo: "mensagens", rotulo: "Conversas iniciadas", singular: "conversa", acoes: ["onsite_conversion.messaging_conversation_started_7d", "onsite_conversion.total_messaging_connection"] },
  { tipo: "leads", rotulo: "Cadastros", singular: "cadastro", acoes: ["lead", "offsite_conversion.fb_pixel_lead", "onsite_web_lead"] },
  { tipo: "compras", rotulo: "Compras", singular: "compra", acoes: ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"] },
  { tipo: "visitas", rotulo: "Visitas à página", singular: "visita", acoes: ["landing_page_view", "omni_landing_page_view"] },
  { tipo: "cliques_link", rotulo: "Cliques no link", singular: "clique", acoes: ["link_click"] },
  { tipo: "engajamento", rotulo: "Engajamentos", singular: "engajamento", acoes: ["post_engagement"] },
  { tipo: "video", rotulo: "Visualizações de vídeo", singular: "visualização", acoes: ["video_view"] },
  { tipo: "alcance", rotulo: "Pessoas alcançadas (aprox.)", singular: "pessoa alcançada", acoes: [] },
];

export const rotuloDoTipo = (t: TipoDeResultado | null | undefined): string =>
  (TIPOS_DE_RESULTADO.find((x) => x.tipo === t) ?? { rotulo: "Resultados" }).rotulo;
export const singularDoTipo = (t: TipoDeResultado | null | undefined): string =>
  (TIPOS_DE_RESULTADO.find((x) => x.tipo === t) ?? { singular: "resultado" }).singular;

const ACOES_POR_TIPO = new Map(TIPOS_DE_RESULTADO.map((t) => [t.tipo, t.acoes]));
const TIPOS_VALOR_COMPRA = ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"];

export type MetricasCompletas = {
  gasto: number;
  impressoes: number;
  /** Aproximação honesta: impressões dividido pela frequência média (alcance não soma entre dias). */
  alcance_aprox: number | null;
  frequencia: number | null;
  cliques: number;
  cliques_link: number;
  /** CTR geral (todos os cliques) em %. */
  ctr: number | null;
  /** CTR do link em %. */
  ctr_link: number | null;
  /** Custo por clique no link. */
  cpc_link: number | null;
  cpm: number | null;
  resultado_tipo: TipoDeResultado | null;
  resultado_rotulo: string;
  resultados: number;
  custo_por_resultado: number | null;
  /** Soma de cada tipo de ação que a Meta registrou (mensagens, leads, compras...). */
  acoes: Record<TipoDeResultado, number>;
  /** Valor de compra que o pixel mediu (action_values). */
  valor_conversao: number | null;
  /** Retorno sobre o investimento: valor de conversão dividido pelo gasto. */
  roas: number | null;
  dias: number;
  inicio: string | null;
  fim: string | null;
};

// ------------------------------------------------------------------ números

export const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
export const arred = (v: number, casas = 2) => Math.round(v * 10 ** casas) / 10 ** casas;
const razao = (a: number, b: number, casas = 2) => (b > 0 ? arred(a / b, casas) : null);

/** Valor do primeiro tipo de ação presente (array da Meta [{action_type, value}]). */
export function valorDaAcao(actions: unknown, tipos: string[]): number | null {
  if (!Array.isArray(actions)) return null;
  for (const tipo of tipos) {
    const a = actions.find((x) => (x as { action_type?: string } | null)?.action_type === tipo) as { value?: unknown } | undefined;
    if (a) return num(a.value);
  }
  return null;
}

// ------------------------------------------------------------------ objetivo -> resultado

/**
 * O resultado que conta para o anúncio, pelo objetivo da campanha e pela
 * meta de otimização do conjunto (quando a coleta nova trouxer). Sem objetivo
 * conhecido, vale o primeiro tipo de conversão presente nas ações.
 */
export function tipoDoResultado(objetivo?: string | null, otimizacao?: string | null, actions?: unknown): TipoDeResultado | null {
  const o = String(otimizacao ?? "").toUpperCase();
  const tem = (t: TipoDeResultado) => valorDaAcao(actions, ACOES_POR_TIPO.get(t) ?? []) != null;
  if (o) {
    if (o === "CONVERSATIONS" || o.indexOf("MESSAGING") === 0) return "mensagens";
    if (o === "LEAD_GENERATION" || o === "QUALITY_LEAD" || o === "QUALITY_CALL") return "leads";
    if (o === "LANDING_PAGE_VIEWS") return "visitas";
    if (o === "LINK_CLICKS") return "cliques_link";
    if (o === "POST_ENGAGEMENT" || o === "PAGE_LIKES" || o === "EVENT_RESPONSES") return "engajamento";
    if (o === "THRUPLAY" || o === "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS") return "video";
    if (o === "REACH" || o === "IMPRESSIONS" || o === "AD_RECALL_LIFT") return "alcance";
    if (o === "OFFSITE_CONVERSIONS" || o === "VALUE") {
      if (tem("compras")) return "compras";
      if (tem("leads")) return "leads";
    }
  }
  const obj = String(objetivo ?? "").toUpperCase();
  if (obj === "OUTCOME_SALES" || obj === "CONVERSIONS" || obj === "PRODUCT_CATALOG_SALES") {
    if (tem("compras")) return "compras";
    if (tem("leads")) return "leads";
    if (tem("mensagens")) return "mensagens";
    return "compras";
  }
  if (obj === "OUTCOME_LEADS" || obj === "LEAD_GENERATION") return tem("leads") || !tem("mensagens") ? "leads" : "mensagens";
  if (obj === "OUTCOME_ENGAGEMENT" || obj === "MESSAGES" || obj === "POST_ENGAGEMENT" || obj === "PAGE_LIKES") {
    return tem("mensagens") || obj === "MESSAGES" ? "mensagens" : "engajamento";
  }
  if (obj === "OUTCOME_TRAFFIC" || obj === "LINK_CLICKS") return tem("visitas") ? "visitas" : "cliques_link";
  if (obj === "OUTCOME_AWARENESS" || obj === "REACH" || obj === "BRAND_AWARENESS") return "alcance";
  if (obj === "VIDEO_VIEWS") return "video";
  if (obj === "OUTCOME_APP_PROMOTION" || obj === "APP_INSTALLS") return "cliques_link";
  for (const t of ["mensagens", "leads", "compras"] as TipoDeResultado[]) if (tem(t)) return t;
  return null;
}

// ------------------------------------------------------------------ soma

const zeroAcoes = (): Record<TipoDeResultado, number> => ({
  mensagens: 0, leads: 0, compras: 0, visitas: 0, cliques_link: 0, engajamento: 0, video: 0, alcance: 0,
});

/**
 * Soma as linhas diárias de um ou mais anúncios. `tipoFixo` força o resultado
 * (um anúncio tem um objetivo); sem ele, decide pelo objetivo de cada linha
 * e o resultado principal é o tipo com mais gasto.
 */
export function metricasCompletas(
  linhas: LinhaDiariaAds[],
  tipoDado?: TipoDeResultado | null | Map<string, TipoDeResultado | null>,
  objetivoPorCampanha?: Map<string, string | null>,
): MetricasCompletas {
  const tipoFixo = tipoDado instanceof Map ? null : tipoDado ?? null;
  const tipoDoAd = tipoDado instanceof Map ? tipoDado : null;
  let gasto = 0, impressoes = 0, cliques = 0, cliquesLink = 0, freqPeso = 0, impComFreq = 0, valor = 0;
  let temValor = false;
  const acoes = zeroAcoes();
  const resultadosPorTipo = zeroAcoes();
  const gastoPorTipo = new Map<TipoDeResultado, number>();
  const dias = new Set<string>();
  for (const l of linhas) {
    const imp = num(l.impressions);
    const g = num(l.spend);
    gasto += g;
    impressoes += imp;
    cliques += num(l.clicks);
    const link = l.link_clicks != null ? num(l.link_clicks) : valorDaAcao(l.actions, ["link_click"]) ?? 0;
    cliquesLink += link;
    const f = num(l.frequency);
    if (f > 0 && imp > 0) {
      freqPeso += f * imp;
      impComFreq += imp;
    }
    for (const t of TIPOS_DE_RESULTADO) {
      if (t.tipo === "alcance") continue;
      const v = t.tipo === "cliques_link" ? link : valorDaAcao(l.actions, t.acoes);
      if (v != null) acoes[t.tipo] += v;
    }
    const vc = valorDaAcao(l.action_values, TIPOS_VALOR_COMPRA);
    if (vc != null) {
      valor += vc;
      temValor = true;
    }
    const objetivo = l.objective ?? (l.campaign_id && objetivoPorCampanha ? objetivoPorCampanha.get(l.campaign_id) ?? null : null);
    const tipo = tipoFixo ?? (tipoDoAd && tipoDoAd.has(l.ad_id) ? tipoDoAd.get(l.ad_id) ?? null : tipoDoResultado(objetivo, l.optimization_goal, l.actions));
    if (tipo) {
      gastoPorTipo.set(tipo, (gastoPorTipo.get(tipo) ?? 0) + g);
      if (tipo !== "alcance") {
        const v = tipo === "cliques_link" ? link : valorDaAcao(l.actions, ACOES_POR_TIPO.get(tipo) ?? []);
        if (v != null) resultadosPorTipo[tipo] += v;
      }
    }
    if (l.day) dias.add(String(l.day).slice(0, 10));
  }
  const frequencia = impComFreq > 0 ? arred(freqPeso / impComFreq) : null;
  const alcanceAprox = frequencia && frequencia > 0 ? Math.round(impressoes / frequencia) : null;
  acoes.alcance = alcanceAprox ?? 0;
  let principal: TipoDeResultado | null = tipoFixo ?? null;
  if (!principal) {
    let maior = -1;
    for (const [t, g] of gastoPorTipo) if (g > maior) { maior = g; principal = t; }
  }
  const resultados = principal === "alcance" ? alcanceAprox ?? 0 : principal ? resultadosPorTipo[principal] : 0;
  const ordenados = [...dias].sort();
  return {
    gasto: arred(gasto),
    impressoes,
    alcance_aprox: alcanceAprox,
    frequencia,
    cliques,
    cliques_link: cliquesLink,
    ctr: impressoes > 0 ? arred((cliques / impressoes) * 100) : null,
    ctr_link: impressoes > 0 ? arred((cliquesLink / impressoes) * 100) : null,
    cpc_link: razao(gasto, cliquesLink),
    cpm: impressoes > 0 ? arred((gasto / impressoes) * 1000) : null,
    resultado_tipo: principal,
    resultado_rotulo: rotuloDoTipo(principal),
    resultados,
    custo_por_resultado: resultados > 0 ? arred(gasto / resultados, principal === "alcance" ? 4 : 2) : null,
    acoes,
    valor_conversao: temValor ? arred(valor) : null,
    roas: temValor && gasto > 0 ? arred(valor / gasto) : null,
    dias: dias.size,
    inicio: ordenados[0] ?? null,
    fim: ordenados[ordenados.length - 1] ?? null,
  };
}

/**
 * O tipo de resultado de cada anúncio, olhando TODAS as linhas dele: um dia
 * sem mensagem não pode trocar o objetivo do anúncio naquele dia.
 */
export function tiposPorAnuncio(linhas: LinhaDiariaAds[], objetivoPorCampanha?: Map<string, string | null>): Map<string, TipoDeResultado | null> {
  const porAd = new Map<string, LinhaDiariaAds[]>();
  for (const l of linhas) {
    const lista = porAd.get(l.ad_id) ?? [];
    lista.push(l);
    porAd.set(l.ad_id, lista);
  }
  const saida = new Map<string, TipoDeResultado | null>();
  for (const [adId, ls] of porAd) {
    const primeira = ls.find((l) => l.objective || l.campaign_id) ?? ls[0];
    const objetivo = primeira.objective ?? (primeira.campaign_id && objetivoPorCampanha ? objetivoPorCampanha.get(primeira.campaign_id) ?? null : null);
    const otimizacao = (ls.find((l) => l.optimization_goal) ?? primeira).optimization_goal ?? null;
    const acoes = ([] as unknown[]).concat(...ls.map((l) => (Array.isArray(l.actions) ? (l.actions as unknown[]) : [])));
    saida.set(adId, tipoDoResultado(objetivo, otimizacao, acoes));
  }
  return saida;
}

/** Variação em % de b sobre a (positivo = subiu); null sem base. */
export function variacaoPct(atual: number | null | undefined, anterior: number | null | undefined): number | null {
  if (atual == null || anterior == null || !(anterior > 0)) return null;
  return arred((atual / anterior - 1) * 100, 1);
}

/** Comparação do período com o anterior de mesmo tamanho (tendência da conta). */
export function compararPeriodos(atual: MetricasCompletas, anterior: MetricasCompletas) {
  return {
    gasto_pct: variacaoPct(atual.gasto, anterior.gasto),
    resultados_pct: variacaoPct(atual.resultados, anterior.resultados),
    custo_por_resultado_pct: variacaoPct(atual.custo_por_resultado, anterior.custo_por_resultado),
    ctr_link_pct: variacaoPct(atual.ctr_link, anterior.ctr_link),
    cpm_pct: variacaoPct(atual.cpm, anterior.cpm),
    alcance_pct: variacaoPct(atual.alcance_aprox, anterior.alcance_aprox),
    anterior: {
      gasto: anterior.gasto,
      resultados: anterior.resultados,
      custo_por_resultado: anterior.custo_por_resultado,
      ctr_link: anterior.ctr_link,
      cpm: anterior.cpm,
    },
  };
}

export type PontoDiario = { dia: string; gasto: number; impressoes: number; cliques_link: number; resultados: number; custo_por_resultado: number | null };

/** Série diária da conta (ou de um recorte), com o resultado de cada linha pelo objetivo. */
export function serieDaConta(linhas: LinhaDiariaAds[], objetivoPorCampanha?: Map<string, string | null>): PontoDiario[] {
  const porDia = new Map<string, LinhaDiariaAds[]>();
  for (const l of linhas) {
    const d = String(l.day).slice(0, 10);
    const lista = porDia.get(d) ?? [];
    lista.push(l);
    porDia.set(d, lista);
  }
  const tipos = tiposPorAnuncio(linhas, objetivoPorCampanha);
  return [...porDia.keys()].sort().map((dia) => {
    const m = metricasCompletas(porDia.get(dia)!, tipos, objetivoPorCampanha);
    return { dia, gasto: m.gasto, impressoes: m.impressoes, cliques_link: m.cliques_link, resultados: m.resultados, custo_por_resultado: m.custo_por_resultado };
  });
}

// ------------------------------------------------------------------ saldo da conta

/**
 * Saldo disponível de conta pré-paga. A Meta não tem um campo numérico para
 * isso na leitura de anúncios: o valor vem no texto do meio de pagamento
 * (funding_source_details.display_string), por exemplo
 * "Saldo disponível (R$ 123,45 BRL)". Lê o número do texto; sem número, null.
 */
export function saldoDoTexto(texto: string | null | undefined): number | null {
  if (!texto) return null;
  const m = String(texto).match(/(?:R\$|BRL|US\$|\$)\s*([0-9][0-9.,]*)/i) ?? String(texto).match(/([0-9]{1,3}(?:[.,][0-9]{3})*[.,][0-9]{2})/);
  if (!m) return null;
  let bruto = m[1].replace(/\s/g, "");
  const ultimaVirgula = bruto.lastIndexOf(",");
  const ultimoPonto = bruto.lastIndexOf(".");
  if (ultimaVirgula > ultimoPonto) bruto = bruto.replace(/\./g, "").replace(",", ".");
  else bruto = bruto.replace(/,/g, "");
  const v = Number(bruto);
  return Number.isFinite(v) ? arred(v) : null;
}

export const STATUS_DA_CONTA_META: Record<number, string> = {
  1: "ativa",
  2: "desativada",
  3: "com pendência de pagamento",
  7: "em análise de risco",
  8: "aguardando acerto",
  9: "em período de carência",
  100: "encerramento pendente",
  101: "encerrada",
  201: "ativa (qualquer)",
  202: "encerrada (qualquer)",
};

export const rotuloDoStatusDaConta = (s: number | string | null | undefined): string | null => {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? STATUS_DA_CONTA_META[n] ?? `status ${n}` : null;
};

// ------------------------------------------------------------------ regras de evolução

/**
 * Limiares da evolução, à vista e testados. São pontos de decisão da equipe,
 * não verdade universal; a IA não mexe neles.
 */
export const REGRAS_DE_EVOLUCAO = {
  anuncios: {
    /** Abaixo disso não se decide nada: vira "observar". */
    impressoes_minimas: 1000,
    /** Gasto mínimo absoluto para julgar um anúncio (R$). */
    gasto_minimo: 20,
    /** Ou gasto de pelo menos N vezes o custo médio por resultado (espera-se N resultados). */
    gasto_em_resultados_esperados: 1.5,
    /** Com N resultados ou mais, já dá para comparar custo mesmo com pouco gasto. */
    resultados_para_comparar: 5,
    /** Vencedor: custo por resultado até 80% da média do tipo, com pelo menos 3 resultados. */
    vencedor_ate_da_media: 0.8,
    resultados_minimos_vencedor: 3,
    /** Descartar: custo 50% acima da média do tipo. */
    descartar_acima_da_media: 1.5,
    /** Descartar: gasto sem nenhum resultado de 2 vezes o custo médio. */
    gasto_sem_resultado_em_medias: 2,
    /** Sem média de custo na conta: impressões sem resultado para descartar. */
    impressoes_sem_resultado: 5000,
    /** Fadiga: frequência a partir disso com CTR caindo. */
    frequencia_fadiga: 3,
    /** CTR do link abaixo de metade da média da conta: atenção fraca. */
    ctr_fraco_da_media: 0.5,
  },
  organico: {
    /** Post precisa de pelo menos 24 h no ar e alcance medido. */
    horas_minimas: 24,
    alcance_minimo: 30,
    /** Média do perfil só com pelo menos 3 posts medidos. */
    posts_para_media: 3,
    /** Destaque: alcance ou engajamento 30% acima da média do perfil. */
    destaque_acima: 1.3,
    /** Abaixo: alcance até 60% da média e engajamento até 80%. */
    abaixo_alcance: 0.6,
    abaixo_engajamento: 0.8,
    /** "Pouca curtida, muito comentário": comentários por curtida a partir disso, com 3 comentários ou mais. */
    comentarios_por_curtida: 0.3,
    comentarios_minimos: 3,
    /** Salvamentos ou compartilhamentos por alcance em 2 vezes a média: conteúdo de referência ou que espalha. */
    salvos_ou_compart_acima: 2,
    /** Formato só entra em aprendizado com 2 posts medidos ou mais. */
    posts_por_formato: 2,
    /** Diferença entre formatos que vira aprendizado. */
    diferenca_de_formato: 1.5,
  },
} as const;

export type Canal = "anuncios" | "organico";

export type ItemDeEvolucao = {
  id: string;
  canal: Canal;
  nome: string;
  imagem_url: string | null;
  link: string | null;
  motivo: string;
  numeros: Record<string, number | string | null>;
};

export type TesteSugerido = {
  titulo: string;
  canal: Canal;
  hipotese: string;
  como: string;
  metrica: string;
  criterio: string;
  base_id: string | null;
};

export type Aprendizado = { canal: Canal; tipo: "repetir" | "evitar"; texto: string; chave: string };

export type LeituraDeEvolucao = {
  periodo: { inicio: string; fim: string };
  base: {
    anuncios: { avaliados: number; tipo_principal: TipoDeResultado | null; custo_medio_por_tipo: Partial<Record<TipoDeResultado, number>>; ctr_link_medio: number | null; custo_referencia_briefing: number | null };
    perfil: { avaliados: number; alcance_medio: number | null; engajamento_medio_pct: number | null; salvos_medio_pct: number | null; compart_medio_pct: number | null };
  };
  vencedores: ItemDeEvolucao[];
  manter: ItemDeEvolucao[];
  descartar: ItemDeEvolucao[];
  observar: ItemDeEvolucao[];
  conteudo: { destaques: ItemDeEvolucao[]; abaixo: ItemDeEvolucao[]; sinais: ItemDeEvolucao[] };
  proximos_testes: TesteSugerido[];
  aprendizados: Aprendizado[];
  limites: string[];
  regras: typeof REGRAS_DE_EVOLUCAO;
};

export type AnuncioParaEvolucao = {
  ad_id: string;
  nome: string;
  campanha: string | null;
  imagem_url: string | null;
  formato: "video" | "imagem" | null;
  cta: string | null;
  metricas: MetricasCompletas;
  /** Variação do CTR do link entre a primeira e a segunda metade do período (%). */
  ctr_var_pct?: number | null;
};

export type PostParaEvolucao = {
  media_id: string;
  media_type: string | null;
  caption: string | null;
  permalink: string | null;
  imagem_url: string | null;
  posted_at: string | null;
  reach: number | null;
  like_count: number | null;
  comments_count: number | null;
  saved: number | null;
  shares: number | null;
  total_interactions: number | null;
};

const reais = (v: number | null | undefined) => (v == null ? "sem dado" : `R$ ${v.toFixed(2).replace(".", ",")}`);
const inteiroBr = (v: number | null | undefined) => (v == null ? "sem dado" : Math.round(v).toLocaleString("pt-BR"));
const pctBr = (v: number | null | undefined, casas = 1) => (v == null ? "sem dado" : `${String(arred(v, casas)).replace(".", ",")}%`);
const vezes = (v: number) => `${String(arred(v, 1)).replace(".", ",")}x`;
const curto = (t: string | null | undefined, max = 60) => {
  const s = String(t ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).replace(/\s+\S*$/, "")}...` : s;
};
const semTravessao = (t: string) => t.replace(/\s*[\u2014\u2013]\s*/g, ", ");

/** Custo médio por resultado de cada tipo, só com anúncios que têm resultado. */
export function mediasPorTipo(anuncios: AnuncioParaEvolucao[]): Partial<Record<TipoDeResultado, number>> {
  const soma = new Map<TipoDeResultado, { g: number; r: number }>();
  for (const a of anuncios) {
    const t = a.metricas.resultado_tipo;
    if (!t || !(a.metricas.resultados > 0)) continue;
    const s = soma.get(t) ?? { g: 0, r: 0 };
    s.g += a.metricas.gasto;
    s.r += a.metricas.resultados;
    soma.set(t, s);
  }
  const saida: Partial<Record<TipoDeResultado, number>> = {};
  for (const [t, s] of soma) if (s.r > 0) saida[t] = arred(s.g / s.r, t === "alcance" ? 4 : 2);
  return saida;
}

/** Tipo de resultado do briefing (objetivo.acao) para usar o custo tolerável. */
export function tipoDoBriefing(acao: string | null | undefined): TipoDeResultado | null {
  const a = String(acao ?? "");
  if (a === "mensagens" || a === "agendamento") return "mensagens";
  if (a === "leads") return "leads";
  if (a === "vendas") return "compras";
  if (a === "trafego") return "visitas";
  if (a === "reconhecimento") return "alcance";
  return null;
}

/** Julga um anúncio: vencedor, manter, descartar ou observar, com motivo e números. */
export function julgarAnuncio(
  a: AnuncioParaEvolucao,
  ref: number | null,
  ctrMedio: number | null,
): { grupo: "vencedores" | "manter" | "descartar" | "observar"; item: ItemDeEvolucao } {
  const R = REGRAS_DE_EVOLUCAO.anuncios;
  const m = a.metricas;
  const sing = singularDoTipo(m.resultado_tipo);
  const numeros: ItemDeEvolucao["numeros"] = {
    gasto: m.gasto,
    impressoes: m.impressoes,
    resultados: m.resultados,
    tipo: m.resultado_rotulo,
    custo_por_resultado: m.custo_por_resultado,
    custo_medio_da_conta: ref,
    ctr_link: m.ctr_link,
    ctr_link_medio: ctrMedio,
    frequencia: m.frequencia,
  };
  const item = (motivo: string): ItemDeEvolucao => ({
    id: a.ad_id, canal: "anuncios", nome: a.nome, imagem_url: a.imagem_url, link: null, motivo: semTravessao(motivo), numeros,
  });
  const gastoMinimo = Math.max(R.gasto_minimo, ref ? ref * R.gasto_em_resultados_esperados : 0);
  const temVolume = m.impressoes >= R.impressoes_minimas && (m.gasto >= gastoMinimo || m.resultados >= R.resultados_para_comparar);
  if (!temVolume) {
    return {
      grupo: "observar",
      item: item(`Pouco volume para decidir: ${inteiroBr(m.impressoes)} impressões e ${reais(m.gasto)} gastos. Precisa de ${inteiroBr(R.impressoes_minimas)} impressões e ${reais(gastoMinimo)} (ou ${R.resultados_para_comparar} ${sing}s).`),
    };
  }
  const fadiga = (m.frequencia ?? 0) >= R.frequencia_fadiga && a.ctr_var_pct != null && a.ctr_var_pct <= -20;
  if (m.resultados <= 0) {
    const queimou = ref ? m.gasto >= ref * R.gasto_sem_resultado_em_medias : m.impressoes >= R.impressoes_sem_resultado;
    if (queimou) {
      return {
        grupo: "descartar",
        item: item(ref
          ? `Gastou ${reais(m.gasto)} sem nenhum(a) ${sing}; a média da conta é ${reais(ref)} por ${sing}.`
          : `${inteiroBr(m.impressoes)} impressões e ${reais(m.gasto)} sem nenhum(a) ${sing}.`),
      };
    }
    return { grupo: "observar", item: item(`Ainda sem ${sing} com ${reais(m.gasto)} gastos; espere até ${reais(ref ? ref * R.gasto_sem_resultado_em_medias : null)} antes de cortar.`) };
  }
  const cpr = m.custo_por_resultado;
  if (ref && cpr != null && cpr >= ref * R.descartar_acima_da_media) {
    return {
      grupo: "descartar",
      item: item(`Custa ${reais(cpr)} por ${sing}, ${Math.round((cpr / ref - 1) * 100)}% acima da média da conta (${reais(ref)}), com ${inteiroBr(m.resultados)} ${sing}s.`),
    };
  }
  if (ref && cpr != null && cpr <= ref * R.vencedor_ate_da_media && m.resultados >= R.resultados_minimos_vencedor) {
    const extra = fadiga ? ` Atenção: frequência ${String(m.frequencia).replace(".", ",")} e CTR caindo ${pctBr(Math.abs(a.ctr_var_pct ?? 0), 0)}; renove a execução mantendo o ângulo.` : "";
    return {
      grupo: "vencedores",
      item: item(`Custa ${reais(cpr)} por ${sing}, ${Math.round((1 - cpr / ref) * 100)}% abaixo da média da conta (${reais(ref)}), com ${inteiroBr(m.resultados)} ${sing}s.${extra}`),
    };
  }
  if (fadiga) {
    return {
      grupo: "manter",
      item: item(`Traz ${sing}s a ${reais(cpr)}, mas cansou: frequência ${String(m.frequencia).replace(".", ",")} e CTR caindo ${pctBr(Math.abs(a.ctr_var_pct ?? 0), 0)}. Manter até a nova versão entrar.`),
    };
  }
  const fraco = ctrMedio && m.ctr_link != null && m.ctr_link < ctrMedio * R.ctr_fraco_da_media;
  return {
    grupo: "manter",
    item: item(`Dentro da média: ${reais(cpr)} por ${sing}${ref ? ` (média ${reais(ref)})` : ""}, ${inteiroBr(m.resultados)} ${sing}s.${fraco ? ` CTR do link de ${pctBr(m.ctr_link, 2)}, menos da metade da média (${pctBr(ctrMedio, 2)}): o gancho pode melhorar.` : ""}`),
  };
}

type PostMedido = PostParaEvolucao & { eng_pct: number; salvos_pct: number; compart_pct: number; interacoes: number };

function medir(p: PostParaEvolucao): PostMedido {
  const alcance = num(p.reach);
  const curtidas = num(p.like_count), comentarios = num(p.comments_count), salvos = num(p.saved), compart = num(p.shares);
  const interacoes = p.total_interactions != null ? num(p.total_interactions) : curtidas + comentarios + salvos + compart;
  return {
    ...p,
    interacoes,
    eng_pct: alcance > 0 ? (interacoes / alcance) * 100 : 0,
    salvos_pct: alcance > 0 ? (salvos / alcance) * 100 : 0,
    compart_pct: alcance > 0 ? (compart / alcance) * 100 : 0,
  };
}

const media = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);

export const FORMATO_DO_POST: Record<string, string> = {
  VIDEO: "vídeo (Reels)",
  REELS: "vídeo (Reels)",
  IMAGE: "imagem única",
  CAROUSEL_ALBUM: "carrossel",
};
const formatoDoPost = (t: string | null) => FORMATO_DO_POST[String(t ?? "").toUpperCase()] ?? (t ? String(t).toLowerCase() : "outro");

/** Julga os posts do perfil contra a média do próprio perfil. */
export function julgarPosts(posts: PostParaEvolucao[], agora = Date.now()) {
  const R = REGRAS_DE_EVOLUCAO.organico;
  const medidos = posts
    .filter((p) => p.reach != null && num(p.reach) >= R.alcance_minimo)
    .filter((p) => !p.posted_at || agora - new Date(p.posted_at).getTime() >= R.horas_minimas * 3600_000)
    .map(medir);
  const base = {
    avaliados: medidos.length,
    alcance_medio: medidos.length >= R.posts_para_media ? Math.round(media(medidos.map((p) => num(p.reach)))!) : null,
    engajamento_medio_pct: medidos.length >= R.posts_para_media ? arred(media(medidos.map((p) => p.eng_pct))!) : null,
    salvos_medio_pct: medidos.length >= R.posts_para_media ? arred(media(medidos.map((p) => p.salvos_pct))!, 3) : null,
    compart_medio_pct: medidos.length >= R.posts_para_media ? arred(media(medidos.map((p) => p.compart_pct))!, 3) : null,
  };
  const destaques: ItemDeEvolucao[] = [];
  const abaixo: ItemDeEvolucao[] = [];
  const sinais: ItemDeEvolucao[] = [];
  if (base.alcance_medio == null || base.engajamento_medio_pct == null) return { base, destaques, abaixo, sinais, medidos };
  const am = base.alcance_medio, em = base.engajamento_medio_pct;
  for (const p of medidos) {
    const alcance = num(p.reach);
    const numeros: ItemDeEvolucao["numeros"] = {
      alcance, alcance_medio: am, engajamento_pct: arred(p.eng_pct), engajamento_medio_pct: em,
      curtidas: p.like_count, comentarios: p.comments_count, salvos: p.saved, compartilhamentos: p.shares, formato: formatoDoPost(p.media_type),
    };
    const item = (motivo: string): ItemDeEvolucao => ({
      id: p.media_id, canal: "organico", nome: curto(p.caption) || `Post de ${String(p.posted_at ?? "").slice(0, 10)}`,
      imagem_url: p.imagem_url, link: p.permalink, motivo: semTravessao(motivo), numeros,
    });
    if (alcance >= am * R.destaque_acima || (p.eng_pct >= em * R.destaque_acima && alcance >= am * 0.7)) {
      destaques.push(item(alcance >= am * R.destaque_acima
        ? `Alcançou ${inteiroBr(alcance)} pessoas, ${vezes(alcance / am)} a média do perfil (${inteiroBr(am)}).`
        : `Engajamento de ${pctBr(p.eng_pct)} do alcance, acima da média do perfil (${pctBr(em)}).`));
    } else if (alcance <= am * R.abaixo_alcance && p.eng_pct <= em * R.abaixo_engajamento) {
      abaixo.push(item(`Não funcionou: alcance de ${inteiroBr(alcance)} (média ${inteiroBr(am)}) e engajamento de ${pctBr(p.eng_pct)} (média ${pctBr(em)}).`));
    }
    const curt = num(p.like_count), com = num(p.comments_count);
    if (com >= R.comentarios_minimos && com >= Math.max(1, curt) * R.comentarios_por_curtida) {
      sinais.push(item(`Pouca curtida e muito comentário: ${inteiroBr(com)} comentários para ${inteiroBr(curt)} curtidas. O post puxou conversa (pergunta, dúvida ou opinião); vale repetir o gancho e responder rápido.`));
    }
    if (base.salvos_medio_pct != null && base.salvos_medio_pct > 0 && p.salvos_pct >= base.salvos_medio_pct * R.salvos_ou_compart_acima && num(p.saved) >= 3) {
      sinais.push(item(`Conteúdo de referência: ${inteiroBr(p.saved)} salvamentos (${pctBr(p.salvos_pct, 2)} do alcance, média ${pctBr(base.salvos_medio_pct, 2)}). As pessoas guardam para depois.`));
    }
    if (base.compart_medio_pct != null && base.compart_medio_pct > 0 && p.compart_pct >= base.compart_medio_pct * R.salvos_ou_compart_acima && num(p.shares) >= 3) {
      sinais.push(item(`Conteúdo que espalha: ${inteiroBr(p.shares)} compartilhamentos (${pctBr(p.compart_pct, 2)} do alcance, média ${pctBr(base.compart_medio_pct, 2)}).`));
    }
  }
  const porAlcance = (a: ItemDeEvolucao, b: ItemDeEvolucao) => num(b.numeros.alcance) - num(a.numeros.alcance);
  destaques.sort(porAlcance);
  abaixo.sort((a, b) => num(a.numeros.alcance) - num(b.numeros.alcance));
  return { base, destaques, abaixo, sinais, medidos };
}

/** Aprendizados de formato e de conversa no orgânico (com volume mínimo). */
export function aprendizadosDoOrganico(medidos: PostMedido[]): Aprendizado[] {
  const R = REGRAS_DE_EVOLUCAO.organico;
  const saida: Aprendizado[] = [];
  const porFormato = new Map<string, PostMedido[]>();
  for (const p of medidos) {
    const f = formatoDoPost(p.media_type);
    const l = porFormato.get(f) ?? [];
    l.push(p);
    porFormato.set(f, l);
  }
  const formatos = [...porFormato.entries()]
    .filter(([, l]) => l.length >= R.posts_por_formato)
    .map(([f, l]) => ({ f, n: l.length, alcance: media(l.map((p) => num(p.reach)))!, eng: media(l.map((p) => p.eng_pct))! }))
    .sort((a, b) => b.alcance - a.alcance);
  if (formatos.length >= 2) {
    const melhor = formatos[0], pior = formatos[formatos.length - 1];
    if (pior.alcance > 0 && melhor.alcance / pior.alcance >= R.diferenca_de_formato) {
      saida.push({
        canal: "organico", tipo: "repetir", chave: `formato:${melhor.f}`,
        texto: `No perfil, ${melhor.f} alcançou em média ${inteiroBr(melhor.alcance)} pessoas contra ${inteiroBr(pior.alcance)} de ${pior.f} (${vezes(melhor.alcance / pior.alcance)}, ${melhor.n} e ${pior.n} posts). Priorizar ${melhor.f}.`,
      });
      saida.push({
        canal: "organico", tipo: "evitar", chave: `formato:${pior.f}`,
        texto: `No perfil, ${pior.f} foi o formato de menor alcance (média ${inteiroBr(pior.alcance)} em ${pior.n} posts). Usar só quando o conteúdo pedir esse formato.`,
      });
    }
  }
  // Pergunta na legenda puxa comentário? Só com 2 posts de cada lado.
  const comPergunta = medidos.filter((p) => /\?/.test(String(p.caption ?? "")));
  const semPergunta = medidos.filter((p) => !/\?/.test(String(p.caption ?? "")));
  if (comPergunta.length >= 2 && semPergunta.length >= 2) {
    const taxa = (l: PostMedido[]) => media(l.map((p) => (num(p.reach) > 0 ? (num(p.comments_count) / num(p.reach)) * 100 : 0)))!;
    const a = taxa(comPergunta), b = taxa(semPergunta);
    if (b > 0 && a / b >= R.diferenca_de_formato) {
      saida.push({
        canal: "organico", tipo: "repetir", chave: "legenda:pergunta",
        texto: `Legendas com pergunta tiveram ${vezes(a / b)} mais comentários por alcance (${pctBr(a, 2)} contra ${pctBr(b, 2)}). Fechar a legenda com uma pergunta simples.`,
      });
    }
  }
  return saida;
}

/** Aprendizados dos anúncios por formato (vídeo x imagem), com volume mínimo. */
export function aprendizadosDosAnuncios(anuncios: AnuncioParaEvolucao[]): Aprendizado[] {
  const saida: Aprendizado[] = [];
  const porTipo = new Map<TipoDeResultado, AnuncioParaEvolucao[]>();
  for (const a of anuncios) {
    const t = a.metricas.resultado_tipo;
    if (!t || a.metricas.impressoes < REGRAS_DE_EVOLUCAO.anuncios.impressoes_minimas) continue;
    const l = porTipo.get(t) ?? [];
    l.push(a);
    porTipo.set(t, l);
  }
  for (const [tipo, lista] of porTipo) {
    const grupos = new Map<string, AnuncioParaEvolucao[]>();
    for (const a of lista) if (a.formato) grupos.set(a.formato, [...(grupos.get(a.formato) ?? []), a]);
    const custo = (l: AnuncioParaEvolucao[]) => {
      const g = l.reduce((s, a) => s + a.metricas.gasto, 0);
      const r = l.reduce((s, a) => s + a.metricas.resultados, 0);
      return r > 0 ? g / r : null;
    };
    const v = grupos.get("video") ?? [], i = grupos.get("imagem") ?? [];
    const cv = custo(v), ci = custo(i);
    const sing = singularDoTipo(tipo);
    if (v.length >= 2 && i.length >= 2 && cv && ci) {
      const [melhor, pior, cm, cp] = cv < ci ? ["vídeo", "imagem", cv, ci] as const : ["imagem", "vídeo", ci, cv] as const;
      if (cp / cm >= 1.3) {
        saida.push({
          canal: "anuncios", tipo: "repetir", chave: `anuncio-formato:${tipo}:${melhor}`,
          texto: `Nos anúncios de ${rotuloDoTipo(tipo).toLowerCase()}, ${melhor} custou ${reais(cm)} por ${sing} contra ${reais(cp)} de ${pior}. Priorizar ${melhor} neste objetivo.`,
        });
        saida.push({
          canal: "anuncios", tipo: "evitar", chave: `anuncio-formato:${tipo}:${pior}`,
          texto: `Nos anúncios de ${rotuloDoTipo(tipo).toLowerCase()}, ${pior} saiu ${Math.round((cp / cm - 1) * 100)}% mais caro por ${sing}. Evitar ${pior} até um teste novo mostrar o contrário.`,
        });
      }
    }
  }
  return saida;
}

/**
 * A leitura completa de evolução, só com regra em código.
 * `custoToleravel` e `tipoToleravel` vêm do briefing de ads (quando houver).
 */
export function lerEvolucao(entrada: {
  periodo: { inicio: string; fim: string };
  anuncios: AnuncioParaEvolucao[];
  posts: PostParaEvolucao[];
  custoToleravel?: number | null;
  tipoToleravel?: TipoDeResultado | null;
  agora?: number;
}): LeituraDeEvolucao {
  const medias = mediasPorTipo(entrada.anuncios);
  const comEntrega = entrada.anuncios.filter((a) => a.metricas.impressoes > 0);
  const impTot = comEntrega.reduce((s, a) => s + a.metricas.impressoes, 0);
  const linkTot = comEntrega.reduce((s, a) => s + a.metricas.cliques_link, 0);
  const ctrMedio = impTot > 0 ? arred((linkTot / impTot) * 100) : null;
  const gastoPorTipo = new Map<TipoDeResultado, number>();
  for (const a of comEntrega) if (a.metricas.resultado_tipo) gastoPorTipo.set(a.metricas.resultado_tipo, (gastoPorTipo.get(a.metricas.resultado_tipo) ?? 0) + a.metricas.gasto);
  let tipoPrincipal: TipoDeResultado | null = null;
  let maior = -1;
  for (const [t, g] of gastoPorTipo) if (g > maior) { maior = g; tipoPrincipal = t; }

  const grupos = { vencedores: [] as ItemDeEvolucao[], manter: [] as ItemDeEvolucao[], descartar: [] as ItemDeEvolucao[], observar: [] as ItemDeEvolucao[] };
  for (const a of comEntrega) {
    const t = a.metricas.resultado_tipo;
    const tolera = entrada.custoToleravel && entrada.custoToleravel > 0 && t && t === entrada.tipoToleravel ? entrada.custoToleravel : null;
    const ref = tolera ?? (t ? medias[t] ?? null : null);
    const j = julgarAnuncio(a, ref, ctrMedio);
    if (tolera) j.item.numeros.custo_referencia_fonte = "briefing";
    grupos[j.grupo].push(j.item);
  }
  const porGasto = (x: ItemDeEvolucao, y: ItemDeEvolucao) => num(y.numeros.gasto) - num(x.numeros.gasto);
  grupos.vencedores.sort((x, y) => num(x.numeros.custo_por_resultado) - num(y.numeros.custo_por_resultado));
  grupos.manter.sort(porGasto);
  grupos.descartar.sort(porGasto);
  grupos.observar.sort(porGasto);

  const organico = julgarPosts(entrada.posts, entrada.agora);
  const aprendizados = [...aprendizadosDosAnuncios(comEntrega), ...aprendizadosDoOrganico(organico.medidos)];
  // O que venceu e o que foi descartado também ensinam, com nome e número.
  for (const v of grupos.vencedores.slice(0, 2)) {
    aprendizados.push({ canal: "anuncios", tipo: "repetir", chave: `vencedor:${v.id}`, texto: `Anúncio vencedor "${curto(v.nome, 50)}": ${v.motivo}` });
  }
  for (const d of grupos.descartar.slice(0, 2)) {
    aprendizados.push({ canal: "anuncios", tipo: "evitar", chave: `descartado:${d.id}`, texto: `Anúncio descartado "${curto(d.nome, 50)}": ${d.motivo}` });
  }
  for (const s of organico.sinais.slice(0, 2)) {
    aprendizados.push({ canal: "organico", tipo: "repetir", chave: `sinal:${s.id}`, texto: `Post "${curto(s.nome, 50)}": ${s.motivo}` });
  }
  for (const b of organico.abaixo.slice(0, 1)) {
    aprendizados.push({ canal: "organico", tipo: "evitar", chave: `abaixo:${b.id}`, texto: `Post "${curto(b.nome, 50)}": ${b.motivo}` });
  }

  const testes: TesteSugerido[] = [];
  for (const v of grupos.vencedores.slice(0, 2)) {
    const cpr = num(v.numeros.custo_por_resultado);
    testes.push({
      titulo: `Variar o vencedor "${curto(v.nome, 40)}"`,
      canal: "anuncios",
      hipotese: `Se mantivermos a oferta e o formato do vencedor e trocarmos só o gancho (primeiros 3 segundos ou primeira linha), o custo continua perto de ${reais(cpr)} e a conta ganha fôlego contra a fadiga.`,
      como: "2 a 3 variações, uma variável por vez, no mesmo conjunto do vencedor.",
      metrica: `Custo por ${String(v.numeros.tipo ?? "resultado").toLowerCase()}`,
      criterio: `Manter a variação que ficar até ${reais(arred(cpr * 1.1))}; cortar a que passar de ${reais(arred(cpr * 1.5))} depois de ${reais(arred(Math.max(20, cpr * 2)))} gastos.`,
      base_id: v.id,
    });
  }
  const postTop = organico.destaques[0];
  if (postTop) {
    testes.push({
      titulo: `Levar o post "${curto(postTop.nome, 40)}" para anúncio`,
      canal: "organico",
      hipotese: `O post alcançou ${inteiroBr(num(postTop.numeros.alcance))} pessoas no orgânico (${postTop.motivo.toLowerCase()}). Como anúncio, o mesmo gancho tende a segurar a atenção mais barato.`,
      como: "Impulsionar o próprio post ou recriar a peça no formato do anúncio com o mesmo gancho.",
      metrica: tipoPrincipal ? `Custo por ${singularDoTipo(tipoPrincipal)}` : "CTR do link e custo por resultado",
      criterio: tipoPrincipal && medias[tipoPrincipal] ? `Bom se ficar abaixo de ${reais(medias[tipoPrincipal]!)} (média da conta).` : "Comparar com a média da conta depois de 1.000 impressões.",
      base_id: postTop.id,
    });
  }
  if (!grupos.vencedores.length && grupos.descartar.length) {
    testes.push({
      titulo: "Testar ângulos novos",
      canal: "anuncios",
      hipotese: "Nenhum anúncio ficou abaixo da média e há peças para cortar: o problema tende a ser o ângulo (a mensagem), não o ajuste fino.",
      como: "3 ângulos diferentes (dor, prova, oferta), mesmo público e mesma verba por ângulo.",
      metrica: tipoPrincipal ? `Custo por ${singularDoTipo(tipoPrincipal)}` : "Custo por resultado",
      criterio: "Decidir com pelo menos 1.000 impressões por ângulo; ficar com o que tiver o menor custo.",
      base_id: null,
    });
  }
  const sinalConversa = organico.sinais.find((s) => s.motivo.indexOf("Pouca curtida") === 0);
  if (sinalConversa) {
    testes.push({
      titulo: "Repetir o gancho de conversa",
      canal: "organico",
      hipotese: `O post "${curto(sinalConversa.nome, 40)}" puxou comentário mais do que curtida: o público quer conversar sobre o tema.`,
      como: "Um post novo com a mesma pergunta ou polêmica, e um anúncio de mensagem com esse gancho.",
      metrica: "Comentários por alcance e conversas iniciadas",
      criterio: "Bom se passar da média de comentários do perfil.",
      base_id: sinalConversa.id,
    });
  }

  const limites = [
    "Alcance de anúncio é aproximado (impressões divididas pela frequência); a Meta não soma alcance entre dias.",
    "Qualidade do contato e venda fechada não vêm da Meta: \"contatos ruins\" só se leem com o comercial.",
  ];
  if (!entrada.posts.length) limites.push("Sem posts medidos do Instagram no período.");
  if (!comEntrega.length) limites.push("Sem anúncios com entrega no período.");
  if (organico.base.alcance_medio == null && entrada.posts.length) limites.push(`Menos de ${REGRAS_DE_EVOLUCAO.organico.posts_para_media} posts com alcance medido: sem média do perfil para comparar.`);

  return {
    periodo: entrada.periodo,
    base: {
      anuncios: { avaliados: comEntrega.length, tipo_principal: tipoPrincipal, custo_medio_por_tipo: medias, ctr_link_medio: ctrMedio, custo_referencia_briefing: entrada.custoToleravel ?? null },
      perfil: organico.base,
    },
    ...grupos,
    conteudo: { destaques: organico.destaques.slice(0, 8), abaixo: organico.abaixo.slice(0, 8), sinais: organico.sinais.slice(0, 8) },
    proximos_testes: testes.slice(0, 5),
    aprendizados: aprendizados.map((a) => ({ ...a, texto: semTravessao(a.texto) })),
    limites,
    regras: REGRAS_DE_EVOLUCAO,
  };
}

// ------------------------------------------------------------------ memória dos agentes

/** Agente que lê o aprendizado: anúncios vão ao estrategista de ads; orgânico, ao estrategista da Mesa. */
export const AGENTE_DO_CANAL: Record<Canal, "estrategista_ads" | "estrategista"> = {
  anuncios: "estrategista_ads",
  organico: "estrategista",
};

export const PREFIXO_DA_MEMORIA = "Evolução";

/** Texto da memória com a janela e a chave (a chave evita repetir o mesmo aprendizado). */
export function textoDaMemoria(a: Aprendizado, periodo: { inicio: string; fim: string }): string {
  const d = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  return `${PREFIXO_DA_MEMORIA} ${d(periodo.inicio)} a ${d(periodo.fim)} [${a.chave}]: ${a.texto}`.slice(0, 4000);
}

/** Chave gravada no texto da memória ("[chave]"), para não repetir. */
export function chaveDaMemoria(texto: string): string | null {
  const m = String(texto ?? "").match(/\[([^\]]{1,120})\]:/);
  return m ? m[1] : null;
}

// ------------------------------------------------------------------ leitura do banco

/** O mínimo do supabase-js que a leitura usa (tipo estrutural, sem importar a biblioteca). */
// deno-lint-ignore no-explicit-any
export type Banco = { from: (tabela: string) => any };

const COLUNAS_DIARIA_BASE = "ad_id, campaign_id, day, spend, impressions, reach, clicks, link_clicks, frequency, actions";
const COLUNAS_DIARIA_NOVAS = `${COLUNAS_DIARIA_BASE}, adset_id, adset_name, objective, optimization_goal, action_values`;

/** Coluna que ainda não existe (SQL novo não aplicado): o PostgREST responde 42703 ou PGRST204. */
const colunaFaltando = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42703" || e.code === "PGRST204" || /column .* does not exist/i.test(String(e.message ?? "")));

/** Linhas diárias de anúncio do cliente no período, paginadas, com as colunas novas quando existirem. */
export async function lerDiariasAds(banco: Banco, clientId: string, inicio: string, fim: string): Promise<LinhaDiariaAds[]> {
  let colunas = COLUNAS_DIARIA_NOVAS;
  const saida: LinhaDiariaAds[] = [];
  for (let pagina = 0; pagina < 40; pagina++) {
    const { data, error } = await banco.from("ads_creative_daily").select(colunas).eq("client_id", clientId)
      .gte("day", inicio).lte("day", fim).order("day").order("ad_id").range(pagina * 1000, pagina * 1000 + 999);
    if (error && colunas !== COLUNAS_DIARIA_BASE && colunaFaltando(error)) {
      colunas = COLUNAS_DIARIA_BASE;
      pagina--;
      continue;
    }
    if (error) throw new Error("metricas_indisponiveis");
    const linhas = (data as LinhaDiariaAds[] | null) ?? [];
    saida.push(...linhas);
    if (linhas.length < 1000) break;
  }
  return saida;
}

export type SaldoDaConta = {
  external_account_id: string;
  nome: string | null;
  numero: string | null;
  moeda: string | null;
  status: string | null;
  motivo_bloqueio: string | null;
  gasto_total: number | null;
  saldo_a_pagar: number | null;
  limite_de_gasto: number | null;
  restante_do_limite: number | null;
  saldo_disponivel: number | null;
  pre_paga: boolean | null;
  pagamento: string | null;
  empresa: string | null;
  coletado_em: string | null;
  erro: string | null;
};

/** Saldo e situação das contas de anúncio do cliente (ads_account_snapshot; sem a tabela ainda, lista vazia). */
export async function lerSaldosDasContas(banco: Banco, clientId: string): Promise<{ contas: SaldoDaConta[]; disponivel: boolean }> {
  const contasQ = await banco.from("external_accounts").select("id, display_name, external_id, status").eq("client_id", clientId).eq("platform", "meta_ads");
  const ligadas = ((contasQ.data as { id: string; display_name: string | null; external_id: string | null; status: string }[] | null) ?? []).filter((c) => c.status === "active");
  if (!ligadas.length) return { contas: [], disponivel: true };
  const { data, error } = await banco.from("ads_account_snapshot")
    .select("external_account_id, currency, account_status, disable_reason, amount_spent, balance, spend_cap, saldo_disponivel, is_prepay_account, funding_display, business_name, coletado_em, erro")
    .eq("client_id", clientId);
  const fotos = new Map(((data as Record<string, unknown>[] | null) ?? []).map((r) => [String(r.external_account_id), r]));
  const contas = ligadas.map((c) => {
    const r = fotos.get(c.id) ?? {};
    const gasto = r.amount_spent != null ? num(r.amount_spent) : null;
    const limite = r.spend_cap != null && num(r.spend_cap) > 0 ? num(r.spend_cap) : null;
    return {
      external_account_id: c.id,
      nome: c.display_name,
      numero: c.external_id,
      moeda: (r.currency as string) ?? null,
      status: rotuloDoStatusDaConta(r.account_status as number | null),
      motivo_bloqueio: r.disable_reason != null && num(r.disable_reason) > 0 ? `código ${num(r.disable_reason)}` : null,
      gasto_total: gasto,
      saldo_a_pagar: r.balance != null ? num(r.balance) : null,
      limite_de_gasto: limite,
      restante_do_limite: limite != null && gasto != null ? arred(Math.max(0, limite - gasto)) : null,
      saldo_disponivel: r.saldo_disponivel != null ? num(r.saldo_disponivel) : null,
      pre_paga: typeof r.is_prepay_account === "boolean" ? r.is_prepay_account : null,
      pagamento: (r.funding_display as string) ?? null,
      empresa: (r.business_name as string) ?? null,
      coletado_em: (r.coletado_em as string) ?? null,
      erro: (r.erro as string) ?? null,
    };
  });
  return { contas, disponivel: !error };
}

export type DesempenhoOrganico = {
  contas: { external_account_id: string; handle: string | null; seguidores: number | null; seguidores_variacao: number | null }[];
  semanas: { week_start: string; alcance: number | null; interacoes: number | null; visitas_perfil: number | null; contas_engajadas: number | null; seguidores: number | null }[];
  totais: { alcance_semanas: number | null; interacoes: number; curtidas: number; comentarios: number; salvos: number; compartilhamentos: number; posts: number; posts_medidos: number };
  posts: PostParaEvolucao[];
};

/** Perfil orgânico no período: semanas (alcance, interações, seguidores) e posts com métricas. */
export async function lerOrganico(banco: Banco, clientId: string, inicio: string, fim: string): Promise<DesempenhoOrganico> {
  const desdeSemana = somarDiasIso(inicio, -6);
  const [semQ, postQ, contasQ] = await Promise.all([
    banco.from("social_metrics_weekly")
      .select("external_account_id, week_start, week_end, followers, reach, profile_views, accounts_engaged, total_interactions")
      .eq("client_id", clientId).gte("week_start", desdeSemana).lte("week_start", fim).order("week_start"),
    banco.from("social_post_metrics")
      .select("media_id, media_type, caption, permalink, media_url, thumbnail_url, posted_at, like_count, comments_count, reach, saved, shares, total_interactions")
      .eq("client_id", clientId).gte("posted_at", `${inicio}T00:00:00-03:00`).lte("posted_at", `${fim}T23:59:59-03:00`)
      .order("posted_at", { ascending: false }).limit(300),
    banco.from("external_accounts").select("id, handle, display_name").eq("client_id", clientId).eq("platform", "instagram").eq("status", "active"),
  ]);
  const semanasBrutas = (semQ.data as Record<string, unknown>[] | null) ?? [];
  const porSemana = new Map<string, { alcance: number | null; interacoes: number | null; visitas_perfil: number | null; contas_engajadas: number | null; seguidores: number | null }>();
  const soma = (a: number | null, b: unknown) => (b == null ? a : (a ?? 0) + num(b));
  for (const s of semanasBrutas) {
    const k = String(s.week_start);
    const atual = porSemana.get(k) ?? { alcance: null, interacoes: null, visitas_perfil: null, contas_engajadas: null, seguidores: null };
    atual.alcance = soma(atual.alcance, s.reach);
    atual.interacoes = soma(atual.interacoes, s.total_interactions);
    atual.visitas_perfil = soma(atual.visitas_perfil, s.profile_views);
    atual.contas_engajadas = soma(atual.contas_engajadas, s.accounts_engaged);
    atual.seguidores = soma(atual.seguidores, s.followers);
    porSemana.set(k, atual);
  }
  const semanas = [...porSemana.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([week_start, v]) => ({ week_start, ...v }));
  const contas = ((contasQ.data as { id: string; handle: string | null; display_name: string | null }[] | null) ?? []).map((c) => {
    const linhas = semanasBrutas.filter((s) => s.external_account_id === c.id && s.followers != null);
    const primeiro = linhas[0], ultimo = linhas[linhas.length - 1];
    return {
      external_account_id: c.id,
      handle: c.handle ?? c.display_name,
      seguidores: ultimo ? num(ultimo.followers) : null,
      seguidores_variacao: primeiro && ultimo && primeiro !== ultimo ? num(ultimo.followers) - num(primeiro.followers) : null,
    };
  });
  const posts: PostParaEvolucao[] = ((postQ.data as Record<string, unknown>[] | null) ?? []).map((p) => ({
    media_id: String(p.media_id),
    media_type: (p.media_type as string) ?? null,
    caption: (p.caption as string) ?? null,
    permalink: (p.permalink as string) ?? null,
    imagem_url: ((p.thumbnail_url as string) || (p.media_url as string)) ?? null,
    posted_at: (p.posted_at as string) ?? null,
    reach: p.reach != null ? num(p.reach) : null,
    like_count: p.like_count != null ? num(p.like_count) : null,
    comments_count: p.comments_count != null ? num(p.comments_count) : null,
    saved: p.saved != null ? num(p.saved) : null,
    shares: p.shares != null ? num(p.shares) : null,
    total_interactions: p.total_interactions != null ? num(p.total_interactions) : null,
  }));
  const alcanceSemanas = semanas.filter((s) => s.week_start >= somarDiasIso(inicio, -3)).reduce((t, s) => (s.alcance == null ? t : (t ?? 0) + s.alcance), null as number | null);
  return {
    contas,
    semanas,
    totais: {
      alcance_semanas: alcanceSemanas,
      interacoes: posts.reduce((t, p) => t + (p.total_interactions != null ? num(p.total_interactions) : num(p.like_count) + num(p.comments_count) + num(p.saved) + num(p.shares)), 0),
      curtidas: posts.reduce((t, p) => t + num(p.like_count), 0),
      comentarios: posts.reduce((t, p) => t + num(p.comments_count), 0),
      salvos: posts.reduce((t, p) => t + num(p.saved), 0),
      compartilhamentos: posts.reduce((t, p) => t + num(p.shares), 0),
      posts: posts.length,
      posts_medidos: posts.filter((p) => p.reach != null).length,
    },
    posts,
  };
}

/** Soma dias numa data ISO (AAAA-MM-DD), em UTC para não escorregar de fuso. */
export function somarDiasIso(data: string, n: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Hoje em São Paulo (AAAA-MM-DD). */
export function hojeEmSaoPaulo(agora = Date.now()): string {
  return new Date(agora - 3 * 3600_000).toISOString().slice(0, 10);
}

/** Período pelo pedido: inicio/fim explícitos (até 180 dias) ou os últimos N dias. */
export function periodoDoPedido(corpo: { dias?: unknown; inicio?: unknown; fim?: unknown }, permitidos = [7, 14, 30, 60, 90], padrao = 30, hoje = hojeEmSaoPaulo()) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const ini = typeof corpo.inicio === "string" && iso.test(corpo.inicio) ? corpo.inicio : null;
  const fimP = typeof corpo.fim === "string" && iso.test(corpo.fim) ? corpo.fim : null;
  if (ini && fimP && ini <= fimP) {
    const inicio = ini < somarDiasIso(fimP, -179) ? somarDiasIso(fimP, -179) : ini;
    const dias = Math.round((new Date(`${fimP}T12:00:00Z`).getTime() - new Date(`${inicio}T12:00:00Z`).getTime()) / 86400_000) + 1;
    return { inicio, fim: fimP, dias };
  }
  const dias = permitidos.indexOf(Number(corpo.dias)) >= 0 ? Number(corpo.dias) : padrao;
  return { inicio: somarDiasIso(hoje, -(dias - 1)), fim: hoje, dias };
}

export type DesempenhoDoCliente = {
  periodo: { inicio: string; fim: string; dias: number };
  organico: Omit<DesempenhoOrganico, "posts"> & { melhores_posts: PostParaEvolucao[] };
  anuncios: {
    conectada: boolean;
    totais: MetricasCompletas;
    comparacao: ReturnType<typeof compararPeriodos>;
    contas: SaldoDaConta[];
    ultima_coleta: string | null;
  };
  somado: {
    alcance_aprox: number | null;
    interacoes: number;
    investimento: number;
    resultados_anuncios: number;
    resultado_rotulo: string;
    custo_por_resultado: number | null;
    seguidores: number | null;
    explicacao: string;
  };
};

/**
 * Visão única do desempenho do cliente: perfil orgânico + anúncios no mesmo
 * período, com os dois somados onde a soma faz sentido (e dizendo como).
 */
export async function lerDesempenhoDoCliente(banco: Banco, clientId: string, periodo: { inicio: string; fim: string; dias: number }): Promise<DesempenhoDoCliente & { _anuncios: AnuncioParaEvolucao[]; _posts: PostParaEvolucao[] }> {
  const antesFim = somarDiasIso(periodo.inicio, -1);
  const antesInicio = somarDiasIso(periodo.inicio, -periodo.dias);
  const [organico, diarias, anteriores, criativosQ, campanhasQ, saldos] = await Promise.all([
    lerOrganico(banco, clientId, periodo.inicio, periodo.fim),
    lerDiariasAds(banco, clientId, periodo.inicio, periodo.fim),
    lerDiariasAds(banco, clientId, antesInicio, antesFim),
    banco.from("ads_creatives").select("ad_id, ad_name, campaign_id, thumbnail_url, image_url, video_id, updated_at").eq("client_id", clientId).order("updated_at", { ascending: false }).limit(500),
    banco.from("ads_campaigns").select("campaign_id, name, objective").eq("client_id", clientId).limit(500),
    lerSaldosDasContas(banco, clientId),
  ]);
  const objetivos = new Map<string, string | null>(((campanhasQ.data as { campaign_id: string; objective: string | null }[] | null) ?? []).map((c) => [c.campaign_id, c.objective]));
  const nomesCamp = new Map<string, string | null>(((campanhasQ.data as { campaign_id: string; name: string | null }[] | null) ?? []).map((c) => [c.campaign_id, c.name]));
  const criativos = (criativosQ.data as { ad_id: string; ad_name: string | null; campaign_id: string | null; thumbnail_url: string | null; image_url: string | null; video_id: string | null; updated_at: string | null }[] | null) ?? [];
  const tipos = tiposPorAnuncio([...anteriores, ...diarias], objetivos);
  const totais = metricasCompletas(diarias, tipos, objetivos);
  const antes = metricasCompletas(anteriores, tipos, objetivos);
  const porAd = new Map<string, LinhaDiariaAds[]>();
  for (const l of diarias) porAd.set(l.ad_id, [...(porAd.get(l.ad_id) ?? []), l]);
  const fichas = new Map(criativos.map((c) => [c.ad_id, c]));
  const anuncios: AnuncioParaEvolucao[] = [...porAd.entries()].map(([adId, linhas]) => {
    const f = fichas.get(adId);
    const camp = f?.campaign_id ?? linhas[0]?.campaign_id ?? null;
    const tipo = tipos.get(adId) ?? null;
    return {
      ad_id: adId,
      nome: f?.ad_name ?? `Anúncio ${adId}`,
      campanha: camp ? nomesCamp.get(camp) ?? null : null,
      imagem_url: f?.image_url ?? f?.thumbnail_url ?? null,
      formato: f ? (f.video_id ? "video" : "imagem") : null,
      cta: null,
      metricas: metricasCompletas(linhas, tipo, objetivos),
      ctr_var_pct: variacaoDoCtr(linhas),
    };
  });
  const datas = criativos.map((c) => c.updated_at).filter((x): x is string => !!x).sort();
  const melhores = organico.posts.filter((p) => p.reach != null).sort((a, b) => num(b.reach) - num(a.reach)).slice(0, 6);
  const seguidores = organico.contas.reduce((t, c) => (c.seguidores == null ? t : (t ?? 0) + c.seguidores), null as number | null);
  const alcance = organico.totais.alcance_semanas != null || totais.alcance_aprox != null ? (organico.totais.alcance_semanas ?? 0) + (totais.alcance_aprox ?? 0) : null;
  const { posts: _p, ...organicoSemPosts } = organico;
  return {
    periodo,
    organico: { ...organicoSemPosts, melhores_posts: melhores },
    anuncios: {
      conectada: saldos.contas.length > 0 || criativos.length > 0,
      totais,
      comparacao: compararPeriodos(totais, antes),
      contas: saldos.contas,
      ultima_coleta: datas[datas.length - 1] ?? null,
    },
    somado: {
      alcance_aprox: alcance,
      interacoes: organico.totais.interacoes + totais.acoes.engajamento,
      investimento: totais.gasto,
      resultados_anuncios: totais.resultados,
      resultado_rotulo: totais.resultado_rotulo,
      custo_por_resultado: totais.custo_por_resultado,
      seguidores,
      explicacao: "Alcance somado = alcance semanal do perfil + alcance aproximado dos anúncios (pode contar a mesma pessoa duas vezes). Interações = interações dos posts do período + engajamentos dos anúncios.",
    },
    _anuncios: anuncios,
    _posts: organico.posts,
  };
}

/** CTR do link da segunda metade dos dias contra a primeira (%), com 500 impressões em cada metade. */
export function variacaoDoCtr(linhas: LinhaDiariaAds[]): number | null {
  const dias = [...new Set(linhas.map((l) => String(l.day).slice(0, 10)))].sort();
  if (dias.length < 4) return null;
  const corte = dias[Math.floor(dias.length / 2)];
  const a = metricasCompletas(linhas.filter((l) => String(l.day).slice(0, 10) < corte), "cliques_link");
  const b = metricasCompletas(linhas.filter((l) => String(l.day).slice(0, 10) >= corte), "cliques_link");
  if (a.impressoes < 500 || b.impressoes < 500) return null;
  return variacaoPct(b.ctr_link, a.ctr_link);
}
