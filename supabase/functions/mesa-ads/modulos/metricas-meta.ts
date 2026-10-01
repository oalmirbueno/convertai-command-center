/**
 * Números da Meta, certos e com o nome certo (pedido do dono em 01/10/2026:
 * "na Conta da Mesa Ads os números não estão marcando correto: está
 * engajamento 5, mas só chegou 1 mensagem para o cliente").
 *
 * A causa (medida na Stop Informática, 25/09 a 01/10): o conjunto de
 * conversas no WhatsApp volta da Meta com optimization_goal "REPLIES", que o
 * painel não conhecia. Sem ele, o resultado de cada anúncio era decidido pela
 * presença de mensagem no próprio anúncio: o anúncio que não trouxe conversa
 * virava "engajamento" e contava curtida, reação e clique (post_engagement).
 * A conta somou 5 engajamentos e mostrou isso como resultado principal.
 *
 * Regras daqui (puras, sem Deno e sem banco; o Vitest importa direto):
 * - cada métrica sai de UM action_type oficial da Meta (ou de um campo
 *   próprio), com o nome em português claro e a definição para o "?";
 * - o resultado segue o objetivo do conjunto (optimization_goal) e, sem ele,
 *   o objetivo da campanha. Nunca a presença de uma ação: "não houve conversa"
 *   é 0 conversa, nunca vira engajamento;
 * - "Conversas iniciadas" é só onsite_conversion.messaging_conversation_started_7d,
 *   o mesmo número da coluna Resultados do Gerenciador. A conexão por mensagem
 *   (total_messaging_connection) é outra métrica e nunca soma junto;
 * - números de leitura agregada da Meta (alcance e frequência) não se somam
 *   entre linhas: o total vem de uma leitura própria da conta.
 *
 * Sem travessão nos textos (regra do dono).
 */

export type FormatoDaMetrica = "brl" | "inteiro" | "pct" | "decimal";

export type IdDaMetrica =
  | "resultados"
  | "custo_por_resultado"
  | "gasto"
  | "conversas"
  | "custo_por_conversa"
  | "primeira_resposta"
  | "conversas_respondidas"
  | "conexoes_mensagem"
  | "leads"
  | "custo_por_lead"
  | "compras"
  | "custo_por_compra"
  | "valor_compras"
  | "roas"
  | "cliques_link"
  | "ctr_link"
  | "cpc_link"
  | "visitas_pagina"
  | "visitas_perfil"
  | "engajamento"
  | "reacoes"
  | "comentarios"
  | "compartilhamentos"
  | "salvamentos"
  | "seguidores"
  | "thruplay"
  | "video_3s"
  | "alcance"
  | "impressoes"
  | "frequencia"
  | "cpm"
  | "cliques"
  | "ctr"
  | "cpc";

export type DefinicaoDaMetrica = {
  id: IdDaMetrica;
  rotulo: string;
  /** A definição para o "?", sem jargão. */
  ajuda: string;
  formato: FormatoDaMetrica;
  /** Subir é bom (custo: não). */
  bomQuandoSobe: boolean;
  /** action_type oficiais da Meta (vale o PRIMEIRO presente na linha, nunca a soma). */
  acoes?: string[];
};

const ACOES = {
  conversas: ["onsite_conversion.messaging_conversation_started_7d"],
  primeira_resposta: ["onsite_conversion.messaging_first_reply"],
  conversas_respondidas: ["onsite_conversion.messaging_conversation_replied_7d"],
  conexoes_mensagem: ["onsite_conversion.total_messaging_connection"],
  // "lead" já soma o do formulário e o do pixel: os outros só valem quando ele não vem.
  leads: ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead", "onsite_web_lead"],
  compras: ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"],
  visitas_pagina: ["landing_page_view", "omni_landing_page_view"],
  engajamento: ["post_engagement"],
  reacoes: ["post_reaction"],
  comentarios: ["comment"],
  compartilhamentos: ["post"],
  salvamentos: ["onsite_conversion.post_save"],
  seguidores: ["like"],
  video_3s: ["video_view"],
  link: ["link_click"],
} as const;

