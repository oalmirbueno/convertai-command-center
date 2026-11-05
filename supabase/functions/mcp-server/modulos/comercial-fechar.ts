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
import { ADICIONAL_GOOGLE, criarCobrancaPix, documentoValido, ErroDoAsaas, planoPorId, valorDoFechamento } from './comercial-asaas.ts';
import { AJUSTES_DA_VOZ, textoFalado } from './comercial-voz.ts';
import { diaDoHorario, horarioDaGrade, horariosLivres, rotuloDoHorario, type Intervalo } from './comercial-agenda.ts';

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

export async function comercialCobrar(input: { lead_id: string; plano: string; nome: string; documento: string; email?: string; com_google?: boolean; com_desconto?: boolean; operador?: string }, ctx: AuthContext) {
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
  const comGoogle = input.com_google === true && plano.mensal > 0;
  const comDesconto = input.com_desconto === true && plano.mensal > 0;
  const valor = valorDoFechamento(plano, comGoogle, comDesconto);
  const nomeDoPacote = (comGoogle ? `${plano.nome} + ${ADICIONAL_GOOGLE.nome}` : plano.nome) + (comDesconto ? ' (15% nos 3 primeiros meses)' : '');
  const venc = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  let criada;
  try {
    criada = await criarCobrancaPix(token, fetch, { nome, documento, email, telefone: digitos((lead as Record<string, unknown>).whatsapp).replace(/^55/, '') || null, valor,
      descricao: plano.mensal > 0 ? `Aceleriq: ${nomeDoPacote}, entrada e primeira mensalidade` : `Aceleriq: ${plano.nome}`, referencia: `lead:${input.lead_id}`, vencimento: venc });
  } catch (e) {
    if (e instanceof ErroDoAsaas) return { cobranca: null, nova: false, erro_asaas: true, aviso: e.message };
    throw e;
  }
  const { data, error } = await comPrazo(db().from('comercial_cobrancas').insert({
    lead_id: input.lead_id, plano: plano.id, plano_nome: nomeDoPacote, valor, nome, documento_final: documento.slice(-4), email,
    asaas_cliente_id: criada.cliente_id, asaas_pagamento_id: criada.pagamento_id, link: criada.link, pix_copia_e_cola: criada.pix_copia_e_cola,
    vencimento: venc, operador_slug: texto(input.operador, 40) || 'mercurio',
  }).select('*').single());
  if (error) throw new Error(`comercial_cobrancas: ${error.message}`);
  await db().from('commercial_lead_events').insert({ lead_id: input.lead_id, kind: 'agente', note: `Pix gerado no Asaas: ${nomeDoPacote}, R$ ${valor}. Aguardando pagamento.` });
  return { cobranca: data, nova: true };
}

async function diasComReuniao(): Promise<string[]> {
  const { data, error } = await comPrazo(db().from('comercial_reunioes').select('dia').eq('situacao', 'marcada').gte('dia', new Date(Date.now() - 86400000).toISOString().slice(0, 10)));
  if (error) throw new Error(`comercial_reunioes: ${error.message}`);
  return ((data ?? []) as Array<{ dia: string }>).map((r) => r.dia);
}

/** Os horários livres do Almir. ocupados: o que o n8n leu do Google Agenda. */
export async function comercialHorarios(input: { ocupados?: Intervalo[]; maximo?: number }, ctx: AuthContext) {
  soDaCasa(ctx);
  const ocupados = Array.isArray(input.ocupados) ? input.ocupados.slice(0, 200) : [];
  return { horarios: horariosLivres(Date.now(), ocupados, await diasComReuniao(), Math.min(Number(input.maximo) || 4, 6)), google_lido: Array.isArray(input.ocupados) };
}

export async function comercialMarcarReuniao(input: { lead_id: string; inicio: string; resumo?: string; operador?: string }, ctx: AuthContext) {
  soDaCasa(ctx);
  if (!isUuid(input.lead_id)) throw new Error('lead_id must be a UUID');
  if (!horarioDaGrade(input.inicio)) return { marcada: false, motivo: 'fora_da_agenda' };
  const inicio = new Date(input.inicio).toISOString();
  const { data: lead } = await comPrazo(db().from('commercial_leads').select('id, name, company, whatsapp').eq('id', input.lead_id).maybeSingle());
  if (!lead) throw new Error('Lead nao encontrado.');
  const l = lead as Record<string, string | null>;
  const { data, error } = await comPrazo(db().from('comercial_reunioes').insert({ lead_id: input.lead_id, inicio, dia: diaDoHorario(inicio), resumo: texto(input.resumo, 2000), operador_slug: texto(input.operador, 40) || 'mercurio' }).select('id').single());
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return { marcada: false, motivo: 'dia_ocupado' };
    throw new Error(`comercial_reunioes: ${error.message}`);
  }
  const titulo = `Reunião: ${l.company || l.name}`;
  await db().from('commercial_activities').insert({ lead_id: input.lead_id, kind: 'ligacao', title: titulo, due_at: inicio, notes: texto(input.resumo, 2000) });
  await db().from('commercial_lead_events').insert({ lead_id: input.lead_id, kind: 'agente', note: `Reunião marcada para ${rotuloDoHorario(inicio)}.` });
  return { marcada: true, id: (data as { id: string }).id, inicio, fim: new Date(Date.parse(inicio) + 3600000).toISOString(), rotulo: rotuloDoHorario(inicio), titulo };
}

const VOZ_PADRAO = 'FB9t7w9dj2IYiysoM5p6';

/** Nota de voz: OGG Opus mono, o formato que o WhatsApp mostra como áudio gravado. */
export async function comercialFalar(input: { texto: string; voz?: string; modelo?: string }, ctx: AuthContext) {
  soDaCasa(ctx);
  const t = textoFalado(texto(input.texto, 900) || '');
  if (!t) throw new Error('texto: vazio.');
  const voz = /^[A-Za-z0-9]{10,40}$/.test(String(input.voz || '')) ? String(input.voz) : VOZ_PADRAO;
  const k = await chave('ELEVENLABS_API_KEY');
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voz}?output_format=opus_48000_64`, {
    method: 'POST', headers: { 'xi-api-key': k, 'content-type': 'application/json' },
    body: JSON.stringify({ text: t, model_id: texto(input.modelo, 40) || 'eleven_v4', language_code: 'pt', voice_settings: AJUSTES_DA_VOZ }),
  });
  if (!r.ok) throw new Error(`ElevenLabs respondeu ${r.status}.`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { audio_base64: btoa(bin), mime: 'audio/ogg', bytes: bytes.length };
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
