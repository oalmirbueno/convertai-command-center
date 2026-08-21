import { supabase } from "@/integrations/supabase/client";

/**
 * O Departamento Comercial da Aceleriq.
 *
 * Regra que organiza o módulo inteiro: **alvo é dado próprio, realizado é
 * lido do Financeiro**. A meta do mês mora em `commercial_goals`; quanto
 * entrou de verdade sai de `financial_entries` na hora de exibir. Copiar o
 * realizado para cá criaria dois números para o mesmo mês, e no primeiro
 * acerto de lançamento eles discordariam — com a tela do comercial dizendo
 * uma coisa e a do financeiro, outra.
 *
 * Nada aqui é do cliente. É gestão de dentro de casa, e o RLS já recusa
 * quem não é admin nem manager.
 */

/* ─────────────────────────────── Funil ──────────────────────────────────── */

/**
 * Os estágios, na ordem em que a conversa acontece.
 *
 * `ganho` e `perdido` são finais e ficam fora do quadro de trabalho: quadro
 * que acumula fechado vira arquivo, e a coluna de hoje some no meio.
 */
export const ESTAGIOS = [
  { id: "novo", label: "Novo", ajuda: "Chegou e ainda não foi tocado" },
  { id: "contato", label: "Em contato", ajuda: "Conversa aberta, sem reunião marcada" },
  { id: "diagnostico", label: "Diagnóstico", ajuda: "Entendendo o negócio e o problema" },
  { id: "proposta", label: "Proposta", ajuda: "Proposta enviada, esperando resposta" },
  { id: "negociacao", label: "Negociação", ajuda: "Ajustando valor, escopo ou prazo" },
  { id: "ganho", label: "Ganho", ajuda: "Fechou e virou cliente" },
  { id: "perdido", label: "Perdido", ajuda: "Não seguiu — o motivo fica registrado" },
] as const;

export type EstagioId = (typeof ESTAGIOS)[number]["id"];

export const ESTAGIOS_ABERTOS = ESTAGIOS.filter(
  (e) => e.id !== "ganho" && e.id !== "perdido",
).map((e) => e.id) as EstagioId[];

export const rotuloDoEstagio = (id: string) =>
  ESTAGIOS.find((e) => e.id === id)?.label || id;

export const ORIGENS = [
  "indicacao",
  "instagram",
  "quiz",
  "prospeccao",
  "evento",
  "site",
  "manual",
] as const;

export const CANAIS = [
  "meta",
  "google",
  "organico",
  "indicacao",
  "evento",
  "outbound",
  "outro",
] as const;

export interface Lead {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  whatsapp: string | null;
  origin: string;
  campaign_id: string | null;
  quiz_submission_id: string | null;
  stage: string;
  monthly_value: number;
  one_off_value: number;
  owner_id: string | null;
  next_action: string | null;
  next_action_at: string | null;
  notes: string | null;
  lost_reason: string | null;
  won_client_id: string | null;
  closed_at: string | null;
  created_at: string;
}

export interface Campanha {
  id: string;
  name: string;
  channel: string;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  budget: number;
  spent: number;
  goal: string | null;
  notes: string | null;
}

export interface Meta {
  id: string;
  period: string;
  metric: string;
  target: number;
  notes: string | null;
}

const numero = (valor: unknown) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

/* ──────────────────────────────── Leads ─────────────────────────────────── */

export async function listarLeads(): Promise<Lead[]> {
  const { data, error } = await supabase
    .from("commercial_leads")
    .select("*")
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((linha) => ({
    ...(linha as unknown as Lead),
    monthly_value: numero(linha.monthly_value),
    one_off_value: numero(linha.one_off_value),
  }));
}

export async function salvarLead(
  lead: Partial<Lead> & { name: string },
): Promise<string | null> {
  const { data: sessao } = await supabase.auth.getUser();
  const corpo = {
    name: lead.name.trim().slice(0, 160),
    company: lead.company?.trim() || null,
    email: lead.email?.trim() || null,
    whatsapp: lead.whatsapp?.trim() || null,
    origin: lead.origin || "manual",
    campaign_id: lead.campaign_id || null,
    stage: lead.stage || "novo",
    monthly_value: numero(lead.monthly_value),
    one_off_value: numero(lead.one_off_value),
    next_action: lead.next_action?.trim() || null,
    next_action_at: lead.next_action_at || null,
    notes: lead.notes?.trim() || null,
  };
  if (lead.id) {
    const { error } = await supabase
      .from("commercial_leads")
      .update(corpo as never)
      .eq("id", lead.id);
    return error ? null : lead.id;
  }
  const { data, error } = await supabase
    .from("commercial_leads")
    .insert({
      ...corpo,
      quiz_submission_id: lead.quiz_submission_id || null,
      created_by: sessao?.user?.id || null,
    } as never)
    .select("id")
    .single();
  if (error || !data) return null;
  return String((data as Record<string, unknown>).id);
}