export const METRICAS: DefinicaoDaMetrica[] = [
  { id: "resultados", rotulo: "Resultados", ajuda: "O resultado que o objetivo do conjunto busca, igual à coluna Resultados do Gerenciador: conversas para mensagem, leads para cadastro, compras para vendas, e assim por diante.", formato: "inteiro", bomQuandoSobe: true },
  { id: "custo_por_resultado", rotulo: "Custo por resultado", ajuda: "Valor investido dividido pelos resultados do objetivo.", formato: "brl", bomQuandoSobe: false },
  { id: "gasto", rotulo: "Valor investido", ajuda: "Quanto a Meta cobrou no período.", formato: "brl", bomQuandoSobe: false },
  { id: "conversas", rotulo: "Conversas iniciadas", ajuda: "Pessoas que começaram uma conversa (WhatsApp, Direct ou Messenger) depois de ver ou clicar no anúncio, em até 7 dias. É o resultado das campanhas de mensagem no Gerenciador.", formato: "inteiro", bomQuandoSobe: true, acoes: [...ACOES.conversas] },
  { id: "custo_por_conversa", rotulo: "Custo por conversa", ajuda: "Valor investido dividido pelas conversas iniciadas.", formato: "brl", bomQuandoSobe: false },
  { id: "primeira_resposta", rotulo: "Primeira resposta", ajuda: "Pessoas que mandaram a primeira mensagem para a empresa depois do anúncio (contato novo).", formato: "inteiro", bomQuandoSobe: true, acoes: [...ACOES.primeira_resposta] },
  { id: "conversas_respondidas", rotulo: "Conversas com resposta", ajuda: "Conversas em que a pessoa respondeu de novo depois da primeira troca, em até 7 dias.", formato: "inteiro", bomQuandoSobe: true, acoes: [...ACOES.conversas_respondidas] },
  { id: "conexoes_mensagem", rotulo: "Contatos por mensagem", ajuda: "Toda vez que alguém se conectou por mensagem com a empresa depois do anúncio, inclusive quem já tinha conversado antes. Não é o resultado do Gerenciador e não soma com as conversas iniciadas.", formato: "inteiro", bomQuandoSobe: true, acoes: [...ACOES.conexoes_mensagem] },
  { id: "leads", rotulo: "Leads", ajuda: "Cadastros: formulário da Meta, formulário no Direct ou o evento Lead do pixel no site.", formato: "inteiro", bomQuandoSobe: true, acoes: [...ACOES.leads] },
  { id: "custo_por_lead", rotulo: "Custo por lead", ajuda: "Valor investido dividido pelos leads.", formato: "brl", bomQuandoSobe: false },
  { id: "compras", rotulo: "Compras", ajuda: "Compras registradas pelo pixel ou pela loja depois do anúncio.", formato: "inteiro", bomQuandoSobe: true, acoes: [...ACOES.compras] },
  { id: "custo_por_compra", rotulo: "Custo por compra", ajuda: "Valor investido dividido pelas compras.", formato: "brl", bomQuandoSobe: false },
  { id: "valor_compras", rotulo: "Valor das compras", ajuda: "Soma do valor das compras que o pixel mediu.", formato: "brl", bomQuandoSobe: true, acoes: [...ACOES.compras] },
  { id: "roas", rotulo: "Retorno (ROAS)", ajuda: "Valor das compras dividido pelo valor investido. 3 quer dizer R$ 3 em vendas para cada R$ 1 investido.", formato: "decimal", bomQuandoSobe: true },
  { id: "cliques_link", rotulo: "Cliques no link", ajuda: "Cliques que levam para fora do anúncio: site, WhatsApp, Direct ou perfil.", formato: "inteiro", bomQuandoSobe: true, acoes: [...ACOES.link] },
  { id: "ctr_link", rotulo: "CTR do link", ajuda: "Em cada 100 vezes que o anúncio apareceu, quantas viraram clique no link.", formato: "pct", bomQuandoSobe: true },
  { id: "cpc_link", rotulo: "CPC do link", ajuda: "Valor investido dividido pelos cliques no link.", formato: "brl", bomQuandoSobe: false },
  { id: "visitas_pagina", rotulo: "Visitas à página", ajuda: "Pessoas que clicaram e a página do site carregou (precisa do pixel).", formato: "inteiro", bomQuandoSobe: true, acoes: [...ACOES.visitas_pagina] },
  { id: "visitas_perfil", rotulo: "Visitas ao perfil", ajuda: "Cliques que levaram ao perfil do Instagram, nas campanhas que otimizam para visita ao perfil.", formato: "inteiro", bomQuandoSobe: true },
  { id: "engajamento", rotulo: "Engajamento com a publicação", ajuda: "Toda interação com o anúncio: curtida, reação, comentário, compartilhamento, salvamento e clique. Não é mensagem nem venda.", formato: "inteiro", bomQuandoSobe: true, acoes: [...ACOES.engajamento] },
  { id: "reacoes", rotulo: "Reações", ajuda: "Curtidas e outras reações no anúncio.", formato: "inteiro", bomQuandoSobe: true, acoes: [...ACOES.reacoes] },
  { id: "comentarios", rotulo: "Comentários", ajuda: "Comentários no anúncio.", formato: "inteiro", bomQuandoSobe: true, acoes: [...ACOES.comentarios] },
  { id: "compartilhamentos", rotulo: "Compartilhamentos", ajuda: "Vezes que o anúncio foi compartilhado.", formato: "inteiro", bomQuandoSobe: true, acoes: [...ACOES.compartilhamentos] },
  { id: "salvamentos", rotulo: "Salvamentos", ajuda: "Vezes que o anúncio foi salvo.", formato: "inteiro", bomQuandoSobe: true, acoes: [...ACOES.salvamentos] },
  { id: "seguidores", rotulo: "Seguidores da Página", ajuda: "Curtidas ou seguidores da Página do Facebook que vieram do anúncio. Seguidores do Instagram a Meta não informa por anúncio.", formato: "inteiro", bomQuandoSobe: true, acoes: [...ACOES.seguidores] },
  { id: "thruplay", rotulo: "ThruPlay", ajuda: "Vídeo assistido até o fim ou por pelo menos 15 segundos.", formato: "inteiro", bomQuandoSobe: true },
  { id: "video_3s", rotulo: "Reproduções de 3 s", ajuda: "Vídeo assistido por pelo menos 3 segundos.", formato: "inteiro", bomQuandoSobe: true, acoes: [...ACOES.video_3s] },
  { id: "alcance", rotulo: "Alcance", ajuda: "Pessoas diferentes que viram o anúncio pelo menos uma vez.", formato: "inteiro", bomQuandoSobe: true },
  { id: "impressoes", rotulo: "Impressões", ajuda: "Vezes que o anúncio apareceu na tela (a mesma pessoa conta mais de uma vez).", formato: "inteiro", bomQuandoSobe: true },
  { id: "frequencia", rotulo: "Frequência", ajuda: "Quantas vezes, em média, cada pessoa viu o anúncio (impressões dividido pelo alcance).", formato: "decimal", bomQuandoSobe: false },
  { id: "cpm", rotulo: "CPM", ajuda: "Custo para aparecer 1.000 vezes.", formato: "brl", bomQuandoSobe: false },
  { id: "cliques", rotulo: "Cliques (todos)", ajuda: "Todos os cliques no anúncio, inclusive em curtir, abrir a foto ou ver mais.", formato: "inteiro", bomQuandoSobe: true },
  { id: "ctr", rotulo: "CTR (todos)", ajuda: "Em cada 100 vezes que o anúncio apareceu, quantos cliques de qualquer tipo.", formato: "pct", bomQuandoSobe: true },
  { id: "cpc", rotulo: "CPC (todos)", ajuda: "Valor investido dividido por todos os cliques.", formato: "brl", bomQuandoSobe: false },
];

export const IDS_DAS_METRICAS: IdDaMetrica[] = METRICAS.map((m) => m.id);
export const definicaoDe = (id: string): DefinicaoDaMetrica | null => METRICAS.find((m) => m.id === id) ?? null;

// ------------------------------------------------------------------ objetivos

