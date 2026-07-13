// Tool registry for the MCP server.
// Round 2: foundation tools (aceleriq_health, aceleriq_capabilities).
// Round 3: read-only tools over existing Aceleriq OS data.
// Never mutates data. Never touches api-gateway.

import { z } from 'https://esm.sh/zod@3.23.8';
import type { AuthContext } from './mcp-auth.ts';
import {
  ALLOWED_ENTITY_TYPES,
  fetchEntity,
  getBriefing,
  getClientContext,
  getFile as getPanelFile,
  getProject,
  getReport,
  getWorkspaceNode,
  listBriefings,
  listClients,
  listFiles,
  listProjects,
  listReports,
  listTasks,
  listWorkspaceNodes,
  search,
} from './aceleriq-read-services.ts';
import {
  bridgeStatus,
  CONTEXT_ORDER,
  getContextBundle,
  getFile,
  INBOX_PREFIX,
  listInboxPending,
  proposeUpdate,
  searchCode,
  SecondBrainError,
} from './second-brain-github.ts';
import {
  completeTask,
  completeTaskSchema,
  createReportDraft,
  createReportDraftSchema,
  createTask,
  createTaskSchema,
  updateProject,
  updateProjectSchema,
  updateTask,
  updateTaskSchema,
  WriteError,
} from './mcp-write-services.ts';

export type ToolScope =
  | 'aceleriq:read'
  | 'aceleriq:write'
  | 'aceleriq:finance'
  | 'memory:read'
  | 'memory:propose'
  | 'admin';

export const ALL_SCOPES: readonly ToolScope[] = [
  'aceleriq:read',
  'aceleriq:write',
  'aceleriq:finance',
  'memory:read',
  'memory:propose',
  'admin',
] as const;

export interface ToolDefinition {
  name: string;
  title?: string;
  description: string;
  scopes: readonly ToolScope[]; // any-of; empty = public to authenticated
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  handler: (input: unknown, ctx: AuthContext) => Promise<unknown>;
}

// Single source of truth for the MCP server version. Bumped whenever the
// tool surface changes materially. No `-read` suffix: the server exposes
// read, memory, and scope-gated write tools.
export const SERVER_INFO = {
  name: 'aceleriq-mcp',
  title: 'Aceleriq OS MCP',
  version: '1.3.0',
} as const;

// ─── Helpers ──────────────────────────────────────────────────
const READ: readonly ToolScope[] = ['aceleriq:read'];
const READ_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

