/**
 * Anúncios hoje (26/10/2026): o boletim Meta do Hermes (9h e 17h30), as ações
 * reais nas contas e o que precisa do dono, numa página só.
 *
 * Contrato combinado com a frente SERVIDOR:
 * - `ads_boletins` (migration 20261026120300): dia, periodo, resumo,
 *   alertas[{client_id?, nivel, texto}], por_cliente[{client_id, gasto,
 *   resultado, observacao}], texto_completo, operator_slug, criado_em; o sino
 *   recebe um aviso `ads_boletim` com link /anuncios/hoje?boletim=<id>.
 * - `ads_rotina_acoes` NÃO ganhou colunas: o MCP grava tipo (traduzido),
 *   alvo jsonb {nivel, meta_id, nome, conta_id}, prova jsonb {antes, depois,
 *   prova_url, operator, acao, fonte, principal}, resumo e porque (o motivo).
 *   O normalizador lê esse jsonb (e aceita colunas soltas, se um dia vierem).
 *
 * Puro (sem React, sem Supabase) para o teste. Sem lookbehind (Safari 11).
 */

export type NivelDoAlerta = "critico" | "atencao" | "info";

export interface AlertaDoBoletim {
  client_id: string | null;
  nivel: NivelDoAlerta;
  texto: string;
}

export interface LinhaDoBoletim {
  client_id: string | null;
  gasto: number | null;
  resultado: string | null;
  observacao: string | null;
}

export interface Boletim {
  id: string;
  periodo: string;
  resumo: string;
  alertas: AlertaDoBoletim[];
  por_cliente: LinhaDoBoletim[];
  texto_completo: string;
  criado_em: string;
  operator: string | null;
}

export interface AcaoNaConta {
  id: string;
  clientId: string | null;
  quando: string;
  quem: string;
  alvoTipo: string | null;
  alvoNome: string;
  acao: string;
  antes: string | null;
  depois: string | null;
  motivo: string | null;
  provaUrl: string | null;
  estado: string | null;
}

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const numero = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v.replace(",", ".")))) return Number(v.replace(",", "."));
  return null;
};
const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Nível escrito de qualquer jeito pelo agente vira um dos três. */
export function nivelDoAlerta(v: unknown): NivelDoAlerta {
  const n = texto(v).toLowerCase();
  if (/^(critico|crítico|critical|alto|high|urgente|vermelho|erro|error|grave)/.test(n)) return "critico";
  if (/^(atencao|atenção|warning|warn|medio|médio|medium|amarelo|aviso)/.test(n)) return "atencao";
  return "info";
}

export const ROTULO_DO_NIVEL: Record<NivelDoAlerta, string> = { critico: "Urgente", atencao: "Atenção", info: "Informativo" };
const ORDEM_DO_NIVEL: Record<NivelDoAlerta, number> = { critico: 0, atencao: 1, info: 2 };

/** "manha"/"tarde" (ou a hora) vira o nome que o dono usa. */
export function nomeDoPeriodo(periodo: string): string {
  const p = periodo.toLowerCase();
  if (/^(manha|manhã|am|09|9h|morning)/.test(p)) return "Boletim das 9h";
  if (/^(tarde|pm|17|fim|evening|afternoon)/.test(p)) return "Boletim das 17h30";
  return periodo ? `Boletim · ${periodo}` : "Boletim";
}

export function normalizarBoletim(linha: unknown): Boletim {
  const r = objeto(linha);
  const alertas = (Array.isArray(r.alertas) ? r.alertas : [])
    .map((a) => {
      const o = objeto(a);
      return { client_id: texto(o.client_id) || null, nivel: nivelDoAlerta(o.nivel), texto: texto(o.texto) };
    })
    .filter((a) => a.texto)
    .sort((a, b) => ORDEM_DO_NIVEL[a.nivel] - ORDEM_DO_NIVEL[b.nivel]);
  const porCliente = (Array.isArray(r.por_cliente) ? r.por_cliente : []).map((l) => {
    const o = objeto(l);
    const resultado = o.resultado;
    return {
      client_id: texto(o.client_id) || null,
      gasto: numero(o.gasto),
      resultado: resultado === null || resultado === undefined ? null : typeof resultado === "object" ? JSON.stringify(resultado) : String(resultado),
      observacao: texto(o.observacao) || null,
    };
  });
  return {
    id: texto(r.id),
    periodo: texto(r.periodo),
    resumo: texto(r.resumo),
    alertas,
    por_cliente: porCliente,
    texto_completo: texto(r.texto_completo),
    criado_em: texto(r.criado_em) || texto(r.created_at),
    // A migration 20261026120300 grava operator_slug.
    operator: texto(r.operator_slug) || texto(r.operator) || null,
  };
}

