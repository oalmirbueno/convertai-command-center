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
  { id: "perdido", label: "Perdido", ajuda: "Não seguiu. O motivo fica registrado" },
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

/* ───────────────────── Classe e qualificação ────────────────────────────── */

/**
 * As três classes de oportunidade — exatamente três, porque a primeira
 * pergunta de qualquer negócio da casa é "com quem estamos falando": quem
 * já paga, quem já paga e pode contratar mais, ou quem nunca comprou.
 *
 * `null` na coluna significa NÃO CONFIRMADO. Nunca se preenche em massa:
 * classe chutada parece resposta e mente melhor que o campo em branco.
 */
export const CLASSES_DO_LEAD = [
  {
    id: "cliente_atual",
    label: "Cliente atual",
    ajuda: "Negócio novo com quem já é cliente da casa",
  },
  {
    id: "upsell",
    label: "Upsell",
    ajuda: "Ampliar o que um cliente atual já contrata",
  },
  {
    id: "novo_prospect",
    label: "Novo prospect",
    ajuda: "Nunca comprou. É daqui que a meta de recorrentes sai",
  },
] as const;

export type ClasseDoLead = (typeof CLASSES_DO_LEAD)[number]["id"];

export const rotuloDaClasse = (id: string | null) =>
  CLASSES_DO_LEAD.find((c) => c.id === id)?.label || "não confirmado";

/**
 * Os campos de qualificação, na ordem em que se pergunta numa conversa.
 *
 * Moram num jsonb no lead: campo ausente é NÃO CONFIRMADO — nunca vira
 * "zero" nem "não existe", porque não perguntado e respondido com "nada"
 * são coisas diferentes e a segunda encerra conversa que nem começou.
 */
export const CAMPOS_DE_QUALIFICACAO = [
  {
    id: "aderencia_icp",
    label: "Aderência ao ICP",
    dica: "O quanto parece o cliente ideal, e por quê",
  },
  {
    id: "problema",
    label: "Problema identificado",
    dica: "A dor, com as palavras do próprio lead",
  },
  {
    id: "orcamento",
    label: "Orçamento",
    dica: "Quanto ele disse que pode investir por mês",
  },
  {
    id: "autoridade",
    label: "Autoridade",
    dica: "Quem decide, e se é com quem estamos falando",
  },
  {
    id: "urgencia",
    label: "Urgência",
    dica: "Para quando ele precisa disso resolvido",
  },
  {
    id: "recorrencia",
    label: "Potencial de recorrência",
    dica: "Chance de virar mensalidade, e de quanto",
  },
  {
    id: "aprovacao",
    label: "Aprovação necessária",
    dica: "O que precisa de aval do dono antes de seguir",
  },
] as const;

/** Só o que foi escrito de verdade entra no jsonb; vazio fica ausente. */
const qualificacaoLimpa = (valor: unknown): Record<string, string> => {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};
  const limpo: Record<string, string> = {};
  for (const [chave, texto] of Object.entries(valor as Record<string, unknown>)) {
    if (typeof texto === "string" && texto.trim()) limpo[chave] = texto.trim();
  }
  return limpo;
};

/**
 * Uma oportunidade conta como QUALIFICADA quando tem classe confirmada,
 * dono único e um próximo passo agendado. É a régua da metrificação por
 * etapa: sem essas três coisas o funil é só uma lista de nomes.
 */