/**
 * Move o lead de estágio e registra a passagem.
 *
 * O evento não é enfeite: "em que pé está" sem "como chegou aqui" vira
 * adivinhação na semana seguinte, e é o que faz o histórico do funil existir.
 * Ganho e perdido carimbam `closed_at` — é dele que sai a conta de quanto
 * tempo o funil leva para fechar.
 */
export async function moverLead(input: {
  lead: Lead;
  paraEstagio: EstagioId;
  motivo?: string;
  clienteGanho?: string | null;
}): Promise<boolean> {
  const { lead, paraEstagio, motivo, clienteGanho } = input;
  if (lead.stage === paraEstagio) return true;
  const { data: sessao } = await supabase.auth.getUser();
  const fechou = paraEstagio === "ganho" || paraEstagio === "perdido";
  const { error } = await supabase
    .from("commercial_leads")
    .update({
      stage: paraEstagio,
      closed_at: fechou ? new Date().toISOString() : null,
      lost_reason: paraEstagio === "perdido" ? motivo?.trim() || null : null,
      won_client_id: paraEstagio === "ganho" ? clienteGanho || null : null,
    } as never)
    .eq("id", lead.id);
  if (error) return false;
  await supabase.from("commercial_lead_events").insert({
    lead_id: lead.id,
    kind: "stage",
    from_stage: lead.stage,
    to_stage: paraEstagio,
    note: motivo?.trim() || null,
    created_by: sessao?.user?.id || null,
  } as never);
  return true;
}

export async function anotarNoLead(leadId: string, nota: string): Promise<boolean> {
  const texto = nota.trim();
  if (texto.length < 2) return false;
  const { data: sessao } = await supabase.auth.getUser();
  const { error } = await supabase.from("commercial_lead_events").insert({
    lead_id: leadId,
    kind: "nota",
    note: texto.slice(0, 2000),
    created_by: sessao?.user?.id || null,
  } as never);
  return !error;
}

export async function historicoDoLead(leadId: string) {
  const { data, error } = await supabase
    .from("commercial_lead_events")
    .select("id, kind, from_stage, to_stage, note, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return data as Array<{
    id: string;
    kind: string;
    from_stage: string | null;
    to_stage: string | null;
    note: string | null;
    created_at: string;
  }>;
}

export async function arquivarLead(id: string): Promise<boolean> {
  const { error } = await supabase
    .from("commercial_leads")
    .update({ archived_at: new Date().toISOString() } as never)
    .eq("id", id);
  return !error;
}

/**
 * Puxa para o funil quem preencheu o diagnóstico e ainda não está lá.
 *
 * O quiz já trazia gente qualificada e o painel só sabia listá-la. Sem isto,
 * entrar no funil era recadastrar tudo na mão — e o que se digita de novo
 * se digita diferente.
 */
export async function importarLeadsDoQuiz(): Promise<number> {
  const { data: quiz } = await supabase
    .from("quiz_submissions")
    .select("id, lead_name, lead_email, lead_whatsapp, lead_company, submitted_at")
    .order("submitted_at", { ascending: false })
    .limit(200);
  if (!quiz || quiz.length === 0) return 0;

  const { data: existentes } = await supabase
    .from("commercial_leads")
    .select("quiz_submission_id")
    .not("quiz_submission_id", "is", null);
  const jaTem = new Set(
    ((existentes || []) as Array<{ quiz_submission_id: string }>).map(
      (l) => l.quiz_submission_id,
    ),
  );

  const novos = (quiz as Array<Record<string, unknown>>)
    .filter((linha) => !jaTem.has(String(linha.id)))
    .map((linha) => ({
      name: String(linha.lead_name || "Sem nome").slice(0, 160),
      company: (linha.lead_company as string) || null,
      email: (linha.lead_email as string) || null,
      whatsapp: (linha.lead_whatsapp as string) || null,
      origin: "quiz",
      quiz_submission_id: String(linha.id),
      stage: "novo",
    }));
  if (novos.length === 0) return 0;

  const { data: sessao } = await supabase.auth.getUser();
  const { error } = await supabase.from("commercial_leads").insert(
    novos.map((n) => ({ ...n, created_by: sessao?.user?.id || null })) as never,
  );
  return error ? 0 : novos.length;
}

/* ──────────────────────────────── Metas ─────────────────────────────────── */

/**
 * As métricas que a casa persegue.
 *
 * `receita` e `mrr_novo` são lidas do Financeiro; `fechamentos` e `leads`
 * saem do próprio funil. Cada uma diz de onde vem o realizado para que
 * ninguém precise adivinhar por que o número é aquele.
 */