export type IdDoObjetivo = "mensagens" | "leads" | "trafego" | "engajamento" | "vendas" | "reconhecimento" | "video" | "seguidores";

export type DefinicaoDoObjetivo = {
  id: IdDoObjetivo;
  rotulo: string;
  ajuda: string;
  /** O resultado mais comum do objetivo (o de cada conjunto vem do optimization_goal). */
  resultado: IdDaMetrica;
  /** As colunas prontas do objetivo, na ordem. */
  colunas: IdDaMetrica[];
};

export const OBJETIVOS: DefinicaoDoObjetivo[] = [
  { id: "mensagens", rotulo: "Mensagens", ajuda: "Campanhas que otimizam para conversa no WhatsApp, Direct ou Messenger.", resultado: "conversas", colunas: ["conversas", "custo_por_conversa", "gasto", "primeira_resposta", "conexoes_mensagem", "alcance", "frequencia", "cliques_link", "ctr_link", "cpm"] },
  { id: "leads", rotulo: "Leads", ajuda: "Campanhas de cadastro: formulário da Meta, Direct ou pixel no site.", resultado: "leads", colunas: ["leads", "custo_por_lead", "gasto", "cliques_link", "ctr_link", "cpc_link", "visitas_pagina", "alcance", "frequencia", "cpm"] },
  { id: "trafego", rotulo: "Tráfego", ajuda: "Campanhas que levam ao site, ao perfil ou a um link.", resultado: "cliques_link", colunas: ["resultados", "custo_por_resultado", "gasto", "cliques_link", "ctr_link", "cpc_link", "visitas_pagina", "visitas_perfil", "alcance", "cpm"] },
  { id: "engajamento", rotulo: "Engajamento", ajuda: "Campanhas que otimizam para interação com a publicação (curtir, comentar, compartilhar).", resultado: "engajamento", colunas: ["engajamento", "custo_por_resultado", "gasto", "reacoes", "comentarios", "compartilhamentos", "salvamentos", "alcance", "frequencia", "cpm"] },
  { id: "vendas", rotulo: "Vendas", ajuda: "Campanhas de compra no site ou na loja (pixel).", resultado: "compras", colunas: ["compras", "custo_por_compra", "gasto", "valor_compras", "roas", "cliques_link", "ctr_link", "visitas_pagina", "alcance", "cpm"] },
  { id: "reconhecimento", rotulo: "Reconhecimento", ajuda: "Campanhas de alcance: aparecer para mais gente.", resultado: "alcance", colunas: ["alcance", "impressoes", "frequencia", "cpm", "gasto", "engajamento", "cliques_link", "ctr_link"] },
  { id: "video", rotulo: "Vídeo", ajuda: "Campanhas de visualização de vídeo.", resultado: "thruplay", colunas: ["thruplay", "custo_por_resultado", "gasto", "video_3s", "alcance", "frequencia", "cpm", "engajamento"] },
  { id: "seguidores", rotulo: "Seguidores", ajuda: "Campanhas de seguidores e curtidas da Página ou do perfil.", resultado: "seguidores", colunas: ["resultados", "custo_por_resultado", "gasto", "seguidores", "engajamento", "alcance", "frequencia", "cpm"] },
];

/** Colunas de "Todos": o que vale para qualquer objetivo. */
export const COLUNAS_DE_TODOS: IdDaMetrica[] = ["gasto", "conversas", "leads", "compras", "cliques_link", "ctr_link", "cpc_link", "alcance", "impressoes", "frequencia", "cpm"];

export const objetivoDe = (id: string | null | undefined): DefinicaoDoObjetivo | null => OBJETIVOS.find((o) => o.id === id) ?? null;

export type Classificacao = { objetivo: IdDoObjetivo | null; resultado: IdDaMetrica | null };

const MENSAGEM = /^(CONVERSATIONS|REPLIES|MESSAGING_.+)$/;

/**
 * Objetivo e resultado de um conjunto (ou campanha, ou anúncio), como no
 * Gerenciador: pelo optimization_goal e, sem ele, pelo objetivo da campanha.
 * Nunca pela presença de uma ação.
 */
export function classificar(objective?: string | null, optimizationGoal?: string | null): Classificacao {
  const o = String(optimizationGoal ?? "").trim().toUpperCase();
  const obj = String(objective ?? "").trim().toUpperCase();
  const conhecido = o && o !== "NONE" && o.indexOf("UNKNOWN") !== 0;
  if (conhecido) {
    if (MENSAGEM.test(o)) return { objetivo: "mensagens", resultado: "conversas" };
    if (o === "LEAD_GENERATION" || o === "QUALITY_LEAD" || o === "QUALITY_CALL") return { objetivo: "leads", resultado: "leads" };
    if (o === "OFFSITE_CONVERSIONS" || o === "VALUE" || o === "CONVERSIONS" || o === "ONSITE_CONVERSIONS") {
      return obj === "OUTCOME_LEADS" || obj === "LEAD_GENERATION" ? { objetivo: "leads", resultado: "leads" } : { objetivo: "vendas", resultado: "compras" };
    }
    if (o === "LANDING_PAGE_VIEWS") return { objetivo: "trafego", resultado: "visitas_pagina" };
    if (o === "LINK_CLICKS") return { objetivo: "trafego", resultado: "cliques_link" };
    if (o === "PROFILE_VISIT" || o === "VISIT_INSTAGRAM_PROFILE") return { objetivo: "trafego", resultado: "visitas_perfil" };
    if (o === "POST_ENGAGEMENT" || o === "EVENT_RESPONSES") return { objetivo: "engajamento", resultado: "engajamento" };
    if (o === "PAGE_LIKES" || o === "PROFILE_AND_PAGE_ENGAGEMENT") return { objetivo: "seguidores", resultado: "seguidores" };
    if (o === "THRUPLAY") return { objetivo: "video", resultado: "thruplay" };
    if (o === "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS") return { objetivo: "video", resultado: "video_3s" };
    if (o === "REACH" || o === "AD_RECALL_LIFT") return { objetivo: "reconhecimento", resultado: "alcance" };
    if (o === "IMPRESSIONS") return { objetivo: "reconhecimento", resultado: "impressoes" };
    if (o === "APP_INSTALLS") return { objetivo: "trafego", resultado: "cliques_link" };
  }
  if (obj === "OUTCOME_SALES" || obj === "CONVERSIONS" || obj === "PRODUCT_CATALOG_SALES") return { objetivo: "vendas", resultado: "compras" };
  if (obj === "OUTCOME_LEADS" || obj === "LEAD_GENERATION") return { objetivo: "leads", resultado: "leads" };
  if (obj === "MESSAGES") return { objetivo: "mensagens", resultado: "conversas" };
  if (obj === "OUTCOME_TRAFFIC" || obj === "LINK_CLICKS" || obj === "OUTCOME_APP_PROMOTION" || obj === "APP_INSTALLS") return { objetivo: "trafego", resultado: "cliques_link" };
  if (obj === "OUTCOME_ENGAGEMENT" || obj === "POST_ENGAGEMENT") return { objetivo: "engajamento", resultado: "engajamento" };
  if (obj === "PAGE_LIKES") return { objetivo: "seguidores", resultado: "seguidores" };
  if (obj === "OUTCOME_AWARENESS" || obj === "REACH" || obj === "BRAND_AWARENESS") return { objetivo: "reconhecimento", resultado: "alcance" };
  if (obj === "VIDEO_VIEWS") return { objetivo: "video", resultado: "thruplay" };
  return { objetivo: null, resultado: null };
}

