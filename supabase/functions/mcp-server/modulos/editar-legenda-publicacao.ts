/**
 * Ajustes em conteúdo já aprovado, como a pessoa conectada, sem derrubar a
 * aprovação e sem criar revisão. A regra fica nas RPCs (auth.uid(), admin ou
 * gestor do cliente, versão esperada, auditoria com o antes e o depois):
 *
 * - aceleriq_editar_legenda_publicacao: editar_legenda_publicacao_aprovada.
 * - aceleriq_ajustar_formato_publicacao: ajustar_formato_publicacao_aprovada.
 *   A RPC troca o formato do conteúdo e o tipo da tarefa vinculada na mesma
 *   transação (as duas guardas se travam uma na outra), então o agente nunca
 *   mexe na tarefa por fora para "destravar" o formato.
 */

import { z } from 'https://esm.sh/zod@3.23.8';
import type { ToolDefinition } from '../../_shared/mcp-tools.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { DataScopeError } from '../../_shared/mcp-auth.ts';
import { dataScopeAllowsClient } from '../../_shared/mcp-security.ts';
import { db } from '../../_shared/aceleriq-read-services.ts';
import { rpcComoPessoa, umaVez } from '../../_shared/mcp-mesas-acoes.ts';

const UUID = z.string().uuid();
const ESCRITA = { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false };

/** Limite de legenda do Instagram; a RPC confere de novo. */
export const LIMITE_DA_LEGENDA = 2200;

export const editarLegendaSchema = z.object({
  publication_id: UUID,
  expected_version: z.number().int().min(0),
  caption: z.string().trim().min(1).max(LIMITE_DA_LEGENDA),
  confirmar: z.literal(true),
  idempotency_key: z.string().trim().min(8).max(120),
}).strict();

const STATUS_EDITAVEIS = new Set(['planned', 'scheduled']);

export async function editarLegendaPublicacao(
  input: z.infer<typeof editarLegendaSchema>,
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
  if (!STATUS_EDITAVEIS.has(pub.status)) {
    throw new Error('Só dá para editar a legenda de publicação planejada ou agendada. Publicada, com falha ou cancelada não muda por aqui.');
  }
  return await umaVez('aceleriq_editar_legenda_publicacao', ctx, input.idempotency_key, async () => {
    if (ctx.resultRefHolder) ctx.resultRefHolder.value = `editorial_publications:${pub.id}`;
    const resultado = await rpcComoPessoa('editar_legenda_publicacao_aprovada', {
      p_publication_id: pub.id,
      p_expected_version: input.expected_version,
      p_caption: input.caption,
    }, ctx);
    return { ref: `editorial_publications:${pub.id}`, resultado: { publicacao: resultado, client_id: pub.client_id } };
  });
}

const tool: ToolDefinition = {
  name: 'aceleriq_editar_legenda_publicacao',
  title: 'Editar legenda de publicação aprovada',
  description:
    'Troca só a legenda de uma publicação planejada ou agendada que já foi aprovada, sem criar revisão e sem derrubar a aprovação. Muda a legenda que vai ao ar e a legenda base do conteúdo; horário, formato, conta e aprovação ficam iguais. Fica registrado quem editou e a legenda antes e depois, e a Agenda mostra "Legenda editada após aprovação". Publicada, com falha ou cancelada não muda. Exige confirmar=true, idempotency_key, expected_version (versão atual da publicação), editorial:write, papel de admin ou gestor do cliente e o cliente no escopo.',
  scopes: ['editorial:write'],
  annotations: ESCRITA,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['publication_id', 'expected_version', 'caption', 'confirmar', 'idempotency_key'],
    properties: {
      publication_id: { type: 'string', format: 'uuid' },
      expected_version: { type: 'integer', minimum: 0, description: 'Versão atual da publicação (editorial_publications.version).' },
      caption: { type: 'string', minLength: 1, maxLength: LIMITE_DA_LEGENDA, description: 'Legenda nova, completa. Até 2.200 caracteres.' },
      confirmar: { type: 'boolean', const: true, description: 'Tem que ser true: muda o texto que o cliente aprovou e que vai ao ar.' },
      idempotency_key: { type: 'string', description: 'Chave estável de 8 a 120 caracteres. Repetir não edita de novo.' },
    },
  },
  handler: async (input, ctx) => {
    const parsed = editarLegendaSchema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    return await editarLegendaPublicacao(parsed.data, ctx);
  },
};