export const leadQualificado = (lead: Lead, temProximoPasso: boolean) =>
  Boolean(lead.classe) && Boolean(lead.owner_id) && temProximoPasso;

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
  /** Quando se espera fechar. Sem isto não existe previsão, só soma. */
  expected_close_date: string | null;
  /** A ficha da empresa. O negócio termina; ela fica, com a história toda. */
  organization_id: string | null;
  contact_id: string | null;
  /** Cliente atual, upsell ou novo prospect. `null` é não confirmado. */
  classe: string | null;
  /** Campos de qualificação preenchidos. Ausente = não confirmado. */
  qualificacao: Record<string, string>;
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
    classe: typeof linha.classe === "string" ? linha.classe : null,
    qualificacao: qualificacaoLimpa(linha.qualificacao),
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
    expected_close_date: lead.expected_close_date || null,
    owner_id: lead.owner_id || null,
    organization_id: lead.organization_id || null,
    contact_id: lead.contact_id || null,
    notes: lead.notes?.trim() || null,
    classe: lead.classe || null,
    qualificacao: qualificacaoLimpa(lead.qualificacao),
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
    fonte: "Financeiro: entradas com competência no mês",
    dinheiro: true,
  },
  {
    id: "mrr_novo",
    label: "Mensalidade nova",
    fonte: "CRM: mensalidade dos leads ganhos no mês",
    dinheiro: true,
  },
  {
    id: "fechamentos",
    label: "Contratos fechados",
    fonte: "CRM: leads que entraram em Ganho no mês",
    dinheiro: false,
  },
  {
    id: "leads",
    label: "Leads novos",
    fonte: "CRM: leads criados no mês",
    dinheiro: false,
  },
  {
    id: "clientes_recorrentes",
    label: "Clientes recorrentes ativos",
    fonte: "Financeiro: clientes com mensalidade recorrente lançada no mês",
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

/**
 * Quantos clientes têm mensalidade RECORRENTE lançada no mês, lido do
 * Financeiro central. Conta cliente distinto com entrada gerada por regra
 * de recorrência, competência no mês e não cancelada: é quem o Financeiro
 * cobrou de verdade, não quem o comercial acha que é recorrente — a mesma
 * régua de "alvo é dado próprio, realizado é lido do Financeiro".
 */
export async function clientesRecorrentesDoMes(periodo: string): Promise<number> {
  const { data, error } = await supabase
    .from("financial_entries")
    .select("client_id")
    .eq("direction", "in")
    .is("cancelled_at", null)
    .not("recurring_rule_id", "is", null)
    .not("client_id", "is", null)
    .gte("competence", periodo)
    .lt("competence", proximoMes(periodo));
  if (error || !data) return 0;
  return new Set(
    (data as Array<{ client_id: unknown }>).map((linha) => String(linha.client_id)),
  ).size;
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
  /** Contagem já lida do Financeiro. Só a métrica de recorrentes usa. */
  clientesRecorrentes?: number;
}): number {
  const { metrica, leads, periodo, receitaFinanceiro } = input;
  if (metrica === "receita") return receitaFinanceiro;
  if (metrica === "clientes_recorrentes") return input.clientesRecorrentes ?? 0;
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
 * recusada — morre de lead esquecido. Os dois saem da AGENDA, não de um
 * campo de texto: compromisso com data é fato, anotação livre é intenção —
 * e a intenção nunca era atualizada quando o combinado mudava.
 */
export function resumoDoFunil(
  leads: Lead[],
  periodo: string,
  agoraIso: string,
  atividades: Atividade[] = [],
): ResumoDoFunil {
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
    semProximoPasso: abertos.filter(
      (lead) => agendaDoLead(atividades, lead.id, agoraIso).abertas === 0,
    ).length,
    atrasados: abertos.filter(
      (lead) => agendaDoLead(atividades, lead.id, agoraIso).atrasadas > 0,
    ).length,
  };
}

export const dinheiro = (valor: number) =>
  valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });

/* ────────────────────────────── Atividades ──────────────────────────────── */

/**
 * O que um comercial faz entre uma coluna e outra.
 *
 * O lead tinha um único `next_action` em texto livre, e um comercial não tem
 * "um próximo passo": tem a ligação de terça, a reunião de quinta e a
 * proposta para sexta. Com um campo só, marcar a ligação como feita apagava
 * a reunião.
 */
export const TIPOS_DE_ATIVIDADE = [
  { id: "ligacao", label: "Ligação" },
  { id: "reuniao", label: "Reunião" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "email", label: "E-mail" },
  { id: "proposta", label: "Proposta" },
  { id: "tarefa", label: "Tarefa" },
] as const;