function makeRead(
  name: string,
  title: string,
  description: string,
  schema: z.ZodTypeAny,
  jsonSchema: Record<string, unknown>,
  fn: (input: any, ctx: AuthContext) => Promise<unknown>,
): ToolDefinition {
  return {
    name,
    title,
    description,
    scopes: READ,
    annotations: READ_ANNOTATIONS,
    inputSchema: jsonSchema,
    handler: async (input, ctx) => {
      const parsed = schema.safeParse(input ?? {});
      if (!parsed.success) {
        throw new Error(`Invalid input: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
      }
      return await fn(parsed.data, ctx);
    },
  };
}

const UUID = z.string().uuid();

// ─── Foundation tools (round 2) ───────────────────────────────
const healthTool: ToolDefinition = {
  name: 'aceleriq_health',
  title: 'Aceleriq health',
  description:
    'Verifica se o servidor MCP do Aceleriq OS está acessível. Retorna hora do servidor, nome da chave e escopos concedidos. Sem efeitos colaterais.',
  scopes: [],
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: READ_ANNOTATIONS,
  handler: (_input, ctx) => Promise.resolve({
    ok: true,
    server: SERVER_INFO.name,
    version: SERVER_INFO.version,
    now: new Date().toISOString(),
    key: { id: ctx.keyId, name: ctx.keyName, origin: ctx.origin },
    scopes: ctx.scopes,
  }),
};

const capabilitiesTool: ToolDefinition = {
  name: 'aceleriq_capabilities',
  title: 'Aceleriq capabilities',
  description:
    'Descreve o servidor MCP: tools disponíveis para esta chave, escopos concedidos, escopos suportados, contagens agregadas e status do Segundo Cérebro (server-side).',
  scopes: [],
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: READ_ANNOTATIONS,
  handler: (_input, ctx) => {
    const visible = TOOLS
      .filter(t => canInvoke(ctx, t))
      .map(t => ({ name: t.name, description: t.description, requiredScopes: t.scopes }));
    const counts = {
      total: TOOLS.length,
      visible: visible.length,
      read: TOOLS.filter(t => t.scopes.includes('aceleriq:read')).length,
      write: TOOLS.filter(t => t.scopes.includes('aceleriq:write')).length,
      memory_read: TOOLS.filter(t => t.scopes.includes('memory:read')).length,
      memory_propose: TOOLS.filter(t => t.scopes.includes('memory:propose')).length,
      public: TOOLS.filter(t => t.scopes.length === 0).length,
    };
    return Promise.resolve({
      server: SERVER_INFO,
      protocolVersion: '2025-06-18',
      grantedScopes: ctx.scopes,
      supportedScopes: ALL_SCOPES,
      counts,
      secondBrain: bridgeStatus(),
      tools: visible,
    });
  },
};

// ─── Read-only tools (round 3) ────────────────────────────────
const listClientsTool = makeRead(
  'aceleriq_list_clients',
  'Listar clientes',
  'Lista clientes reais do Aceleriq OS (user_roles.role = client + profiles). Suporta busca por nome, empresa ou email, paginação e limite. Consulta somente dados existentes.',
  z.object({
    query: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).optional(),
  }).strict(),
  {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Termo de busca em nome/empresa/email.' },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 25 },
      offset: { type: 'integer', minimum: 0, default: 0 },
    },
    additionalProperties: false,
  },
  (input) => listClients(input),
);

const getClientContextTool = makeRead(
  'aceleriq_get_client_context',
  'Contexto consolidado de cliente',
  'Consolida dados existentes de um cliente: perfil, projetos, tarefas abertas, marcos próximos, briefings, relatórios, arquivos recentes e solicitações. Não altera nenhum registro.',
  z.object({ client_id: UUID }).strict(),
  {
    type: 'object',
    properties: { client_id: { type: 'string', format: 'uuid' } },
    required: ['client_id'],
    additionalProperties: false,
  },
  (input) => getClientContext(input),
);

const listProjectsTool = makeRead(
  'aceleriq_list_projects',
  'Listar projetos',
  'Lista projetos existentes com filtros por cliente, status e busca textual (nome/descrição).',
  z.object({
    client_id: UUID.optional(),
    status: z.string().max(64).optional(),
    query: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).optional(),
  }).strict(),
  {
    type: 'object',
    properties: {
      client_id: { type: 'string', format: 'uuid' },
      status: { type: 'string' },
      query: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 },
    },
    additionalProperties: false,
  },
  (input) => listProjects(input),
);

const getProjectTool = makeRead(
  'aceleriq_get_project',
  'Detalhes de projeto',
  'Retorna projeto, marcos, tarefas, arquivos recentes e relatórios associados.',
  z.object({ project_id: UUID }).strict(),
  {
    type: 'object',
    properties: { project_id: { type: 'string', format: 'uuid' } },
    required: ['project_id'],
    additionalProperties: false,
  },
  (input) => getProject(input),
);

const listTasksTool = makeRead(
  'aceleriq_list_tasks',
  'Listar tarefas',
  'Lista tarefas com filtros por projeto, cliente (via projetos), status, responsável ou apenas abertas.',
  z.object({
    project_id: UUID.optional(),
    client_id: UUID.optional(),
    status: z.string().max(64).optional(),
    assigned_to: UUID.optional(),
    only_open: z.boolean().optional(),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).optional(),
  }).strict(),
  {
    type: 'object',
    properties: {
      project_id: { type: 'string', format: 'uuid' },
      client_id: { type: 'string', format: 'uuid' },
      status: { type: 'string' },
      assigned_to: { type: 'string', format: 'uuid' },
      only_open: { type: 'boolean' },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 },
    },
    additionalProperties: false,
  },
  (input) => listTasks(input),
);

const listReportsTool = makeRead(
  'aceleriq_list_reports',
  'Listar relatórios',
  'Lista relatórios (metadados) filtrando por cliente ou projeto. Use aceleriq_get_report para o conteúdo completo.',
  z.object({
    client_id: UUID.optional(),
    project_id: UUID.optional(),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).optional(),
  }).strict(),
  {
    type: 'object',
    properties: {
      client_id: { type: 'string', format: 'uuid' },
      project_id: { type: 'string', format: 'uuid' },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 },
    },
    additionalProperties: false,
  },
  (input) => listReports(input),
);

const getReportTool = makeRead(
  'aceleriq_get_report',
  'Detalhes de relatório',
  'Retorna um relatório com métricas, highlights, próximos passos e mídias. Notas internas não são expostas.',
  z.object({ report_id: UUID }).strict(),
  {
    type: 'object',
    properties: { report_id: { type: 'string', format: 'uuid' } },
    required: ['report_id'],
    additionalProperties: false,
  },
  (input) => getReport(input),
);

const listBriefingsTool = makeRead(
  'aceleriq_list_briefings',
  'Listar briefings',
  'Lista briefings existentes com filtros por cliente, projeto ou status de envio.',
  z.object({
    client_id: UUID.optional(),
    project_id: UUID.optional(),
    submitted: z.boolean().optional(),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).optional(),
  }).strict(),
  {
    type: 'object',
    properties: {
      client_id: { type: 'string', format: 'uuid' },
      project_id: { type: 'string', format: 'uuid' },
      submitted: { type: 'boolean' },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 },
    },
    additionalProperties: false,
  },
  (input) => listBriefings(input),
);

const getBriefingTool = makeRead(
  'aceleriq_get_briefing',
  'Detalhes de briefing',
  'Retorna um briefing com as respostas do cliente.',
  z.object({ briefing_id: UUID }).strict(),
  {
    type: 'object',
    properties: { briefing_id: { type: 'string', format: 'uuid' } },
    required: ['briefing_id'],
    additionalProperties: false,
  },
  (input) => getBriefing(input),
);

const listWorkspaceNodesTool = makeRead(
  'aceleriq_list_workspace_nodes',
  'Listar nós do workspace',
  'Lista nós do workspace (arquivos, pastas, vídeos) com filtros por pasta pai, cliente, escopo e tipo. Não retorna URLs assinadas de storage.',
  z.object({
    parent_id: UUID.nullable().optional(),
    client_id: UUID.optional(),
    scope: z.string().max(64).optional(),
    kind: z.string().max(64).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).optional(),
  }).strict(),
  {
    type: 'object',
    properties: {
      parent_id: { type: ['string', 'null'], format: 'uuid' },
      client_id: { type: 'string', format: 'uuid' },
      scope: { type: 'string' },
      kind: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 },
    },
    additionalProperties: false,
  },
  (input) => listWorkspaceNodes(input),
);

const getWorkspaceNodeTool = makeRead(
  'aceleriq_get_workspace_node',
  'Detalhes de nó do workspace',
  'Retorna metadados de um nó do workspace pelo ID.',
  z.object({ node_id: UUID }).strict(),
  {
    type: 'object',
    properties: { node_id: { type: 'string', format: 'uuid' } },
    required: ['node_id'],
    additionalProperties: false,
  },
  (input) => getWorkspaceNode(input),
);

const listFilesTool = makeRead(
  'aceleriq_list_files',
  'Listar arquivos',
  'Lista arquivos de entregas/aprovação com filtros por cliente, projeto, pasta e status de aprovação.',
  z.object({
    client_id: UUID.optional(),
    project_id: UUID.optional(),
    folder: z.string().max(128).optional(),
    approval_status: z.string().max(64).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).optional(),
  }).strict(),
  {
    type: 'object',
    properties: {
      client_id: { type: 'string', format: 'uuid' },
      project_id: { type: 'string', format: 'uuid' },
      folder: { type: 'string' },
      approval_status: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 },
    },
    additionalProperties: false,
  },
  (input) => listFiles(input),
);

const searchTool = makeRead(
  'aceleriq_search',
  'Busca global',
  'Pesquisa textual apenas nas entidades autorizadas do Aceleriq OS: clientes, projetos, tarefas, relatórios, workspace, arquivos, solicitações, marcos. Financeiro não é incluído.',
  z.object({
    query: z.string().min(1).max(200),
    entities: z.array(z.enum(ALLOWED_ENTITY_TYPES as unknown as [string, ...string[]])).max(9).optional(),
    limit_per_entity: z.number().int().min(1).max(10).optional(),
  }).strict(),
  {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1 },
      entities: {
        type: 'array',
        items: { type: 'string', enum: [...ALLOWED_ENTITY_TYPES] },
      },
      limit_per_entity: { type: 'integer', minimum: 1, maximum: 10, default: 10 },
    },
    required: ['query'],
    additionalProperties: false,
  },
  (input) => search(input),
);

const fetchTool = makeRead(
  'aceleriq_fetch',
  'Buscar entidade por ID',
  'Retorna uma entidade pelo tipo e ID. Tipos permitidos: client, project, task, briefing, report, workspace_node, file, client_request, milestone.',
  z.object({
    type: z.enum(ALLOWED_ENTITY_TYPES as unknown as [string, ...string[]]),
    id: UUID,
  }).strict(),
  {
    type: 'object',
    properties: {
      type: { type: 'string', enum: [...ALLOWED_ENTITY_TYPES] },
      id: { type: 'string', format: 'uuid' },
    },
    required: ['type', 'id'],
    additionalProperties: false,
  },
  (input) => fetchEntity(input),
);

// ─── Second Brain (round 4) ───────────────────────────────────
const MEMORY_READ: readonly ToolScope[] = ['memory:read'];
const MEMORY_PROPOSE: readonly ToolScope[] = ['memory:propose'];

function memoryError(e: unknown): Error {
  if (e instanceof SecondBrainError) {
    return new Error(`second_brain:${e.error.kind} ${JSON.stringify(e.error)}`);
  }
  return e instanceof Error ? e : new Error(String(e));
}

const memoryGetContextTool: ToolDefinition = {
  name: 'memory_get_context',
  title: 'Segundo Cérebro — contexto inicial',
  description:
    'Lê, na ordem oficial (AGENTS_MEMORY_BRIDGE → memory/agent-context.md → MEMORY.md → memory/now.md), o pacote de bootstrap do Segundo Cérebro. Aceita paths adicionais específicos. Nunca escreve.',
  scopes: MEMORY_READ,
  annotations: READ_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: {
      extra_paths: { type: 'array', items: { type: 'string' }, maxItems: 10 },
    },
    additionalProperties: false,
  },
  handler: async (input) => {
    const schema = z.object({ extra_paths: z.array(z.string().min(1).max(256)).max(10).optional() }).strict();
    const parsed = schema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.message}`);
    try {
      const bundle = await getContextBundle(parsed.data.extra_paths);
      return { source: 'github', ...bundle, bridge: bridgeStatus() };
    } catch (e) { throw memoryError(e); }
  },
};

const memorySearchTool: ToolDefinition = {
  name: 'memory_search',
  title: 'Segundo Cérebro — busca',
  description: 'Busca textual (GitHub Code Search) restrita ao repositório do Segundo Cérebro. Sem escrita.',
  scopes: MEMORY_READ,
  annotations: READ_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 2, maxLength: 200 },
      limit: { type: 'integer', minimum: 1, maximum: 25 },
    },
    required: ['query'],
    additionalProperties: false,
  },
  handler: async (input) => {
    const schema = z.object({ query: z.string().min(2).max(200), limit: z.number().int().min(1).max(25).optional() }).strict();
    const parsed = schema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.message}`);
    try { return { results: await searchCode(parsed.data.query, parsed.data.limit ?? 10) }; }
    catch (e) { throw memoryError(e); }
  },
};

const memoryFetchTool: ToolDefinition = {
  name: 'memory_fetch',
  title: 'Segundo Cérebro — fetch de arquivo',
  description: 'Lê um arquivo específico do repositório do Segundo Cérebro. Path relativo obrigatório; recusa traversal e paths absolutos. Sem escrita.',
  scopes: MEMORY_READ,
  annotations: READ_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', minLength: 1, maxLength: 512 },
      ref: { type: 'string', minLength: 1, maxLength: 128 },
    },
    required: ['path'],
    additionalProperties: false,
  },
  handler: async (input) => {
    const schema = z.object({ path: z.string().min(1).max(512), ref: z.string().min(1).max(128).optional() }).strict();
    const parsed = schema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.message}`);
    try { return await getFile(parsed.data.path, parsed.data.ref); }
    catch (e) { throw memoryError(e); }
  },
};

