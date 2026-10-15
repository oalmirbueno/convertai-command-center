/**
 * Aviso de post no ar na Revisão do Ciclo (MCP 2.10.0, 14/10/2026).
 *
 * Mesmo rito da revisão dos rituais: preparar (texto e destino congelados) → o dono decide → quem envia
 * registra o envio com evidência. As funções do banco são as *_por_agente: o operador é validado e o
 * administrador configurado é assumido só naquela transação. Nada aqui manda mensagem.
 *
 * Além do operador, vale o escopo da chave: cliente fora do escopo é recusado antes de qualquer escrita.
 */

import { db, isUuid } from '../../_shared/aceleriq-read-services.ts';
import { assertClientAccess, canAccessClient, type AuthContext } from '../../_shared/mcp-auth.ts';

const slug = (s: string) => String(s || '').trim().toLowerCase();

async function rpc(nome: string, args: Record<string, unknown>) {
  const { data, error } = await db().rpc(nome, args);
  if (error) throw new Error(`${nome}: ${error.message}`);
  return data;
}

async function clienteDoAviso(avisoId: string): Promise<string> {
  if (!isUuid(avisoId)) throw new Error('aviso_id must be a UUID');
  const { data, error } = await db().from('aviso_publicacao').select('client_id').eq('id', avisoId).maybeSingle();
  if (error) throw new Error(`aviso_publicacao: ${error.message}`);
  if (!data) throw new Error('AVISO_NAO_ENCONTRADO');
  return String(data.client_id);
}

export async function avisoPublicacaoFila(input: { operator: string }, ctx: AuthContext) {
  const fila = await rpc('aviso_publicacao_fila_para_agente', { _operator_slug: slug(input.operator) }) as Record<string, unknown>;
  // A fila é da casa toda; a chave com escopo de clientes só vê os dela.
  if (ctx.dataScope.unrestricted) return fila;
  const dentro = (lista: unknown) => (Array.isArray(lista) ? lista : []).filter((x) => canAccessClient(ctx, String((x as { client_id?: unknown }).client_id ?? '')));
  return {
    ...fila,
    esperando_decisao: dentro(fila.esperando_decisao),
    aprovados_para_enviar: dentro(fila.aprovados_para_enviar),
    posts_no_ar_sem_aviso: dentro(fila.posts_no_ar_sem_aviso),
    // Enviados recentes não trazem client_id; com escopo, ficam de fora.
    enviados_recentes: [],
  };
}

export async function avisoPublicacaoPreparar(input: {
  operator: string; publication_id: string; mensagem: string; channel: 'portal' | 'whatsapp'; recipient?: string; idempotency_key: string;
}, ctx: AuthContext) {
  if (!isUuid(input.publication_id)) throw new Error('publication_id must be a UUID');
  const { data: pub, error } = await db().from('editorial_publications').select('client_id').eq('id', input.publication_id).maybeSingle();
  if (error) throw new Error(`editorial_publications: ${error.message}`);
  if (!pub) throw new Error('AVISO_PUBLICACAO_NAO_ENCONTRADA');
  assertClientAccess(ctx, String(pub.client_id));
  const recipient = String(input.recipient ?? '').trim();
  if (input.channel === 'whatsapp' && !recipient) {
    throw new Error('recipient é obrigatório no WhatsApp: o nome exato do grupo ou do contato.');
  }
  return await rpc('aviso_publicacao_preparar_por_agente', {
    _operator_slug: slug(input.operator),
    _publication_id: input.publication_id,
    _mensagem: input.mensagem,
    _destination: { channel: input.channel, recipient: input.channel === 'portal' ? 'portal' : recipient },
    _idempotency_key: input.idempotency_key,
  });
}

export async function avisoPublicacaoDecidir(input: {
  operator: string; aviso_id: string; decision: 'aprovado' | 'rejeitado'; evidence: string; comment?: string; idempotency_key: string;
}, ctx: AuthContext) {
  assertClientAccess(ctx, await clienteDoAviso(input.aviso_id));
  return await rpc('aviso_publicacao_decidir_por_agente', {
    _operator_slug: slug(input.operator),
    _aviso_id: input.aviso_id,
    _decision: input.decision,
    _comment: input.comment?.trim() || null,
    _evidence: String(input.evidence || '').trim(),
    _idempotency_key: input.idempotency_key,
  });
}

export async function avisoPublicacaoMarcarEnviado(input: {
  operator: string; aviso_id: string; evidence: string; idempotency_key: string;
}, ctx: AuthContext) {
  assertClientAccess(ctx, await clienteDoAviso(input.aviso_id));
  return await rpc('aviso_publicacao_marcar_enviado_por_agente', {
    _operator_slug: slug(input.operator),
    _aviso_id: input.aviso_id,
    _evidence: String(input.evidence || '').trim(),
    _idempotency_key: input.idempotency_key,
  });
}
