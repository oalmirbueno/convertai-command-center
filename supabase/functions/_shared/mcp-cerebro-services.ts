/**
 * Cérebro do cliente pelo MCP: ler (o que o cliente já ensinou, por área) e
 * registrar (um aprendizado novo, sem duplicar). As regras moram em
 * cerebro-do-cliente.ts; aqui ficam a fronteira do cliente, o banco e o Jev.
 *
 * Escrita pelo MCP roda com a chave de serviço (como as outras escritas do
 * MCP legado), então a fronteira é conferida aqui antes de tocar no banco:
 * UUID válido, cliente dentro do escopo do principal e cliente existente.
 */

import { db, isUuid } from './aceleriq-read-services.ts';
import { assertClientAccess, type AuthContext } from './mcp-auth.ts';
import { exigirClienteExistente } from './mcp-client-id-guard.ts';
import { findIdempotentResult } from './mcp-write-services.ts';
import { jevPerguntar } from './jev.ts';
import {
  AREAS_DO_CEREBRO,
  CerebroErro,
  lerCerebro,
  registrarAprendizado,
  resumoParaPrompt,
  resumoPorArea,
  type AreaDoCerebro,
  type CategoriaDoCerebro,
  type JulgarAprendizado,
} from './cerebro-do-cliente.ts';

async function conferirCliente(clientId: string, ctx: AuthContext) {
  if (!isUuid(clientId)) throw new Error('client_id must be a UUID');
  assertClientAccess(ctx, clientId);
  await exigirClienteExistente(db(), clientId);
}

export async function cerebroLer(
  input: { client_id: string; area?: AreaDoCerebro; limite_caracteres?: number; incluir_fatos?: boolean },
  ctx: AuthContext,
) {
  await conferirCliente(input.client_id, ctx);
  const leitura = await lerCerebro(db(), input.client_id);
  const limite = input.limite_caracteres;
  const doPedido = input.area
    ? resumoParaPrompt(leitura.fatos, { areas: [input.area], limite })
    : null;
  const fatos = input.area
    ? leitura.fatos.filter((f) => f.area === input.area || f.area === 'geral')
    : leitura.fatos;
  return {
    client_id: input.client_id,
    area: input.area ?? null,
    como_usar:
      'O resumo é o que entra no prompt de cada agente (teto de caracteres, regra do dono primeiro, mais reforçado antes). Regra do dono (evitar, preferência, ajuste) vale sobre sugestão sua; o que performou tem número e período, não generalize além disso. Para ensinar algo novo, use aceleriq_cerebro_registrar: repetido vira reforço, contraditório aposenta o antigo.',
    resumo: doPedido ? doPedido.texto : null,
    resumo_por_area: input.area ? null : resumoPorArea(leitura.fatos, limite),
    totais: {
      fatos: fatos.length,
      por_area: Object.fromEntries(AREAS_DO_CEREBRO.map((a) => [a, leitura.fatos.filter((f) => f.area === a).length])),
      fontes: leitura.fontes,
    },
    fatos: input.incluir_fatos === false ? undefined : fatos.slice(0, 150),
    avisos: leitura.avisos,
  };
}

/** O Jev como juiz de "repete ou contradiz"; sem chave, a escrita segue só com a regra de texto igual. */
const julgarComJev: JulgarAprendizado = async (state, questions) => {
  const r = await jevPerguntar({ state, questions }, { timeoutMs: 12_000 });
  return r.answers as Record<string, { choice?: string; probabilities?: Record<string, number>; confidence?: number }>;
};

export async function cerebroRegistrar(
  input: {
    client_id: string;
    area: AreaDoCerebro;
    categoria: CategoriaDoCerebro;
    texto: string;
    motivo?: string;
    evidencia?: string;
    referencia_id?: string;
    valido_dias?: number | null;
    idempotency_key: string;
  },
  ctx: AuthContext,
) {
  await conferirCliente(input.client_id, ctx);
  const anterior = await findIdempotentResult('aceleriq_cerebro_registrar', ctx.keyId, input.idempotency_key).catch(() => null);
  if (anterior) {
    return {
      ok: true,
      replay: true,
      idempotency_replay_of: anterior.correlationId,
      ref: anterior.resultRef,
      aviso: 'Esta idempotency_key já foi usada com sucesso: nada foi gravado de novo.',
    };
  }
  try {
    const r = await registrarAprendizado(db(), {
      client_id: input.client_id,
      area: input.area,
      categoria: input.categoria,
      texto: input.texto,
      motivo: input.motivo ?? null,
      evidencia: input.evidencia ?? null,
      referencia_id: input.referencia_id ?? null,
      valido_dias: input.valido_dias,
      fonte: 'mcp',
      criado_por: ctx.dataScope?.principalUserId ?? null,
    }, { julgar: julgarComJev });
    if (ctx.resultRefHolder && r.id) ctx.resultRefHolder.value = `agente_memoria:${r.id}`;
    return {
      ok: true,
      ...r,
      onde_fica: `agente_memoria (agente ${r.agente}): entra no prompt do agente desta área na próxima execução.`,
      feito_por: { via: 'mcp', principal: ctx.keyId, pessoa: ctx.dataScope?.principalUserId ?? null, correlation_id: ctx.correlationId ?? null },
    };
  } catch (e) {
    if (e instanceof CerebroErro) throw new Error(`cerebro:${e.codigo} ${e.message}`);
    throw e;
  }
}
