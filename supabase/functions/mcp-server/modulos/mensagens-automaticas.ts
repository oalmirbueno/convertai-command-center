/**
 * Lembrete de aprovação e régua de cobrança (MCP 2.22.0, 27/10/2026).
 *
 * O painel prepara as mensagens; o dono aprova (o modelo do lembrete uma vez; cada cobrança com um toque ou a
 * régua inteira do cliente). O Hermes só lê o que já foi aprovado, envia no grupo do cliente e registra o
 * envio com evidência. Nada aqui decide nem escreve mensagem: as funções do banco são as *_para_agente e
 * *_por_agente, que validam o operador e assumem o administrador configurado só naquela transação.
 *
 * Banco: supabase/migrations/20261027100000_lembrete_de_aprovacao_e_regua_de_cobranca.sql.
 */

import { db, isUuid } from '../../_shared/aceleriq-read-services.ts';
import { assertClientAccess, canAccessClient, type AuthContext } from '../../_shared/mcp-auth.ts';

const slug = (s: string) => String(s || '').trim().toLowerCase();

async function rpc(nome: string, args: Record<string, unknown>) {
  const { data, error } = await db().rpc(nome, args);
  if (error) throw new Error(`${nome}: ${error.message}`);
  return data;
}

/** A fila é da casa toda; chave com escopo de clientes só vê os dela. */
export function filtrarFilaPorEscopo(fila: Record<string, unknown>, pode: (clientId: string) => boolean): Record<string, unknown> {
  const dentro = (lista: unknown) => (Array.isArray(lista) ? lista : []).filter((x) => pode(String((x as { client_id?: unknown }).client_id ?? '')));
  return { ...fila, aprovados_para_enviar: dentro(fila.aprovados_para_enviar), enviados_recentes: dentro(fila.enviados_recentes) };
}

export async function mensagensAutomaticasFila(input: { operator: string }, ctx: AuthContext) {
  const fila = await rpc('mensagens_automaticas_fila_para_agente', { _operator_slug: slug(input.operator) }) as Record<string, unknown>;
  if (ctx.dataScope.unrestricted) return fila;
  return filtrarFilaPorEscopo(fila, (id) => canAccessClient(ctx, id));
}

export async function mensagensAutomaticasMarcarEnviado(input: {
  operator: string; mensagem_id: string; evidence: string; idempotency_key: string;
}, ctx: AuthContext) {
  if (!isUuid(input.mensagem_id)) throw new Error('mensagem_id must be a UUID');
  const { data, error } = await db().from('mensagem_automatica').select('client_id').eq('id', input.mensagem_id).maybeSingle();
  if (error) throw new Error(`mensagem_automatica: ${error.message}`);
  if (!data) throw new Error('MENSAGEM_NAO_ENCONTRADA');
  assertClientAccess(ctx, String(data.client_id));
  return await rpc('mensagem_automatica_marcar_enviado_por_agente', {
    _operator_slug: slug(input.operator),
    _id: input.mensagem_id,
    _evidence: String(input.evidence || '').trim(),
    _key: input.idempotency_key,
  });
}
