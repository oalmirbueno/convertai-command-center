/**
 * Reabre ou reagenda uma publicação editorial como a pessoa conectada.
 * A regra continua em transition_editorial_publication (auth.uid()).
 */

import { z } from 'https://esm.sh/zod@3.23.8';
import type { ToolDefinition } from '../../_shared/mcp-tools.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { DataScopeError } from '../../_shared/mcp-auth.ts';
import { dataScopeAllowsClient } from '../../_shared/mcp-security.ts';
import { db } from '../../_shared/aceleriq-read-services.ts';
import { rpcComoPessoa } from '../../_shared/mcp-mesas-acoes.ts';

const UUID = z.string().uuid();
const ESCRITA = { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false };

export const reagendarSchema = z.object({
  publication_id: UUID,
  acao: z.enum(['reopen', 'schedule']),
  expected_version: z.number().int().min(0),
  scheduled_at: z.string().datetime({ offset: true }).optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
}).strict().superRefine((valor, ctx) => {
  if (valor.acao === 'schedule' && !valor.scheduled_at) {
    ctx.addIssue({ code: 'custom', path: ['scheduled_at'], message: 'schedule exige scheduled_at.' });
  }
});

export async function reagendarPublicacao(
  input: z.infer<typeof reagendarSchema>,
  ctx: AuthContext,
) {
  const { data, error } = await db()
    .from('editorial_publications')
    .select('id, client_id, status, version')
    .eq('id', input.publication_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const pub = data as { id: string; client_id: string; status: string; version: number } | null;
  if (!pub) throw new Error('Publicação não encontrada.');
  if (!dataScopeAllowsClient(ctx.dataScope, pub.client_id)) {
    throw new DataScopeError('resource is outside this MCP principal data scope');
  }
  if (ctx.resultRefHolder) ctx.resultRefHolder.value = `editorial_publications:${pub.id}`;
  const resultado = await rpcComoPessoa('transition_editorial_publication', {
    p_publication_id: pub.id,
    p_action: input.acao,
    p_expected_version: input.expected_version,
    p_scheduled_at: input.scheduled_at ?? null,
    p_timezone: input.timezone ?? null,
  }, ctx);
  return { ok: true, publicacao: resultado, client_id: pub.client_id };
}

const tool: ToolDefinition = {
  name: 'aceleriq_reagendar_publicacao',
  title: 'Reagendar publicação',
  description:
    'Reabre (reopen) ou agenda (schedule) uma publicação editorial pela transição oficial. Publicação cancelada da mesma conta volta a planned sem inserir outra linha. Exige editorial:write e o cliente no escopo. Não publica sozinha.',
  scopes: ['editorial:write'],
  annotations: ESCRITA,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['publication_id', 'acao', 'expected_version'],
    properties: {
      publication_id: { type: 'string', format: 'uuid' },
      acao: { type: 'string', enum: ['reopen', 'schedule'] },
      expected_version: { type: 'integer', minimum: 0 },
      scheduled_at: { type: 'string', description: 'Obrigatório em schedule. ISO 8601 com fuso.' },
      timezone: { type: 'string', description: 'Fuso IANA. Ex.: America/Sao_Paulo.' },
    },
  },
  handler: async (input, ctx) => {
    const parsed = reagendarSchema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    return await reagendarPublicacao(parsed.data, ctx);
  },
};

export const FERRAMENTA_DE_REAGENDAR: readonly ToolDefinition[] = [tool];