// ------------------------------------------------------------------ números

export type Numeros = Record<IdDaMetrica, number | null>;

const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
};
const arred = (v: number, casas = 2) => Math.round(v * 10 ** casas) / 10 ** casas;

/** Valor do primeiro action_type presente (lista da Meta [{action_type, value}]); null quando nenhum veio. */
export function valorDaAcao(lista: unknown, tipos: readonly string[]): number | null {
  if (!Array.isArray(lista)) return null;
  for (const t of tipos) {
    const a = lista.find((x) => x && typeof x === "object" && (x as Record<string, unknown>).action_type === t) as Record<string, unknown> | undefined;
    if (a) return n(a.value) ?? 0;
  }
  return null;
}

/** Os números que SOMAM entre linhas (contagens e dinheiro). */
const SOMAVEIS: IdDaMetrica[] = [
  "gasto", "impressoes", "cliques", "cliques_link", "conversas", "primeira_resposta", "conversas_respondidas", "conexoes_mensagem",
  "leads", "compras", "valor_compras", "visitas_pagina", "visitas_perfil", "engajamento", "reacoes", "comentarios", "compartilhamentos",
  "salvamentos", "seguidores", "thruplay", "video_3s",
];

export const vazio = (): Numeros => {
  const o = {} as Numeros;
  for (const id of IDS_DAS_METRICAS) o[id] = null;
  return o;
};

/**
 * Os números de UMA linha de insights da Meta (conta, campanha, conjunto,
 * anúncio, hora ou dia), com o resultado da classificação. Contagem que a Meta
 * não mandou fica 0 (a Meta omite a ação que não aconteceu); alcance só quando
 * veio (linha por hora não traz alcance).
 */
export function numerosDaLinha(linha: Record<string, unknown>, c: Classificacao): Numeros {
  const x = vazio();
  const acoes = linha.actions;
  x.gasto = arred(n(linha.spend) ?? 0);
  x.impressoes = n(linha.impressions) ?? 0;
  x.alcance = n(linha.reach);
  x.cliques = n(linha.clicks) ?? 0;
  x.cliques_link = n(linha.inline_link_clicks) ?? valorDaAcao(acoes, ACOES.link) ?? 0;
  x.conversas = valorDaAcao(acoes, ACOES.conversas) ?? 0;
  x.primeira_resposta = valorDaAcao(acoes, ACOES.primeira_resposta) ?? 0;
  x.conversas_respondidas = valorDaAcao(acoes, ACOES.conversas_respondidas) ?? 0;
  x.conexoes_mensagem = valorDaAcao(acoes, ACOES.conexoes_mensagem) ?? 0;
  x.leads = valorDaAcao(acoes, ACOES.leads) ?? 0;
  x.compras = valorDaAcao(acoes, ACOES.compras) ?? 0;
  x.valor_compras = valorDaAcao(linha.action_values, ACOES.compras) ?? 0;
  x.visitas_pagina = valorDaAcao(acoes, ACOES.visitas_pagina) ?? 0;
  x.visitas_perfil = c.resultado === "visitas_perfil" ? x.cliques_link : 0;
  x.engajamento = valorDaAcao(acoes, ACOES.engajamento) ?? 0;
  x.reacoes = valorDaAcao(acoes, ACOES.reacoes) ?? 0;
  x.comentarios = valorDaAcao(acoes, ACOES.comentarios) ?? 0;
  x.compartilhamentos = valorDaAcao(acoes, ACOES.compartilhamentos) ?? 0;
  x.salvamentos = valorDaAcao(acoes, ACOES.salvamentos) ?? 0;
  x.seguidores = valorDaAcao(acoes, ACOES.seguidores) ?? 0;
  x.thruplay = valorDaAcao(linha.video_thruplay_watched_actions, ["video_view"]) ?? 0;
  x.video_3s = valorDaAcao(acoes, ACOES.video_3s) ?? 0;
  if (c.resultado) x.resultados = x[c.resultado];
  return derivar(x, c.resultado);
}

/** Taxas e custos a partir das somas (iguais às da Meta: a Meta divide os mesmos números). */
export function derivar(x: Numeros, resultado: IdDaMetrica | null): Numeros {
  const g = x.gasto ?? 0;
  const div = (a: number | null, b: number | null, casas = 2) => (a !== null && b !== null && b > 0 ? arred(a / b, casas) : null);
  x.ctr_link = x.impressoes ? arred(((x.cliques_link ?? 0) / x.impressoes) * 100) : null;
  x.ctr = x.impressoes ? arred(((x.cliques ?? 0) / x.impressoes) * 100) : null;
  x.cpc_link = div(g, x.cliques_link);
  x.cpc = div(g, x.cliques);
  x.cpm = x.impressoes ? arred((g / x.impressoes) * 1000) : null;
  x.frequencia = div(x.impressoes, x.alcance);
  x.custo_por_conversa = div(g, x.conversas);
  x.custo_por_lead = div(g, x.leads);
  x.custo_por_compra = div(g, x.compras);
  x.roas = x.valor_compras ? div(x.valor_compras, g) : null;
  x.custo_por_resultado = resultado && x.resultados !== null ? div(g, x.resultados, resultado === "alcance" || resultado === "impressoes" ? 4 : 2) : null;
  return x;
}

