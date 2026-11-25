// Tools para chave presa a UM projeto e UM operador (concessão em mcp_project_grants).
// Projeto, cliente e operador vêm de ctx.projectGrant, nunca dos argumentos. Sem cacheSeg de propósito:
// a URL assinada nunca pode ser reaproveitada. Escrita (envio de MP4 + pedido de revisão da agência) só
// aparece com ctx.projectGrant.videoWrite (opt-in da concessão + MCP_PROJECT_VIDEO_WRITE=true) e o banco
// reconfere chave, concessão, operador, projeto, tarefa e autoria em cada RPC.

import { z } from 'https://esm.sh/zod@3.23.8';
import type { ToolDefinition } from '../../_shared/mcp-tools.ts';
import { DataScopeError, type AuthContext } from '../../_shared/mcp-auth.ts';
import { db } from './aceleriq-read-services.ts';
import { ErroDaFerramenta } from './robustez.ts';
import {
  finalizeProjectVideo,
  IDEMPOTENCY_KEY_RE,
  listProjectFiles,
  prepareProjectVideo,
  ProjectAccessError,
  projectEntrar,
  projectIdentity,
  readApprovedFile,
  readProjectSummary,
  readProjectTasks,
  requestProjectVideoReview,
  SHA256_RE,
  VIDEO_MAX_BYTES,
  VIDEO_MIN_BYTES,
  videoErrorFromDb,
  type ProjectGrant,
  type ProjectPorts,
  type VideoPorts,
} from '../../_shared/mcp-project-access.ts';

const LEITURA = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false };
const ESCRITA = { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false };
const VIDEO_BUCKET = 'mcp-files';

const portas: ProjectPorts = {
  async tasks({ projectId, taskId, limit }) {
    let q = db().from('tasks').select('id,title,status,priority,due_date,updated_at,project_id').eq('project_id', projectId).is('deleted_at', null);
    if (taskId) q = q.eq('id', taskId);
    const { data, error } = await q.order('updated_at', { ascending: false }).limit(limit);
    if (error) throw new ProjectAccessError('unavailable', 'Leitura de tarefas indisponível.');
    return (data ?? []) as never;
  },
  async files({ projectId, clientId, fileId, limit }) {
    let q = db().from('files')
      .select('id,project_id,client_id,file_name,file_type,folder,mime_type,extension,status,approval_status,agency_approval_status,locked_at,created_at,archived_at,parent_file_id,storage_bucket,storage_path,sensitivity')
      .eq('project_id', projectId).eq('client_id', clientId).eq('status', 'ready').is('archived_at', null)
      .or('sensitivity.is.null,sensitivity.eq.normal');
    if (fileId) q = q.eq('id', fileId);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
    if (error) throw new ProjectAccessError('unavailable', 'Leitura de arquivos indisponível.');
    return (data ?? []) as never;
  },
  async project({ projectId, clientId }) {
    const { data, error } = await db().from('projects')
      .select('id,client_id,name,status,description,objectives,scope,deadline,deleted_at')
      .eq('id', projectId).eq('client_id', clientId).is('deleted_at', null).limit(1);
    if (error) throw new ProjectAccessError('unavailable', 'Leitura do projeto indisponível.');
    return ((data ?? [])[0] ?? null) as never;
  },
  async objectOwners(bucket, path) {
    // Registro canônico: quem é dono do objeto (bucket+caminho). Sem filtro de projeto/cliente de propósito:
    // se outra linha, de outro projeto, apontar para o mesmo objeto, o núcleo fecha o download.
    const { data, error } = await db().from('files').select('id,project_id,client_id')
      .eq('storage_bucket', bucket).eq('storage_path', path).limit(2);
    if (error) throw new ProjectAccessError('unavailable', 'Conferência do armazenamento indisponível.');
    return (data ?? []) as never;
  },
  async signedUrl(bucket, path, ttlSec) {
    const { data, error } = await db().storage.from(bucket).createSignedUrl(path, ttlSec);
    return error ? null : (data?.signedUrl ?? null);
  },
};