const memoryListPendingTool: ToolDefinition = {
  name: 'memory_list_pending_proposals',
  title: 'Segundo Cérebro — propostas pendentes',
  description: `Lista propostas .md aguardando revisão do OpenClaw em ${INBOX_PREFIX}. Sem escrita.`,
  scopes: MEMORY_READ,
  annotations: READ_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: { limit: { type: 'integer', minimum: 1, maximum: 500 } },
    additionalProperties: false,
  },
  handler: async (input) => {
    const schema = z.object({ limit: z.number().int().min(1).max(500).optional() }).strict();
    const parsed = schema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.message}`);
    try { return { inbox: INBOX_PREFIX, items: await listInboxPending(parsed.data.limit ?? 25) }; }
    catch (e) { throw memoryError(e); }
  },
};

const memoryProposeTool: ToolDefinition = {
  name: 'memory_propose_update',
  title: 'Segundo Cérebro — propor atualização',
  description:
    `Cria uma proposta .md em ${INBOX_PREFIX} (único diretório de escrita permitido). Nome de arquivo é gerado pelo servidor. Nunca sobrescreve arquivos. Bloqueia MEMORY.md, memory/now.md, decisions, projects/, context/, lessons, pending e inboxes de outros agentes.`,
  scopes: MEMORY_PROPOSE,
  annotations: {
    readOnlyHint: false,
    idempotentHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 3, maxLength: 160 },
      summary: { type: 'string', minLength: 10, maxLength: 2000 },
      origin: { type: 'string', minLength: 2, maxLength: 120, description: 'quem/qual agente propõe (ex: chatgpt-work, hermes-agent).' },
      suggested_destination: { type: 'string', maxLength: 256 },
      context: { type: 'string', maxLength: 6000 },
      risks: { type: 'string', maxLength: 2000 },
      correlation_id: { type: 'string', minLength: 6, maxLength: 64 },
      body_markdown: { type: 'string', maxLength: 12000 },
    },
    required: ['title', 'summary', 'origin', 'correlation_id'],
    additionalProperties: false,
  },
  handler: async (input) => {
    const schema = z.object({
      title: z.string().min(3).max(160),
      summary: z.string().min(10).max(2000),
      origin: z.string().min(2).max(120),
      suggested_destination: z.string().max(256).optional(),
      context: z.string().max(6000).optional(),
      risks: z.string().max(2000).optional(),
      correlation_id: z.string().min(6).max(64),
      body_markdown: z.string().max(12000).optional(),
    }).strict();
    const parsed = schema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.message}`);
    try { return await proposeUpdate(parsed.data); }
    catch (e) { throw memoryError(e); }
  },
};