/** Valor de antes/depois em texto curto (número, texto ou objeto pequeno). */
export function valorEmTexto(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const o = objeto(v);
  const pares = Object.keys(o).filter((k) => o[k] !== null && o[k] !== undefined && typeof o[k] !== "object").map((k) => `${k.replace(/_/g, " ")}: ${String(o[k])}`);
  return pares.length ? pares.join(" · ").slice(0, 200) : null;
}

const ACAO_LEGIVEL: Record<string, string> = {
  pausar: "Pausou", ativar: "Ativou", orcamento: "Mudou o orçamento", renomear: "Renomeou",
  duplicar_anuncio: "Duplicou o anúncio", trocar_criativo: "Trocou o criativo", vincular_criativo: "Vinculou o criativo",
  montar_campanha: "Montou a campanha", ativar_campanha: "Ativou a campanha", proposta: "Propôs", parada: "Parou a rotina",
  data_fim: "Mudou a data de fim", arquivar: "Arquivou", outro: "Mudou",
};

const QUEM: Record<string, string> = { rotina: "Rotina de tráfego", agente: "Agente sênior", paperclip: "Paperclip", default: "Hermes", hermes: "Hermes" };

export function normalizarAcao(linha: unknown): AcaoNaConta {
  const r = objeto(linha);
  const alvo = objeto(r.alvo);
  const prova = objeto(r.prova);
  // Gravação do MCP 2.19: tipo traduzido, alvo {nivel, meta_id, nome, conta_id},
  // prova {antes, depois, prova_url, operator, acao, fonte, principal}, resumo e porque.
  const acaoBruta = texto(r.acao) || texto(r.tipo) || texto(prova.acao);
  const operador = texto(r.operator) || texto(prova.operator) || texto(r.origem);
  const provaUrl = texto(r.prova_url) || texto(prova.prova_url) || texto(prova.url) || texto(prova.link) || texto(prova.print) || null;
  return {
    id: texto(r.id),
    clientId: texto(r.client_id) || null,
    quando: texto(r.criado_em) || texto(r.created_at),
    quem: QUEM[operador.toLowerCase()] || operador || "Agente",
    alvoTipo: texto(r.alvo_tipo) || texto(alvo.tipo) || texto(alvo.nivel) || null,
    alvoNome: texto(r.alvo_nome) || texto(alvo.nome) || texto(alvo.name) || texto(r.alvo_id) || texto(alvo.meta_id) || texto(alvo.id) || "Alvo não informado",
    acao: ACAO_LEGIVEL[acaoBruta] || acaoBruta || texto(r.resumo) || "Ação",
    antes: valorEmTexto(r.antes !== undefined ? r.antes : prova.antes),
    depois: valorEmTexto(r.depois !== undefined ? r.depois : r.resultado_depois !== undefined ? r.resultado_depois : prova.depois),
    motivo: texto(r.motivo) || texto(r.porque) || texto(r.resumo) || null,
    provaUrl: provaUrl && /^https?:\/\//i.test(provaUrl) ? provaUrl : null,
    estado: texto(r.estado) || null,
  };
}

export interface CampanhaDoPainel {
  id?: string;
  client_id: string;
  external_account_id?: string | null;
  name: string | null;
  status: string | null;
  effective_status: string | null;
  daily_budget: number | null;
  stop_time: string | null;
}

export interface ContaComSaldo {
  client_id: string;
  external_id?: string | null;
  display_name: string;
  status: string;
  saldo_disponivel?: number | null;
}

export type TipoDoPedido = "saldo" | "decisao" | "terminada" | "vencendo" | "alerta";

export interface PedidoDoTrafego {
  chave: string;
  tipo: TipoDoPedido;
  clientId: string | null;
  texto: string;
  quando?: string | null;
}

const DIA = 86_400_000;
const ativa = (c: CampanhaDoPainel) => String(c.effective_status || c.status || "").toUpperCase() === "ACTIVE";