function grantDe(ctx: AuthContext): ProjectGrant {
  const g = ctx.projectGrant;
  // Fecha também se o escopo de dados não bater com a concessão (defesa em profundidade).
  if (!g || ctx.dataScope.unrestricted || ctx.dataScope.clientIds.length !== 1 || ctx.dataScope.clientIds[0] !== g.clientId) {
    throw new DataScopeError('resource is outside this MCP principal data scope');
  }
  return g;
}

async function comErroClaro<T>(fn: () => Promise<T>): Promise<T | { ok: false; codigo: string; mensagem: string }> {
  try { return await fn(); } catch (e) {
    if (e instanceof ProjectAccessError) return { ok: false, codigo: e.code, mensagem: e.message };
    throw e;
  }
}

// ─── Envio de MP4 ────────────────────────────────────────────
// A chave passada às RPCs é a da credencial AUTENTICADA (ctx.keyId); o banco deriva dela projeto, cliente,
// operador, autoria, bucket e caminho. Mensagens do banco/Storage nunca são repassadas (podem conter detalhes).

const CODIGO_DA_ESCRITA: Record<string, string> = {
  conflict: 'conflito', not_found: 'nao_encontrado', invalid_input: 'entrada_invalida', denied: 'negado', author: 'autoria',
  task: 'tarefa', expired: 'expirado', invalid_object: 'objeto_invalido', state: 'estado', unavailable: 'indisponivel',
};

async function escrita<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ProjectAccessError) {
      throw new ErroDaFerramenta(CODIGO_DA_ESCRITA[e.code] ?? e.code, e.message, null, e.code === 'unavailable');
    }
    throw e;
  }
}

async function rpc<T>(nome: string, args: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await db().rpc(nome, args);
  if (error) throw videoErrorFromDb(error.message);
  return (Array.isArray(data) ? data : data ? [data] : []) as T[];
}

async function primeiro<T>(nome: string, args: Record<string, unknown>): Promise<T> {
  const [r] = await rpc<T>(nome, args);
  if (!r) throw new ProjectAccessError('unavailable', 'Operação indisponível agora.');
  return r;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

function portasDoVideo(keyId: string): VideoPorts {
  return {
    prepare: ({ taskId, sizeBytes, sha256, idempotencyKey }) => primeiro('mcp_project_video_prepare', {
      p_api_key_id: keyId, p_task_id: taskId, p_size_bytes: sizeBytes, p_sha256: sha256, p_idempotency_key: idempotencyKey,
    }),
    async signedUploadUrl(storagePath) {
      // Sem upsert (padrão): o primeiro PUT grava; nenhum PUT posterior sobrescreve o objeto.
      try {
        const { data, error } = await db().storage.from(VIDEO_BUCKET).createSignedUploadUrl(storagePath);
        return error ? null : (data?.signedUrl ?? null);
      } catch { return null; }
    },
    async open({ uploadId, idempotencyKey }) {
      const r = await primeiro<Record<string, unknown>>('mcp_project_video_open', {
        p_api_key_id: keyId, p_upload_id: uploadId, p_idempotency_key: idempotencyKey,
      });
      return {
        status: r.status as never, storage_path: String(r.storage_path), size_bytes: Number(r.size_bytes), sha256: String(r.sha256),
        file_id: (r.file_id as string | null) ?? null, attachment_id: (r.attachment_id as string | null) ?? null,
        object_bytes: r.object_bytes == null ? null : Number(r.object_bytes),
        object_id: typeof r.object_id === 'string' ? r.object_id : null,
        object_version: typeof r.object_version === 'string' ? r.object_version : null,
      };
    },
    async inspect(storagePath) {
      try {
        const { data, error } = await db().storage.from(VIDEO_BUCKET).download(storagePath);
        if (error || !data) return null;
        const bytes = new Uint8Array(await data.arrayBuffer());
        return { size: bytes.byteLength, sha256: await sha256Hex(bytes), head: bytes.subarray(0, 64) };
      } catch { return null; }
    },
    finalize: ({ uploadId, idempotencyKey, sizeBytes, sha256, headerOk, objectId, objectVersion }) => primeiro('mcp_project_video_finalize', {
      p_api_key_id: keyId, p_upload_id: uploadId, p_idempotency_key: idempotencyKey,
      p_size_bytes: sizeBytes, p_sha256: sha256, p_header_ok: headerOk, p_object_id: objectId, p_object_version: objectVersion,
    }),
    requestReview: ({ uploadId, idempotencyKey }) => primeiro('mcp_project_video_request_review', {
      p_api_key_id: keyId, p_upload_id: uploadId, p_idempotency_key: idempotencyKey,
    }),
  };
}

function entradaDe<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input ?? {});
  if (!r.success) throw new ProjectAccessError('invalid_input', `Entrada inválida: ${r.error.issues.map((i) => i.path.join('.') || 'argumentos').join(', ')}.`);
  return r.data;
}