/**
 * Soma de linhas (para um total que a Meta não mandou pronto). Alcance não
 * soma entre linhas: fica o que veio em `alcanceExato` (a leitura da conta),
 * ou nada. O resultado só soma quando todas as linhas buscam o MESMO resultado.
 */
export function somarNumeros(itens: { numeros: Numeros; resultado: IdDaMetrica | null }[], alcanceExato?: number | null): { numeros: Numeros; resultado: IdDaMetrica | null; misto: boolean } {
  const x = vazio();
  for (const id of SOMAVEIS) x[id] = 0;
  for (const i of itens) for (const id of SOMAVEIS) x[id] = (x[id] ?? 0) + (i.numeros[id] ?? 0);
  x.gasto = arred(x.gasto ?? 0);
  x.valor_compras = arred(x.valor_compras ?? 0);
  x.alcance = alcanceExato ?? (itens.length === 1 ? itens[0].numeros.alcance : null);
  const tipos = itens.filter((i) => (i.numeros.gasto ?? 0) > 0 || (i.numeros.resultados ?? 0) > 0).map((i) => i.resultado);
  const unicos = tipos.filter((t, k) => tipos.indexOf(t) === k);
  const resultado = unicos.length === 1 ? unicos[0] : null;
  if (resultado) x.resultados = resultado === "alcance" ? x.alcance : x[resultado];
  return { numeros: derivar(x, resultado), resultado, misto: unicos.length > 1 };
}

// ------------------------------------------------------------------ níveis

export type NivelDaMetrica = "conta" | "campanha" | "conjunto" | "anuncio";
export const NIVEIS: NivelDaMetrica[] = ["conta", "campanha", "conjunto", "anuncio"];
export const NIVEL_DA_META: Record<NivelDaMetrica, string> = { conta: "account", campanha: "campaign", conjunto: "adset", anuncio: "ad" };

/** Campos pedidos à Meta (só leitura). */
export const CAMPOS_DOS_INSIGHTS = [
  "campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name", "objective", "optimization_goal",
  "spend", "impressions", "reach", "frequency", "clicks", "inline_link_clicks", "actions", "action_values",
  "video_thruplay_watched_actions", "date_start", "date_stop",
].join(",");

/** Campos da leitura por hora ou por dia (a Meta não traz alcance quebrado por hora). */
export const CAMPOS_DO_TEMPO = ["campaign_id", "adset_id", "objective", "optimization_goal", "spend", "impressions", "clicks", "inline_link_clicks", "actions", "action_values", "video_thruplay_watched_actions", "date_start"].join(",");

export const QUEBRA_POR_HORA = "hourly_stats_aggregated_by_advertiser_time_zone";

/**
 * O caminho de insights na Graph API (sem token). `use_unified_attribution_setting`
 * faz a Meta contar com a MESMA janela de atribuição de cada conjunto no
 * Gerenciador, então o número bate com o que o dono vê lá.
 */
export function caminhoDosInsights(act: string, opcoes: {
  nivel: NivelDaMetrica;
  inicio: string;
  fim: string;
  quebra?: "hora" | "dia" | null;
  campanhas?: string[] | null;
  depois?: string | null;
}): string {
  const p: string[] = [
    `level=${NIVEL_DA_META[opcoes.nivel]}`,
    `time_range=${encodeURIComponent(JSON.stringify({ since: opcoes.inicio, until: opcoes.fim }))}`,
    "use_unified_attribution_setting=true",
    "limit=500",
  ];
  if (opcoes.quebra === "hora") p.push(`breakdowns=${QUEBRA_POR_HORA}`);
  if (opcoes.quebra === "dia") p.push("time_increment=1");
  if (opcoes.campanhas && opcoes.campanhas.length) {
    p.push(`filtering=${encodeURIComponent(JSON.stringify([{ field: "campaign.id", operator: "IN", value: opcoes.campanhas.slice(0, 200) }]))}`);
  }
  if (opcoes.depois) p.push(`after=${encodeURIComponent(opcoes.depois)}`);
  return `act_${String(act).replace(/^act_/, "")}/insights?${p.join("&")}`;
}

/** Linhas e o cursor da próxima página de uma resposta de insights. */
export function paginaDosInsights(bruto: unknown): { linhas: Record<string, unknown>[]; depois: string | null } {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const linhas = Array.isArray(o.data) ? (o.data as Record<string, unknown>[]).filter((l) => l && typeof l === "object") : [];
  const paging = o.paging && typeof o.paging === "object" ? (o.paging as Record<string, unknown>) : {};
  const cursores = paging.cursors && typeof paging.cursors === "object" ? (paging.cursors as Record<string, unknown>) : {};
  const depois = paging.next && typeof cursores.after === "string" ? (cursores.after as string) : null;
  return { linhas, depois };
}

// ------------------------------------------------------------------ itens da tabela

export type ItemDaMetrica = {
  nivel: NivelDaMetrica;
  id: string;
  nome: string;
  campanha_id: string | null;
  campanha: string | null;
  conjunto_id: string | null;
  conjunto: string | null;
  objetivo: IdDoObjetivo | null;
  objetivo_meta: string | null;
  otimizacao: string | null;
  resultado: IdDaMetrica | null;
  resultado_rotulo: string;
  numeros: Numeros;
};

const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").replace(/[–—]/g, ",").trim() : null);

/**
 * Classificação de cada conjunto pela leitura no nível de conjunto (o
 * optimization_goal do conjunto é o confiável: na campanha a Meta devolve
 * "NONE" ou "Unknown Optimization Goal" quando os conjuntos diferem).
 */