// ─── Write tools (round 5) ────────────────────────────────────
// Only four: create_task, update_task, complete_task, create_report_draft.
// All require aceleriq:write. Fields are on a strict allowlist (Zod .strict()).
const WRITE: readonly ToolScope[] = ['aceleriq:write'];
const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

function writeError(e: unknown): Error {
  if (e instanceof WriteError) {
    return new Error(`write:${e.code} ${e.message}`);
  }
  return e instanceof Error ? e : new Error(String(e));
}

function ensureWriteCtx(ctx: AuthContext) {
  if (!ctx.correlationId) throw new Error('missing correlationId on write context');
  return {
    keyId: ctx.keyId,
    origin: ctx.origin,
    correlationId: ctx.correlationId,
    resultRefHolder: ctx.resultRefHolder,
  };
}

const createTaskTool: ToolDefinition = {
  name: 'aceleriq_create_task',
  title: 'Criar tarefa',
  description:
    'Cria uma tarefa em um projeto existente. Campos permitidos apenas: project_id, title, description, status, priority, assigned_to, due_date, milestone_id, idempotency_key. Nunca cria projetos, clientes ou faturamento. Nunca envia notificações ao cliente.',
  scopes: WRITE,
  annotations: WRITE_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: {
      project_id: { type: 'string', format: 'uuid' },
      title: { type: 'string', minLength: 1, maxLength: 200 },
      description: { type: 'string', maxLength: 4000 },
      status: { type: 'string', enum: ['backlog', 'todo', 'doing', 'review', 'done'] },
      priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
      assigned_to: { type: 'string', format: 'uuid' },
      due_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      milestone_id: { type: 'string', format: 'uuid' },
      idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
    },
    required: ['project_id', 'title', 'idempotency_key'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    const parsed = createTaskSchema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    try { return await createTask(parsed.data, ensureWriteCtx(ctx)); }
    catch (e) { throw writeError(e); }
  },
};