export const rotuloDaAtividade = (id: string) =>
  TIPOS_DE_ATIVIDADE.find((t) => t.id === id)?.label || id;

export interface Atividade {
  id: string;
  /**
   * Nulo quando o compromisso e proprio: reuniao de planejamento, bloco
   * para escrever proposta, almoco com quem ainda nao virou lead. Sem isto
   * a agenda do painel seria metade da verdade, e nao daria para confiar
   * nela para saber se o dia esta cheio.
   */
  lead_id: string | null;
  kind: string;
  title: string;
  due_at: string;
  done_at: string | null;
  owner_id: string | null;
  notes: string | null;
}

/** Todas as atividades abertas, de todos os leads: a agenda do comercial. */
export async function listarAtividades(): Promise<Atividade[]> {
  const { data, error } = await supabase
    .from("commercial_activities")
    .select("id, lead_id, kind, title, due_at, done_at, owner_id, notes")
    .order("due_at", { ascending: true })
    .limit(500);
  if (error || !data) return [];
  return data as unknown as Atividade[];
}

export async function salvarAtividade(input: {
  id?: string;
  leadId?: string | null;
  kind: string;
  title: string;
  dueAt: string;
  ownerId?: string | null;
  notes?: string | null;
}): Promise<boolean> {
  const titulo = input.title.trim();
  if (titulo.length < 2 || !input.dueAt) return false;
  // Data invalida derruba a tela inteira: `new Date("2026-08-21T")` vira
  // Invalid Date, e toISOString() nele LANCA. Basta o campo de hora ficar
  // vazio para o formulario explodir em vez de recusar.
  const quando = new Date(input.dueAt);
  if (Number.isNaN(quando.getTime())) return false;
  const { data: sessao } = await supabase.auth.getUser();
  const corpo = {
    lead_id: input.leadId || null,
    kind: input.kind || "tarefa",
    title: titulo.slice(0, 200),
    due_at: quando.toISOString(),
    owner_id: input.ownerId || null,
    notes: input.notes?.trim() || null,
  };
  if (input.id) {
    const { error } = await supabase
      .from("commercial_activities")
      .update(corpo as never)
      .eq("id", input.id);
    return !error;
  }
  const { error } = await supabase
    .from("commercial_activities")
    .insert({ ...corpo, created_by: sessao?.user?.id || null } as never);
  return !error;
}

/**
 * Concluir e reabrir.
 *
 * Concluir também registra na história do lead: a atividade feita é o que
 * aconteceu de verdade, e é ela que responde "o que já foi tentado aqui"
 * quando alguém pega o lead na semana seguinte.
 */
export async function concluirAtividade(
  atividade: Atividade,
  concluir: boolean,
): Promise<boolean> {
  const { data: sessao } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("commercial_activities")
    .update({ done_at: concluir ? new Date().toISOString() : null } as never)
    .eq("id", atividade.id);
  if (error) return false;
  // So o compromisso ligado a um lead vira linha na historia dele; o
  // proprio nao tem onde ser registrado, nem precisa.
  if (concluir && atividade.lead_id) {
    await supabase.from("commercial_lead_events").insert({
      lead_id: atividade.lead_id,
      kind: "atividade",
      note: `${rotuloDaAtividade(atividade.kind)}: ${atividade.title}`,
      created_by: sessao?.user?.id || null,
    } as never);
  }
  return true;
}

export async function apagarAtividade(id: string): Promise<boolean> {
  const { error } = await supabase.from("commercial_activities").delete().eq("id", id);
  return !error;
}

export interface AgendaDoLead {
  proxima: Atividade | null;
  atrasadas: number;
  abertas: number;
}

/**
 * O estado da agenda de um lead, para o cartão do funil.
 *
 * Substitui o `next_action` de texto livre: a próxima atividade em aberto é
 * um fato com data, não uma anotação que ninguém atualiza.
 */