const idem = z.string().regex(IDEMPOTENCY_KEY_RE);
const prepararSchema = z.object({
  task_id: z.string().uuid(),
  tamanho_bytes: z.number().int().min(VIDEO_MIN_BYTES).max(VIDEO_MAX_BYTES),
  sha256: z.string().regex(SHA256_RE),
  idempotency_key: idem,
  confirmar: z.literal(true),
}).strict();
const sessaoSchema = z.object({ upload_id: z.string().uuid(), idempotency_key: idem, confirmar: z.literal(true) }).strict();

const IDEM_JSON = { type: 'string', minLength: 8, maxLength: 128, description: 'Chave de idempotência (repetir com a mesma é seguro).' };
const CONFIRMAR_JSON = { type: 'boolean', const: true, description: 'Obrigatório: true.' };

const tarefasSchema = z.object({ task_id: z.string().uuid().optional(), limite: z.number().int().min(1).max(100).optional() }).strict();
const arquivosSchema = z.object({ limite: z.number().int().min(1).max(100).optional() }).strict();
const lerSchema = z.object({ file_id: z.string().uuid() }).strict();

const FERRAMENTAS: ToolDefinition[] = [
  {
    // Mesmo nome da tool legada; só resolve com concessão (toolFor). Sem caixa, equipe, regras nem presença.
    name: 'aceleriq_escritorio_entrar',
    title: 'Entrar (credencial de projeto)',
    description: 'Só leitura. Confirma o operador fixado nesta credencial (slug em voce.slug). operator é opcional e só vale se for igual ao da credencial.',
    scopes: ['tasks:read'],
    inputSchema: { type: 'object', additionalProperties: false, properties: { operator: { type: 'string', description: 'Opcional; omitido ou igual ao operador da credencial.' } } },
    annotations: LEITURA,
    handler: (input, ctx) => comErroClaro(async () => projectEntrar(grantDe(ctx), input ?? {})),
  },
  {
    name: 'aceleriq_projeto_identidade',
    title: 'Identidade da credencial',
    description: 'Projeto, cliente e operador fixados nesta credencial. Não lista equipe, outros projetos nem clientes.',
    scopes: ['tasks:read'],
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: LEITURA,
    handler: async (_input, ctx) => projectIdentity(grantDe(ctx)),
  },
  {
    name: 'aceleriq_projeto_resumo',
    title: 'Resumo do projeto',
    description: 'Nome, status, prazo, descrição, objetivos e escopo do projeto desta credencial.',
    scopes: ['tasks:read'],
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: LEITURA,
    handler: (_input, ctx) => comErroClaro(() => readProjectSummary(portas, grantDe(ctx))),
  },
  {
    name: 'aceleriq_projeto_tarefas',
    title: 'Tarefas do projeto',
    description: 'Metadados das tarefas do projeto desta credencial (uma tarefa por task_id ou a lista).',
    scopes: ['tasks:read'],
    inputSchema: { type: 'object', additionalProperties: false, properties: { task_id: { type: 'string', format: 'uuid' }, limite: { type: 'integer', minimum: 1, maximum: 100 } } },
    annotations: LEITURA,
    handler: (input, ctx) => comErroClaro(() => readProjectTasks(portas, grantDe(ctx), tarefasSchema.parse(input ?? {}))),
  },
  {
    name: 'aceleriq_projeto_arquivos',
    title: 'Arquivos do projeto',
    description: 'Metadados dos arquivos do projeto desta credencial. Não devolve caminho de armazenamento.',
    scopes: ['files:read'],
    inputSchema: { type: 'object', additionalProperties: false, properties: { limite: { type: 'integer', minimum: 1, maximum: 100 } } },
    annotations: LEITURA,
    handler: (input, ctx) => comErroClaro(() => listProjectFiles(portas, grantDe(ctx), arquivosSchema.parse(input ?? {}))),
  },
  {
    name: 'aceleriq_projeto_arquivo_ler',
    title: 'Ler arquivo aprovado',
    description: 'URL assinada de 60 s para um arquivo do projeto aprovado pela agência e pelo cliente. Não é guardada em cache.',
    scopes: ['files:read'],
    inputSchema: { type: 'object', additionalProperties: false, required: ['file_id'], properties: { file_id: { type: 'string', format: 'uuid' } } },
    annotations: LEITURA,
    handler: (input, ctx) => comErroClaro(() => readApprovedFile(portas, grantDe(ctx), lerSchema.parse(input))),
  },
  {
    name: 'aceleriq_projeto_video_preparar',
    title: 'Preparar envio de MP4 à tarefa',
    description: 'Prepara o envio de UM MP4 (até 100 MiB) para uma tarefa viva do projeto desta credencial. Devolve upload_url (PUT único, sem sobrescrita, não guardada). Destino, autoria e projeto são definidos pelo servidor. Exige confirmar: true e idempotency_key.',
    scopes: ['files:write'],
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['task_id', 'tamanho_bytes', 'sha256', 'idempotency_key', 'confirmar'],
      properties: {
        task_id: { type: 'string', format: 'uuid' },
        tamanho_bytes: { type: 'integer', minimum: VIDEO_MIN_BYTES, maximum: VIDEO_MAX_BYTES },
        sha256: { type: 'string', pattern: '^[0-9a-f]{64}$', description: 'SHA-256 do MP4 em hexadecimal minúsculo.' },
        idempotency_key: IDEM_JSON,
        confirmar: CONFIRMAR_JSON,
      },
    },
    annotations: ESCRITA,
    handler: (input, ctx) => escrita(() => prepareProjectVideo(portasDoVideo(ctx.keyId), grantDe(ctx), entradaDe(prepararSchema, input))),
  },
  {
    name: 'aceleriq_projeto_video_finalizar',
    title: 'Finalizar envio de MP4',
    description: 'Confere o MP4 enviado (tamanho, sha256 e formato) e o registra como arquivo do projeto e anexo da tarefa, com autoria do agente. Repetir devolve o mesmo resultado. Não pede aprovação.',
    scopes: ['files:write'],
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['upload_id', 'idempotency_key', 'confirmar'],
      properties: { upload_id: { type: 'string', format: 'uuid' }, idempotency_key: IDEM_JSON, confirmar: CONFIRMAR_JSON },
    },
    annotations: ESCRITA,
    handler: (input, ctx) => escrita(() => finalizeProjectVideo(portasDoVideo(ctx.keyId), grantDe(ctx), entradaDe(sessaoSchema, input))),
  },
  {
    name: 'aceleriq_projeto_video_pedir_aprovacao',
    title: 'Pedir revisão da agência',
    description: 'Pede a revisão HUMANA da agência (Gate 1) só para o MP4 deste envio. Não aprova, não libera ao cliente, não agenda, não publica e não notifica fora do painel.',
    scopes: ['files:write'],
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['upload_id', 'idempotency_key', 'confirmar'],
      properties: { upload_id: { type: 'string', format: 'uuid' }, idempotency_key: IDEM_JSON, confirmar: CONFIRMAR_JSON },
    },
    annotations: ESCRITA,
    handler: (input, ctx) => escrita(() => requestProjectVideoReview(portasDoVideo(ctx.keyId), grantDe(ctx), entradaDe(sessaoSchema, input))),
  },
];

export const FERRAMENTAS_DO_PROJETO_RESTRITO: readonly ToolDefinition[] = FERRAMENTAS;