export function classificacaoDosConjuntos(linhasDeConjunto: Record<string, unknown>[]): Map<string, Classificacao & { gasto: number; campanha: string | null; objective: string | null; otimizacao: string | null }> {
  const m = new Map<string, Classificacao & { gasto: number; campanha: string | null; objective: string | null; otimizacao: string | null }>();
  for (const l of linhasDeConjunto) {
    const id = txt(l.adset_id);
    if (!id) continue;
    const objective = txt(l.objective);
    const otimizacao = txt(l.optimization_goal);
    const anterior = m.get(id);
    const gasto = (anterior ? anterior.gasto : 0) + (n(l.spend) ?? 0);
    m.set(id, { ...classificar(objective, otimizacao), gasto, campanha: txt(l.campaign_id), objective, otimizacao });
  }
  return m;
}

/** Classificação da campanha: a do conjunto com mais gasto (na falta, o objetivo da campanha). */
export function classificacaoDaCampanha(
  campanhaId: string | null,
  objective: string | null,
  otimizacao: string | null,
  conjuntos: ReturnType<typeof classificacaoDosConjuntos>,
): Classificacao {
  let melhor: { c: Classificacao; gasto: number } | null = null;
  for (const [, c] of conjuntos) {
    if (!campanhaId || c.campanha !== campanhaId) continue;
    if (!melhor || c.gasto > melhor.gasto) melhor = { c: { objetivo: c.objetivo, resultado: c.resultado }, gasto: c.gasto };
  }
  return melhor ? melhor.c : classificar(objective, otimizacao);
}

export const rotuloDaMetrica = (id: IdDaMetrica | null | undefined): string => (id ? (definicaoDe(id) ?? { rotulo: "Resultados" }).rotulo : "Resultados");

/** Uma linha de insights vira item da tabela, já com o resultado certo do objetivo. */
export function itemDaLinha(nivel: NivelDaMetrica, l: Record<string, unknown>, conjuntos: ReturnType<typeof classificacaoDosConjuntos>): ItemDaMetrica | null {
  const campanhaId = txt(l.campaign_id);
  const conjuntoId = txt(l.adset_id);
  const id = nivel === "campanha" ? campanhaId : nivel === "conjunto" ? conjuntoId : nivel === "anuncio" ? txt(l.ad_id) : "conta";
  if (!id) return null;
  const objective = txt(l.objective);
  const otimizacao = txt(l.optimization_goal);
  const doConjunto = conjuntoId ? conjuntos.get(conjuntoId) : undefined;
  const c: Classificacao = nivel === "campanha"
    ? classificacaoDaCampanha(campanhaId, objective, otimizacao, conjuntos)
    : doConjunto ? { objetivo: doConjunto.objetivo, resultado: doConjunto.resultado } : classificar(objective, otimizacao);
  const nome = nivel === "campanha" ? txt(l.campaign_name) : nivel === "conjunto" ? txt(l.adset_name) : nivel === "anuncio" ? txt(l.ad_name) : "Conta";
  return {
    nivel,
    id,
    nome: (nome ?? `${nivel === "anuncio" ? "Anúncio" : nivel === "conjunto" ? "Conjunto" : "Campanha"} ${id}`).slice(0, 200),
    campanha_id: campanhaId,
    campanha: txt(l.campaign_name),
    conjunto_id: conjuntoId,
    conjunto: txt(l.adset_name),
    objetivo: c.objetivo,
    objetivo_meta: objective,
    otimizacao: doConjunto ? doConjunto.otimizacao : otimizacao,
    resultado: c.resultado,
    resultado_rotulo: rotuloDaMetrica(c.resultado),
    numeros: numerosDaLinha(l, c),
  };
}

// ------------------------------------------------------------------ totais por objetivo

export type TotalDoObjetivo = {
  objetivo: IdDoObjetivo;
  rotulo: string;
  campanhas: number;
  resultado: IdDaMetrica | null;
  resultado_rotulo: string;
  /** Resultados por tipo quando o objetivo mistura resultados (ex.: tráfego com visita à página e ao perfil). */
  por_resultado: { metrica: IdDaMetrica; rotulo: string; valor: number }[];
  numeros: Numeros;
};

/** Totais de cada objetivo presente, a partir das linhas de conjunto (resultado de cada conjunto pelo optimization_goal dele). */
export function totaisPorObjetivo(itensDeConjunto: ItemDaMetrica[]): TotalDoObjetivo[] {
  const saida: TotalDoObjetivo[] = [];
  for (const o of OBJETIVOS) {
    const doObjetivo = itensDeConjunto.filter((i) => i.objetivo === o.id);
    if (!doObjetivo.length) continue;
    const s = somarNumeros(doObjetivo.map((i) => ({ numeros: i.numeros, resultado: i.resultado })));
    const porTipo = new Map<IdDaMetrica, number>();
    for (const i of doObjetivo) if (i.resultado) porTipo.set(i.resultado, (porTipo.get(i.resultado) ?? 0) + (i.resultado === "alcance" ? 0 : (i.numeros[i.resultado] ?? 0)));
    const campanhas = doObjetivo.map((i) => i.campanha_id).filter((c, k, l) => !!c && l.indexOf(c) === k).length;
    saida.push({
      objetivo: o.id,
      rotulo: o.rotulo,
      campanhas,
      resultado: s.resultado,
      resultado_rotulo: s.resultado ? rotuloDaMetrica(s.resultado) : "Resultados",
      por_resultado: [...porTipo].map(([metrica, valor]) => ({ metrica, rotulo: rotuloDaMetrica(metrica), valor })),
      numeros: s.numeros,
    });
  }
  return saida.sort((a, b) => (b.numeros.gasto ?? 0) - (a.numeros.gasto ?? 0));
}

// ------------------------------------------------------------------ por hora e por dia da semana

export type FaixaDoTempo = {
  /** 0 a 23 (hora) ou 0 a 6 (domingo a sábado). */
  indice: number;
  rotulo: string;
  gasto: number;
  impressoes: number;
  cliques_link: number;
  conversas: number;
  leads: number;
  compras: number;
  /** Resultado do objetivo (só quando o recorte busca um resultado só). */
  resultados: number | null;
  custo_por_resultado: number | null;
};