export function agendaDoLead(
  atividades: Atividade[],
  leadId: string,
  agoraIso: string,
): AgendaDoLead {
  const abertas = atividades
    .filter((a) => a.lead_id === leadId && !a.done_at)
    .sort((a, b) => a.due_at.localeCompare(b.due_at));
  return {
    proxima: abertas[0] || null,
    atrasadas: abertas.filter((a) => a.due_at < agoraIso).length,
    abertas: abertas.length,
  };
}

/* ─────────────────────────── Previsão de receita ────────────────────────── */

/**
 * A chance de fechar, por estágio.
 *
 * Números da casa, não de manual: servem para ordenar a previsão, e é por
 * isso que existem. Uma previsão que trata proposta enviada e primeiro
 * contato como a mesma coisa não é previsão — é soma.
 */
export const CHANCE_POR_ESTAGIO: Record<string, number> = {
  novo: 0.1,
  contato: 0.2,
  diagnostico: 0.4,
  proposta: 0.6,
  negociacao: 0.8,
  ganho: 1,
  perdido: 0,
};

/** O valor de um lead no primeiro ano: mensalidade × 12 + entrada. */
export const valorDoLead = (lead: Lead) => lead.monthly_value * 12 + lead.one_off_value;

export interface Previsao {
  /** Soma bruta do que tem data de fechamento no mês. */
  bruto: number;
  /** A mesma soma, cada lead pesado pela chance do estágio dele. */
  ponderado: number;
  /** Quantos leads entram na conta. */
  leads: number;
  /** Em aberto sem data prevista — o que a previsão NÃO consegue ver. */
  semData: number;
}

/**
 * Quanto deve entrar no mês, e o que a conta não enxerga.
 *
 * `semData` é tão importante quanto o número: previsão feita só sobre quem
 * tem data parece precisa e esconde metade do funil. Dizer quantos ficaram
 * de fora é o que impede a conta de virar promessa.
 */
export function previsaoDoMes(leads: Lead[], periodo: string): Previsao {
  const fim = proximoMes(periodo);
  const abertos = leads.filter((lead) =>
    ESTAGIOS_ABERTOS.includes(lead.stage as EstagioId),
  );
  const noMes = abertos.filter(
    (lead) =>
      lead.expected_close_date != null &&
      lead.expected_close_date >= periodo &&
      lead.expected_close_date < fim,
  );
  return {
    bruto: noMes.reduce((soma, lead) => soma + valorDoLead(lead), 0),
    ponderado: noMes.reduce(
      (soma, lead) => soma + valorDoLead(lead) * (CHANCE_POR_ESTAGIO[lead.stage] ?? 0),
      0,
    ),
    leads: noMes.length,
    semData: abertos.filter((lead) => !lead.expected_close_date).length,
  };
}

/* ─────────────────────── Empresas e contatos (o CRM) ────────────────────── */

/**
 * A ficha da empresa e a das pessoas dela.
 *
 * O negocio termina; a empresa e o contato ficam. E o que faz a segunda
 * conversa com a mesma empresa comecar de onde a primeira parou, em vez de
 * um cadastro novo do zero com o historico orfao no negocio antigo.
 */
export interface Empresa {
  id: string;
  name: string;
  segment: string | null;
  site: string | null;
  city: string | null;
  notes: string | null;
  client_id: string | null;
  owner_id: string | null;
}

export interface Contato {
  id: string;
  organization_id: string | null;
  name: string;
  role: string | null;
  email: string | null;
  whatsapp: string | null;
  is_primary: boolean;
  notes: string | null;
}

export async function listarEmpresas(): Promise<Empresa[]> {
  const { data, error } = await supabase
    .from("commercial_organizations")
    .select("id, name, segment, site, city, notes, client_id, owner_id")
    .is("archived_at", null)
    .order("name");
  if (error || !data) return [];
  return data as unknown as Empresa[];
}