export const METRICAS = [
  {
    id: "receita",
    label: "Receita do mês",
    fonte: "Financeiro — entradas com competência no mês",
    dinheiro: true,
  },
  {
    id: "mrr_novo",
    label: "Mensalidade nova",
    fonte: "Funil — mensalidade dos leads ganhos no mês",
    dinheiro: true,
  },
  {
    id: "fechamentos",
    label: "Contratos fechados",
    fonte: "Funil — leads que entraram em Ganho no mês",
    dinheiro: false,
  },
  {
    id: "leads",
    label: "Leads novos",
    fonte: "Funil — leads criados no mês",
    dinheiro: false,
  },
] as const;

export const primeiroDiaDoMes = (data: Date) =>
  `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-01`;

export async function listarMetas(periodo: string): Promise<Meta[]> {
  const { data, error } = await supabase
    .from("commercial_goals")
    .select("id, period, metric, target, notes")
    .eq("period", periodo);
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((linha) => ({
    ...(linha as unknown as Meta),
    target: numero(linha.target),
  }));
}

export async function salvarMeta(input: {
  periodo: string;
  metrica: string;
  alvo: number;
}): Promise<boolean> {
  const { periodo, metrica, alvo } = input;
  if (!(alvo > 0)) return false;
  const { data: sessao } = await supabase.auth.getUser();
  // onConflict na chave (period, metric): editar a meta do mês é o caso
  // comum, e sem isto o segundo salvar estouraria na chave única.
  const { error } = await supabase.from("commercial_goals").upsert(
    {
      period: periodo,
      metric: metrica,
      target: alvo,
      created_by: sessao?.user?.id || null,
    } as never,
    { onConflict: "period,metric" },
  );
  return !error;
}

export async function apagarMeta(id: string): Promise<boolean> {
  const { error } = await supabase.from("commercial_goals").delete().eq("id", id);
  return !error;
}

/* ────────────────────── A ponte com o Financeiro ────────────────────────── */

/**
 * A receita REALIZADA do mês, lida do Financeiro central.
 *
 * Usa `competence` (o mês a que a receita pertence), não a data de
 * pagamento: é assim que o Financeiro fecha o mês, e usar régua diferente
 * faria a mesma empresa ter dois "faturamento de agosto". Cancelado fica de
 * fora — é lançamento que deixou de existir.
 */
export async function receitaDoMes(periodo: string): Promise<number> {
  const inicio = periodo;
  const fim = proximoMes(periodo);
  const { data, error } = await supabase
    .from("financial_entries")
    .select("amount")
    .eq("direction", "in")
    .is("cancelled_at", null)
    .gte("competence", inicio)
    .lt("competence", fim);
  if (error || !data) return 0;
  return (data as Array<{ amount: unknown }>).reduce(
    (soma, linha) => soma + numero(linha.amount),
    0,
  );
}

export function proximoMes(periodo: string): string {
  const [ano, mes] = periodo.split("-").map(Number);
  return mes === 12
    ? `${ano + 1}-01-01`
    : `${ano}-${String(mes + 1).padStart(2, "0")}-01`;
}

const dentroDoMes = (iso: string | null, periodo: string) => {
  if (!iso) return false;
  return iso >= periodo && iso < proximoMes(periodo);
};

/**
 * O realizado de cada métrica, montado a partir das duas fontes.
 *
 * Recebe os leads já carregados em vez de consultar de novo: a tela já os
 * tem na mão, e uma segunda consulta abriria espaço para as duas listas
 * discordarem na mesma tela.
 */
export function realizadoDoMes(input: {
  metrica: string;
  leads: Lead[];
  periodo: string;
  receitaFinanceiro: number;
}): number {
  const { metrica, leads, periodo, receitaFinanceiro } = input;
  if (metrica === "receita") return receitaFinanceiro;
  const ganhosDoMes = leads.filter(
    (lead) => lead.stage === "ganho" && dentroDoMes(lead.closed_at, periodo),
  );
  if (metrica === "mrr_novo") {
    return ganhosDoMes.reduce((soma, lead) => soma + lead.monthly_value, 0);
  }
  if (metrica === "fechamentos") return ganhosDoMes.length;
  if (metrica === "leads") {
    return leads.filter((lead) => dentroDoMes(lead.created_at, periodo)).length;
  }
  return 0;
}

/* ────────────────────────────── Campanhas ───────────────────────────────── */

export async function listarCampanhas(): Promise<Campanha[]> {
  const { data, error } = await supabase
    .from("commercial_campaigns")
    .select("*")
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((linha) => ({
    ...(linha as unknown as Campanha),
    budget: numero(linha.budget),
    spent: numero(linha.spent),
  }));
}