/** Campanha marcada como ativa com o fim no passado: terminou (o status da Meta está desatualizado). */
export function campanhaTerminada(c: CampanhaDoPainel, agora: number): boolean {
  if (!ativa(c) || !c.stop_time) return false;
  const fim = Date.parse(c.stop_time);
  return Number.isFinite(fim) && fim <= agora;
}

/** Campanha ativa que termina nos próximos 3 dias. */
export function campanhaVencendo(c: CampanhaDoPainel, agora: number): boolean {
  if (!ativa(c) || !c.stop_time) return false;
  const fim = Date.parse(c.stop_time);
  return Number.isFinite(fim) && fim > agora && fim - agora <= 3 * DIA;
}

/**
 * Saldo baixo: conta ativa com saldo pré-pago que não cobre 3 dias da verba
 * diária das campanhas no ar (e nunca menos de R$ 50).
 */
export function saldoBaixo(conta: ContaComSaldo, campanhas: readonly CampanhaDoPainel[], agora: number): { baixo: boolean; diasQueCobre: number | null } {
  if (conta.status !== "active" || conta.saldo_disponivel === null || conta.saldo_disponivel === undefined) return { baixo: false, diasQueCobre: null };
  const daConta = campanhas.filter((c) => c.client_id === conta.client_id && (!conta.external_id || !c.external_account_id || c.external_account_id === conta.external_id) && ativa(c) && !campanhaTerminada(c, agora));
  const porDia = daConta.reduce((t, c) => t + (Number(c.daily_budget) || 0), 0);
  const saldo = Number(conta.saldo_disponivel) || 0;
  const piso = Math.max(50, porDia * 3);
  return { baixo: saldo < piso, diasQueCobre: porDia > 0 ? Math.floor((saldo / porDia) * 10) / 10 : null };
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** O que precisa do dono hoje, na ordem de urgência. */
export function precisaDeVoce(p: {
  contas: readonly ContaComSaldo[];
  campanhas: readonly CampanhaDoPainel[];
  acoes: readonly AcaoNaConta[];
  boletim: Boletim | null;
  nomeDe: (clientId: string | null) => string;
  agora: number;
}): PedidoDoTrafego[] {
  const saida: PedidoDoTrafego[] = [];
  for (const c of p.contas) {
    const s = saldoBaixo(c, p.campanhas, p.agora);
    if (!s.baixo) continue;
    saida.push({
      chave: `saldo:${c.client_id}:${c.external_id || c.display_name}`, tipo: "saldo", clientId: c.client_id,
      texto: `${p.nomeDe(c.client_id)}: saldo de ${brl(Number(c.saldo_disponivel) || 0)} (${c.display_name})${s.diasQueCobre !== null ? ` (cobre ${String(s.diasQueCobre).replace(".", ",")} ${s.diasQueCobre === 1 ? "dia" : "dias"})` : ""}`,
    });
  }
  if (p.boletim) {
    p.boletim.alertas.filter((a) => a.nivel === "critico").forEach((a, i) => {
      saida.push({ chave: `alerta:${p.boletim!.id}:${i}`, tipo: "alerta", clientId: a.client_id, texto: a.client_id ? `${p.nomeDe(a.client_id)}: ${a.texto}` : a.texto, quando: p.boletim!.criado_em });
    });
  }
  for (const a of p.acoes) {
    if (a.estado !== "proposta") continue;
    saida.push({ chave: `decisao:${a.id}`, tipo: "decisao", clientId: a.clientId, texto: `${p.nomeDe(a.clientId)}: proposta do agente em ${a.alvoNome}${a.motivo ? `: ${a.motivo}` : ""}`, quando: a.quando });
  }
  for (const c of p.campanhas) {
    if (campanhaTerminada(c, p.agora)) {
      saida.push({ chave: `terminada:${c.id || c.name}`, tipo: "terminada", clientId: c.client_id, texto: `${p.nomeDe(c.client_id)}: "${c.name || "campanha sem nome"}" terminou em ${new Date(c.stop_time!).toLocaleDateString("pt-BR")} (a Meta ainda marca como ativa)`, quando: c.stop_time });
    } else if (campanhaVencendo(c, p.agora)) {
      saida.push({ chave: `vencendo:${c.id || c.name}`, tipo: "vencendo", clientId: c.client_id, texto: `${p.nomeDe(c.client_id)}: "${c.name || "campanha sem nome"}" termina em ${new Date(c.stop_time!).toLocaleDateString("pt-BR")}`, quando: c.stop_time });
    }
  }
  return saida;
}

/** A tabela ainda não existe neste banco (migration da frente SERVIDOR não aplicada). */
export function tabelaAusente(erro: { message?: string; code?: string } | null | undefined): boolean {
  if (!erro) return false;
  return erro.code === "42P01" || erro.code === "PGRST205" || /does not exist|could not find the table|schema cache/i.test(erro.message || "");
}

/* ───────────── 26/10 (tarde): um cartão por cliente com anúncio ativo ───────────── */

/*
 * Pedido do dono (26/10): "são só os clientes que têm anúncios ativos: o que
 * estiver ativo na Mesa Ads aparece aqui; se não estiver na Mesa Ads, não
 * aparece". A Mesa Ads (etapa Conta) lê a conta ao vivo de `ads_campaigns`,
 * que a coleta ads-metrics atualiza a cada 10 min (collect_ads_now força).
 * Cliente ativo = tem ao menos uma campanha que a Mesa Ads mostra "No ar":
 * effective_status (ou status) ACTIVE e sem data de fim no passado (a mesma
 * regra do `statusLabel` em src/lib/adsLanguage.ts). Pausada, encerrada ou
 * ACTIVE com o fim já passado não conta.
 */

export interface DiaDeAnuncio {
  client_id: string;
  campaign_id: string;
  campaign_name?: string | null;
  objective?: string | null;
  day: string;
  spend: number | string | null;
  actions?: Array<{ action_type: string; value: string | number }> | null;
}

export type SituacaoDaCampanha = "ativa" | "terminando" | "terminada";
export type TomDoCusto = "bom" | "atencao" | "ruim" | "neutro";

export interface CampanhaDoCartao {
  chave: string;
  nome: string;
  situacao: SituacaoDaCampanha;
  /** Fim programado (ISO), quando há. */
  fim: string | null;
  verbaDiaria: number | null;
}

export interface CartaoDoCliente {
  clientId: string;
  gastoHoje: number;
  gastoSemana: number;
  /** Soma da verba diária das campanhas no ar (null: a verba mora no conjunto). */
  tetoDia: number | null;
  tetoSemana: number | null;
  /** Gasto dos últimos 7 dias, do mais antigo para hoje. */
  serie: number[];
  resultados: number | null;
  /** "conversas", "leads", "vendas" (plural). */
  nomeDoResultado: string;
  custoPorResultado: number | null;
  custoAnterior: number | null;
  tom: TomDoCusto;
  campanhas: CampanhaDoCartao[];
  saldo: number | null;
  saldoBaixo: boolean;
  diasQueCobre: number | null;
  ultimaAcao: AcaoNaConta | null;
  propostas: number;
  alertas: AlertaDoBoletim[];
}

const ehAtiva = (c: CampanhaDoPainel) => String(c.effective_status || c.status || "").toUpperCase() === "ACTIVE";

/** A campanha que a Mesa Ads mostra "No ar". */
export function campanhaNoAr(c: CampanhaDoPainel, agora: number): boolean {
  return ehAtiva(c) && !campanhaTerminada(c, agora);
}

/** Os clientes com anúncio ativo na Mesa Ads (ao menos uma campanha no ar). */
export function clientesComAnuncioAtivo(campanhas: readonly CampanhaDoPainel[], agora: number): string[] {
  const ids: string[] = [];
  for (const c of campanhas) if (c.client_id && campanhaNoAr(c, agora) && ids.indexOf(c.client_id) < 0) ids.push(c.client_id);
  return ids;
}

/** Data local AAAA-MM-DD (o `day` da coleta). */
export function diaLocal(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const TIPOS_DE_RESULTADO: Array<{ nome: string; tipos: string[]; objetivo: RegExp }> = [
  { nome: "vendas", tipos: ["offsite_conversion.fb_pixel_purchase", "purchase", "omni_purchase"], objetivo: /SALES|CONVERSION|CATALOG|PRODUCT/ },
  { nome: "leads", tipos: ["onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead", "lead", "leadgen.other"], objetivo: /LEAD/ },
  // Conversa iniciada = só messaging_conversation_started_7d (a reserva total_messaging_connection inflava; Mesa Ads, 01/10).
  { nome: "conversas", tipos: ["onsite_conversion.messaging_conversation_started_7d", "messaging_conversation_started_7d"], objetivo: /MESSAG|ENGAGEMENT/ },
];

/** O resultado principal: o tipo que o objetivo pede ou o mais valioso que apareceu. */
function resultadoPrincipal(dias: readonly DiaDeAnuncio[]): { nome: string; tipos: string[] } | null {
  const presentes: Record<string, true> = {};
  for (const d of dias) for (const a of d.actions || []) if (a && a.action_type) presentes[a.action_type] = true;
  const objetivo = String((dias.find((d) => d.objective) || { objective: "" }).objective || "").toUpperCase();
  const doObjetivo = TIPOS_DE_RESULTADO.find((t) => t.objetivo.test(objetivo) && t.tipos.some((x) => presentes[x]));
  if (doObjetivo) return doObjetivo;
  return TIPOS_DE_RESULTADO.find((t) => t.tipos.some((x) => presentes[x])) || null;
}

function contar(dias: readonly DiaDeAnuncio[], tipos: string[]): number {
  let n = 0;
  for (const d of dias) {
    const achado = (d.actions || []).find((a) => tipos.indexOf(a.action_type) >= 0);
    if (achado) n += Number(achado.value) || 0;
  }
  return n;
}

/**
 * Custo por resultado da semana contra a semana anterior: até 10% acima é
 * bom, até 35% é atenção, mais que isso é ruim. Gasto de R$ 50 ou mais sem
 * resultado é ruim. Sem semana anterior para comparar, neutro.
 */
export function tomDoCusto(atual: number | null, anterior: number | null, gasto: number, resultados: number | null): TomDoCusto {
  if (gasto >= 50 && !resultados) return "ruim";
  if (atual === null || anterior === null || anterior <= 0) return "neutro";
  const r = atual / anterior;
  if (r <= 1.1) return "bom";
  if (r <= 1.35) return "atencao";
  return "ruim";
}

const ORDEM_DA_SITUACAO: Record<SituacaoDaCampanha, number> = { terminada: 0, terminando: 1, ativa: 2 };

/** Um cartão por cliente com anúncio ativo, o que mais pede atenção primeiro. */
export function montarCartoes(p: {
  campanhas: readonly CampanhaDoPainel[];
  dias: readonly DiaDeAnuncio[];
  contas: readonly ContaComSaldo[];
  acoes: readonly AcaoNaConta[];
  boletim: Boletim | null;
  agora: number;
}): CartaoDoCliente[] {
  const ativos = clientesComAnuncioAtivo(p.campanhas, p.agora);
  const hoje = diaLocal(p.agora);
  const seteDias: string[] = [];
  for (let i = 6; i >= 0; i -= 1) seteDias.push(diaLocal(p.agora - i * DIA));
  const antes: string[] = [];
  for (let i = 13; i >= 7; i -= 1) antes.push(diaLocal(p.agora - i * DIA));
  const gasto = (lista: readonly DiaDeAnuncio[]) => lista.reduce((t, d) => t + (Number(d.spend) || 0), 0);

  const cartoes = ativos.map((clientId): CartaoDoCliente => {
    const doCliente = p.campanhas.filter((c) => c.client_id === clientId);
    const verbas = doCliente.filter((c) => campanhaNoAr(c, p.agora)).map((c) => (c.daily_budget === null || c.daily_budget === undefined ? null : Number(c.daily_budget) || 0));
    const tetoDia = verbas.some((v) => v !== null) ? verbas.reduce((t: number, v) => t + (v || 0), 0) : null;

    const dias = p.dias.filter((d) => d.client_id === clientId);
    const semana = dias.filter((d) => seteDias.indexOf(d.day) >= 0);
    const anterior = dias.filter((d) => antes.indexOf(d.day) >= 0);
    const gastoSemana = gasto(semana);
    const principal = resultadoPrincipal(semana.length ? semana : dias);
    const resultados = principal ? contar(semana, principal.tipos) : null;
    const resultadosAntes = principal ? contar(anterior, principal.tipos) : 0;
    const custo = resultados ? gastoSemana / resultados : null;
    const custoAnterior = resultadosAntes ? gasto(anterior) / resultadosAntes : null;

    const campanhas: CampanhaDoCartao[] = doCliente
      .filter(ehAtiva)
      .map((c) => ({
        chave: String(c.id || c.name),
        nome: c.name || "Campanha sem nome",
        situacao: (campanhaTerminada(c, p.agora) ? "terminada" : campanhaVencendo(c, p.agora) ? "terminando" : "ativa") as SituacaoDaCampanha,
        fim: c.stop_time,
        verbaDiaria: c.daily_budget === null || c.daily_budget === undefined ? null : Number(c.daily_budget) || 0,
      }))
      // Terminada há mais de 7 dias não interessa mais.
      .filter((c) => c.situacao !== "terminada" || !c.fim || p.agora - Date.parse(c.fim) <= 7 * DIA)
      .sort((a, b) => ORDEM_DA_SITUACAO[a.situacao] - ORDEM_DA_SITUACAO[b.situacao]);

    let saldo: number | null = null;
    let baixo = false;
    let cobre: number | null = null;
    for (const c of p.contas) {
      if (c.client_id !== clientId || c.saldo_disponivel === null || c.saldo_disponivel === undefined) continue;
      saldo = (saldo || 0) + (Number(c.saldo_disponivel) || 0);
      const s = saldoBaixo(c, p.campanhas, p.agora);
      if (s.baixo) baixo = true;
      if (s.diasQueCobre !== null) cobre = cobre === null ? s.diasQueCobre : Math.min(cobre, s.diasQueCobre);
    }

    const acoes = p.acoes.filter((a) => a.clientId === clientId);
    return {
      clientId,
      gastoHoje: gasto(dias.filter((d) => d.day === hoje)),
      gastoSemana,
      tetoDia,
      tetoSemana: tetoDia === null ? null : tetoDia * 7,
      serie: seteDias.map((d) => gasto(dias.filter((x) => x.day === d))),
      resultados,
      nomeDoResultado: principal ? principal.nome : "resultados",
      custoPorResultado: custo,
      custoAnterior,
      tom: tomDoCusto(custo, custoAnterior, gastoSemana, resultados),
      campanhas,
      saldo,
      saldoBaixo: baixo,
      diasQueCobre: cobre,
      ultimaAcao: acoes.find((a) => a.estado !== "proposta") || null,
      propostas: acoes.filter((a) => a.estado === "proposta").length,
      alertas: p.boletim ? p.boletim.alertas.filter((a) => a.client_id === clientId) : [],
    };
  });

  return cartoes
    .map((c) => ({ c, peso: pesoDoCartao(c) }))
    .sort((a, b) => b.peso - a.peso || b.c.gastoSemana - a.c.gastoSemana)
    .map((x) => x.c);
}

/** Quantas coisas pedem o dono neste cartão (saldo, proposta, campanha terminando, alerta, custo ruim). */
export function alertasDoCartao(c: CartaoDoCliente): number {
  return (c.saldoBaixo ? 1 : 0)
    + c.propostas
    + c.campanhas.filter((x) => x.situacao !== "ativa").length
    + c.alertas.filter((a) => a.nivel !== "info").length
    + (c.tom === "ruim" ? 1 : 0);
}

function pesoDoCartao(c: CartaoDoCliente): number {
  return (c.saldoBaixo ? 100 : 0) + c.propostas * 50 + c.alertas.filter((a) => a.nivel === "critico").length * 40 + (c.tom === "ruim" ? 20 : 0) + alertasDoCartao(c);
}

/** Os números da carteira (topo da tela). */
export function numerosDaCarteira(cartoes: readonly CartaoDoCliente[]): { gastoHoje: number; gastoSemana: number; resultados: number; custoMedio: number | null; alertas: number; tetoDia: number | null } {
  let gastoHoje = 0;
  let gastoSemana = 0;
  let resultados = 0;
  let gastoComResultado = 0;
  let alertas = 0;
  let tetoDia: number | null = null;
  for (const c of cartoes) {
    gastoHoje += c.gastoHoje;
    gastoSemana += c.gastoSemana;
    if (c.resultados) {
      resultados += c.resultados;
      gastoComResultado += c.gastoSemana;
    }
    if (c.tetoDia !== null) tetoDia = (tetoDia || 0) + c.tetoDia;
    alertas += alertasDoCartao(c);
  }
  return { gastoHoje, gastoSemana, resultados, custoMedio: resultados ? gastoComResultado / resultados : null, alertas, tetoDia };
}
