/**
 * O que o n8n pede ao painel para o Mercúrio fechar e repassar (MCP 2.24, 05/11/2026).
 *
 * - Entrada nova: quem chama no WhatsApp (anúncio, indicação) vira lead do Mercúrio; número de quem já é
 *   cliente ou de lead tocado por pessoa não recebe resposta automática.
 * - Cobrar: Pix no Asaas com o valor da tabela, nunca o que veio do texto do modelo.
 * - Repasses: a Caixa que ainda não foi avisada no WhatsApp da Aceleriq; o n8n manda e marca.
 *
 * Quem confirma o pagamento é o webhook comercial-asaas-webhook, conferindo no próprio Asaas.
 */

import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { db, isUuid, READ_LIMITS } from '../../_shared/aceleriq-read-services.ts';
import { chave } from '../../_shared/chaves.ts';
import { criarCobrancaPix, documentoValido, ErroDoAsaas, planoPorId, valorDoFechamento } from '../../_shared/comercial-asaas.ts';

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

async function comPrazo<T>(p: PromiseLike<T>, ms = READ_LIMITS.queryTimeoutMs): Promise<T> {
  return await Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Query timeout after ${ms}ms`)), ms)),
  ]);
}

function soDaCasa(ctx: AuthContext) {
  if (!ctx.dataScope.unrestricted) throw new Error('O comercial e area interna da casa: esta credencial e restrita a cliente e nao alcanca o CRM.');
}

const digitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const texto = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** DDD e os 8 últimos dígitos: o wa_id brasileiro pode vir sem o 9. */
export function chaveDoNumero(bruto: unknown): string | null {
  let d = digitos(bruto);
  if (d.length < 10) return null;
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? d.slice(0, 2) + d.slice(-8) : d;
}

export async function comercialEntradaNova(input: { whatsapp: string; nome_perfil?: string; anuncio?: Record<string, unknown>; operador?: string }, ctx: AuthContext) {
  soDaCasa(ctx);
  const k = chaveDoNumero(input.whatsapp);
  if (!k) throw new Error('whatsapp: numero invalido.');
  const operador = texto(input.operador, 40) || 'mercurio';
  const { data: possiveis, error } = await comPrazo(db().from('commercial_leads')
    .select('id, name, company, email, whatsapp, stage, origin, classe, qualificacao, agente_slug, notes, archived_at')
    .ilike('whatsapp', `%${k.slice(-4)}`).is('archived_at', null).limit(50));
  if (error) throw new Error(`commercial_leads: ${error.message}`);
  const lead = ((possiveis ?? []) as Array<Record<string, unknown>>).find((l) => chaveDoNumero(l.whatsapp) === k) || null;
  if (lead) {
    const q = (lead.qualificacao as Record<string, unknown>) || {};
    if (q.client_id || lead.stage === 'ganho') return { lead_id: lead.id, criado: false, so_registrar: true, motivo: 'ja_e_cliente' };
    if (lead.agente_slug && lead.agente_slug !== operador) return { lead_id: lead.id, criado: false, so_registrar: true, motivo: 'com_outro_agente' };
    if (!lead.agente_slug && lead.stage !== 'novo') return { lead_id: lead.id, criado: false, so_registrar: true, motivo: 'com_a_equipe' };
    if (!lead.agente_slug) {
      await db().from('commercial_leads').update({ agente_slug: operador, agente_desde: new Date().toISOString() }).eq('id', lead.id);
    }
    return { lead_id: lead.id, criado: false, so_registrar: false, item: itemDoLead(lead) };
  }
  const anuncio = input.anuncio && typeof input.anuncio === 'object' ? input.anuncio : null;
  const nome = texto(input.nome_perfil, 120) || `WhatsApp ${digitos(input.whatsapp).slice(-4)}`;
  const qualificacao = { fonte: anuncio ? 'anuncio_whatsapp' : 'whatsapp_entrada', whatsapp_confirmado: true, ...(anuncio ? { anuncio } : {}) };
  const { data: novo, error: e2 } = await comPrazo(db().from('commercial_leads').insert({
    name: nome, whatsapp: digitos(input.whatsapp), stage: 'novo', origin: anuncio ? 'anuncio' : 'whatsapp', qualificacao,
    agente_slug: operador, agente_desde: new Date().toISOString(),
  }).select('id, name, company, email, whatsapp, stage, origin, classe, qualificacao, notes').single());
  if (e2 || !novo) throw new Error(`commercial_leads: ${e2?.message || 'nao criado'}`);
  await db().from('commercial_lead_events').insert({ lead_id: (novo as Record<string, unknown>).id, kind: 'agente', note: anuncio ? 'Chamou no WhatsApp por um anúncio.' : 'Chamou no WhatsApp comercial.' });
  return { lead_id: (novo as Record<string, unknown>).id, criado: true, so_registrar: false, item: itemDoLead(novo as Record<string, unknown>) };
}

function itemDoLead(l: Record<string, unknown>) {
  return {
    lead_id: l.id, nome: l.name, empresa: l.company ?? null, whatsapp: l.whatsapp ?? null, email: l.email ?? null, etapa: l.stage, origem: l.origin,
    lead_frio: false, primeiro_contato_feito: false, nao_contatar: false, classe: l.classe ?? null, qualificacao: l.qualificacao ?? {}, notas: l.notes ?? null, mensagens: [], fatos: [],
  };
}

export async function comercialCobrar(input: { lead_id: string; plano: string; nome: string; documento: string; email?: string; operador?: string }, ctx: AuthContext) {
  soDaCasa(ctx);
  if (!isUuid(input.lead_id)) throw new Error('lead_id must be a UUID');
  const plano = planoPorId(input.plano);
  if (!plano) throw new Error('plano: use um plano da tabela.');
  const nome = texto(input.nome, 120);
  if (!nome || nome.length < 3) throw new Error('nome: falta o nome ou a razao social para a cobranca.');
  const documento = documentoValido(input.documento);
  if (!documento) throw new Error('documento: CPF ou CNPJ nao confere.');
  const email = texto(input.email, 200);
  if (email && !EMAIL.test(email)) throw new Error('email: invalido.');
  const { data: lead } = await comPrazo(db().from('commercial_leads').select('id, whatsapp, qualificacao').eq('id', input.lead_id).maybeSingle());
  if (!lead) throw new Error('Lead nao encontrado.');
  const q = ((lead as Record<string, unknown>).qualificacao as Record<string, unknown>) || {};
  if (q.nao_contatar === 'sim' || q.nao_contatar === true) throw new Error('Este lead pediu para nao ser mais contatado.');
  const { data: aberta } = await comPrazo(db().from('comercial_cobrancas').select('*').eq('lead_id', input.lead_id).eq('plano', plano.id).eq('situacao', 'aguardando').maybeSingle());
  if (aberta) return { cobranca: aberta, nova: false };
  let token = '';
  try { token = await chave('ASAAS_API_KEY'); } catch { token = ''; }
  if (!token) return { cobranca: null, nova: false, sem_asaas: true, aviso: 'A chave do Asaas ainda nao esta no cofre: passe para a equipe fechar.' };
  const valor = valorDoFechamento(plano);
  const venc = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  let criada;
  try {
    criada = await criarCobrancaPix(token, fetch, { nome, documento, email, telefone: digitos((lead as Record<string, unknown>).whatsapp).replace(/^55/, '') || null, valor,
      descricao: `Aceleriq: plano ${plano.nome}, entrada e primeira mensalidade`, referencia: `lead:${input.lead_id}`, vencimento: venc });
  } catch (e) {
    if (e instanceof ErroDoAsaas) return { cobranca: null, nova: false, erro_asaas: true, aviso: e.message };
    throw e;
  }
  const { data, error } = await comPrazo(db().from('comercial_cobrancas').insert({
    lead_id: input.lead_id, plano: plano.id, plano_nome: plano.nome, valor, nome, documento_final: documento.slice(-4), email,
    asaas_cliente_id: criada.cliente_id, asaas_pagamento_id: criada.pagamento_id, link: criada.link, pix_copia_e_cola: criada.pix_copia_e_cola,
    vencimento: venc, operador_slug: texto(input.operador, 40) || 'mercurio',
  }).select('*').single());
  if (error) throw new Error(`comercial_cobrancas: ${error.message}`);
  await db().from('commercial_lead_events').insert({ lead_id: input.lead_id, kind: 'agente', note: `Pix gerado no Asaas: ${plano.nome}, R$ ${valor}. Aguardando pagamento.` });
  return { cobranca: data, nova: true };
}

export async function comercialRepasses(input: { limit?: number }, ctx: AuthContext) {
  soDaCasa(ctx);
  const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 30);
  const { data, error } = await comPrazo(db().from('commercial_handoffs')
    .select('id, lead_id, tipo, resumo, proximo_passo, telefone, dados, created_at, commercial_leads(name, company, whatsapp)')
    .is('repassado_em', null).in('situacao', ['nova']).gte('created_at', '2026-11-05').order('created_at', { ascending: true }).limit(limit));
  if (error) throw new Error(`commercial_handoffs: ${error.message}`);
  return { itens: data ?? [], total: (data ?? []).length };
}

export async function comercialRepasseMarcar(input: { id: string; wamid?: string }, ctx: AuthContext) {
  soDaCasa(ctx);
  if (!isUuid(input.id)) throw new Error('id must be a UUID');
  const { data, error } = await comPrazo(db().from('commercial_handoffs').update({ repassado_em: new Date().toISOString(), repasse_wamid: texto(input.wamid, 200) }).eq('id', input.id).is('repassado_em', null).select('id').maybeSingle());
  if (error) throw new Error(`commercial_handoffs: ${error.message}`);
  return { id: input.id, marcado: !!data };
}