export async function listarContatos(): Promise<Contato[]> {
  const { data, error } = await supabase
    .from("commercial_contacts")
    .select("id, organization_id, name, role, email, whatsapp, is_primary, notes")
    .is("archived_at", null)
    .order("name");
  if (error || !data) return [];
  return data as unknown as Contato[];
}

export async function salvarEmpresa(
  empresa: Partial<Empresa> & { name: string },
): Promise<string | null> {
  const nome = empresa.name.trim();
  if (nome.length < 2) return null;
  const { data: sessao } = await supabase.auth.getUser();
  const corpo = {
    name: nome.slice(0, 160),
    segment: empresa.segment?.trim() || null,
    site: empresa.site?.trim() || null,
    city: empresa.city?.trim() || null,
    notes: empresa.notes?.trim() || null,
    client_id: empresa.client_id || null,
    owner_id: empresa.owner_id || null,
  };
  if (empresa.id) {
    const { error } = await supabase
      .from("commercial_organizations")
      .update(corpo as never)
      .eq("id", empresa.id);
    return error ? null : empresa.id;
  }
  const { data, error } = await supabase
    .from("commercial_organizations")
    .insert({ ...corpo, created_by: sessao?.user?.id || null } as never)
    .select("id")
    .single();
  if (error || !data) return null;
  return String((data as Record<string, unknown>).id);
}

export async function salvarContato(
  contato: Partial<Contato> & { name: string },
): Promise<string | null> {
  const nome = contato.name.trim();
  if (nome.length < 2) return null;
  const { data: sessao } = await supabase.auth.getUser();
  const corpo = {
    organization_id: contato.organization_id || null,
    name: nome.slice(0, 160),
    role: contato.role?.trim() || null,
    email: contato.email?.trim() || null,
    whatsapp: contato.whatsapp?.trim() || null,
    is_primary: contato.is_primary === true,
    notes: contato.notes?.trim() || null,
  };
  if (contato.id) {
    const { error } = await supabase
      .from("commercial_contacts")
      .update(corpo as never)
      .eq("id", contato.id);
    return error ? null : contato.id;
  }
  const { data, error } = await supabase
    .from("commercial_contacts")
    .insert({ ...corpo, created_by: sessao?.user?.id || null } as never)
    .select("id")
    .single();
  if (error || !data) return null;
  return String((data as Record<string, unknown>).id);
}

export async function arquivarEmpresa(id: string): Promise<boolean> {
  const { error } = await supabase
    .from("commercial_organizations")
    .update({ archived_at: new Date().toISOString() } as never)
    .eq("id", id);
  return !error;
}

export interface FichaDaEmpresa {
  empresa: Empresa;
  contatos: Contato[];
  negocios: Lead[];
  /** Fechado alguma vez, some do funil mas continua na historia da empresa. */
  ganhos: number;
  perdidos: number;
  abertos: number;
  /** Quanto essa empresa ja rendeu em mensalidade nova, somando os ganhos. */
  mrrGanho: number;
}

/**
 * Tudo o que se sabe de uma empresa, junto.
 *
 * E a tela que a planilha nunca teve: quantas vezes a casa conversou com
 * aquela empresa, quem sao as pessoas, o que fechou e o que nao fechou.
 */
export function fichaDaEmpresa(
  empresa: Empresa,
  contatos: Contato[],
  leads: Lead[],
): FichaDaEmpresa {
  const negocios = leads.filter((lead) => lead.organization_id === empresa.id);
  const ganhos = negocios.filter((lead) => lead.stage === "ganho");
  return {
    empresa,
    contatos: contatos
      .filter((c) => c.organization_id === empresa.id)
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary)),
    negocios,
    ganhos: ganhos.length,
    perdidos: negocios.filter((lead) => lead.stage === "perdido").length,
    abertos: negocios.filter((lead) =>
      ESTAGIOS_ABERTOS.includes(lead.stage as EstagioId),
    ).length,
    mrrGanho: ganhos.reduce((soma, lead) => soma + lead.monthly_value, 0),
  };
}