export async function salvarCampanha(
  campanha: Partial<Campanha> & { name: string },
): Promise<boolean> {
  const { data: sessao } = await supabase.auth.getUser();
  const corpo = {
    name: campanha.name.trim().slice(0, 160),
    channel: campanha.channel || "outro",
    status: campanha.status || "ativa",
    starts_on: campanha.starts_on || null,
    ends_on: campanha.ends_on || null,
    budget: numero(campanha.budget),
    spent: numero(campanha.spent),
    goal: campanha.goal?.trim() || null,
    notes: campanha.notes?.trim() || null,
  };
  if (campanha.id) {
    const { error } = await supabase
      .from("commercial_campaigns")
      .update(corpo as never)
      .eq("id", campanha.id);
    return !error;
  }
  const { error } = await supabase
    .from("commercial_campaigns")
    .insert({ ...corpo, created_by: sessao?.user?.id || null } as never);
  return !error;
}

export async function arquivarCampanha(id: string): Promise<boolean> {
  const { error } = await supabase
    .from("commercial_campaigns")
    .update({ archived_at: new Date().toISOString() } as never)
    .eq("id", id);
  return !error;
}

export interface KpiDaCampanha {
  leads: number;
  ganhos: number;
  investido: number;
  mrrGanho: number;
  entradaGanha: number;
  /** Custo por lead. `null` quando ainda não houve lead — divisão sem sentido. */
  custoPorLead: number | null;
  /** Custo de aquisição por cliente fechado. */
  custoPorCliente: number | null;
  /**
   * Quanto a campanha devolve no primeiro ano, por real investido.
   *
   * Mensalidade × 12 + entrada: campanha se paga em contrato que dura, e
   * medir só o primeiro mês faria toda campanha parecer prejuízo.
   */
  retornoAnual: number | null;
}

export function kpisDaCampanha(campanha: Campanha, leads: Lead[]): KpiDaCampanha {
  const daCampanha = leads.filter((lead) => lead.campaign_id === campanha.id);
  const ganhos = daCampanha.filter((lead) => lead.stage === "ganho");
  const investido = campanha.spent > 0 ? campanha.spent : 0;
  const mrrGanho = ganhos.reduce((soma, lead) => soma + lead.monthly_value, 0);
  const entradaGanha = ganhos.reduce((soma, lead) => soma + lead.one_off_value, 0);
  const retorno = mrrGanho * 12 + entradaGanha;
  return {
    leads: daCampanha.length,
    ganhos: ganhos.length,
    investido,
    mrrGanho,
    entradaGanha,
    custoPorLead: daCampanha.length > 0 && investido > 0 ? investido / daCampanha.length : null,
    custoPorCliente: ganhos.length > 0 && investido > 0 ? investido / ganhos.length : null,
    retornoAnual: investido > 0 ? retorno / investido : null,
  };
}

/* ──────────────────────────── Saúde do funil ────────────────────────────── */

export interface ResumoDoFunil {
  abertos: number;
  valorEmJogo: number;
  ganhosNoMes: number;
  perdidosNoMes: number;
  taxaDeGanho: number | null;
  semProximoPasso: number;
  atrasados: number;
}

/**
 * O retrato do funil hoje.
 *
 * `valorEmJogo` soma mensalidade × 12 + entrada dos leads abertos: é o que
 * está em disputa no ano, e é a leitura que faz um lead de mensalidade
 * pequena e um projeto grande caberem na mesma conta.
 *
 * `semProximoPasso` e `atrasados` existem porque funil não morre de proposta
 * recusada — morre de lead esquecido.
 */
export function resumoDoFunil(leads: Lead[], periodo: string, hojeIso: string): ResumoDoFunil {
  const abertos = leads.filter((lead) => ESTAGIOS_ABERTOS.includes(lead.stage as EstagioId));
  const ganhos = leads.filter(
    (lead) => lead.stage === "ganho" && dentroDoMes(lead.closed_at, periodo),
  );
  const perdidos = leads.filter(
    (lead) => lead.stage === "perdido" && dentroDoMes(lead.closed_at, periodo),
  );
  const fechados = ganhos.length + perdidos.length;
  return {
    abertos: abertos.length,
    valorEmJogo: abertos.reduce(
      (soma, lead) => soma + lead.monthly_value * 12 + lead.one_off_value,
      0,
    ),
    ganhosNoMes: ganhos.length,
    perdidosNoMes: perdidos.length,
    taxaDeGanho: fechados > 0 ? ganhos.length / fechados : null,
    semProximoPasso: abertos.filter((lead) => !lead.next_action_at).length,
    atrasados: abertos.filter(
      (lead) => lead.next_action_at != null && lead.next_action_at < hojeIso,
    ).length,
  };
}

export const dinheiro = (valor: number) =>
  valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