const updateTaskTool: ToolDefinition = {
  name: 'aceleriq_update_task',
  title: 'Atualizar tarefa',
  description:
    'Atualiza campos permitidos de uma tarefa. Não permite trocar project_id, source, created_at nem propriedade. Todos os campos são opcionais exceto task_id e idempotency_key. Nunca envia notificações ao cliente.',
  scopes: WRITE,
  annotations: WRITE_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', format: 'uuid' },
      title: { type: 'string', minLength: 1, maxLength: 200 },
      description: { type: ['string', 'null'], maxLength: 4000 },
      status: { type: 'string', enum: ['backlog', 'todo', 'doing', 'review', 'done'] },
      priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
      assigned_to: { type: ['string', 'null'], format: 'uuid' },
      due_date: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      milestone_id: { type: ['string', 'null'], format: 'uuid' },
      idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
    },
    required: ['task_id', 'idempotency_key'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    const parsed = updateTaskSchema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    try { return await updateTask(parsed.data, ensureWriteCtx(ctx)); }
    catch (e) { throw writeError(e); }
  },
};

const completeTaskTool: ToolDefinition = {
  name: 'aceleriq_complete_task',
  title: 'Concluir tarefa',
  description:
    'Marca uma tarefa como concluída (status=done). Rejeita tarefas já concluídas. Sem outros efeitos colaterais, sem envio para cliente.',
  scopes: WRITE,
  annotations: { ...WRITE_ANNOTATIONS, idempotentHint: true },
  inputSchema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', format: 'uuid' },
      idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
    },
    required: ['task_id', 'idempotency_key'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    const parsed = completeTaskSchema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    try { return await completeTask(parsed.data, ensureWriteCtx(ctx)); }
    catch (e) { throw writeError(e); }
  },
};

