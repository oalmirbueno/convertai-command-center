/**
 * CRM da casa pelo MCP — leitura completa e escrita (v1.44.0).
 *
 * Ate aqui o agente so LIA a lista de oportunidades. O dono pediu acesso
 * completo: abrir a ficha, criar e editar o negocio, mover de etapa com o
 * mesmo rigor da tela (perdido exige motivo; ganho/perdido carimbam
 * closed_at; toda mudanca de etapa vira evento), anotar conversa, agendar e
 * concluir atividades, cadastrar empresa e contato.
 *
 * Duas regras herdadas do painel, que nao se negociam:
 *  1. Area da casa: chave restrita a cliente nao ve nem escreve nada aqui.
 *  2. Edicao grava SO o que foi mandado. Campo ausente nao vira null.
 */

import type { AuthContext } from './mcp-auth.ts';
import { db, isUuid, READ_LIMITS } from './aceleriq-read-services.ts';
import {
  avaliarEvidencias,
  CAMPOS_DO_FATO,
  ehTipoDeEvidencia,
  evidenciaPrincipal,
  normalizarCampoDoFato,
  pedeParaParar,
  type Evidencia,
} from './comercial-evidencia.ts';

export const ETAPAS_DO_FUNIL = ['novo', 'contato', 'diagnostico', 'proposta', 'negociacao', 'ganho', 'perdido'] as const;
export const CLASSES_DO_LEAD = ['cliente_atual', 'upsell', 'novo_prospect'] as const;
export const ORIGENS_DO_LEAD = ['indicacao', 'instagram', 'quiz', 'prospeccao', 'evento', 'site', 'manual', 'checkout', 'maquina_de_leads'] as const;
export const TIPOS_DE_ATIVIDADE = ['ligacao', 'reuniao', 'whatsapp', 'email', 'proposta', 'tarefa'] as const;

const texto = (v: unknown, max = 2000): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

const dinheiro = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
};

