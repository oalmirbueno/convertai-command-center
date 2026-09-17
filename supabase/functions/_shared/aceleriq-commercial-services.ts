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

export const ETAPAS_DO_FUNIL = ['novo', 'contato', 'diagnostico', 'proposta', 'negociacao', 'ganho', 'perdido'] as const;
export const CLASSES_DO_LEAD = ['cliente_atual', 'upsell', 'novo_prospect'] as const;
export const ORIGENS_DO_LEAD = ['indicacao', 'instagram', 'quiz', 'prospeccao', 'evento', 'site', 'manual'] as const;
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
    lead.organization_id ? comPrazo(db().from('commercial_organizations').select('id, name, segment, site, city, notes, client_id').eq('id', lead.organization_id).maybeSingle()) : Promise.resolve({ data: null }),
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
  await db().from('commercial_lead_events').insert({ lead_id: data.id, kind: 'nota', note: `Criado pelo MCP (${ctx.keyName}).` });
  return { oportunidade: data, criado: true };
}

export async function updateOpportunity(input: OpportunityInput & { opportunity_id: string }, ctx: AuthContext) {
  soDaCasa(ctx);
  const antes = await exigirLead(input.opportunity_id);
  await exigirPerfil(input.owner_id, 'owner_id');
  const { opportunity_id: _id, ...campos } = input;
  const corpo = corpoDoLead(campos);
  if (Object.keys(corpo).length === 0) throw new Error('Nada para atualizar: mande ao menos um campo alem do id.');
  if ('name' in corpo && String(corpo.name).length < 2) throw new Error('name: o negocio precisa de um nome.');
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
  await db().from('commercial_lead_events').insert({
    lead_id: lead.id, kind: 'stage', from_stage: lead.stage, to_stage: para, note: motivo,
  });
  return { oportunidade: data, movido: true, de: lead.stage, para };
}

export async function addOpportunityNote(input: { opportunity_id: string; note: string }, ctx: AuthContext) {
  soDaCasa(ctx);
  const lead = await exigirLead(input.opportunity_id);
  const nota = texto(input.note, 2000);
  if (!nota || nota.length < 2) throw new Error('note: escreva um pouco mais.');
  const { data, error } = await comPrazo(db().from('commercial_lead_events')
    .insert({ lead_id: lead.id, kind: 'nota', note: nota }).select('id, created_at').single());
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
  await db().from('commercial_leads').update({ next_action: titulo, next_action_at: quando.toISOString().slice(0, 10) }).eq('id', lead.id);
  return { atividade: data, criada: true };
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
  if (concluir) {
    const resultado = texto(input.outcome, 1000);
    await db().from('commercial_lead_events').insert({
      lead_id: atividade.lead_id, kind: 'atividade', note: `Feito: ${atividade.title}${resultado ? ` · ${resultado}` : ''}`,
    });
  }
  return { activity_id: atividade.id, concluida: concluir };
}

export async function listCommercialOrganizations(opts: { search?: string; limit?: number }, ctx: AuthContext) {
  soDaCasa(ctx);
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  let qb = db().from('commercial_organizations')
    .select('id, name, segment, site, city, notes, client_id, owner_id, created_at, contatos:commercial_contacts(id, name, role, email, whatsapp, is_primary, archived_at)')
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

export async function upsertCommercialOrganization(input: { organization_id?: string; name?: string; segment?: string; site?: string; city?: string; notes?: string; client_id?: string | null; owner_id?: string | null }, ctx: AuthContext) {
  soDaCasa(ctx);
  await exigirPerfil(input.owner_id, 'owner_id');
  await exigirPerfil(input.client_id, 'client_id');
  const corpo: Record<string, unknown> = {};
  for (const k of ['segment', 'site', 'city'] as const) if (input[k] !== undefined) corpo[k] = texto(input[k], 200);
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