export const FERRAMENTA_DE_EDITAR_LEGENDA: readonly ToolDefinition[] = [tool];

// ------------------------------------------------------------ formato

/** Peça única: os formatos que a RPC aceita. Carrossel não entra. */
export const FORMATOS_DE_PECA_UNICA = ['static', 'story', 'reel', 'video'] as const;

export const ajustarFormatoSchema = z.object({
  post_id: UUID,
  expected_version: z.number().int().min(0),
  content_type: z.enum(FORMATOS_DE_PECA_UNICA),
  confirmar: z.literal(true),
  idempotency_key: z.string().trim().min(8).max(120),
}).strict();

export async function ajustarFormatoPublicacao(
  input: z.infer<typeof ajustarFormatoSchema>,
  ctx: AuthContext,
) {
  const { data, error } = await db()
    .from('editorial_posts')
    .select('id, client_id, content_type, version, archived_at')
    .eq('id', input.post_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const post = data as { id: string; client_id: string; content_type: string; version: number; archived_at: string | null } | null;
  if (!post) throw new Error('Conteúdo não encontrado.');
  if (!dataScopeAllowsClient(ctx.dataScope, post.client_id)) {
    throw new DataScopeError('resource is outside this MCP principal data scope');
  }
  if (post.archived_at) throw new Error('Conteúdo indisponível.');
  if (!(FORMATOS_DE_PECA_UNICA as readonly string[]).includes(post.content_type)) {
    throw new Error('Só peça única troca de formato aqui. Carrossel não vira Story.');
  }
  return await umaVez('aceleriq_ajustar_formato_publicacao', ctx, input.idempotency_key, async () => {
    if (ctx.resultRefHolder) ctx.resultRefHolder.value = `editorial_posts:${post.id}`;
    const resultado = await rpcComoPessoa('ajustar_formato_publicacao_aprovada', {
      p_post_id: post.id,
      p_expected_version: input.expected_version,
      p_content_type: input.content_type,
    }, ctx);
    return { ref: `editorial_posts:${post.id}`, resultado: { conteudo: resultado, client_id: post.client_id } };
  });
}

const ferramentaDeFormato: ToolDefinition = {
  name: 'aceleriq_ajustar_formato_publicacao',
  title: 'Ajustar formato de conteúdo aprovado',
  description:
    'Troca só o formato de um conteúdo aprovado de peça única, sem criar revisão e sem derrubar a aprovação: static (post no feed), story, reel ou video. Imagem vai para static ou story; vídeo vai para reel, video ou story; carrossel não troca. O formato do conteúdo e o tipo da tarefa vinculada mudam juntos, na mesma transação: não altere a tarefa por fora. Horário, conta, legenda e aprovação ficam iguais, e fica registrado quem ajustou e o formato antes e depois. Recusa conteúdo com publicação publicada ou com falha e conteúdo com envio em andamento. Exige confirmar=true, idempotency_key, expected_version (versão atual do conteúdo, editorial_posts.version), editorial:write, papel de admin ou gestor do cliente e o cliente no escopo.',
  scopes: ['editorial:write'],
  annotations: ESCRITA,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['post_id', 'expected_version', 'content_type', 'confirmar', 'idempotency_key'],
    properties: {
      post_id: { type: 'string', format: 'uuid', description: 'Id do conteúdo (editorial_posts.id), não da publicação.' },
      expected_version: { type: 'integer', minimum: 0, description: 'Versão atual do conteúdo (editorial_posts.version).' },
      content_type: { type: 'string', enum: [...FORMATOS_DE_PECA_UNICA], description: 'Formato novo: static, story, reel ou video.' },
      confirmar: { type: 'boolean', const: true, description: 'Tem que ser true: muda onde a peça aprovada vai sair (feed ou Story).' },
      idempotency_key: { type: 'string', description: 'Chave estável de 8 a 120 caracteres. Repetir não ajusta de novo.' },
    },
  },
  handler: async (input, ctx) => {
    const parsed = ajustarFormatoSchema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    return await ajustarFormatoPublicacao(parsed.data, ctx);
  },
};

export const FERRAMENTA_DE_AJUSTAR_FORMATO: readonly ToolDefinition[] = [ferramentaDeFormato];