async function comPrazo<T>(p: PromiseLike<T>, ms = READ_LIMITS.queryTimeoutMs): Promise<T> {
  return await Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Query timeout after ${ms}ms`)), ms)),
  ]);
}

function soDaCasa(ctx: AuthContext) {
  if (!ctx.dataScope.unrestricted) {
    throw new Error('O comercial e area interna da casa: esta credencial e restrita a cliente e nao alcanca o CRM.');
  }
}

async function exigirLead(id: string) {
  if (!isUuid(id)) throw new Error('opportunity_id must be a UUID');
  const { data, error } = await comPrazo(db().from('commercial_leads').select('*').eq('id', id).maybeSingle());
  if (error) throw new Error(`commercial_leads: ${error.message}`);
  if (!data) throw new Error('Oportunidade nao encontrada. Confira o id com aceleriq_list_opportunities.');
  return data as Record<string, unknown>;
}

async function exigirPerfil(id: string | null | undefined, campo: string) {
  if (!id) return;
  if (!isUuid(id)) throw new Error(`${campo} must be a UUID`);
  const { data } = await comPrazo(db().from('profiles').select('id').eq('id', id).maybeSingle());
  if (!data) throw new Error(`${campo}: perfil nao encontrado.`);
}

/** A ficha inteira de um negocio: dados, empresa, contato, atividades e historia. */
export async function getOpportunity(input: { opportunity_id: string }, ctx: AuthContext) {
  soDaCasa(ctx);
  const lead = await exigirLead(input.opportunity_id);
  const [atividades, eventos, empresa, contato, dono] = await Promise.all([
    comPrazo(db().from('commercial_activities').select('id, kind, title, due_at, done_at, owner_id, notes, created_at').eq('lead_id', lead.id).order('due_at', { ascending: true }).limit(100)),
    comPrazo(db().from('commercial_lead_events').select('id, kind, from_stage, to_stage, note, created_at').eq('lead_id', lead.id).order('created_at', { ascending: false }).limit(100)),
    lead.organization_id ? comPrazo(db().from('commercial_organizations').select('id, name, segment, site, city, instagram, phone, address, cnpj, size, notes, client_id').eq('id', lead.organization_id).maybeSingle()) : Promise.resolve({ data: null }),
    lead.contact_id ? comPrazo(db().from('commercial_contacts').select('id, name, role, email, whatsapp, is_primary').eq('id', lead.contact_id).maybeSingle()) : Promise.resolve({ data: null }),
    lead.owner_id ? comPrazo(db().from('profiles').select('id, full_name').eq('id', lead.owner_id).maybeSingle()) : Promise.resolve({ data: null }),
  ]);
  const abertas = ((atividades as { data: Array<Record<string, unknown>> | null }).data ?? []).filter((a) => !a.done_at);
  return {
    oportunidade: {
      ...lead,
      valor_em_jogo_12m: dinheiro(lead.monthly_value) * 12 + dinheiro(lead.one_off_value),
      responsavel: (dono as { data: Record<string, unknown> | null }).data ?? null,
    },
    empresa: (empresa as { data: unknown }).data ?? null,
    contato: (contato as { data: unknown }).data ?? null,
    atividades: (atividades as { data: unknown[] | null }).data ?? [],
    proxima_atividade: abertas[0] ?? null,
    historia: (eventos as { data: unknown[] | null }).data ?? [],
    link: `/comercial/crm`,
  };
}

export interface OpportunityInput {
  name?: string; company?: string; email?: string; whatsapp?: string; origin?: string;
  campaign_id?: string | null; monthly_value?: number; one_off_value?: number;
  next_action?: string | null; next_action_at?: string | null; expected_close_date?: string | null;
  owner_id?: string | null; organization_id?: string | null; contact_id?: string | null;
  notes?: string | null; classe?: string | null; qualificacao?: Record<string, unknown>;
  /** 25/10: a campanha da Meta (id da Meta) e o agente que atende ('mercurio' ou null). */
  ads_campaign_id?: string | null; agente_slug?: string | null;
}

function corpoDoLead(input: OpportunityInput): Record<string, unknown> {
  const corpo: Record<string, unknown> = {};
  const tem = (k: keyof OpportunityInput) => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;
  if (tem('name')) corpo.name = String(input.name ?? '').trim().slice(0, 160);
  if (tem('company')) corpo.company = texto(input.company, 200);
  if (tem('email')) corpo.email = texto(input.email, 200);
  if (tem('whatsapp')) corpo.whatsapp = texto(input.whatsapp, 40);
  if (tem('origin')) corpo.origin = input.origin || 'manual';
  if (tem('campaign_id')) corpo.campaign_id = input.campaign_id || null;
  if (tem('monthly_value')) corpo.monthly_value = dinheiro(input.monthly_value);
  if (tem('one_off_value')) corpo.one_off_value = dinheiro(input.one_off_value);
  if (tem('next_action')) corpo.next_action = texto(input.next_action, 300);
  if (tem('next_action_at')) corpo.next_action_at = input.next_action_at || null;
  if (tem('expected_close_date')) corpo.expected_close_date = input.expected_close_date || null;
  if (tem('owner_id')) corpo.owner_id = input.owner_id || null;
  if (tem('organization_id')) corpo.organization_id = input.organization_id || null;
  if (tem('contact_id')) corpo.contact_id = input.contact_id || null;
  if (tem('notes')) corpo.notes = texto(input.notes, 4000);
  if (tem('classe')) corpo.classe = input.classe || null;
  if (tem('ads_campaign_id')) corpo.ads_campaign_id = texto(input.ads_campaign_id, 64);
  if (tem('agente_slug')) corpo.agente_slug = texto(input.agente_slug, 40);
  if (tem('qualificacao')) {
    const limpo: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.qualificacao ?? {})) {
      const valor = texto(v, 600);
      if (valor) limpo[k.slice(0, 60)] = valor;
    }
    corpo.qualificacao = limpo;
  }
  return corpo;
}

export async function createOpportunity(input: OpportunityInput & { name: string; stage?: string }, ctx: AuthContext) {
  soDaCasa(ctx);
  if (String(input.name ?? '').trim().length < 2) throw new Error('name: o negocio precisa de um nome.');
  await exigirPerfil(input.owner_id, 'owner_id');
  const corpo = corpoDoLead(input);
  const etapa = input.stage && input.stage !== 'ganho' && input.stage !== 'perdido' ? input.stage : 'novo';
  const { data, error } = await comPrazo(db().from('commercial_leads')
    .insert({ origin: 'manual', monthly_value: 0, one_off_value: 0, qualificacao: {}, ...corpo, stage: etapa })
    .select('id, name, company, stage, classe, origin, monthly_value, one_off_value, owner_id, created_at').single());
  if (error) throw new Error(`commercial_leads: ${error.message}`);
  // O lead ja existe; falha no evento nao desfaz a criacao, mas fica dita na resposta.
  const avisos: string[] = [];
  const { error: eventoErro } = await db().from('commercial_lead_events').insert({ lead_id: data.id, kind: 'nota', note: `Criado pelo MCP (${ctx.keyName}).` });
  if (eventoErro) avisos.push(`commercial_lead_events: ${eventoErro.message}`);
  return { oportunidade: data, criado: true, ...(avisos.length > 0 ? { warnings: avisos } : {}) };
}

export async function updateOpportunity(input: OpportunityInput & { opportunity_id: string }, ctx: AuthContext) {
  soDaCasa(ctx);
  const antes = await exigirLead(input.opportunity_id);
  await exigirPerfil(input.owner_id, 'owner_id');
  const { opportunity_id: _id, ...campos } = input;
  const corpo = corpoDoLead(campos);
  if (Object.keys(corpo).length === 0) throw new Error('Nada para atualizar: mande ao menos um campo alem do id.');
  if ('name' in corpo && String(corpo.name).length < 2) throw new Error('name: o negocio precisa de um nome.');
  // Qualificacao soma: mandar uma resposta nova nao apaga as que ja estavam.
  if (corpo.qualificacao && antes.qualificacao && typeof antes.qualificacao === 'object') {
    corpo.qualificacao = { ...(antes.qualificacao as Record<string, unknown>), ...(corpo.qualificacao as Record<string, unknown>) };
  }
  const { data, error } = await comPrazo(db().from('commercial_leads').update(corpo).eq('id', antes.id).select('*').single());
  if (error) throw new Error(`commercial_leads: ${error.message}`);
  return { oportunidade: data, campos_alterados: Object.keys(corpo) };
}

/** Mover de etapa com as mesmas regras da tela. */
export async function moveOpportunity(input: { opportunity_id: string; stage: string; reason?: string; won_client_id?: string | null }, ctx: AuthContext) {
  soDaCasa(ctx);
  const lead = await exigirLead(input.opportunity_id);
  const para = input.stage;
  if (lead.stage === para) return { oportunidade: lead, movido: false, motivo: 'Ja estava nesta etapa.' };
  const motivo = texto(input.reason, 1000);
  if (para === 'perdido' && (!motivo || motivo.length < 3)) {
    throw new Error('reason: diga em uma linha por que foi perdido. E o que ensina o proximo.');
  }
  if (para === 'ganho' && input.won_client_id) await exigirPerfil(input.won_client_id, 'won_client_id');
  const fechou = para === 'ganho' || para === 'perdido';
  const { data, error } = await comPrazo(db().from('commercial_leads').update({
    stage: para,
    closed_at: fechou ? new Date().toISOString() : null,
    lost_reason: para === 'perdido' ? motivo : null,
    won_client_id: para === 'ganho' ? input.won_client_id || null : null,
  }).eq('id', lead.id).select('*').single());
  if (error) throw new Error(`commercial_leads: ${error.message}`);
  // A etapa ja mudou; se o evento da historia falhar, a resposta avisa.
  const avisos: string[] = [];
  const { error: eventoErro } = await db().from('commercial_lead_events').insert({
    lead_id: lead.id, kind: 'stage', from_stage: lead.stage, to_stage: para, note: motivo,
  });
  if (eventoErro) avisos.push(`commercial_lead_events: ${eventoErro.message}`);
  return { oportunidade: data, movido: true, de: lead.stage, para, ...(avisos.length > 0 ? { warnings: avisos } : {}) };
}

export async function addOpportunityNote(input: { opportunity_id: string; note: string; operador?: string }, ctx: AuthContext) {
  soDaCasa(ctx);
  const lead = await exigirLead(input.opportunity_id);
  const nota = texto(input.note, 2000);
  if (!nota || nota.length < 2) throw new Error('note: escreva um pouco mais.');
  // 25/10: nota de agente (Mercurio e outros) fica marcada com o operador; o MCP nao tem created_by.
  const operador = texto(input.operador, 40);
  const { data, error } = await comPrazo(db().from('commercial_lead_events')
    .insert(operador ? { lead_id: lead.id, kind: 'agente', note: `[${operador}] ${nota}`.slice(0, 2000) } : { lead_id: lead.id, kind: 'nota', note: nota })
    .select('id, created_at').single());
  if (error) throw new Error(`commercial_lead_events: ${error.message}`);
  return { anotado: true, evento: data };
}

export async function archiveOpportunity(input: { opportunity_id: string }, ctx: AuthContext) {
  soDaCasa(ctx);
  const lead = await exigirLead(input.opportunity_id);
  const { error } = await comPrazo(db().from('commercial_leads').update({ archived_at: new Date().toISOString() }).eq('id', lead.id));
  if (error) throw new Error(`commercial_leads: ${error.message}`);
  return { arquivado: true, opportunity_id: lead.id, observacao: 'Arquivar nao apaga: o negocio sai do quadro e o historico fica.' };
}

/**
 * Apagar de verdade: some o negocio, a agenda e a historia dele (cascata do
 * banco). A ficha da empresa fica. Exige confirmacao explicita e motivo,
 * porque nao tem volta; para tirar do quadro guardando a historia, arquive.
 */
export async function deleteOpportunity(input: { opportunity_id: string; confirm: boolean; reason: string }, ctx: AuthContext) {
  soDaCasa(ctx);
  if (input.confirm !== true) throw new Error('confirm: mande true para apagar. Apagar nao tem volta; arquivar guarda a historia.');
  const motivo = texto(input.reason, 500);
  if (!motivo || motivo.length < 5) throw new Error('reason: diga por que esta apagando (duplicado, teste, cadastro errado).');
  const lead = await exigirLead(input.opportunity_id);
  const { data, error } = await comPrazo(db().from('commercial_leads').delete().eq('id', lead.id).select('id'));
  if (error) throw new Error(`commercial_leads: ${error.message}`);
  if (!data || data.length === 0) throw new Error('Nada foi apagado.');
  return { apagado: true, opportunity_id: lead.id, nome: lead.name, empresa: lead.company ?? null, motivo, observacao: 'A ficha da empresa continua no CRM.' };
}

export async function listCommercialActivities(opts: { opportunity_id?: string; status?: 'abertas' | 'concluidas' | 'todas'; limit?: number }, ctx: AuthContext) {
  soDaCasa(ctx);
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  let qb = db().from('commercial_activities')
    .select('id, lead_id, kind, title, due_at, done_at, owner_id, notes, created_at, lead:commercial_leads(name, company, stage)')
    .order('due_at', { ascending: true }).limit(limit);
  if (opts.opportunity_id) {
    if (!isUuid(opts.opportunity_id)) throw new Error('opportunity_id must be a UUID');
    qb = qb.eq('lead_id', opts.opportunity_id);
  }
  if (!opts.status || opts.status === 'abertas') qb = qb.is('done_at', null);
  else if (opts.status === 'concluidas') qb = qb.not('done_at', 'is', null);
  const { data, error } = await comPrazo(qb);
  if (error) throw new Error(`commercial_activities: ${error.message}`);
  const agora = Date.now();
  return {
    items: (data ?? []).map((a: Record<string, unknown>) => ({ ...a, atrasada: !a.done_at && Date.parse(String(a.due_at)) < agora })),
    total: (data ?? []).length,
  };
}

export async function createCommercialActivity(input: { opportunity_id: string; kind?: string; title: string; due_at: string; owner_id?: string | null; notes?: string }, ctx: AuthContext) {
  soDaCasa(ctx);
  const lead = await exigirLead(input.opportunity_id);
  const titulo = texto(input.title, 200);
  if (!titulo || titulo.length < 2) throw new Error('title: diga o que sera feito.');
  const quando = new Date(input.due_at);
  if (!Number.isFinite(quando.getTime())) throw new Error('due_at: data invalida (use ISO, ex.: 2026-09-18T14:00:00-03:00).');
  await exigirPerfil(input.owner_id, 'owner_id');
  const { data, error } = await comPrazo(db().from('commercial_activities').insert({
    lead_id: lead.id, kind: input.kind || 'tarefa', title: titulo, due_at: quando.toISOString(),
    owner_id: input.owner_id || (lead.owner_id as string | null) || null, notes: texto(input.notes, 2000),
  }).select('id, lead_id, kind, title, due_at, owner_id').single());
  if (error) throw new Error(`commercial_activities: ${error.message}`);
  // O cartao do quadro le a proxima acao do proprio lead: manter em dia.
  // A atividade ja existe; se o cartao nao atualizar, a resposta avisa.
  const avisos: string[] = [];
  const { error: cartaoErro } = await db().from('commercial_leads').update({ next_action: titulo, next_action_at: quando.toISOString().slice(0, 10) }).eq('id', lead.id);
  if (cartaoErro) avisos.push(`commercial_leads.next_action: ${cartaoErro.message}`);
  return { atividade: data, criada: true, ...(avisos.length > 0 ? { warnings: avisos } : {}) };
}

export async function completeCommercialActivity(input: { activity_id: string; done?: boolean; outcome?: string }, ctx: AuthContext) {
  soDaCasa(ctx);
  if (!isUuid(input.activity_id)) throw new Error('activity_id must be a UUID');
  const { data: atividade, error: lerErro } = await comPrazo(db().from('commercial_activities').select('id, lead_id, title, kind').eq('id', input.activity_id).maybeSingle());
  if (lerErro) throw new Error(`commercial_activities: ${lerErro.message}`);
  if (!atividade) throw new Error('Atividade nao encontrada.');
  const concluir = input.done !== false;
  const { error } = await comPrazo(db().from('commercial_activities').update({ done_at: concluir ? new Date().toISOString() : null }).eq('id', atividade.id));
  if (error) throw new Error(`commercial_activities: ${error.message}`);
  const avisos: string[] = [];
  if (concluir) {
    const resultado = texto(input.outcome, 1000);
    const { error: eventoErro } = await db().from('commercial_lead_events').insert({
      lead_id: atividade.lead_id, kind: 'atividade', note: `Feito: ${atividade.title}${resultado ? ` · ${resultado}` : ''}`,
    });
    if (eventoErro) avisos.push(`commercial_lead_events: ${eventoErro.message}`);
  }
  return { activity_id: atividade.id, concluida: concluir, ...(avisos.length > 0 ? { warnings: avisos } : {}) };
}

export async function listCommercialOrganizations(opts: { search?: string; limit?: number }, ctx: AuthContext) {
  soDaCasa(ctx);
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  let qb = db().from('commercial_organizations')
    .select('id, name, segment, site, city, instagram, phone, address, cnpj, size, notes, client_id, owner_id, created_at, contatos:commercial_contacts(id, name, role, email, whatsapp, is_primary, archived_at)')
    .is('archived_at', null).order('name', { ascending: true }).limit(limit);
  const busca = texto(opts.search, 80);
  if (busca) qb = qb.ilike('name', `%${busca.replace(/[%_]/g, '')}%`);
  const { data, error } = await comPrazo(qb);
  if (error) throw new Error(`commercial_organizations: ${error.message}`);
  return {
    items: (data ?? []).map((o: Record<string, unknown>) => ({
      ...o, contatos: ((o.contatos as Array<Record<string, unknown>>) ?? []).filter((c) => !c.archived_at),
    })),
    total: (data ?? []).length,
  };
}

export async function upsertCommercialOrganization(input: { organization_id?: string; name?: string; segment?: string; site?: string; city?: string; instagram?: string; phone?: string; address?: string; cnpj?: string; size?: string; notes?: string; client_id?: string | null; owner_id?: string | null }, ctx: AuthContext) {
  soDaCasa(ctx);
  await exigirPerfil(input.owner_id, 'owner_id');
  await exigirPerfil(input.client_id, 'client_id');
  const corpo: Record<string, unknown> = {};
  for (const k of ['segment', 'site', 'city', 'instagram', 'phone', 'address', 'cnpj', 'size'] as const) if (input[k] !== undefined) corpo[k] = texto(input[k], 300);
  if (input.notes !== undefined) corpo.notes = texto(input.notes, 4000);
  if (input.client_id !== undefined) corpo.client_id = input.client_id || null;
  if (input.owner_id !== undefined) corpo.owner_id = input.owner_id || null;
  if (input.name !== undefined) {
    const nome = texto(input.name, 200);
    if (!nome || nome.length < 2) throw new Error('name: a empresa precisa de um nome.');
    corpo.name = nome;
  }
  if (input.organization_id) {
    if (!isUuid(input.organization_id)) throw new Error('organization_id must be a UUID');
    if (Object.keys(corpo).length === 0) throw new Error('Nada para atualizar.');
    const { data, error } = await comPrazo(db().from('commercial_organizations').update(corpo).eq('id', input.organization_id).select('*').maybeSingle());
    if (error) throw new Error(`commercial_organizations: ${error.message}`);
    if (!data) throw new Error('Empresa nao encontrada.');
    return { empresa: data, criada: false };
  }
  if (!corpo.name) throw new Error('name: obrigatorio para criar a empresa.');
  const { data, error } = await comPrazo(db().from('commercial_organizations').insert(corpo).select('*').single());
  if (error) throw new Error(`commercial_organizations: ${error.message}`);
  return { empresa: data, criada: true };
}

export async function upsertCommercialContact(input: { contact_id?: string; organization_id?: string | null; name?: string; role?: string; email?: string; whatsapp?: string; is_primary?: boolean; notes?: string }, ctx: AuthContext) {
  soDaCasa(ctx);
  const corpo: Record<string, unknown> = {};
  if (input.organization_id !== undefined) {
    if (input.organization_id && !isUuid(input.organization_id)) throw new Error('organization_id must be a UUID');
    corpo.organization_id = input.organization_id || null;
  }
  for (const k of ['role', 'email'] as const) if (input[k] !== undefined) corpo[k] = texto(input[k], 200);
  if (input.whatsapp !== undefined) corpo.whatsapp = texto(input.whatsapp, 40);
  if (input.notes !== undefined) corpo.notes = texto(input.notes, 2000);
  if (input.is_primary !== undefined) corpo.is_primary = input.is_primary === true;
  if (input.name !== undefined) {
    const nome = texto(input.name, 200);
    if (!nome || nome.length < 2) throw new Error('name: o contato precisa de um nome.');
    corpo.name = nome;
  }
  if (input.contact_id) {
    if (!isUuid(input.contact_id)) throw new Error('contact_id must be a UUID');
    if (Object.keys(corpo).length === 0) throw new Error('Nada para atualizar.');
    const { data, error } = await comPrazo(db().from('commercial_contacts').update(corpo).eq('id', input.contact_id).select('*').maybeSingle());
    if (error) throw new Error(`commercial_contacts: ${error.message}`);
    if (!data) throw new Error('Contato nao encontrado.');
    return { contato: data, criado: false };
  }
  if (!corpo.name) throw new Error('name: obrigatorio para criar o contato.');
  const { data, error } = await comPrazo(db().from('commercial_contacts').insert({ is_primary: false, ...corpo }).select('*').single());
  if (error) throw new Error(`commercial_contacts: ${error.message}`);
  return { contato: data, criado: true };
}

// ===================================================================
// 25/10/2026: o Mercurio (agente comercial do Hermes), a Caixa do comercial, os fatos com prova e a Maquina de
// leads. Contrato do banco: migration 20261025130000_comercial_mercurio_e_maquina_de_leads.sql. Roteiro do
// agente: docs/comercial/MERCURIO.md. O WhatsApp e do Hermes: o painel guarda a conversa, a fila e os avisos.
// ===================================================================

export const CANAIS_DA_MENSAGEM = ['whatsapp', 'instagram', 'email', 'telefone', 'site', 'outro'] as const;
/** Lead frio: o primeiro contato conta no teto do dia e respeita o horario. */
const ORIGENS_FRIAS = ['prospeccao', 'maquina_de_leads'];
const SLUG = /^[a-z0-9_-]{2,40}$/;

const slugDoOperador = (v: unknown, padrao = 'mercurio') => {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!s) return padrao;
  if (!SLUG.test(s)) throw new Error('operador: use o slug do agente (ex.: mercurio).');
  return s;
};

/** Data (YYYY-MM-DD) e hora (HH:MM) agora em Sao Paulo, e o inicio do dia em ISO. */
export function agoraEmSaoPaulo(agora = new Date()): { data: string; hora: string; inicioDoDiaIso: string } {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(agora);
  const p = (t: string) => (partes.find((x) => x.type === t) || { value: '00' }).value;
  const hora = `${p('hour') === '24' ? '00' : p('hour')}:${p('minute')}`;
  const data = `${p('year')}-${p('month')}-${p('day')}`;
  // Sao Paulo sem horario de verao: UTC-3.
  return { data, hora, inicioDoDiaIso: new Date(`${data}T00:00:00-03:00`).toISOString() };
}

export const dentroDoHorario = (hora: string, inicio: string, fim: string) => hora >= String(inicio).slice(0, 5) && hora < String(fim).slice(0, 5);

const naoContatar = (lead: Record<string, unknown>) => {
  const q = (lead.qualificacao && typeof lead.qualificacao === 'object' ? lead.qualificacao : {}) as Record<string, unknown>;
  const v = q.nao_contatar;
  return v === true || v === 'sim' || v === 'true';
};

async function configDoAgente(slug: string) {
  const { data, error } = await comPrazo(db().from('commercial_agente_config').select('*').eq('slug', slug).maybeSingle());
  if (error) throw new Error(`commercial_agente_config: ${error.message}`);
  return (data as Record<string, unknown> | null) ?? null;
}

async function primeirosContatosHoje(slug: string, inicioDoDiaIso: string): Promise<number> {
  const { count, error } = await comPrazo(db().from('commercial_lead_events').select('id', { count: 'exact', head: true })
    .eq('kind', 'primeiro_contato').eq('note', slug).gte('created_at', inicioDoDiaIso));
  if (error) throw new Error(`commercial_lead_events: ${error.message}`);
  return count ?? 0;
}

export function resumoDaConfig(cfg: Record<string, unknown> | null, feitosHoje: number, agora = agoraEmSaoPaulo()) {
  const inicio = String((cfg && cfg.horario_inicio) || '09:00').slice(0, 5);
  const fim = String((cfg && cfg.horario_fim) || '18:00').slice(0, 5);
  const limite = Number(cfg && cfg.limite_primeiros_contatos_dia) || 0;
  return {
    ativo: !!(cfg && cfg.ativo),
    horario: `${inicio} a ${fim} (Sao Paulo)`,
    agora: agora.hora,
    dentro_do_horario: dentroDoHorario(agora.hora, inicio, fim),
    limite_primeiros_contatos_dia: limite,
    primeiros_contatos_hoje: feitosHoje,
    restam_hoje: Math.max(0, limite - feitosHoje),
    orientacoes: (cfg && cfg.orientacoes) || null,
  };
}

/** A fila do agente comercial: os leads que ele atende, com conversa, fatos e a regra do dia. */
export async function comercialFila(input: { operador?: string; limit?: number }, ctx: AuthContext) {
  soDaCasa(ctx);
  const slug = slugDoOperador(input.operador);
  const agora = agoraEmSaoPaulo();
  const [cfg, feitos] = await Promise.all([configDoAgente(slug), primeirosContatosHoje(slug, agora.inicioDoDiaIso)]);
  const regra = resumoDaConfig(cfg, feitos, agora);
  if (!regra.ativo) {
    return { operador: slug, config: regra, itens: [], total: 0, aviso: `O ${slug} esta desligado no painel (Comercial). Nao envie mensagem; so registre o que chegar.` };
  }
  const limit = Math.min(Math.max(Number(input.limit) || 30, 1), 100);
  const { data: leads, error } = await comPrazo(db().from('commercial_leads')
    .select('id, name, company, email, whatsapp, stage, origin, classe, qualificacao, next_action, next_action_at, notes, campaign_id, ads_campaign_id, organization_id, monthly_value, one_off_value, agente_desde, updated_at, created_at')
    .eq('agente_slug', slug).is('archived_at', null).not('stage', 'in', '(ganho,perdido)')
    .order('updated_at', { ascending: false }).limit(limit));
  if (error) throw new Error(`commercial_leads: ${error.message}`);
  const lista = (leads ?? []) as Array<Record<string, unknown>>;
  const ids = lista.map((l) => String(l.id));
  if (!ids.length) return { operador: slug, config: regra, itens: [], total: 0 };
  const campanhasInternas = Array.from(new Set(lista.map((l) => l.campaign_id).filter(Boolean))) as string[];
  const campanhasMeta = Array.from(new Set(lista.map((l) => l.ads_campaign_id).filter(Boolean))) as string[];
  const [msgs, fatos, internas, meta] = await Promise.all([
    comPrazo(db().from('commercial_lead_messages').select('lead_id, direcao, canal, texto, enviada_em, operador_slug').in('lead_id', ids).order('enviada_em', { ascending: false }).limit(Math.min(2000, ids.length * 20))),
    comPrazo(db().from('commercial_facts').select('lead_id, campo, valor, evidencia, situacao, created_at').in('lead_id', ids).neq('situacao', 'descartado').order('created_at', { ascending: false }).limit(500)),
    campanhasInternas.length ? comPrazo(db().from('commercial_campaigns').select('id, name, channel').in('id', campanhasInternas)) : Promise.resolve({ data: [] }),
    campanhasMeta.length ? comPrazo(db().from('ads_campaigns').select('campaign_id, name, status').in('campaign_id', campanhasMeta)) : Promise.resolve({ data: [] }),
  ]);
  const porLead = new Map<string, Array<Record<string, unknown>>>();
  for (const m of ((msgs as { data: Array<Record<string, unknown>> | null }).data ?? [])) {
    const k = String(m.lead_id);
    const l = porLead.get(k) || [];
    if (l.length < 20) l.push(m);
    porLead.set(k, l);
  }
  const fatosPorLead = new Map<string, Array<Record<string, unknown>>>();
  for (const f of ((fatos as { data: Array<Record<string, unknown>> | null }).data ?? [])) {
    const k = String(f.lead_id);
    fatosPorLead.set(k, (fatosPorLead.get(k) || []).concat([f]));
  }
  const nomeInterna = new Map(((internas as { data: Array<Record<string, unknown>> | null }).data ?? []).map((c) => [String(c.id), c]));
  const nomeMeta = new Map(((meta as { data: Array<Record<string, unknown>> | null }).data ?? []).map((c) => [String(c.campaign_id), c]));
  const itens = lista.map((l) => {
    const conversa = (porLead.get(String(l.id)) || []).slice().reverse();
    return {
      lead_id: l.id,
      nome: l.name,
      empresa: l.company ?? null,
      whatsapp: l.whatsapp ?? null,
      email: l.email ?? null,
      etapa: l.stage,
      origem: l.origin,
      lead_frio: ORIGENS_FRIAS.indexOf(String(l.origin)) >= 0,
      primeiro_contato_feito: conversa.some((m) => m.direcao === 'saida'),
      nao_contatar: naoContatar(l),
      classe: l.classe ?? null,
      qualificacao: l.qualificacao ?? {},
      proxima_acao: l.next_action ?? null,
      proxima_acao_em: l.next_action_at ?? null,
      valores: { mensal: l.monthly_value, avulso: l.one_off_value },
      notas: l.notes ?? null,
      campanha: l.campaign_id ? (nomeInterna.get(String(l.campaign_id)) ?? { id: l.campaign_id }) : null,
      campanha_meta: l.ads_campaign_id ? (nomeMeta.get(String(l.ads_campaign_id)) ?? { campaign_id: l.ads_campaign_id }) : null,
      mensagens: conversa,
      fatos: fatosPorLead.get(String(l.id)) || [],
      atende_desde: l.agente_desde ?? null,
    };
  });
  return { operador: slug, config: regra, itens, total: itens.length };
}

/** Registra uma mensagem da conversa do lead (entrada ou saida). Idempotente por id_externo. */
export async function comercialRegistrarMensagem(input: { lead_id: string; direcao: 'entrada' | 'saida'; texto: string; canal?: string; enviada_em?: string; id_externo?: string; operador?: string }, ctx: AuthContext) {
  soDaCasa(ctx);
  const lead = await exigirLead(input.lead_id);
  if (input.direcao !== 'entrada' && input.direcao !== 'saida') throw new Error('direcao: entrada ou saida.');
  const corpo = typeof input.texto === 'string' ? input.texto.trim().slice(0, 8000) : '';
  if (!corpo) throw new Error('texto: a mensagem esta vazia.');
  const canal = input.canal && (CANAIS_DA_MENSAGEM as readonly string[]).indexOf(input.canal) >= 0 ? input.canal : 'whatsapp';
  const quando = input.enviada_em ? new Date(input.enviada_em) : new Date();
  if (!Number.isFinite(quando.getTime())) throw new Error('enviada_em: data invalida (ISO 8601).');
  const idExterno = texto(input.id_externo, 200);
  if (idExterno) {
    const { data: ja } = await comPrazo(db().from('commercial_lead_messages').select('*').eq('lead_id', lead.id).eq('id_externo', idExterno).maybeSingle());
    if (ja) return { mensagem: ja, registrada: false, duplicada: true };
  }
  const slug = input.direcao === 'saida' ? slugDoOperador(input.operador) : null;
  const avisos: string[] = [];
  let primeiroContato = false;
  if (input.direcao === 'saida') {
    if (naoContatar(lead)) throw new Error('Este lead pediu para nao ser mais contatado (LGPD). Nao envie mensagem; se ele voltar a falar, registre a entrada.');
    const { count: saidas } = await comPrazo(db().from('commercial_lead_messages').select('id', { count: 'exact', head: true }).eq('lead_id', lead.id).eq('direcao', 'saida'));
    primeiroContato = (saidas ?? 0) === 0 && ORIGENS_FRIAS.indexOf(String(lead.origin)) >= 0;
    if (primeiroContato && slug) {
      const cfg = await configDoAgente(slug);
      const agora = agoraEmSaoPaulo();
      const regra = resumoDaConfig(cfg, await primeirosContatosHoje(slug, agora.inicioDoDiaIso), agora);
      if (!regra.ativo) throw new Error(`O ${slug} esta desligado no painel: primeiro contato com lead frio nao deve sair.`);
      if (!regra.dentro_do_horario) throw new Error(`Fora do horario do comercial (${regra.horario}; agora ${regra.agora}). Primeiro contato com lead frio so dentro do horario.`);
      if (regra.restam_hoje <= 0) throw new Error(`Teto do dia atingido: ${regra.primeiros_contatos_hoje} de ${regra.limite_primeiros_contatos_dia} primeiros contatos. Deixe para amanha.`);
    }
  }
  const { data, error } = await comPrazo(db().from('commercial_lead_messages').insert({
    lead_id: lead.id, direcao: input.direcao, canal, texto: corpo, enviada_em: quando.toISOString(),
    operador_slug: slug, id_externo: idExterno,
  }).select('*').single());
  if (error) {
    // Corrida no id_externo: devolve a que ja estava.
    if (idExterno && /duplicate|unique/i.test(error.message)) {
      const { data: ja } = await comPrazo(db().from('commercial_lead_messages').select('*').eq('lead_id', lead.id).eq('id_externo', idExterno).maybeSingle());
      if (ja) return { mensagem: ja, registrada: false, duplicada: true };
    }
    throw new Error(`commercial_lead_messages: ${error.message}`);
  }
  if (primeiroContato && slug) {
    const { error: e } = await db().from('commercial_lead_events').insert({ lead_id: lead.id, kind: 'primeiro_contato', note: slug });
    if (e) avisos.push(`commercial_lead_events: ${e.message}`);
  }
  // Primeira mensagem enviada tira o lead de "novo".
  if (input.direcao === 'saida' && lead.stage === 'novo') {
    const { error: e1 } = await db().from('commercial_leads').update({ stage: 'contato' }).eq('id', lead.id);
    if (!e1) await db().from('commercial_lead_events').insert({ lead_id: lead.id, kind: 'stage', from_stage: 'novo', to_stage: 'contato', note: `Primeira mensagem enviada (${slug}).` });
    else avisos.push(`commercial_leads.stage: ${e1.message}`);
  }
  let pediuParaParar = false;
  if (input.direcao === 'entrada' && !naoContatar(lead) && pedeParaParar(corpo)) {
    pediuParaParar = true;
    const qual = { ...((lead.qualificacao as Record<string, unknown>) || {}), nao_contatar: 'sim' };
    const { error: e2 } = await db().from('commercial_leads').update({ qualificacao: qual }).eq('id', lead.id);
    if (e2) avisos.push(`commercial_leads.qualificacao: ${e2.message}`);
    await db().from('commercial_lead_events').insert({ lead_id: lead.id, kind: 'agente', note: 'Pediu para nao ser mais contatado: o agente nao envia mais mensagens (LGPD).' });
  }
  return {
    mensagem: data, registrada: true, primeiro_contato: primeiroContato,
    ...(pediuParaParar ? { pediu_para_parar: true, aviso: 'O lead pediu para parar: nao responda vendendo. No maximo confirme com educacao que nao vai mais mandar mensagem.' } : {}),
    ...(avisos.length ? { warnings: avisos } : {}),
  };
}

/** A Caixa do comercial: o agente avisa so quem avancou ou fechou (o banco avisa no sino). */
export async function comercialAvisarCaixa(input: { lead_id: string; tipo: 'avancou' | 'fechou'; resumo: string; proximo_passo?: string; telefone?: string; dados?: Record<string, unknown>; operador?: string }, ctx: AuthContext) {
  soDaCasa(ctx);
  const lead = await exigirLead(input.lead_id);
  if (input.tipo !== 'avancou' && input.tipo !== 'fechou') throw new Error('tipo: avancou ou fechou. A Caixa e so para quem avancou ou fechou.');
  const resumo = texto(input.resumo, 2000);
  if (!resumo || resumo.length < 5) throw new Error('resumo: conte em poucas linhas o que aconteceu e o contexto.');
  const desde = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const { data: aberto } = await comPrazo(db().from('commercial_handoffs').select('id, created_at').eq('lead_id', lead.id).eq('tipo', input.tipo).eq('situacao', 'nova').gte('created_at', desde).limit(1));
  if (aberto && aberto.length) throw new Error(`Ja existe um aviso "${input.tipo}" aberto para este lead nas ultimas 6 horas (${aberto[0].id}). Nao repita: atualize a conversa e as notas.`);
  const dados = input.dados && typeof input.dados === 'object' ? input.dados : {};
  if (JSON.stringify(dados).length > 8000) throw new Error('dados: grande demais (ate 8 mil caracteres).');
  const telefone = texto(input.telefone, 40) || (lead.whatsapp as string | null) || null;
  const { data, error } = await comPrazo(db().from('commercial_handoffs').insert({
    lead_id: lead.id, tipo: input.tipo, resumo, proximo_passo: texto(input.proximo_passo, 300), telefone, dados,
    operador_slug: slugDoOperador(input.operador),
  }).select('*').single());
  if (error) throw new Error(`commercial_handoffs: ${error.message}`);
  return { item: data, avisado: true, link: `/comercial/caixa?item=${data.id}`, observacao: 'A equipe foi avisada no sino (Comercial).' };
}

/** Fato com prova: a regua decide se grava na ficha, vira sugestao ou e descartado. */
export async function comercialRegistrarFato(input: { lead_id?: string; organization_id?: string; campo: string; valor: string; evidencias: Evidencia[]; operador?: string }, ctx: AuthContext) {
  soDaCasa(ctx);
  if (!input.lead_id && !input.organization_id) throw new Error('Informe lead_id ou organization_id.');
  const lead = input.lead_id ? await exigirLead(input.lead_id) : null;
  const orgId = input.organization_id || (lead && (lead.organization_id as string | null)) || null;
  if (orgId && !isUuid(orgId)) throw new Error('organization_id must be a UUID');
  const campo = normalizarCampoDoFato(input.campo);
  if (campo.length < 2) throw new Error('campo: diga qual dado (ex.: whatsapp, cnpj, cargo).');
  const valor = texto(input.valor, 1000);
  if (!valor) throw new Error('valor: vazio.');
  const evidencias = (Array.isArray(input.evidencias) ? input.evidencias : []).slice(0, 10)
    .filter((e) => e && ehTipoDeEvidencia(e.tipo))
    .map((e) => ({ tipo: e.tipo, detalhe: String(e.detalhe || '').trim().slice(0, 500), fonte_url: texto(e.fonte_url, 500) }));
  if (!evidencias.length) throw new Error('evidencias: mande ao menos uma prova (tipo e detalhe). Sem prova, o fato nao entra.');
  if (evidencias.some((e) => e.detalhe.length < 3)) throw new Error('evidencias.detalhe: escreva o que viu e onde, para a equipe ler.');
  const aval = avaliarEvidencias(evidencias);
  const destino = CAMPOS_DO_FATO[campo];
  let escritoEm: string | null = null;
  const avisos: string[] = [];
  if (aval.situacao === 'gravado' && destino) {
    const v = valor.slice(0, destino.max);
    if (destino.alvo === 'lead' && lead) {
      const { error } = await db().from('commercial_leads').update({ [destino.coluna]: v }).eq('id', lead.id);
      if (error) avisos.push(`commercial_leads: ${error.message}`); else escritoEm = `commercial_leads.${destino.coluna}`;
    } else if (destino.alvo === 'qualificacao' && lead) {
      const qual = { ...((lead.qualificacao as Record<string, unknown>) || {}), [destino.coluna]: v };
      const { error } = await db().from('commercial_leads').update({ qualificacao: qual }).eq('id', lead.id);
      if (error) avisos.push(`commercial_leads.qualificacao: ${error.message}`); else escritoEm = `commercial_leads.qualificacao.${destino.coluna}`;
    } else if (destino.alvo === 'empresa' && orgId) {
      const { error } = await db().from('commercial_organizations').update({ [destino.coluna]: v }).eq('id', orgId);
      if (error) avisos.push(`commercial_organizations: ${error.message}`); else escritoEm = `commercial_organizations.${destino.coluna}`;
    } else {
      avisos.push('Fato forte, mas sem ficha onde gravar (lead sem empresa ligada): ficou so registrado.');
    }
  } else if (aval.situacao === 'gravado') {
    avisos.push(`O campo "${campo}" nao e um campo da ficha: o fato ficou registrado, sem escrever na ficha.`);
  }
  const { data, error } = await comPrazo(db().from('commercial_facts').insert({
    lead_id: lead ? lead.id : null, organization_id: orgId, campo, valor,
    evidencia: evidenciaPrincipal(evidencias),
    detalhe: evidencias.map((e) => `${e.tipo}: ${e.detalhe}`).join(' | ').slice(0, 2000),
    fonte_url: evidencias.map((e) => e.fonte_url).filter(Boolean)[0] || null,
    situacao: aval.situacao, operador_slug: slugDoOperador(input.operador),
  }).select('*').single());
  if (error) throw new Error(`commercial_facts: ${error.message}`);
  return { fato: data, avaliacao: aval, escrito_em: escritoEm, ...(avisos.length ? { warnings: avisos } : {}) };
}

/** Liga ou desliga o agente comercial num lead. */
export async function comercialAtribuirAgente(input: { lead_id: string; operador: string | null; motivo: string }, ctx: AuthContext) {
  soDaCasa(ctx);
  const lead = await exigirLead(input.lead_id);
  const motivo = texto(input.motivo, 500);
  if (!motivo || motivo.length < 3) throw new Error('motivo: diga em uma linha por que liga ou desliga o agente.');
  const novo = input.operador === null || input.operador === '' ? null : slugDoOperador(input.operador);
  if ((lead.agente_slug ?? null) === novo) return { lead_id: lead.id, agente: novo, mudou: false };
  const { error } = await comPrazo(db().from('commercial_leads').update({ agente_slug: novo }).eq('id', lead.id));
  if (error) throw new Error(`commercial_leads: ${error.message}`);
  await db().from('commercial_lead_events').insert({ lead_id: lead.id, kind: 'agente', note: novo ? `${novo} passou a atender: ${motivo}` : `Agente deixou de atender (${lead.agente_slug ?? 'nenhum'}): ${motivo}` });
  return { lead_id: lead.id, agente: novo, mudou: true };
}

/** Maquina de leads: pede uma busca (o worker da casa roda) ou devolve a igual que ja esta na fila. */
export async function comercialMaquinaBuscar(input: { nicho: string; cidade: string; uf?: string; limite?: number; fontes?: string[]; campanha_id?: string | null; entregar_ao_mercurio?: boolean }, ctx: AuthContext) {
  soDaCasa(ctx);
  const nicho = texto(input.nicho, 120);
  const cidade = texto(input.cidade, 120);
  if (!nicho || nicho.length < 2) throw new Error('nicho: diga o ramo (ex.: clinica odontologica).');
  if (!cidade || cidade.length < 2) throw new Error('cidade: diga a cidade.');
  const uf = input.uf ? String(input.uf).trim().toUpperCase().slice(0, 2) : null;
  const limite = Math.min(Math.max(Math.round(Number(input.limite) || 50), 1), 300);
  const fontes = (Array.isArray(input.fontes) ? input.fontes : ['osm', 'sites']).map((f) => String(f).trim().toLowerCase()).filter((f) => /^[a-z_]{2,20}$/.test(f)).slice(0, 5);
  if (input.campanha_id && !isUuid(input.campanha_id)) throw new Error('campanha_id must be a UUID');
  const { data: igual } = await comPrazo(db().from('leads_buscas').select('*').ilike('nicho', nicho).ilike('cidade', cidade).in('situacao', ['na_fila', 'rodando']).limit(1));
  if (igual && igual.length) return { busca: igual[0], criada: false, duplicada: true, observacao: 'Ja existe uma busca igual na fila.' };
  const { data, error } = await comPrazo(db().from('leads_buscas').insert({
    nicho, cidade, uf, limite, fontes: fontes.length ? fontes : ['osm', 'sites'],
    campanha_id: input.campanha_id || null, entregar_ao_mercurio: input.entregar_ao_mercurio === true,
  }).select('*').single());
  if (error) throw new Error(`leads_buscas: ${error.message}`);
  return { busca: data, criada: true, observacao: 'O worker da casa roda a busca. Acompanhe com aceleriq_comercial_maquina_candidatos.' };
}

/** Maquina de leads: as buscas recentes ou os candidatos de uma busca. */
export async function comercialMaquinaCandidatos(input: { busca_id?: string; situacao?: string; limit?: number }, ctx: AuthContext) {
  soDaCasa(ctx);
  const limit = Math.min(Math.max(Number(input.limit) || 100, 1), 300);
  if (!input.busca_id) {
    const { data, error } = await comPrazo(db().from('leads_buscas').select('id, nicho, cidade, uf, situacao, encontrados, limite, erro, entregar_ao_mercurio, created_at, terminado_em').order('created_at', { ascending: false }).limit(20));
    if (error) throw new Error(`leads_buscas: ${error.message}`);
    return { buscas: data ?? [], total: (data ?? []).length };
  }
  if (!isUuid(input.busca_id)) throw new Error('busca_id must be a UUID');
  const { data: busca, error: e1 } = await comPrazo(db().from('leads_buscas').select('*').eq('id', input.busca_id).maybeSingle());
  if (e1) throw new Error(`leads_buscas: ${e1.message}`);
  if (!busca) throw new Error('Busca nao encontrada.');
  let qb = db().from('leads_candidatos').select('*').eq('busca_id', input.busca_id).order('nota', { ascending: false, nullsFirst: false }).order('created_at', { ascending: true }).limit(limit);
  if (input.situacao && ['novo', 'importado', 'descartado'].indexOf(input.situacao) >= 0) qb = qb.eq('situacao', input.situacao);
  const { data, error } = await comPrazo(qb);
  if (error) throw new Error(`leads_candidatos: ${error.message}`);
  return { busca, candidatos: data ?? [], total: (data ?? []).length };
}