const DIAS_DA_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/** "13:00:00 - 13:59:59" vira 13. */
export function horaDaLinha(v: unknown): number | null {
  const m = typeof v === "string" ? v.match(/^(\d{1,2}):/) : null;
  const h = m ? Number(m[1]) : NaN;
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : null;
}

/** "2026-09-28" vira 1 (segunda), pelo calendário (meio-dia em UTC, sem escorregar de fuso). */
export function diaDaSemana(data: unknown): number | null {
  if (typeof data !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.slice(0, 10))) return null;
  const d = new Date(`${data.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(d.getTime()) ? d.getUTCDay() : null;
}

/**
 * Soma as linhas por hora do dia (ou por dia da semana). `resultadoDe` diz o
 * resultado de cada linha (pelo conjunto); o resultado só soma quando todas
 * buscam o mesmo.
 */
export function faixasDoTempo(
  linhas: Record<string, unknown>[],
  modo: "hora" | "dia_da_semana",
  classificacaoDe: (l: Record<string, unknown>) => Classificacao,
  filtro?: (c: Classificacao) => boolean,
): { faixas: FaixaDoTempo[]; resultado: IdDaMetrica | null } {
  const total = modo === "hora" ? 24 : 7;
  const faixas: FaixaDoTempo[] = [];
  for (let i = 0; i < total; i++) {
    faixas.push({ indice: i, rotulo: modo === "hora" ? `${String(i).padStart(2, "0")}h` : DIAS_DA_SEMANA[i], gasto: 0, impressoes: 0, cliques_link: 0, conversas: 0, leads: 0, compras: 0, resultados: 0, custo_por_resultado: null });
  }
  const tipos: (IdDaMetrica | null)[] = [];
  const porFaixa: { k: number; x: Numeros; r: IdDaMetrica | null }[] = [];
  for (const l of linhas) {
    const c = classificacaoDe(l);
    if (filtro && !filtro(c)) continue;
    const k = modo === "hora" ? horaDaLinha(l[QUEBRA_POR_HORA]) : diaDaSemana(l.date_start);
    if (k === null) continue;
    const x = numerosDaLinha(l, c);
    if ((x.gasto ?? 0) > 0 || (x.resultados ?? 0) > 0) tipos.push(c.resultado);
    porFaixa.push({ k, x, r: c.resultado });
  }
  const unicos = tipos.filter((t, i) => tipos.indexOf(t) === i);
  const resultado = unicos.length === 1 ? unicos[0] : null;
  for (const { k, x } of porFaixa) {
    const f = faixas[k];
    f.gasto += x.gasto ?? 0;
    f.impressoes += x.impressoes ?? 0;
    f.cliques_link += x.cliques_link ?? 0;
    f.conversas += x.conversas ?? 0;
    f.leads += x.leads ?? 0;
    f.compras += x.compras ?? 0;
    if (resultado && resultado !== "alcance") f.resultados = (f.resultados ?? 0) + (x[resultado] ?? 0);
  }
  for (const f of faixas) {
    f.gasto = arred(f.gasto);
    if (!resultado || resultado === "alcance") f.resultados = null;
    f.custo_por_resultado = f.resultados ? arred(f.gasto / f.resultados) : null;
  }
  return { faixas, resultado: resultado === "alcance" ? null : resultado };
}

export type MelhorHorario = {
  /** Hora (ou dia) com mais resultados; empate: o mais barato. */
  melhor: { indice: number; rotulo: string; valor: number; custo: number | null } | null;
  /** As 3 horas seguidas com mais resultados (só por hora). */
  faixa: { inicio: number; fim: number; rotulo: string; valor: number; pct: number } | null;
  /** Abaixo disso o "melhor" é sorte: a tela mostra o gráfico e avisa que é pouco. */
  pouco_volume: boolean;
};

/** Volume mínimo no período para apontar o melhor horário. */
export const MINIMO_PARA_MELHOR_HORARIO = 10;

/** O melhor horário (ou dia) pela métrica escolhida (resultados ou conversas). */
export function melhorHorario(faixas: FaixaDoTempo[], chave: "resultados" | "conversas" | "leads" | "compras" | "cliques_link", modo: "hora" | "dia_da_semana"): MelhorHorario {
  const valor = (f: FaixaDoTempo) => Number(f[chave] ?? 0) || 0;
  const total = faixas.reduce((s, f) => s + valor(f), 0);
  if (total <= 0) return { melhor: null, faixa: null, pouco_volume: true };
  let melhor: FaixaDoTempo | null = null;
  for (const f of faixas) {
    if (valor(f) <= 0) continue;
    const custo = (x: FaixaDoTempo) => (valor(x) > 0 ? x.gasto / valor(x) : Infinity);
    if (!melhor || valor(f) > valor(melhor) || (valor(f) === valor(melhor) && custo(f) < custo(melhor))) melhor = f;
  }
  let faixa: MelhorHorario["faixa"] = null;
  if (modo === "hora") {
    let maior = -1;
    for (let i = 0; i < 24; i++) {
      const soma = valor(faixas[i]) + valor(faixas[(i + 1) % 24]) + valor(faixas[(i + 2) % 24]);
      if (soma > maior) {
        maior = soma;
        const fim = (i + 3) % 24;
        faixa = { inicio: i, fim, rotulo: `das ${String(i).padStart(2, "0")}h às ${String(fim).padStart(2, "0")}h`, valor: soma, pct: Math.round((soma / total) * 100) };
      }
    }
  }
  return {
    melhor: melhor ? { indice: melhor.indice, rotulo: melhor.rotulo, valor: valor(melhor), custo: valor(melhor) > 0 ? arred(melhor.gasto / valor(melhor)) : null } : null,
    faixa,
    pouco_volume: total < MINIMO_PARA_MELHOR_HORARIO,
  };
}

// ------------------------------------------------------------------ atribuição e avisos

/** A janela de atribuição dos conjuntos, em português ("7 dias após o clique ou 1 dia após ver"). */
export function textoDaJanela(specs: unknown[]): string {
  const frases: string[] = [];
  for (const s of specs) {
    const lista = Array.isArray(s) ? s : [];
    const partes = lista
      .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : null))
      .filter((x): x is Record<string, unknown> => !!x)
      .map((x) => {
        const d = n(x.window_days) ?? 0;
        const tipo = String(x.event_type ?? "").toUpperCase();
        const dias = `${d} dia${d === 1 ? "" : "s"}`;
        if (tipo === "CLICK_THROUGH") return `${dias} após o clique`;
        if (tipo === "VIEW_THROUGH") return `${dias} após ver`;
        if (tipo === "ENGAGED_VIDEO_VIEW") return `${dias} após assistir`;
        return "";
      })
      .filter(Boolean);
    const f = partes.length ? partes.join(" ou ") : "7 dias após o clique ou 1 dia após ver (padrão da Meta)";
    if (frases.indexOf(f) < 0) frases.push(f);
  }
  if (!frases.length) return "7 dias após o clique ou 1 dia após ver (padrão da Meta)";
  return frases.length === 1 ? frases[0] : `varia por conjunto: ${frases.join("; ")}`;
}

/**
 * Avisos de quando o número ainda não fecha: período com hoje (a Meta leva
 * horas para contar) e a coleta do painel atrás do que a Meta já mostra.
 */
export function avisosDoNumero(opcoes: {
  fim: string;
  hoje: string;
  fonte: "meta_ao_vivo" | "coleta";
  aoVivo?: { conversas: number; leads: number; compras: number; gasto: number } | null;
  coleta?: { conversas: number; leads: number; compras: number; gasto: number } | null;
}): string[] {
  const avisos: string[] = [];
  if (opcoes.fonte === "coleta") avisos.push("Sem leitura da Meta agora: estes são os números da última coleta do painel. Podem estar atrás do Gerenciador.");
  if (opcoes.fim >= opcoes.hoje) avisos.push("O período inclui hoje: a Meta ainda conta as conversas e os resultados de hoje, que podem subir nas próximas horas.");
  const a = opcoes.aoVivo;
  const c = opcoes.coleta;
  if (a && c) {
    const faltas: string[] = [];
    if (a.conversas !== c.conversas) faltas.push(`${a.conversas} conversa${a.conversas === 1 ? "" : "s"} na Meta e ${c.conversas} na coleta`);
    if (a.leads !== c.leads) faltas.push(`${a.leads} lead${a.leads === 1 ? "" : "s"} na Meta e ${c.leads} na coleta`);
    if (a.compras !== c.compras) faltas.push(`${a.compras} compra${a.compras === 1 ? "" : "s"} na Meta e ${c.compras} na coleta`);
    if (faltas.length) avisos.push(`Os outros blocos da aba usam a coleta do painel (a cada 10 min) e ainda não bateram com a Meta: ${faltas.join("; ")}. Aqui vale o número da Meta.`);
  }
  return avisos;
}

/** Contagens da coleta do painel (linhas diárias de ads_creative_daily), para comparar com a Meta. */
export function contagensDaColeta(diarias: { spend?: unknown; actions?: unknown }[]): { conversas: number; leads: number; compras: number; gasto: number } {
  let conversas = 0, leads = 0, compras = 0, gasto = 0;
  for (const d of diarias) {
    conversas += valorDaAcao(d.actions, ACOES.conversas) ?? 0;
    leads += valorDaAcao(d.actions, ACOES.leads) ?? 0;
    compras += valorDaAcao(d.actions, ACOES.compras) ?? 0;
    gasto += n(d.spend) ?? 0;
  }
  return { conversas, leads, compras, gasto: arred(gasto) };
}

/**
 * Sem acesso à Meta agora: as linhas diárias da coleta (anúncio por dia) viram
 * linhas no formato de insights do nível pedido. Alcance não soma entre dias:
 * fica de fora (a tela mostra "-").
 */
export function linhasDaColeta(
  diarias: Record<string, unknown>[],
  nivel: NivelDaMetrica,
  nomes: { campanhas: Map<string, string>; anuncios: Map<string, string> },
): Record<string, unknown>[] {
  const grupos = new Map<string, Record<string, unknown>[]>();
  for (const d of diarias) {
    const k = nivel === "conta" ? "conta" : nivel === "campanha" ? String(d.campaign_id ?? "") : nivel === "conjunto" ? String(d.adset_id ?? "") : String(d.ad_id ?? "");
    if (!k) continue;
    const l = grupos.get(k);
    if (l) l.push(d);
    else grupos.set(k, [d]);
  }
  const saida: Record<string, unknown>[] = [];
  for (const [, ls] of grupos) {
    const somaAcoes = (campo: "actions" | "action_values") => {
      const m = new Map<string, number>();
      for (const l of ls) for (const a of Array.isArray(l[campo]) ? (l[campo] as Record<string, unknown>[]) : []) {
        const t = typeof a.action_type === "string" ? a.action_type : null;
        if (t) m.set(t, (m.get(t) ?? 0) + (n(a.value) ?? 0));
      }
      return [...m].map(([action_type, value]) => ({ action_type, value: String(value) }));
    };
    const p = ls[0];
    const soma = (c: string) => ls.reduce((s, l) => s + (n(l[c]) ?? 0), 0);
    const campanha = txt(p.campaign_id);
    saida.push({
      campaign_id: campanha,
      campaign_name: campanha ? nomes.campanhas.get(campanha) ?? txt(p.campaign_name) : null,
      adset_id: txt(p.adset_id),
      adset_name: txt(p.adset_name),
      ad_id: txt(p.ad_id),
      ad_name: txt(p.ad_id) ? nomes.anuncios.get(String(p.ad_id)) ?? null : null,
      objective: txt(p.objective),
      optimization_goal: txt(p.optimization_goal),
      spend: String(arred(soma("spend"))),
      impressions: String(soma("impressions")),
      clicks: String(soma("clicks")),
      inline_link_clicks: String(soma("link_clicks")),
      actions: somaAcoes("actions"),
      action_values: somaAcoes("action_values"),
    });
  }
  return saida;
}