const createReportDraftTool: ToolDefinition = {
  name: 'aceleriq_create_report_draft',
  title: 'Criar rascunho de relatório',
  description:
    'Cria um relatório em RASCUNHO (status=draft). client_id é derivado do projeto — não aceito no input. Sem publicação, sem envio ao cliente, sem aprovação automática, sem file_url, sem internal_notes.',
  scopes: WRITE,
  annotations: WRITE_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: {
      project_id: { type: 'string', format: 'uuid' },
      title: { type: 'string', minLength: 1, maxLength: 200 },
      period_start: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      period_end: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      summary: { type: 'string', maxLength: 8000 },
      highlights: { type: 'string', maxLength: 4000 },
      next_steps: { type: 'string', maxLength: 4000 },
      metrics: { type: 'object' },
      chart_type: { type: 'string', enum: ['area', 'bar', 'line', 'pie'] },
      chart_data: { type: 'array', items: { type: 'object' }, maxItems: 500 },
      idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
    },
    required: ['project_id', 'title', 'idempotency_key'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    const parsed = createReportDraftSchema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    try { return await createReportDraft(parsed.data, ensureWriteCtx(ctx)); }
    catch (e) { throw writeError(e); }
  },
};

export const TOOLS: readonly ToolDefinition[] = [
  healthTool,
  capabilitiesTool,
  // read tools (round 3)
  searchTool,
  fetchTool,
  listClientsTool,
  getClientContextTool,
  listProjectsTool,
  getProjectTool,
  listTasksTool,
  listReportsTool,
  getReportTool,
  listBriefingsTool,
  getBriefingTool,
  listWorkspaceNodesTool,
  getWorkspaceNodeTool,
  listFilesTool,
  // Second Brain bridge (round 4)
  memoryGetContextTool,
  memorySearchTool,
  memoryFetchTool,
  memoryListPendingTool,
  memoryProposeTool,
  // Write tools (round 5) — controlled operational writes
  createTaskTool,
  updateTaskTool,
  completeTaskTool,
  createReportDraftTool,
];

export const TOOL_MAP: ReadonlyMap<string, ToolDefinition> = new Map(
  TOOLS.map(t => [t.name, t]),
);

export function canInvoke(ctx: AuthContext, tool: ToolDefinition): boolean {
  if (tool.scopes.length === 0) return true;
  if (ctx.scopes.includes('admin')) return true;
  return tool.scopes.some(s => ctx.scopes.includes(s));
}

export function describeTool(t: ToolDefinition) {
  const securitySchemes = t.scopes.length === 0
    ? [{ type: 'noauth' }]
    : [{
      type: 'oauth2',
      scopes: ['openid', 'email', 'profile'],
      description: 'OAuth do Aceleriq OS. Permissões de dados são aplicadas pelo backend/RLS e pelos escopos MCP internos.',
    }];

  return {
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: t.annotations,
    _meta: {
      securitySchemes,
      required_mcp_scopes: t.scopes,
    },
  };
}
