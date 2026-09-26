/**
 * aceleriq_client_instruction (MCP 2.4.0, 26/09): manda uma orientação ou um
 * prompt para o planejamento de um cliente ("o mês e tudo que é gerado se
 * baseia também no MCP"). A orientação vira uma memória do projeto com a
 * etiqueta orientacao_da_mesa e aparece na área MCP do Contexto do cliente,
 * valendo para o planejamento por padrão (a equipe desliga quando quiser). O
 * agente do Mês, o pedido livre e os geradores de meses leem as ativas; se ela
 * declarar outro público, o agente do Mês pergunta ao Jev se esse público é
 * real para o cliente antes de adaptar.
 *
 * Escrita com a chave de serviço (como as outras escritas do MCP legado): a
 * fronteira é conferida aqui antes de tocar no banco (UUID, cliente no escopo
 * do principal, cliente existente) e a chave de idempotência evita duplicar.
 */

import { db, isUuid } from './aceleriq-read-services.ts';
import { assertClientAccess, type AuthContext } from './mcp-auth.ts';
import { exigirClienteExistente } from './mcp-client-id-guard.ts';
import { findIdempotentResult } from './mcp-write-services.ts';
import { ETIQUETA_DA_ORIENTACAO } from './contexto-mcp.ts';

export type EntradaDaOrientacao = {
  client_id: string;
  instrucao: string;
  titulo?: string;
  publico?: string;
  vale_para_planejamento?: boolean;
  idempotency_key: string;
};

type Ctx = AuthContext & { correlationId?: string; resultRefHolder?: { value?: string } };

export async function orientacaoDoCliente(input: EntradaDaOrientacao, ctx: Ctx) {
  if (!isUuid(input.client_id)) throw new Error('client_id must be a UUID');
  assertClientAccess(ctx, input.client_id);
  await exigirClienteExistente(db(), input.client_id, `${input.titulo ?? ''} ${input.instrucao}`);

  const anterior = await findIdempotentResult('aceleriq_client_instruction', ctx.keyId, input.idempotency_key).catch(() => null);
  if (anterior) {
    return {
      ok: true,
      replay: true,
      idempotency_replay_of: anterior.correlationId,
      ref: anterior.resultRef,
      aviso: 'Esta idempotency_key já foi usada com sucesso: nada foi gravado de novo.',
    };
  }

  const titulo = (input.titulo || input.instrucao.replace(/\s+/g, ' ').trim().slice(0, 80)).slice(0, 200);
  const { data, error } = await db().from('project_memory').insert({
    client_id: input.client_id,
    project_id: null,
    kind: 'decisao',
    source: (ctx.origin || 'mcp').slice(0, 60),
    title: titulo,
    content: input.instrucao,
    tags: [ETIQUETA_DA_ORIENTACAO],
    metadata: {
      origin: ctx.origin || 'mcp',
      key_id: ctx.keyId,
      tipo: 'orientacao_do_cliente',
      publico: input.publico ? input.publico.slice(0, 1200) : null,
      vale_para_planejamento: input.vale_para_planejamento !== false,
      idempotency_key: input.idempotency_key,
      correlation_id: ctx.correlationId ?? null,
    },
    created_by: ctx.dataScope?.principalUserId ?? null,
  }).select('id, created_at').single();
  if (error || !data) throw new Error(`project_memory: ${error?.message ?? 'orientação não gravada'}`);
  const id = String((data as { id: string }).id);
  if (ctx.resultRefHolder) ctx.resultRefHolder.value = `project_memory:${id}`;
  return {
    ok: true,
    id,
    criado_em: (data as { created_at: string }).created_at,
    onde_fica:
      'Contexto do cliente > MCP, na Mesa. Vale para o planejamento por padrão (agente do Mês, pedido livre e gerador de meses leem as orientações ativas); a equipe pode desligar ali.',
    publico: input.publico
      ? 'O público declarado passa pelo julgamento do Jev no agente do Mês: se ele for real para o negócio, os conteúdos se adaptam e o agente propõe atualizar o público do contexto; se não for, o público registrado continua.'
      : null,
    feito_por: { via: 'mcp', principal: ctx.keyId, pessoa: ctx.dataScope?.principalUserId ?? null, correlation_id: ctx.correlationId ?? null },
  };
}
