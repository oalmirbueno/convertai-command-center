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

export const SERVER_INFO = {
  name: 'aceleriq-mcp',
  title: 'Aceleriq OS MCP',
  version: '1.1.0-read',
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
    'Descreve o servidor MCP: tools disponíveis para esta chave, escopos concedidos e escopos suportados.',
  scopes: [],
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: READ_ANNOTATIONS,
  handler: (_input, ctx) => {
    const visible = TOOLS
      .filter(t => canInvoke(ctx, t))
      .map(t => ({ name: t.name, description: t.description, requiredScopes: t.scopes }));
    return Promise.resolve({
      server: SERVER_INFO,
      protocolVersion: '2025-06-18',
      grantedScopes: ctx.scopes,
      supportedScopes: ALL_SCOPES,
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
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  }).strict(),
  {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Termo de busca em nome/empresa/email.' },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
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
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  }).strict(),
  {
    type: 'object',
    properties: {
      client_id: { type: 'string', format: 'uuid' },
      status: { type: 'string' },
      query: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
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
    limit: z.number().int().min(1).max(100).optional(),
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
      limit: { type: 'integer', minimum: 1, maximum: 100 },
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
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  }).strict(),
  {
    type: 'object',
    properties: {
      client_id: { type: 'string', format: 'uuid' },
      project_id: { type: 'string', format: 'uuid' },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
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
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  }).strict(),
  {
    type: 'object',
    properties: {
      client_id: { type: 'string', format: 'uuid' },
      project_id: { type: 'string', format: 'uuid' },
      submitted: { type: 'boolean' },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
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
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  }).strict(),
  {
    type: 'object',
    properties: {
      parent_id: { type: ['string', 'null'], format: 'uuid' },
      client_id: { type: 'string', format: 'uuid' },
      scope: { type: 'string' },
      kind: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
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
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  }).strict(),
  {
    type: 'object',
    properties: {
      client_id: { type: 'string', format: 'uuid' },
      project_id: { type: 'string', format: 'uuid' },
      folder: { type: 'string' },
      approval_status: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
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
  return {
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: t.annotations,
  };
}
