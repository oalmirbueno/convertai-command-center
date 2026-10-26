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
