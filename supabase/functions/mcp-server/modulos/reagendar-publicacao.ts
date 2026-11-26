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
import { rpcComoPessoa, umaVez } from '../../_shared/mcp-mesas-acoes.ts';
import { audioDaEntrada, ESQUEMA_AUDIO_CONFIGURATION, gravarAudioDaPublicacao } from './audio-instagram.ts';
import type { AudioConfiguration } from './audio-instagram-regras.ts';

const UUID = z.string().uuid();
const ESCRITA = { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false };

export const reagendarSchema = z.object({
  publication_id: UUID,
  expected_version: z.number().int().min(0),
  scheduled_at: z.string().datetime({ offset: true }),
  timezone: z.string().trim().min(1).max(80).optional(),
  confirmar: z.literal(true),
  idempotency_key: z.string().trim().min(8).max(120),
  // MCP 2.39.3: opcional, só Reel do Instagram (regras em audio-instagram-regras.ts). Ausente = igual a antes.
  audio_configuration: z.unknown().optional(),
}).strict();

/** MCP 2.39.3: o teste troca a leitura e as RPCs; sem deps, o caminho é o de sempre. */
export interface DependenciasDoReagendar {
  // deno-lint-ignore no-explicit-any
  banco: { from(tabela: string): any };
  rpc: (nome: string, args: Record<string, unknown>, ctx: AuthContext) => Promise<unknown>;
  umaVez: typeof umaVez;
}

export async function reagendarPublicacao(
  input: z.infer<typeof reagendarSchema>,
  ctx: AuthContext,
  deps: DependenciasDoReagendar = { banco: db(), rpc: rpcComoPessoa as unknown as DependenciasDoReagendar['rpc'], umaVez },
) {
  const { data, error } = await deps.banco
    .from('editorial_publications')
    .select('id, client_id, status, version')
    .eq('id', input.publication_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const pub = data as { id: string; client_id: string; status: string; version: number } | null;
  if (!pub) throw new Error('Publicação não encontrada.');
  if (pub.status === 'cancelled') {
    throw new Error('Publicação cancelada não reabre por agente. Um admin ou gestor marca a conta na Agenda.');
  }
  if (!dataScopeAllowsClient(ctx.dataScope, pub.client_id)) {
    throw new DataScopeError('resource is outside this MCP principal data scope');
  }
  // MCP 2.39.3: com audio_configuration, confere Reel e Instagram ANTES de agendar; sem ele, nada a mais é lido.
  let audio: AudioConfiguration | null = null;
  if (input.audio_configuration !== undefined) {
    const alvo = await deps.banco.from('editorial_publications').select('id, post_id, platform').eq('id', pub.id).maybeSingle();
    if (alvo.error || !alvo.data) throw new Error('Não foi possível ler a publicação agora. Tente de novo.');
    const post = await deps.banco.from('editorial_posts').select('id, content_type').eq('id', (alvo.data as { post_id: string }).post_id).maybeSingle();
    if (post.error || !post.data) throw new Error('Não foi possível ler o post da publicação agora. Tente de novo.');
    audio = audioDaEntrada(input.audio_configuration, {
      content_type: (post.data as { content_type: string | null }).content_type,
      platform: (alvo.data as { platform: string }).platform,
    });
  }
  return await deps.umaVez('aceleriq_reagendar_publicacao', ctx, input.idempotency_key, async () => {
    if (ctx.resultRefHolder) ctx.resultRefHolder.value = `editorial_publications:${pub.id}`;
    const resultado = await deps.rpc('transition_editorial_publication', {
      p_publication_id: pub.id,
      p_action: 'schedule',
      p_expected_version: input.expected_version,
      p_scheduled_at: input.scheduled_at,
      p_timezone: input.timezone ?? null,
    }, ctx);
    return {
      ref: `editorial_publications:${pub.id}`,
      resultado: {
        publicacao: resultado,
        client_id: pub.client_id,
        ...(audio ? { audio: await gravarAudioDaPublicacao(pub.id, audio, ctx, deps.rpc) } : {}),
      },
    };
  });
}

const tool: ToolDefinition = {
  name: 'aceleriq_reagendar_publicacao',
  title: 'Reagendar publicação',
  description:
    'Agenda (schedule) uma publicação que não está cancelada, pela transição oficial. Publicação cancelada não reabre por aqui: isso é ação humana na Agenda. audio_configuration opcional (2.39.3): só Reel do Instagram, grava o áudio da Meta na publicação. Exige confirmar=true, idempotency_key, editorial:write e o cliente no escopo.',
  scopes: ['editorial:write'],
  annotations: ESCRITA,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['publication_id', 'expected_version', 'scheduled_at', 'confirmar', 'idempotency_key'],
    properties: {
      publication_id: { type: 'string', format: 'uuid' },
      expected_version: { type: 'integer', minimum: 0 },
      scheduled_at: { type: 'string', description: 'ISO 8601 com fuso.' },
      timezone: { type: 'string', description: 'Fuso IANA. Ex.: America/Sao_Paulo.' },
      confirmar: { type: 'boolean', const: true, description: 'Tem que ser true: muda o horário que o cliente pode ver.' },
      idempotency_key: { type: 'string', description: 'Chave estável de 8 a 120 caracteres. Repetir não agenda de novo.' },
      audio_configuration: ESQUEMA_AUDIO_CONFIGURATION,
    },
  },
  handler: async (input, ctx) => {
    const parsed = reagendarSchema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    return await reagendarPublicacao(parsed.data, ctx);
  },
};

export const FERRAMENTA_DE_REAGENDAR: readonly ToolDefinition[] = [tool];
