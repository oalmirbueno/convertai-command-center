// Tool registry for the MCP server.
// Round 2: foundation tools (aceleriq_health, aceleriq_capabilities).
// Round 3: read-only tools over existing Aceleriq OS data.
// Never mutates data. Never touches api-gateway.

import { z } from 'https://esm.sh/zod@3.23.8';
import type { AuthContext } from './mcp-auth.ts';
import { dataScopeAllowsTool } from './mcp-security.ts';
import {
  ALLOWED_ENTITY_TYPES,
  fetchEntity,
  getBriefing,
  getClientContext,
  getClientDossier,
  getFile as getPanelFile,
  getProject,
  getReport,
  getWorkspaceNode,
  listBriefings,
  listClients,
  listOpportunities,
  listEditorialCalendar,
  listFiles,
  listProjects,
  listReports,
  listTasks,
  listWeeklyCycle,
  listWorkspaceNodes,
  PUBLISHABLE_DELIVERY_TYPES,
  search,
  getCurrentDossier,
  auditIntegrity,
} from './aceleriq-read-services.ts';
import {
  OPERATOR_EVENTS,
  operatorBoard,
  operatorRegister,
  operatorReport,
} from './aceleriq-operators-services.ts';
import {
  getFinanceAdsInvestment,
  getFinanceCapital,
  getFinanceCashFlow,
  listFinanceHistory,
  listFinanceMensalidades,
} from './aceleriq-finance-fluxo.ts';
import {
  getFinanceDashboard,
  listFinanceExpenses,
  listFinanceProjectPayments,
} from './aceleriq-finance-dashboard.ts';
import {
  getFinanceBilling,
  getFinanceOverview,
  listFinanceClientSummaries,
  listFinanceEntries,
  listFinancePlans,
  listFinanceRecurringRules,
} from './aceleriq-finance-services.ts';
import {
  bridgeStatus,
  CONTEXT_ORDER,
  getContextBundle,
  getFile,
  getBridgePulse,
  INBOX_PREFIX,
  listInboxPending,
  listRecentCommits,
  proposeUpdate,
  searchCode,
  SecondBrainError,
} from './second-brain-github.ts';
import {
  completeTask,
  completeTaskSchema,
  archiveProject,
  archiveProjectSchema,
  createEditorialItem,
  createEditorialItemSchema,
  createProject,
  createProjectSchema,
  reopenTask,
  reopenTaskSchema,
  restoreProject,
  restoreProjectSchema,
  updateClient,
  updateClientSchema,
  createReportDraft,
  createReportDraftSchema,
  createTask,
  createTaskSchema,
  EDITORIAL_DELIVERY_TYPE_VALUES,
  TASK_DELIVERY_TYPE_VALUES,
  updateProject,
  updateProjectSchema,
  updateTask,
  updateTaskSchema,
  upsertCurrentDossier,
  upsertCurrentDossierSchema,
  WriteError,
} from './mcp-write-services.ts';
import {
  cancelContract,
  cancelContractSchema,
  createContract,
  createContractSchema,
  getContract,
  getContractSchema,
  listContracts,
  listContractsSchema,
  updateContract,
  updateContractSchema,
} from './mcp-contracts-services.ts';

export type ToolScope =
  // Aggregate scopes (kept for backward compat — expand into granular below).
  | 'aceleriq:read'
  | 'aceleriq:write'
  | 'aceleriq:finance'
  // Granular per-resource scopes (Bloco D).
  | 'clients:read'
  | 'clients:write'
  | 'projects:read'
  | 'projects:write'
  | 'tasks:read'
  | 'tasks:write'
  | 'editorial:read'
  | 'editorial:write'
  | 'reports:read'
  | 'reports:write'
  | 'briefings:read'
  | 'files:read'
  | 'files:write'
  | 'files:sensitive:read'
  | 'files:archive'
  | 'workspace:read'
  | 'commercial:read'
  | 'contracts:read'
  | 'contracts:write'
  | 'memory:read'
  | 'memory:propose'
  | 'admin';

export const ALL_SCOPES: readonly ToolScope[] = [
  'aceleriq:read',
  'aceleriq:write',
  'aceleriq:finance',
  'clients:read',
  'clients:write',
  'projects:read',
  'projects:write',
  'tasks:read',
  'tasks:write',
  'editorial:read',
  'editorial:write',
  'reports:read',
  'reports:write',
  'briefings:read',
  'files:read',
  'files:write',
  'files:sensitive:read',
  'files:archive',
  'workspace:read',
  'commercial:read',
  'contracts:read',
  'contracts:write',
  'memory:read',
  'memory:propose',
  'admin',
] as const;

// Human-readable descriptions for the OAuth consent screen and audit logs.
export const SCOPE_DESCRIPTIONS: Record<ToolScope, { title: string; description: string; sensitive?: boolean }> = {
  'aceleriq:read': { title: 'Leitura ampla', description: 'Ler todos os dados operacionais (clientes, projetos, tarefas, relatórios, briefings, arquivos).' },
  'aceleriq:write': { title: 'Escrita operacional', description: 'Criar/atualizar tarefas, rascunhos de relatórios e ajustes de projetos.', sensitive: true },
  'aceleriq:finance': { title: 'Financeiro', description: 'Acessar informações financeiras agregadas.', sensitive: true },
  'clients:read': { title: 'Clientes — leitura', description: 'Listar e visualizar contextos de clientes.' },
  'clients:write': { title: 'Clientes — dossiê', description: 'Atualizar o dossiê de contexto do cliente com versão e histórico. Não cria nem apaga clientes.', sensitive: true },
  'projects:read': { title: 'Projetos — leitura', description: 'Listar e detalhar projetos.' },
  'projects:write': { title: 'Projetos — escrita', description: 'Atualizar prazo, status, progresso, escopo e objetivos de projetos.', sensitive: true },
  'tasks:read': { title: 'Tarefas — leitura', description: 'Listar tarefas do Kanban.' },
  'tasks:write': { title: 'Tarefas — escrita', description: 'Criar, editar e concluir tarefas.', sensitive: true },
  'editorial:read': { title: 'Calendário editorial — leitura', description: 'Ler somente entregas publicáveis e seus planos editoriais dentro dos clientes autorizados.' },
  'editorial:write': { title: 'Linha editorial — criação', description: 'Criar tarefas de produção publicáveis vinculadas a cliente e projeto. Não aprova, agenda nem publica.', sensitive: true },
  'reports:read': { title: 'Relatórios — leitura', description: 'Listar e ler relatórios publicados.' },
  'reports:write': { title: 'Relatórios — escrita', description: 'Criar rascunhos de relatórios.', sensitive: true },
  'briefings:read': { title: 'Briefings — leitura', description: 'Listar e ler briefings enviados.' },
  'files:read': { title: 'Arquivos — leitura', description: 'Consultar arquivos e conteúdos não restritos dos clientes autorizados.' },
  'files:write': { title: 'Arquivos — escrita', description: 'Anexar arquivos, criar versões e atualizar seus metadados.', sensitive: true },
  'files:sensitive:read': { title: 'Arquivos sensíveis — leitura', description: 'Ler contratos, documentos societários e outros arquivos marcados como confidenciais ou restritos.', sensitive: true },
  'files:archive': { title: 'Arquivos — arquivar/restaurar', description: 'Arquivar e restaurar arquivos, mantendo o histórico.', sensitive: true },
  'workspace:read': { title: 'Workspace — leitura', description: 'Navegar pastas e nós do Workspace interno.' },
  'commercial:read': { title: 'Comercial — leitura', description: 'Ler o funil comercial interno: oportunidades, classe, qualificação, responsável e prazos. Área da casa, nunca visível a cliente.' },
  'contracts:read': { title: 'Contratos — leitura', description: 'Listar e detalhar contratos e status de assinatura.' },
  'contracts:write': { title: 'Contratos — rascunhos', description: 'Criar, atualizar e cancelar somente rascunhos completamente não assinados e nunca enviados. Não permite assinar, aprovar, enviar ou publicar contratos.', sensitive: true },
  'memory:read': { title: 'Segundo Cérebro — leitura', description: 'Consultar contexto, arquivos e commits do repositório de memória.' },
  'memory:propose': { title: 'Segundo Cérebro — propor', description: 'Criar propostas .md no inbox do OpenClaw (nunca sobrescreve arquivos).', sensitive: true },
  'admin': { title: 'Administrador', description: 'Bypass total de escopo. Concede acesso a todas as ferramentas.', sensitive: true },
};

// Aggregate scopes expand into granular scopes at authorization time. This
// keeps existing API keys with `aceleriq:read`/`aceleriq:write` working while
// letting OAuth clients ask for exactly what they need.
export const SCOPE_EXPANSIONS: Partial<Record<ToolScope, ToolScope[]>> = {
  'aceleriq:read': [
    'clients:read', 'projects:read', 'tasks:read',
    'reports:read', 'briefings:read', 'files:read',
    'workspace:read', 'contracts:read', 'editorial:read',
    'commercial:read',
    // Decisão do dono (27/08): o financeiro abre para TODA credencial
    // interna de leitura, sem marcação por chave. A separação por
    // consentimento era regra do implementador e virou atrito real — o
    // agente do GPT ficou dias sem ver o caixa por falta de um checkbox.
    // O que continua de pé, e é o que protege de verdade: chave restrita
    // a cliente NUNCA alcança o financeiro (as ferramentas não estão na
    // lista tenant-scoped, e o despachante nega por padrão), e não existe
    // escrita financeira pelo MCP.
    'aceleriq:finance',
  ],
  'aceleriq:write': [
    'projects:write', 'tasks:write', 'reports:write', 'files:write',
    'editorial:write', 'clients:write',
  ],
};

export function expandScopes(granted: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const s of granted) {
    out.add(s);
    const exp = SCOPE_EXPANSIONS[s as ToolScope];
    if (exp) for (const e of exp) out.add(e);
  }
  return out;
}

// Granular scope tagging per tool. Applied at TOOLS export time so we don't
// have to touch every makeRead(...) call site.
export const GRANULAR_SCOPE_BY_TOOL: Record<string, ToolScope> = {
  aceleriq_list_clients: 'clients:read',
  aceleriq_get_client_context: 'clients:read',
  aceleriq_get_current_dossier: 'clients:read',
  aceleriq_upsert_current_dossier: 'clients:write',
  aceleriq_update_client: 'clients:write',
  aceleriq_list_projects: 'projects:read',
  aceleriq_get_project: 'projects:read',
  aceleriq_create_project: 'projects:write',
  aceleriq_update_project: 'projects:write',
  aceleriq_archive_project: 'projects:write',
  aceleriq_restore_project: 'projects:write',
  aceleriq_reopen_task: 'tasks:write',
  aceleriq_list_tasks: 'tasks:read',
  aceleriq_list_editorial_calendar: 'editorial:read',
  aceleriq_create_editorial_item: 'editorial:write',
  aceleriq_create_task: 'tasks:write',
  aceleriq_update_task: 'tasks:write',
  aceleriq_complete_task: 'tasks:write',
  aceleriq_list_reports: 'reports:read',
  aceleriq_get_social_metrics: 'reports:read',
  aceleriq_list_social_posts: 'reports:read',
  aceleriq_get_ads_campaigns: 'reports:read',
  aceleriq_get_ads_performance: 'reports:read',
  aceleriq_get_report: 'reports:read',
  aceleriq_create_report_draft: 'reports:write',
  aceleriq_list_briefings: 'briefings:read',
  aceleriq_get_briefing: 'briefings:read',
  aceleriq_list_files: 'files:read',
  aceleriq_get_file: 'files:read',
  aceleriq_list_workspace_nodes: 'workspace:read',
  aceleriq_list_opportunities: 'commercial:read',
  aceleriq_get_workspace_node: 'workspace:read',
};

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
  version: '1.33.0',
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

/**
 * Leitura financeira: escopo próprio, e só ele.
 *
 * `aceleriq:read` NÃO expande para `aceleriq:finance` (ver SCOPE_EXPANSIONS),
 * então quem tem leitura geral continua sem ver dinheiro: o financeiro é
 * consentimento à parte, marcado como sensível na tela de permissão. E o
 * despachante barra princípio restrito a cliente em ferramenta fora da lista
 * de tenant-scoped — nenhuma daqui está, então finanças da casa não vazam
 * para chave de cliente.
 *
 * Todas são readOnly de verdade: não existe escrita financeira pelo MCP.
 */
const FINANCE: readonly ToolScope[] = ['aceleriq:finance'];

function makeFinanceRead(
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
    scopes: FINANCE,
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

/**
 * Teto de pagina que ACOMODA em vez de recusar.
 *
 * O log de auditoria mostrou o defeito mais caro do MCP inteiro: 203
 * chamadas de aceleriq_search e 94 de memory_search falharam por pedirem
 * acima do teto ("Number must be less than or equal to 10"). O agente
 * pedia 50, recebia um erro de validacao e ficava sem resposta nenhuma —
 * quando a resposta certa sempre existiu: os 10 que cabem.
 *
 * Pedir mais do que o maximo e um exagero de quem quer contexto, nao uma
 * tentativa de abuso. Recusar a chamada inteira por isso e hostil e nao
 * protege nada, porque o teto continua valendo do mesmo jeito.
 *
 * O teto CONTINUA sendo respeitado: nunca sai mais que `max`. O que muda e
 * que 50 vira 10 em vez de virar erro. Texto que nao e numero segue sendo
 * recusado — ali o pedido e ambiguo de verdade.
 */
function limite(max: number, min = 1) {
  return z.preprocess((valor) => {
    if (valor === undefined || valor === null || valor === '') return undefined;
    const n = Number(valor);
    if (!Number.isFinite(n)) return valor;
    return Math.min(Math.max(Math.floor(n), min), max);
  }, z.number().int().min(min).max(max).optional());
}

const UUID = z.string().uuid();

function isRealToolDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

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
    protocolVersion: '2025-06-18',
    now: new Date().toISOString(),
    tokenSubject: ctx.keyId,
    oauthClientId: ctx.origin,
    key: { id: ctx.keyId, name: ctx.keyName, origin: ctx.origin },
    rawGrantedScopes: ctx.scopes,
    effectiveScopes: Array.from(expandScopes(ctx.scopes)).sort(),
    consentedScopes: ctx.scopes,
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
      .filter(t => canInvoke(ctx, t) && canUseToolWithDataScope(ctx, t))
      .map(t => ({ name: t.name, description: t.description, requiredScopes: t.scopes }));
    const counts = {
      total: TOOLS.length,
      visible: visible.length,
      read: TOOLS.filter(t => t.scopes.includes('aceleriq:read')).length,
      write: TOOLS.filter(t => t.scopes.includes('aceleriq:write')).length,
      contracts_read: TOOLS.filter(t => t.scopes.includes('contracts:read')).length,
      contracts_write: TOOLS.filter(t => t.scopes.includes('contracts:write')).length,
      memory_read: TOOLS.filter(t => t.scopes.includes('memory:read')).length,
      memory_propose: TOOLS.filter(t => t.scopes.includes('memory:propose')).length,
      editorial_read: TOOLS.filter(t => t.scopes.includes('editorial:read')).length,
      editorial_write: TOOLS.filter(t => t.scopes.includes('editorial:write')).length,
      finance: TOOLS.filter(t => t.scopes.includes('aceleriq:finance')).length,
      public: TOOLS.filter(t => t.scopes.length === 0).length,
    };

    /**
     * O diagnostico de catalogo velho, dito em voz alta.
     *
     * O caso real: tres agentes ficaram em HOLD dizendo "as rotas
     * financeiras nao estao invocaveis neste turno" — e estavam certos.
     * O servidor tinha as 14, mas o adaptador deles guardava a lista de
     * antes. `initialize` declara `listChanged: false` (verdade: nao temos
     * stream para empurrar aviso de mudanca), entao o cliente cacheia e
     * nunca mais pergunta. O catalogo cresce e ninguem avisa.
     *
     * Esta ferramenta e justamente a que o agente confuso chama. Entao ela
     * passa a responder o que ele precisa ouvir: os nomes que ele DEVERIA
     * conseguir chamar e a instrucao exata de como destravar. Sem isto o
     * agente conclui "a ferramenta nao existe" — e fica parado com o dado
     * disponivel do outro lado.
     */
    const nomesVisiveis = visible.map(t => t.name);
    const comoDestravar = nomesVisiveis.length > 0
      ? 'Se alguma tool listada em `tools` aqui NAO aparecer na sua lista de funcoes, o seu adaptador esta com o catalogo antigo em cache: peca tools/list de novo, ou reconecte o conector do Aceleriq OS. O servidor nao empurra aviso de mudanca (listChanged=false), entao a lista so atualiza quando o cliente pergunta.'
      : 'Nenhuma tool visivel para esta credencial: confira os escopos concedidos.';

    return Promise.resolve({
      server: SERVER_INFO,
      protocolVersion: '2025-06-18',
      catalogo: {
        tools_no_servidor: TOOLS.length,
        tools_visiveis_para_esta_credencial: visible.length,
        nomes_visiveis: nomesVisiveis,
        como_destravar: comoDestravar,
      },
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
    limit: limite(500),
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
  (input, ctx) => listClients(input, ctx),
);

const listOpportunitiesTool = makeRead(
  'aceleriq_list_opportunities',
  'Listar oportunidades comerciais',
  'Lista as oportunidades do funil comercial interno (commercial_leads): classe (cliente_atual, upsell, novo_prospect ou sem_classe), etapa, responsável, próxima ação, prazo, valores propostos e qualificação. Campo vazio significa "não confirmado", nunca zero. Somente leitura de registros existentes; área interna da casa, vazia para chaves restritas a cliente.',
  z.object({
    classe: z.enum(['cliente_atual', 'upsell', 'novo_prospect', 'sem_classe']).optional(),
    etapa: z.enum(['novo', 'contato', 'diagnostico', 'proposta', 'negociacao', 'ganho', 'perdido']).optional(),
    incluir_fechadas: z.boolean().optional(),
    limit: limite(500),
    offset: z.number().int().min(0).optional(),
  }).strict(),
  {
    type: 'object',
    properties: {
      classe: {
        type: 'string',
        enum: ['cliente_atual', 'upsell', 'novo_prospect', 'sem_classe'],
        description: 'Filtra por classe; sem_classe devolve as ainda não confirmadas.',
      },
      etapa: {
        type: 'string',
        enum: ['novo', 'contato', 'diagnostico', 'proposta', 'negociacao', 'ganho', 'perdido'],
        description: 'Filtra pelo estágio do funil.',
      },
      incluir_fechadas: {
        type: 'boolean',
        default: false,
        description: 'Inclui ganho e perdido; por padrão só o funil aberto.',
      },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 25 },
      offset: { type: 'integer', minimum: 0, default: 0 },
    },
    additionalProperties: false,
  },
  (input, ctx) => listOpportunities(input, ctx),
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
  (input, ctx) => getClientContext(input, ctx),
);

const listProjectsTool = makeRead(
  'aceleriq_list_projects',
  'Listar projetos',
  'Lista projetos existentes com filtros por cliente, status e busca textual (nome/descrição).',
  z.object({
    client_id: UUID.optional(),
    status: z.string().max(64).optional(),
    query: z.string().max(200).optional(),
    limit: limite(500),
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
  (input, ctx) => listProjects(input, ctx),
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
  (input, ctx) => getProject(input, ctx),
);

const listTasksTool = makeRead(
  'aceleriq_list_tasks',
  'Listar tarefas',
  'Lista tarefas dentro do escopo de clientes da credencial, com client_id derivado do projeto, paginação completa e filtros por projeto, cliente, status, responsável, tipo de entrega, área ou apenas abertas.',
  z.object({
    project_id: UUID.optional(),
    client_id: UUID.optional(),
    status: z.string().max(64).optional(),
    assigned_to: UUID.optional(),
    delivery_type: z.string().max(64).optional(),
    workstream: z.enum(['general', 'design', 'content', 'video', 'traffic', 'development', 'operations']).optional(),
    only_open: z.boolean().optional(),
    limit: limite(500),
    offset: z.number().int().min(0).optional(),
  }).strict(),
  {
    type: 'object',
    properties: {
      project_id: { type: 'string', format: 'uuid' },
      client_id: { type: 'string', format: 'uuid' },
      status: { type: 'string' },
      assigned_to: { type: 'string', format: 'uuid' },
      delivery_type: { type: 'string', enum: [...TASK_DELIVERY_TYPE_VALUES] },
      workstream: { type: 'string', enum: ['general', 'design', 'content', 'video', 'traffic', 'development', 'operations'] },
      only_open: { type: 'boolean' },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 },
    },
    additionalProperties: false,
  },
  (input, ctx) => listTasks(input, ctx),
);

const listEditorialCalendarTool = makeRead(
  'aceleriq_list_editorial_calendar',
  'Listar calendário editorial',
  'Lista o calendário editorial completo e deduplicado para um client_id autorizado: posts ativos (inclusive standalone) e tarefas publicáveis ainda sem post. Período usa tasks.due_date para tarefas e editorial_publications.scheduled_at para posts; use include_unscheduled para incluir backlog sem agenda no recorte. Anexa conta social e metadados seguros do arquivo ou carrossel, sem tokens, URLs de Storage, caminhos privados, hashes ou notas internas.',
  z.object({
    client_id: UUID,
    project_id: UUID.optional(),
    date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealToolDate, { message: 'date_from must be a real calendar date' }).optional(),
    date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealToolDate, { message: 'date_to must be a real calendar date' }).optional(),
    format: z.enum(PUBLISHABLE_DELIVERY_TYPES).optional(),
    delivery_type: z.enum(PUBLISHABLE_DELIVERY_TYPES).optional(),
    status: z.enum(['backlog', 'todo', 'doing', 'review', 'approved', 'blocked']).optional(),
    production_status: z.enum(['draft', 'production', 'ready']).optional(),
    publication_status: z.enum(['planned', 'scheduled', 'published', 'failed', 'cancelled']).optional(),
    include_unscheduled: z.boolean().optional(),
    limit: limite(500),
    offset: z.number().int().min(0).optional(),
  }).strict()
    .refine(
      value => !value.date_from || !value.date_to || value.date_to >= value.date_from,
      { message: 'date_to must be on or after date_from' },
    )
    .refine(
      value => !value.format || !value.delivery_type || value.format === value.delivery_type,
      { message: 'format and delivery_type cannot conflict' },
    ),
  {
    type: 'object',
    properties: {
      client_id: { type: 'string', format: 'uuid', description: 'Cliente obrigatório. O servidor aplica o escopo de dados da credencial.' },
      project_id: { type: 'string', format: 'uuid' },
      date_from: { type: 'string', format: 'date', description: 'Data inicial inclusiva. Filtra task.due_date e publication.scheduled_at.' },
      date_to: { type: 'string', format: 'date', description: 'Data final inclusiva. Filtra task.due_date e publication.scheduled_at.' },
      format: { type: 'string', enum: [...EDITORIAL_DELIVERY_TYPE_VALUES], description: 'Formato canônico. design e static cobrem arte estática.' },
      delivery_type: { type: 'string', enum: [...EDITORIAL_DELIVERY_TYPE_VALUES], deprecated: true, description: 'Alias temporário de format.' },
      status: { type: 'string', enum: ['backlog', 'todo', 'doing', 'review', 'approved', 'blocked'], description: 'Status das tarefas publicáveis ainda sem post. done, archived e cancelled nunca entram no calendário.' },
      production_status: { type: 'string', enum: ['draft', 'production', 'ready'], description: 'Etapa dos posts editoriais ativos. Quando informado, tarefas sem post ficam fora.' },
      publication_status: { type: 'string', enum: ['planned', 'scheduled', 'published', 'failed', 'cancelled'], description: 'Status dos planos/publicações ligados ao post. Quando informado, itens sem publicação ficam fora.' },
      include_unscheduled: { type: 'boolean', description: 'Inclui posts ainda sem scheduled_at. Padrão false quando há período e true sem período.' },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 25 },
      offset: { type: 'integer', minimum: 0, default: 0 },
    },
    required: ['client_id'],
    additionalProperties: false,
  },
  (input, ctx) => listEditorialCalendar(input, ctx),
);

const listReportsTool = makeRead(
  'aceleriq_list_reports',
  'Listar relatórios',
  'Lista relatórios (metadados) filtrando por cliente ou projeto. Use aceleriq_get_report para o conteúdo completo.',
  z.object({
    client_id: UUID.optional(),
    project_id: UUID.optional(),
    limit: limite(500),
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
    limit: limite(500),
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
    limit: limite(500),
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
  'Lista arquivos com filtros por cliente, projeto, pasta e status. O gate usa os campos persistidos: visibility=internal fica restrito à equipe; visibility=client_shared foi liberado sem decisão; visibility=approval com requires_approval=true segue o status do cliente. Agentes apenas consultam e não aprovam nem publicam.',
  z.object({
    client_id: UUID.optional(),
    project_id: UUID.optional(),
    folder: z.string().max(128).optional(),
    approval_status: z.string().max(64).optional(),
    limit: limite(500),
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

const getFileTool = makeRead(
  'aceleriq_get_file',
  'Detalhes de arquivo',
  'Retorna um arquivo pelo ID com metadados completos e semântica de aprovação enriquecida (approval_state, requires_approval, is_internal_document).',
  z.object({ file_id: UUID }).strict(),
  {
    type: 'object',
    properties: { file_id: { type: 'string', format: 'uuid' } },
    required: ['file_id'],
    additionalProperties: false,
  },
  (input) => getPanelFile(input),
);

const searchTool = makeRead(
  'aceleriq_search',
  'Busca global',
  'Pesquisa textual apenas nas entidades autorizadas do Aceleriq OS: clientes, projetos, tarefas, relatórios, workspace, arquivos, solicitações, marcos. Financeiro não é incluído.',
  z.object({
    query: z.string().min(1).max(200),
    entities: z.array(z.enum(ALLOWED_ENTITY_TYPES as unknown as [string, ...string[]])).max(9).optional(),
    limit_per_entity: limite(10),
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
    const schema = z.object({ query: z.string().min(2).max(200), limit: limite(25) }).strict();
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
    const schema = z.object({ limit: limite(500) }).strict();
    const parsed = schema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.message}`);
    try { return { inbox: INBOX_PREFIX, items: await listInboxPending(parsed.data.limit ?? 25) }; }
    catch (e) { throw memoryError(e); }
  },
};

const memoryPulseTool: ToolDefinition = {
  name: 'memory_get_pulse',
  title: 'Segundo Cérebro — pulse em tempo real',
  description: 'Snapshot leve do bridge: HEAD commit, branch, contagem de propostas pendentes e latência. Cacheado por 15s. Sem escrita.',
  scopes: MEMORY_READ,
  annotations: READ_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: { force: { type: 'boolean', description: 'Ignora o cache in-memory de 15s.' } },
    additionalProperties: false,
  },
  handler: async (input) => {
    const schema = z.object({ force: z.boolean().optional() }).strict();
    const parsed = schema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.message}`);
    try { return await getBridgePulse(parsed.data.force ?? false); }
    catch (e) { throw memoryError(e); }
  },
};

const memoryRecentCommitsTool: ToolDefinition = {
  name: 'memory_recent_commits',
  title: 'Segundo Cérebro — commits recentes',
  description: 'Lista os últimos commits do repositório (até 30). Aceita filtro opcional por path relativo. Sem escrita.',
  scopes: MEMORY_READ,
  annotations: READ_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 30 },
      path: { type: 'string', minLength: 1, maxLength: 512 },
    },
    additionalProperties: false,
  },
  handler: async (input) => {
    const schema = z.object({
      limit: limite(30),
      path: z.string().min(1).max(512).optional(),
    }).strict();
    const parsed = schema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.message}`);
    try { return { commits: await listRecentCommits(parsed.data.limit ?? 10, parsed.data.path) }; }
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

// ─── Write tools (round 5+) ───────────────────────────────────
// Generic operational writes require aceleriq:write; editorial creation has
// its own editorial:write scope. Every input uses a strict allowlist.
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
    dataScope: ctx.dataScope,
    resultRefHolder: ctx.resultRefHolder,
  };
}

const createTaskTool: ToolDefinition = {
  name: 'aceleriq_create_task',
  title: 'Criar tarefa',
  description:
    'Cria uma tarefa em um projeto existente. Campos permitidos apenas: project_id, title, description, status, priority, delivery_type, assigned_to, due_date, milestone_id, idempotency_key. Nunca cria projetos, clientes ou faturamento. Nunca envia notificações ao cliente.',
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
      delivery_type: {
        type: 'string',
        enum: [...TASK_DELIVERY_TYPE_VALUES],
      },
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

const createEditorialItemTool: ToolDefinition = {
  name: 'aceleriq_create_editorial_item',
  title: 'Adicionar item à linha editorial',
  description:
    'Cria uma tarefa de produção publicável no cliente e projeto informados, com data e formato explícitos. O item entra no Kanban e no calendário editorial como backlog. Não cria post, não aprova, não agenda, não publica e não conecta conta social.',
  scopes: ['editorial:write'],
  annotations: WRITE_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: {
      client_id: { type: 'string', format: 'uuid' },
      project_id: { type: 'string', format: 'uuid' },
      title: { type: 'string', minLength: 1, maxLength: 200 },
      description: { type: 'string', minLength: 3, maxLength: 4000 },
      context: { type: 'string', minLength: 3, maxLength: 4000 },
      format: { type: 'string', enum: [...EDITORIAL_DELIVERY_TYPE_VALUES], description: 'Formato canônico da pauta.' },
      delivery_type: { type: 'string', enum: [...EDITORIAL_DELIVERY_TYPE_VALUES], deprecated: true, description: 'Alias temporário de format.' },
      due_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
      assigned_to: { type: 'string', format: 'uuid' },
      idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
    },
    required: ['client_id', 'project_id', 'title', 'due_date', 'idempotency_key'],
    allOf: [
      { anyOf: [{ required: ['format'] }, { required: ['delivery_type'] }] },
      { anyOf: [{ required: ['description'] }, { required: ['context'] }] },
    ],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    const parsed = createEditorialItemSchema.safeParse(input ?? {});
    if (!parsed.success) {
      throw new Error(`Invalid input: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    }
    try { return await createEditorialItem(parsed.data, ensureWriteCtx(ctx)); }
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
      delivery_type: {
        type: 'string',
        enum: [...TASK_DELIVERY_TYPE_VALUES],
      },
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

const createProjectTool: ToolDefinition = {
  name: 'aceleriq_create_project',
  title: 'Criar projeto',
  description:
    'Cria um projeto operacional para um cliente existente: name, project_type, start_date, deadline, description, scope, objectives. NÃO define cobrança, valores nem brand — isso é feito no painel, onde o plano financeiro nasce junto. Requer idempotency_key.',
  scopes: WRITE,
  annotations: WRITE_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: {
      client_id: { type: 'string', format: 'uuid' },
      name: { type: 'string', minLength: 1, maxLength: 200 },
      project_type: { type: 'string', maxLength: 64 },
      start_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      deadline: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      description: { type: 'string', maxLength: 8000 },
      scope: { type: 'string', maxLength: 8000 },
      objectives: { type: 'string', maxLength: 8000 },
      idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
    },
    required: ['client_id', 'name', 'project_type', 'start_date', 'deadline', 'idempotency_key'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    const parsed = createProjectSchema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    try { return await createProject(parsed.data, ensureWriteCtx(ctx)); }
    catch (e) { throw writeError(e); }
  },
};

const updateProjectTool: ToolDefinition = {
  name: 'aceleriq_update_project',
  title: 'Atualizar projeto',
  description: 'Atualiza campos operacionais de um projeto (name, description, status, project_type, start_date, deadline, progress 0-100, scope, objectives). Não altera cliente, brand, billing_mode ou total_value. Requer idempotency_key.',
  scopes: WRITE,
  annotations: WRITE_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: {
      project_id: { type: 'string', format: 'uuid' },
      name: { type: 'string', minLength: 1, maxLength: 200 },
      description: { type: ['string', 'null'], maxLength: 8000 },
      status: { type: 'string', enum: ['active', 'done', 'paused', 'standby', 'cancelled'] },
      project_type: { type: 'string', maxLength: 64 },
      start_date: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      deadline: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      progress: { type: 'integer', minimum: 0, maximum: 100 },
      scope: { type: ['string', 'null'], maxLength: 8000 },
      objectives: { type: ['string', 'null'], maxLength: 8000 },
      idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
    },
    required: ['project_id', 'idempotency_key'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    const parsed = updateProjectSchema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    try { return await updateProject(parsed.data, ensureWriteCtx(ctx)); }
    catch (e) { throw writeError(e); }
  },
};

// ─── Contracts (Bloco B) ──────────────────────────────────────
// Agentes podem criar, editar ou cancelar apenas rascunhos completamente
// não assinados e nunca enviados. Nenhuma tool MCP assina, aprova, envia,
// publica ou faz upload do arquivo original do contrato.
const CONTRACTS_READ: readonly ToolScope[] = ['contracts:read', 'aceleriq:read'];
const CONTRACTS_WRITE: readonly ToolScope[] = ['contracts:write'];

const listContractsTool: ToolDefinition = {
  name: 'aceleriq_list_contracts',
  title: 'Listar contratos',
  description: 'Lista contratos com filtros opcionais (client_id, project_id, status, query em title) e paginação padrão has_more/next_offset. Cada item inclui is_signed, is_locked e sign_url.',
  scopes: CONTRACTS_READ,
  annotations: READ_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: {
      client_id: { type: 'string', format: 'uuid' },
      project_id: { type: 'string', format: 'uuid' },
      status: { type: 'string', enum: ['draft', 'sent', 'signed', 'completed', 'cancelled'] },
      query: { type: 'string', maxLength: 200 },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 25 },
      offset: { type: 'integer', minimum: 0, default: 0 },
    },
    additionalProperties: false,
  },
  handler: async (input) => {
    const parsed = listContractsSchema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    return await listContracts(parsed.data);
  },
};

const getContractTool: ToolDefinition = {
  name: 'aceleriq_get_contract',
  title: 'Detalhar contrato',
  description: 'Retorna um contrato pelo id, incluindo is_signed, is_locked e sign_url pública quando aplicável.',
  scopes: CONTRACTS_READ,
  annotations: READ_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: { contract_id: { type: 'string', format: 'uuid' } },
    required: ['contract_id'],
    additionalProperties: false,
  },
  handler: async (input) => {
    const parsed = getContractSchema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    return await getContract(parsed.data);
  },
};

const createContractTool: ToolDefinition = {
  name: 'aceleriq_create_contract',
  title: 'Criar contrato (rascunho)',
  description: 'Cria somente um rascunho completamente não assinado e não enviado. Exige client_id existente; project_id opcional deve pertencer ao mesmo cliente. Nunca assina, aprova, envia email, publica ou faz upload — original_file_url deve apontar para um arquivo já hospedado.',
  scopes: CONTRACTS_WRITE,
  annotations: WRITE_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: {
      client_id: { type: 'string', format: 'uuid' },
      project_id: { type: 'string', format: 'uuid' },
      title: { type: 'string', minLength: 1, maxLength: 200 },
      description: { type: 'string', maxLength: 8000 },
      original_file_url: { type: 'string', format: 'uri', maxLength: 2000 },
      original_file_name: { type: 'string', minLength: 1, maxLength: 300 },
      idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
    },
    required: ['client_id', 'title', 'original_file_url', 'original_file_name', 'idempotency_key'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    const parsed = createContractSchema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    try { return await createContract(parsed.data, ensureWriteCtx(ctx)); }
    catch (e) { throw writeError(e); }
  },
};

const updateContractTool: ToolDefinition = {
  name: 'aceleriq_update_contract',
  title: 'Atualizar rascunho de contrato',
  description: 'Atualiza title, description, project_id ou arquivo somente enquanto o contrato permanece em draft, sem assinatura administrativa ou do cliente, sem sent_at e sem arquivo final. Nunca altera client_id, sign_token, assinaturas ou created_by.',
  scopes: CONTRACTS_WRITE,
  annotations: WRITE_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: {
      contract_id: { type: 'string', format: 'uuid' },
      title: { type: 'string', minLength: 1, maxLength: 200 },
      description: { type: ['string', 'null'], maxLength: 8000 },
      original_file_url: { type: 'string', format: 'uri', maxLength: 2000 },
      original_file_name: { type: 'string', minLength: 1, maxLength: 300 },
      project_id: { type: ['string', 'null'], format: 'uuid' },
      idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
    },
    required: ['contract_id', 'idempotency_key'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    const parsed = updateContractSchema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    try { return await updateContract(parsed.data, ensureWriteCtx(ctx)); }
    catch (e) { throw writeError(e); }
  },
};

const cancelContractTool: ToolDefinition = {
  name: 'aceleriq_cancel_contract',
  title: 'Cancelar rascunho de contrato',
  description: 'Cancela somente um contrato em draft completamente não assinado e nunca enviado (status → cancelled). Aceita reason opcional, anexada à description. Não cancela contratos assinados, aprovados, enviados ou publicados.',
  scopes: CONTRACTS_WRITE,
  annotations: { ...WRITE_ANNOTATIONS, destructiveHint: true },
  inputSchema: {
    type: 'object',
    properties: {
      contract_id: { type: 'string', format: 'uuid' },
      reason: { type: 'string', maxLength: 2000 },
      idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
    },
    required: ['contract_id', 'idempotency_key'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    const parsed = cancelContractSchema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    try { return await cancelContract(parsed.data, ensureWriteCtx(ctx)); }
    catch (e) { throw writeError(e); }
  },
};



// ─── Dossiê do cliente: o retrato inteiro numa chamada ────────────────────
const getClientDossierTool: ToolDefinition = {
  name: 'aceleriq_get_client_dossier',
  title: 'Dossiê do cliente',
  description: 'Retrato COMPLETO de um cliente numa única chamada, pronto para virar contexto: cadastro, serviços contratados, frentes ativas, tarefas abertas, bastidor do ciclo semanal das últimas 6 semanas, publicações (no ar, agendadas e as que perderam a data), entregas recentes, aprovações paradas com dias de espera, últimos relatórios com o que foi prometido, briefings, contratos, carteira de anúncios, os NÚMEROS REAIS do Instagram (8 semanas com variação) e das campanhas de Meta Ads (30 dias por campanha), as publicações que mais performaram, a história já registrada na memória e a FASE do método A.C.E.L.E.R.A em que o cliente está (analisar, clarear, estruturar, lancar, executar, revisar, acelerar), calculada pela evolução real dele. Use esta ferramenta ANTES de escrever qualquer coisa sobre o cliente: ela substitui dez chamadas separadas. Atenção: são fatos do painel. O que voltar vazio significa que não há registro, NÃO que o trabalho não existe.',
  scopes: ['clients:read'] as const,
  annotations: READ_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: { client_id: { type: 'string', format: 'uuid' } },
    required: ['client_id'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    const schema = z.object({ client_id: z.string().uuid() }).strict();
    const parsed = schema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.message}`);
    return await getClientDossier(parsed.data, ctx);
  },
};

const updateClientTool: ToolDefinition = {
  name: 'aceleriq_update_client',
  title: 'Atualizar cadastro do cliente',
  description:
    'Atualiza cadastro e situação de um cliente: full_name, company_name, phone, plan_status (onboarding/active/standby/inactive), client_type, brand. É assim que se ATIVA, PAUSA (standby) ou DESATIVA um cliente — nenhum cadastro é apagado, muda-se a situação. NÃO altera e-mail (é a credencial de login), nem plano/valor/renovação (o Financeiro é a fonte), nem os serviços contratados (isso é contrato, decisão de painel). change_reason é obrigatório.',
  scopes: ['clients:write'] as const,
  annotations: WRITE_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: {
      client_id: { type: 'string', format: 'uuid' },
      full_name: { type: 'string', minLength: 1, maxLength: 200 },
      company_name: { type: ['string', 'null'], maxLength: 200 },
      phone: { type: ['string', 'null'], maxLength: 40 },
      plan_status: { type: 'string', enum: ['onboarding', 'active', 'standby', 'inactive'] },
      client_type: { type: 'string', maxLength: 40 },
      brand: { type: ['string', 'null'], maxLength: 80 },
      change_reason: { type: 'string', minLength: 3, maxLength: 400 },
      idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
    },
    required: ['client_id', 'change_reason', 'idempotency_key'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    const parsed = updateClientSchema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    try { return await updateClient(parsed.data, ensureWriteCtx(ctx)); }
    catch (e) { throw writeError(e); }
  },
};

// ─── Arquivar / restaurar / reabrir ───────────────────────────
// Exclusão definitiva não existe no MCP: o destrutivo vira arquivamento,
// e todo arquivamento tem par de restauração. reason obrigatório nos dois
// sentidos que tiram algo da vista.
const archiveProjectTool: ToolDefinition = {
  name: 'aceleriq_archive_project',
  title: 'Arquivar projeto',
  description:
    'Arquiva um projeto (deleted_at), tirando-o das listas sem apagar nada: tarefas, arquivos e histórico continuam no banco e voltam com aceleriq_restore_project. NÃO exclui definitivamente. Recusa projeto já arquivado. reason é obrigatório.',
  scopes: WRITE,
  annotations: { ...WRITE_ANNOTATIONS, destructiveHint: true },
  inputSchema: {
    type: 'object',
    properties: {
      project_id: { type: 'string', format: 'uuid' },
      reason: { type: 'string', minLength: 3, maxLength: 400 },
      idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
    },
    required: ['project_id', 'reason', 'idempotency_key'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    const parsed = archiveProjectSchema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    try { return await archiveProject(parsed.data, ensureWriteCtx(ctx)); }
    catch (e) { throw writeError(e); }
  },
};

const restoreProjectTool: ToolDefinition = {
  name: 'aceleriq_restore_project',
  title: 'Restaurar projeto',
  description:
    'Traz de volta um projeto arquivado (deleted_at volta a nulo), com tudo que estava pendurado nele. Recusa projeto que não está arquivado.',
  scopes: WRITE,
  annotations: WRITE_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: {
      project_id: { type: 'string', format: 'uuid' },
      idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
    },
    required: ['project_id', 'idempotency_key'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    const parsed = restoreProjectSchema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    try { return await restoreProject(parsed.data, ensureWriteCtx(ctx)); }
    catch (e) { throw writeError(e); }
  },
};

const reopenTaskTool: ToolDefinition = {
  name: 'aceleriq_reopen_task',
  title: 'Reabrir tarefa',
  description:
    'Reabre uma tarefa concluída, devolvendo-a ao fluxo (padrão: doing; aceita backlog, todo, doing ou review). É o par de aceleriq_complete_task: sem ele, uma conclusão equivocada só se desfazia pelo painel. Recusa tarefa que não está concluída. reason é obrigatório.',
  scopes: WRITE,
  annotations: WRITE_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', format: 'uuid' },
      status: { type: 'string', enum: ['backlog', 'todo', 'doing', 'review'] },
      reason: { type: 'string', minLength: 3, maxLength: 400 },
      idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
    },
    required: ['task_id', 'reason', 'idempotency_key'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    const parsed = reopenTaskSchema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    try { return await reopenTask(parsed.data, ensureWriteCtx(ctx)); }
    catch (e) { throw writeError(e); }
  },
};

// ─── Dossiê com estado atual canônico ──────────────────────────
// Duas camadas: project_memory segue como HISTÓRIA cumulativa;
// client_dossiers guarda o ESTADO ATUAL com um único is_current por
// (cliente, projeto, tipo), versão sequencial e bloqueio de regressão.
const upsertCurrentDossierTool: ToolDefinition = {
  name: 'aceleriq_upsert_current_dossier',
  title: 'Dossiê — atualizar estado atual',
  description:
    'Atualiza o dossiê de contexto de um cliente de forma TRANSACIONAL e versionada: a versão anterior vira histórico (superseded, nunca apagada) e a nova vira o único estado atual da chave (client_id, project_id, dossier_type). expected_version bloqueia regressão: passe a versão que você LEU (0 se não existia); se o mundo mudou desde então, a chamada retorna conflito e você relê antes de regravar. change_reason é obrigatório: toda mudança carrega o porquê. Idempotente por idempotency_key. Para o painel, o registro retornado É o que o card exibe. Use aceleriq_upsert_project_memory apenas para eventos históricos avulsos — ele não mantém estado atual.',
  scopes: ['clients:write'] as const,
  annotations: WRITE_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: {
      client_id: { type: 'string', format: 'uuid' },
      project_id: { type: 'string', format: 'uuid' },
      dossier_type: { type: 'string', maxLength: 60, default: 'contexto' },
      content: { type: 'string', minLength: 3, maxLength: 60000 },
      summary: { type: 'string', maxLength: 400 },
      change_reason: { type: 'string', minLength: 3, maxLength: 400 },
      source: { type: 'string', maxLength: 60 },
      tags: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 20 },
      metadata: { type: 'object' },
      expected_version: { type: 'integer', minimum: 0 },
      idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
    },
    required: ['client_id', 'content', 'change_reason', 'idempotency_key'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    const parsed = upsertCurrentDossierSchema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    try { return await upsertCurrentDossier(parsed.data, ensureWriteCtx(ctx)); }
    catch (e) { throw writeError(e); }
  },
};

const getCurrentDossierTool: ToolDefinition = {
  name: 'aceleriq_get_current_dossier',
  title: 'Dossiê — estado atual e histórico',
  description:
    'Devolve o dossiê ATUAL de um cliente pela chave canônica (client_id, project_id, dossier_type) — o mesmo registro que o painel exibe — mais o histórico de versões (resumos, sem o corpo). Passe version para ler o corpo de uma versão antiga. Leia SEMPRE antes de atualizar: current_version é o expected_version da sua próxima gravação.',
  scopes: ['clients:read'] as const,
  annotations: READ_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: {
      client_id: { type: 'string', format: 'uuid' },
      project_id: { type: 'string', format: 'uuid' },
      dossier_type: { type: 'string', maxLength: 60, default: 'contexto' },
      version: { type: 'integer', minimum: 1 },
    },
    required: ['client_id'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    const schema = z.object({
      client_id: z.string().uuid(),
      project_id: z.string().uuid().optional(),
      dossier_type: z.string().max(60).optional(),
      version: z.number().int().min(1).optional(),
    }).strict();
    const parsed = schema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.message}`);
    return await getCurrentDossier(parsed.data, ctx);
  },
};

const auditIntegrityTool: ToolDefinition = {
  name: 'aceleriq_audit_integrity',
  title: 'Auditoria global de integridade',
  description:
    'Varre TODOS os clientes e devolve um relatório de inconsistências mensuráveis: dossiês atuais duplicados, clientes sem dossiê atual, tarefas apontando para projeto removido, arquivos e relatórios sem cliente, projetos cujo dono não é cliente, memória sem vínculo. É leitura pura — nada é alterado; repare com as ferramentas de escrita, que auditam cada mudança. Exige credencial sem restrição de clientes.',
  scopes: ['clients:read'] as const,
  annotations: READ_ANNOTATIONS,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (_input, ctx) => {
    return await auditIntegrity({}, ctx);
  },
};

// ─── Ciclo semanal de operação (o bastidor por cliente) ────────────────────
const getWeeklyCycleTool: ToolDefinition = {
  name: 'aceleriq_get_weekly_cycle',
  title: 'Ciclo da semana — ler',
  description: 'Lê o checklist semanal de operação por cliente: quais etapas do ciclo (Social Media ou Tráfego Pago) foram concluídas em cada semana, quando e por quem. É o bastidor do trabalho, o que mostra se a rotina rodou de verdade naquela semana. Traz também os avulsos (extras): gravação, reunião, ajuste pedido no meio da semana — trabalho real que não cabe nas 6 etapas fixas e que costuma explicar o resultado. Sem week_start, devolve a semana atual.',
  scopes: ['projects:read'] as const,
  annotations: READ_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: {
      client_id: { type: 'string', format: 'uuid' },
      area: { type: 'string', enum: ['social', 'trafego'] },
      week_start: { type: 'string', description: 'Segunda-feira da semana, no formato AAAA-MM-DD. Sem isto, usa a semana atual.' },
      weeks: { type: 'integer', minimum: 1, maximum: 12, description: 'Quantas semanas para trás incluir a partir de week_start.' },
    },
    additionalProperties: false,
  },
  handler: async (input) => {
    const schema = z.object({
      client_id: z.string().uuid().optional(),
      area: z.enum(['social', 'trafego']).optional(),
      week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      weeks: limite(12),
    }).strict();
    const parsed = schema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.message}`);
    return await listWeeklyCycle(parsed.data);
  },
};

// ─── Resultado real: Instagram e Meta Ads ──────────────────────────────────
import {
  listAdsCampaigns as _listAdsCampaigns,
  listAdsPerformance as _listAdsPerformance,
  listSocialMetrics as _listSocialMetrics,
  listSocialPosts as _listSocialPosts,
} from './aceleriq-metrics-services.ts';

const getSocialMetricsTool: ToolDefinition = {
  name: 'aceleriq_get_social_metrics',
  title: 'Instagram — números por semana',
  description: 'Lê os números REAIS do Instagram do cliente, semana fechada a semana fechada: seguidores, alcance, visitas ao perfil, contas engajadas e interações. Já devolve a variação percentual contra a semana anterior, calculada aqui para não depender da ordem da lista. Use antes de afirmar qualquer coisa sobre desempenho de conteúdo: sem isto, a leitura é chute.',
  scopes: ['reports:read'] as const,
  annotations: READ_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: {
      client_id: { type: 'string', format: 'uuid' },
      weeks: { type: 'integer', minimum: 1, maximum: 52, description: 'Quantas semanas para trás. Padrão 12.' },
    },
    additionalProperties: false,
  },
  handler: async (input) => {
    const schema = z.object({
      client_id: z.string().uuid().optional(),
      weeks: limite(52),
    }).strict();
    const parsed = schema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.message}`);
    return await _listSocialMetrics(parsed.data);
  },
};

const listSocialPostsTool: ToolDefinition = {
  name: 'aceleriq_list_social_posts',
  title: 'Instagram — histórico de publicações',
  description: 'Histórico das publicações do cliente com o desempenho real de cada uma: curtidas, comentários, alcance, salvamentos, compartilhamentos e interações totais, com a legenda e o link do post. Vem com o ranking das cinco que mais performaram. Use para dizer O QUE funcionou, com o post na mão, em vez de falar de conteúdo em geral.',
  scopes: ['reports:read'] as const,
  annotations: READ_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: {
      client_id: { type: 'string', format: 'uuid' },
      limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Quantas publicações. Padrão 25.' },
    },
    additionalProperties: false,
  },
  handler: async (input) => {
    const schema = z.object({
      client_id: z.string().uuid().optional(),
      limit: limite(100),
    }).strict();
    const parsed = schema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.message}`);
    return await _listSocialPosts(parsed.data);
  },
};

const getAdsCampaignsTool: ToolDefinition = {
  name: 'aceleriq_get_ads_campaigns',
  title: 'Meta Ads — campanhas e situação',
  description: 'As campanhas de Meta Ads do cliente com nome, objetivo, verba diária ou total configurada, datas e situação. Traz status (o que a equipe configurou) e effective_status (o que a Meta está realmente fazendo) — os dois discordam com frequência, e quem vale é o segundo: campanha marcada como ativa pode estar parada por verba, conta ou reprovação.',
  scopes: ['reports:read'] as const,
  annotations: READ_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: {
      client_id: { type: 'string', format: 'uuid' },
      only_active: { type: 'boolean', description: 'Só o que a Meta está realmente rodando agora.' },
    },
    additionalProperties: false,
  },
  handler: async (input) => {
    const schema = z.object({
      client_id: z.string().uuid().optional(),
      only_active: z.boolean().optional(),
    }).strict();
    const parsed = schema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.message}`);
    return await _listAdsCampaigns(parsed.data);
  },
};

const getAdsPerformanceTool: ToolDefinition = {
  name: 'aceleriq_get_ads_performance',
  title: 'Meta Ads — desempenho por dia e por campanha',
  description: 'O desempenho REAL das campanhas: investimento, alcance, exibições, cliques no link e os resultados por tipo (conversas iniciadas, cadastros, compras). Devolve o dia a dia (para ver tendência) E o total já agregado por campanha (para responder quanto rendeu). ATENÇÃO ao ler: alcance NÃO se soma entre dias — a mesma pessoa alcançada em dois dias não são duas pessoas; o campo reach do agregado já é o maior dia, que é o piso honesto. Em results_by_type, qual tipo É o resultado depende do objetivo da campanha.',
  scopes: ['reports:read'] as const,
  annotations: READ_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: {
      client_id: { type: 'string', format: 'uuid' },
      days: { type: 'integer', minimum: 1, maximum: 30, description: 'Janela em dias. Padrão e máximo 30, que é o que a coleta guarda.' },
    },
    additionalProperties: false,
  },
  handler: async (input) => {
    const schema = z.object({
      client_id: z.string().uuid().optional(),
      days: limite(30),
    }).strict();
    const parsed = schema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.message}`);
    return await _listAdsPerformance(parsed.data);
  },
};

// ─── Project Memory (persistent, large context per client/project) ─────────
import { listMemory as _listProjectMemory, upsertMemory as _upsertProjectMemory } from './project-memory-services.ts';

const getProjectMemoryTool: ToolDefinition = {
  name: 'aceleriq_get_project_memory',
  title: 'Memória do projeto — ler',
  description: 'Lê a história persistente de um cliente: mensagens enviadas (ritual), semanas de operação fechadas (ciclo), entregas, aprovações, decisões, anotações da equipe, trabalhos avulsos da semana, listas rápidas e marcos, além do que agentes externos registraram. Ordem do mais recente para o mais antigo. Use para retomar contexto de onde parou antes de escrever ou decidir qualquer coisa sobre o cliente.',
  scopes: ['projects:read'] as const,
  annotations: READ_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: {
      client_id: { type: 'string', format: 'uuid' },
      project_id: { type: 'string', format: 'uuid' },
      kind: { type: 'string', enum: ['ritual','ciclo','entrega','aprovacao','decisao','nota','marco','avulso','checklist','note','summary','decision','fact','second_brain','external'] },
      limit: { type: 'integer', minimum: 1, maximum: 200 },
    },
    required: ['client_id'],
    additionalProperties: false,
  },
  handler: async (input) => {
    const schema = z.object({
      client_id: z.string().uuid(),
      project_id: z.string().uuid().optional(),
      kind: z.enum(['ritual','ciclo','entrega','aprovacao','decisao','nota','marco','avulso','checklist','note','summary','decision','fact','second_brain','external']).optional(),
      limit: limite(200),
    }).strict();
    const parsed = schema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.message}`);
    const items = await _listProjectMemory(parsed.data);
    return { count: items.length, items };
  },
};

const upsertProjectMemoryTool: ToolDefinition = {
  name: 'aceleriq_upsert_project_memory',
  title: 'Memória do projeto — gravar',
  description: 'Adiciona um registro persistente à memória de um cliente/projeto (nota, resumo, decisão, fato). Cumulativo — nunca sobrescreve. Ideal para o ChatGPT/Codex/Hermes registrarem EVENTOS vindos de fora do painel. NÃO mantém o estado atual do dossiê: o card do painel lê a chave canônica de aceleriq_upsert_current_dossier — gravar só aqui deixa o painel desatualizado.',
  scopes: ['projects:write'] as const,
  annotations: { ...WRITE_ANNOTATIONS, idempotentHint: false },
  inputSchema: {
    type: 'object',
    properties: {
      client_id: { type: 'string', format: 'uuid' },
      project_id: { type: 'string', format: 'uuid' },
      kind: { type: 'string', enum: ['ritual','ciclo','entrega','aprovacao','decisao','nota','marco','avulso','checklist','note','summary','decision','fact','second_brain','external'] },
      source: { type: 'string', maxLength: 60 },
      title: { type: 'string', maxLength: 200 },
      content: { type: 'string', minLength: 3, maxLength: 20000 },
      tags: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 20 },
      metadata: { type: 'object' },
    },
    required: ['client_id', 'content'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    const schema = z.object({
      client_id: z.string().uuid(),
      project_id: z.string().uuid().optional(),
      kind: z.enum(['ritual','ciclo','entrega','aprovacao','decisao','nota','marco','avulso','checklist','note','summary','decision','fact','second_brain','external']).optional(),
      source: z.string().max(60).optional(),
      title: z.string().max(200).optional(),
      content: z.string().min(3).max(20000),
      tags: z.array(z.string().max(40)).max(20).optional(),
      metadata: z.record(z.unknown()).optional(),
    }).strict();
    const parsed = schema.safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.message}`);
    const created = await _upsertProjectMemory({
      ...parsed.data,
      source: parsed.data.source ?? ctx.origin ?? 'mcp',
      metadata: { ...(parsed.data.metadata ?? {}), origin: ctx.origin, key_id: ctx.keyId },
    });
    return { ok: true, ...created };
  },
};

// ─── Files v2 (Bloco B — v1.7.0) ──────────────────────────────
import {
  FILE_WRITE_ENABLED,
  archiveFile, archiveSchema,
  createFileVersion, createVersionSchema,
  finalizeFileUpload, finalizeUploadSchema,
  getFileContent, getContentSchema,
  getProcessingStatus, processingStatusSchema,
  inlineUploadSchema, uploadFileInline,
  prepareFileUpload, prepareUploadSchema,
  restoreFile, restoreSchema,
  searchFileContent, searchContentSchema,
  updateFileMetadata, updateMetadataSchema,
  FileError,
} from './mcp-files-services.ts';

const FILES_WRITE: readonly ToolScope[] = ['files:write'];
const FILES_ARCHIVE: readonly ToolScope[] = ['files:archive'];
const FILES_READ: readonly ToolScope[] = ['files:read'];

function toRpc(e: unknown): Error {
  if (e instanceof FileError) return new Error(`[${e.code}] ${e.message}`);
  return e instanceof Error ? e : new Error(String(e));
}

function makeFileTool(
  name: string, title: string, description: string,
  scopes: readonly ToolScope[], schema: z.ZodTypeAny, jsonSchema: Record<string, unknown>,
  fn: (input: any, ctx: any) => Promise<unknown>,
  writeOp = false,
): ToolDefinition {
  return {
    name, title, description, scopes,
    annotations: writeOp ? { ...WRITE_ANNOTATIONS } : READ_ANNOTATIONS,
    inputSchema: jsonSchema,
    handler: async (input, ctx) => {
      const parsed = schema.safeParse(input ?? {});
      if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
      try {
        return await fn(parsed.data, {
          keyId: ctx.keyId, scopes: ctx.scopes, origin: ctx.origin,
          correlationId: ctx.correlationId ?? crypto.randomUUID(),
          resultRefHolder: ctx.resultRefHolder,
        });
      } catch (e) { throw toRpc(e); }
    },
  };
}

const prepareUploadTool = makeFileTool(
  'aceleriq_prepare_file_upload', 'Preparar upload de arquivo',
  'Cria um rascunho interno e devolve URL assinada de upload para o bucket privado mcp-files. Agentes não publicam nem aprovam arquivos. Exige files:write e valida cliente, projeto e MIME.',
  FILES_WRITE, prepareUploadSchema,
  { type: 'object', additionalProperties: false, required: ['client_id','file_name','mime_type','size_bytes','folder','idempotency_key'], properties: {
    client_id: { type: 'string', format: 'uuid' }, project_id: { type: 'string', format: 'uuid' },
    file_name: { type: 'string', maxLength: 255 }, mime_type: { type: 'string' },
    size_bytes: { type: 'integer', minimum: 1 }, sha256: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
    folder: { type: 'string', enum: ['estrategicos','materiais','operacionais','contratos','relatorios','entregas'] },
    file_type: { type: 'string' },
    sensitivity: { type: 'string', enum: ['normal','confidential','restricted'] },
    description: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
  }},
  prepareFileUpload, true,
);

const finalizeUploadTool = makeFileTool(
  'aceleriq_finalize_file_upload', 'Finalizar upload de arquivo',
  'Confirma upload no Storage, valida SHA-256 e tamanho, marca status=ready e enfileira extração. Coloca em quarentena se houver divergência.',
  FILES_WRITE, finalizeUploadSchema,
  { type: 'object', additionalProperties: false, required: ['file_id','idempotency_key'], properties: {
    file_id: { type: 'string', format: 'uuid' },
    sha256: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
    idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
  }},
  finalizeFileUpload, true,
);

const inlineUploadTool = makeFileTool(
  'aceleriq_upload_file_inline', 'Upload inline (base64)',
  'Upload direto por conteúdo Base64. Limite padrão 10 MB. Ideal para anexos pequenos. Não registra Base64 em logs nem devolve na resposta.',
  FILES_WRITE, inlineUploadSchema,
  { type: 'object', additionalProperties: false, required: ['client_id','file_name','mime_type','content_base64','folder','idempotency_key'], properties: {
    client_id: { type: 'string', format: 'uuid' }, project_id: { type: 'string', format: 'uuid' },
    file_name: { type: 'string', maxLength: 255 }, mime_type: { type: 'string' },
    content_base64: { type: 'string', description: 'Base64 do conteúdo (≤10MB decodificado).' },
    folder: { type: 'string', enum: ['estrategicos','materiais','operacionais','contratos','relatorios','entregas'] },
    file_type: { type: 'string' },
    sensitivity: { type: 'string', enum: ['normal','confidential','restricted'] },
    description: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
  }},
  uploadFileInline, true,
);

// aceleriq_upload_file (canal do ChatGPT Apps SDK) — atualmente usa o mesmo mecanismo inline;
// o SDK oficial de anexos será plugado no Bloco C sem quebrar este contrato.
const uploadFileTool = makeFileTool(
  'aceleriq_upload_file', 'Anexar arquivo (canal ChatGPT)',
  'Recebe arquivos anexados pelo usuário na conversa (ChatGPT/Codex). Atualmente aceita content_base64 como fallback universal; a integração oficial do Apps SDK de anexos é ativada por _meta.attachments quando disponível.',
  FILES_WRITE, inlineUploadSchema,
  { type: 'object', additionalProperties: false, required: ['client_id','file_name','mime_type','content_base64','folder','idempotency_key'], properties: {
    client_id: { type: 'string', format: 'uuid' }, project_id: { type: 'string', format: 'uuid' },
    file_name: { type: 'string', maxLength: 255 }, mime_type: { type: 'string' },
    content_base64: { type: 'string' },
    folder: { type: 'string', enum: ['estrategicos','materiais','operacionais','contratos','relatorios','entregas'] },
    file_type: { type: 'string' },
    sensitivity: { type: 'string', enum: ['normal','confidential','restricted'] },
    description: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
  }},
  uploadFileInline, true,
);

const getContentTool = makeFileTool(
  'aceleriq_get_file_content', 'Ler conteúdo do arquivo',
  'Lê o conteúdo extraído (páginas/planilhas/slides/chunks) com paginação. Documentos confidenciais/restritos exigem files:sensitive:read. Arquivos em quarentena não devolvem conteúdo.',
  FILES_READ, getContentSchema,
  { type: 'object', additionalProperties: false, required: ['file_id'], properties: {
    file_id: { type: 'string', format: 'uuid' },
    mode: { type: 'string', enum: ['metadata','full','chunks','pages','sheets','slides'] },
    start_page: { type: 'integer', minimum: 1 }, end_page: { type: 'integer', minimum: 1 },
    sheet_name: { type: 'string' },
    start_slide: { type: 'integer', minimum: 1 }, end_slide: { type: 'integer', minimum: 1 },
    offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200 },
    include_metadata: { type: 'boolean' },
  }},
  getFileContent, false,
);

const searchContentTool = makeFileTool(
  'aceleriq_search_file_content', 'Pesquisar dentro dos documentos',
  'Full-text search em português dentro do conteúdo extraído. Respeita client_id, projeto, sensibilidade e escopos. Nunca retorna conteúdo sensível sem files:sensitive:read.',
  FILES_READ, searchContentSchema,
  { type: 'object', additionalProperties: false, required: ['query'], properties: {
    query: { type: 'string', minLength: 1, maxLength: 500 },
    client_id: { type: 'string', format: 'uuid' }, project_id: { type: 'string', format: 'uuid' },
    file_id: { type: 'string', format: 'uuid' },
    folder: { type: 'string', enum: ['estrategicos','materiais','operacionais','contratos','relatorios','entregas'] },
    file_type: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
    limit: { type: 'integer', minimum: 1, maximum: 100 }, offset: { type: 'integer', minimum: 0 },
    include_snippets: { type: 'boolean' },
  }},
  searchFileContent, false,
);

const updateMetadataTool = makeFileTool(
  'aceleriq_update_file_metadata', 'Atualizar metadados',
  'Atualiza somente metadados internos permitidos (pasta, sensibilidade, tags e descrição). Nunca publica, aprova, troca client_id, uploaded_by, sha256 ou storage_path.',
  FILES_WRITE, updateMetadataSchema,
  { type: 'object', additionalProperties: false, required: ['file_id','idempotency_key'], properties: {
    file_id: { type: 'string', format: 'uuid' }, project_id: { type: ['string','null'], format: 'uuid' },
    folder: { type: 'string', enum: ['estrategicos','materiais','operacionais','contratos','relatorios','entregas'] },
    file_type: { type: 'string' },
    sensitivity: { type: 'string', enum: ['normal','confidential','restricted'] },
    description: { type: 'string' }, caption: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
  }},
  updateFileMetadata, true,
);

const createVersionTool = makeFileTool(
  'aceleriq_create_file_version', 'Criar nova versão',
  'Cria uma correção interna ligada por revision_of_file_id. A versão anterior permanece imutável e a nova precisa passar novamente pelas duas aprovações humanas.',
  FILES_WRITE, createVersionSchema,
  { type: 'object', additionalProperties: false, required: ['parent_file_id','content_base64','mime_type','idempotency_key'], properties: {
    parent_file_id: { type: 'string', format: 'uuid' },
    content_base64: { type: 'string' }, file_name: { type: 'string' }, mime_type: { type: 'string' },
    version_notes: { type: 'string' },
    idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
  }},
  createFileVersion, true,
);

const archiveTool = makeFileTool(
  'aceleriq_archive_file', 'Arquivar (soft delete)',
  'Marca o arquivo como archived preservando histórico e Storage. Contratos oficiais assinados não podem ser arquivados via MCP.',
  FILES_ARCHIVE, archiveSchema,
  { type: 'object', additionalProperties: false, required: ['file_id','idempotency_key'], properties: {
    file_id: { type: 'string', format: 'uuid' }, reason: { type: 'string' },
    idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
  }},
  archiveFile, true,
);

const restoreTool = makeFileTool(
  'aceleriq_restore_file', 'Restaurar arquivo arquivado',
  'Restaura arquivo previamente arquivado (status → ready). Registra auditoria.',
  FILES_ARCHIVE, restoreSchema,
  { type: 'object', additionalProperties: false, required: ['file_id','idempotency_key'], properties: {
    file_id: { type: 'string', format: 'uuid' },
    idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
  }},
  restoreFile, true,
);

const processingStatusTool = makeFileTool(
  'aceleriq_get_file_processing_status', 'Status de processamento',
  'Consulta status de upload/validação/extração sem baixar conteúdo. Recebe file_id ou processing_job_id.',
  FILES_READ, processingStatusSchema,
  { type: 'object', additionalProperties: false, properties: {
    file_id: { type: 'string', format: 'uuid' }, processing_job_id: { type: 'string', format: 'uuid' },
  }},
  getProcessingStatus, false,
);



// ─── Financeiro (somente leitura) ─────────────────────────────
const MODO_FINANCEIRO = z.enum(['cash', 'accrual', 'forecast']);
const COMPETENCIA = z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'competence must be YYYY-MM or YYYY-MM-DD');

const MODO_JSON = {
  type: 'string',
  enum: ['cash', 'accrual', 'forecast'],
  description: "Olhar: 'cash' (caixa, o que entrou/saiu), 'accrual' (competência) ou 'forecast' (previsto). Padrão: cash.",
};
const COMPETENCIA_JSON = {
  type: 'string',
  description: 'Mês de competência, YYYY-MM (ou YYYY-MM-DD, normalizado para o dia 1). Padrão: mês corrente.',
};

const financeOverviewTool = makeFinanceRead(
  'aceleriq_get_finance_overview',
  'Retrato financeiro do mês',
  'O mês em uma leitura: saldo inicial, entrou, saiu, líquido, recebido e pago, a receber e a pagar, vencido, receita recorrente, custo fixo, previsão de 30/60/90 dias e número de clientes. Vem das MESMAS funções que a tela do Financeiro usa, então nunca discorda dela. SOMENTE LEITURA: o MCP não lança, não baixa e não cancela nada.',
  z.object({ mode: MODO_FINANCEIRO.optional(), competence: COMPETENCIA.optional() }).strict(),
  {
    type: 'object',
    properties: { mode: MODO_JSON, competence: COMPETENCIA_JSON },
    additionalProperties: false,
  },
  (input) => getFinanceOverview(input),
);

const financeEntriesTool = makeFinanceRead(
  'aceleriq_list_finance_entries',
  'Movimentações do caixa',
  'As linhas do mês: cada entrada e saída com data, vencimento, cliente, valor, imposto reservado, se já foi baixada e por qual método. Filtra por direção (in/out), situação e cliente, e devolve os totais do filtro. SOMENTE LEITURA.',
  z.object({
    mode: MODO_FINANCEIRO.optional(),
    competence: COMPETENCIA.optional(),
    direction: z.enum(['in', 'out']).optional(),
    status: z.string().max(40).optional(),
    client_id: UUID.optional(),
    limit: limite(500),
    offset: z.number().int().min(0).optional(),
  }).strict(),
  {
    type: 'object',
    properties: {
      mode: MODO_JSON,
      competence: COMPETENCIA_JSON,
      direction: { type: 'string', enum: ['in', 'out'], description: "'in' = entrada, 'out' = saída." },
      status: { type: 'string', description: 'Situação do lançamento (ex.: pending, settled, scheduled).' },
      client_id: { type: 'string', description: 'UUID do cliente. Traz também as baixas do lançamento dele.' },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 25 },
      offset: { type: 'integer', minimum: 0, default: 0 },
    },
    additionalProperties: false,
  },
  (input) => listFinanceEntries(input),
);

const financeClientSummariesTool = makeFinanceRead(
  'aceleriq_get_finance_client_summaries',
  'Financeiro por cliente',
  'Cada cliente com plano, valor contratado, recebido, em aberto, vencido, próximo vencimento e margem de contribuição depois do imposto e do custo direto. Traz o resumo da carteira (receita contratada, total em aberto, total vencido, quantos clientes têm vencido) e sinaliza quem está com revisão pendente. SOMENTE LEITURA.',
  z.object({ client_id: UUID.optional() }).strict(),
  {
    type: 'object',
    properties: { client_id: { type: 'string', description: 'UUID do cliente, para trazer só ele.' } },
    additionalProperties: false,
  },
  (input) => listFinanceClientSummaries(input),
);

const financePlansTool = makeFinanceRead(
  'aceleriq_list_finance_plans',
  'Planos da casa',
  'Os planos e a versão vigente de cada um: valor operacional, valor final, alíquota, custo direto, taxa de entrada e desde quando vale. `natureza_do_valor` avisa quando o valor ainda precisa de revisão. SOMENTE LEITURA.',
  z.object({
    include_archived: z.boolean().optional(),
    limit: limite(500),
    offset: z.number().int().min(0).optional(),
  }).strict(),
  {
    type: 'object',
    properties: {
      include_archived: { type: 'boolean', description: 'Incluir planos arquivados. Padrão: false.' },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 25 },
      offset: { type: 'integer', minimum: 0, default: 0 },
    },
    additionalProperties: false,
  },
  (input) => listFinancePlans(input),
);

const financeRecurringTool = makeFinanceRead(
  'aceleriq_list_finance_recurring',
  'Recorrências',
  'As regras que se repetem sozinhas todo mês (mensalidade, custo fixo, imposto, pró-labore): valor, frequência, dia de vencimento, vigência e se estão ligadas. É o esqueleto do MRR — o resumo separa receita recorrente de custo recorrente. Atenção: aqui a direção é income/expense, e não o in/out dos lançamentos. SOMENTE LEITURA.',
  z.object({
    client_id: UUID.optional(),
    include_inactive: z.boolean().optional(),
    limit: limite(500),
    offset: z.number().int().min(0).optional(),
  }).strict(),
  {
    type: 'object',
    properties: {
      client_id: { type: 'string', description: 'UUID do cliente, para trazer só as regras dele.' },
      include_inactive: { type: 'boolean', description: 'Incluir regras desligadas. Padrão: false.' },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 25 },
      offset: { type: 'integer', minimum: 0, default: 0 },
    },
    additionalProperties: false,
  },
  (input) => listFinanceRecurringRules(input),
);

const financeBillingTool = makeFinanceRead(
  'aceleriq_get_finance_billing',
  'Cobranca da casa (a tela /financeiro)',
  'A cobranca real do painel, linha a linha, com as MESMAS reguas da tela /financeiro: cliente, tipo (renewal, one_off, project, ads_recharge), valor, quanto de fato entrou (respeitando pagamento parcial), vencimento, pagamento e se esta vencida. O resumo traz recebido no mes, a receber, vencido total e a receita mensal esperada dos planos ativos. Recarga de anuncio nao conta como receita e recorrencia de cliente parado fica fora dos totais, exatamente como na tela. USE ESTA FERRAMENTA quando o modulo v2 vier zerado: e aqui que mora o dinheiro da casa hoje. SOMENTE LEITURA.',
  z.object({
    competence: COMPETENCIA.optional(),
    status: z.string().max(40).optional(),
    type: z.string().max(40).optional(),
    client_id: UUID.optional(),
    limit: limite(500),
    offset: z.number().int().min(0).optional(),
  }).strict(),
  {
    type: 'object',
    properties: {
      competence: COMPETENCIA_JSON,
      status: { type: 'string', description: 'Situacao: pending, paid, partial, cancelled.' },
      type: { type: 'string', description: 'Tipo: renewal, one_off, project, ads_recharge.' },
      client_id: { type: 'string', description: 'UUID do cliente.' },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 25 },
      offset: { type: 'integer', minimum: 0, default: 0 },
    },
    additionalProperties: false,
  },
  (input) => getFinanceBilling(input),
);

const financeDashboardTool = makeFinanceRead(
  'aceleriq_get_finance_dashboard',
  'Painel financeiro completo do mes',
  'A TELA /financeiro inteira para um mes, com as MESMAS formulas dela. Indicadores: saldo em caixa, recebido (com a quebra planos + projetos), a receber, atrasado, receita esperada e projecao do proximo mes. Divisao automatica: bruto, reserva tributaria pela aliquota do plano de cada cliente, receita operacional, custos fixos, pro-labore proporcional pela escada do Plano Diretor, reserva de clientes/investimento, lucro do mes e ponto de equilibrio. Traz ainda a serie do ano mes a mes (recebido x pendente), a proporcao por marca (AcelerIQ, SiteBolt, junto), o resumo dos projetos individuais, o saldo das carteiras de anuncio e as listas de pendentes e recebidos do mes. Funciona para QUALQUER competencia, passada ou futura. SOMENTE LEITURA.',
  z.object({
    competence: COMPETENCIA.optional(),
    incluir_listas: z.boolean().optional(),
  }).strict(),
  {
    type: 'object',
    properties: {
      competence: COMPETENCIA_JSON,
      incluir_listas: {
        type: 'boolean',
        description: 'false devolve so os totais, sem as listas de pendentes e recebidos. Padrao: true.',
      },
    },
    additionalProperties: false,
  },
  (input) => getFinanceDashboard(input),
);

const financeExpensesTool = makeFinanceRead(
  'aceleriq_list_finance_expenses',
  'Despesas e custos fixos',
  'As saidas da casa: descricao, fornecedor, categoria, valor, situacao, recorrencia, vencimento e pagamento. O resumo separa o custo fixo mensal do que foi pago e do que falta pagar no mes. Sem isto o agente ve so o que entra, e dizer que o mes fechou bem ignora metade da conta. SOMENTE LEITURA.',
  z.object({
    competence: COMPETENCIA.optional(),
    status: z.string().max(40).optional(),
    recurrence: z.string().max(40).optional(),
    category: z.string().max(60).optional(),
    limit: limite(500),
    offset: z.number().int().min(0).optional(),
  }).strict(),
  {
    type: 'object',
    properties: {
      competence: COMPETENCIA_JSON,
      status: { type: 'string', description: 'paid, pending...' },
      recurrence: { type: 'string', description: 'monthly para os custos fixos.' },
      category: { type: 'string', description: 'Categoria da despesa.' },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 25 },
      offset: { type: 'integer', minimum: 0, default: 0 },
    },
    additionalProperties: false,
  },
  (input) => listFinanceExpenses(input),
);

const financeProjectPaymentsTool = makeFinanceRead(
  'aceleriq_list_finance_project_payments',
  'Projetos e parcelas',
  'Cada projeto contratado com valor total, entrada, quanto ja foi recebido, quanto falta e quanto esta atrasado, com a lista de parcelas uma a uma (numero, valor, situacao, vencimento e pagamento). E o pedaco que faltava no recebido do mes: a tela soma planos + parcelas de projeto. SOMENTE LEITURA.',
  z.object({
    client_id: UUID.optional(),
    limit: limite(500),
    offset: z.number().int().min(0).optional(),
  }).strict(),
  {
    type: 'object',
    properties: {
      client_id: { type: 'string', description: 'UUID do cliente.' },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 25 },
      offset: { type: 'integer', minimum: 0, default: 0 },
    },
    additionalProperties: false,
  },
  (input) => listFinanceProjectPayments(input),
);

const financeCashFlowTool = makeFinanceRead(
  'aceleriq_get_finance_cash_flow',
  'Fluxo de caixa',
  'O caixa da casa: base conciliada, tudo que entrou, tudo que saiu, saldo, quanto esta reservado em caixinhas e o SALDO LIVRE - o numero que decide se da para gastar. Traz a serie mes a mes (entrou, saiu, resultado, aportes de socio), as saidas por categoria e o total a pagar em aberto. O segmento separa a carteira recorrente da avulsa pelo tipo do cliente, como na tela. Aporte de socio nao entra como receita nem como despesa: e capital. SOMENTE LEITURA.',
  z.object({
    meses: limite(24),
    segmento: z.enum(['all', 'recurring', 'one_off']).optional(),
  }).strict(),
  {
    type: 'object',
    properties: {
      meses: { type: 'integer', minimum: 1, maximum: 24, default: 12, description: 'Quantos meses na serie.' },
      segmento: { type: 'string', enum: ['all', 'recurring', 'one_off'], description: 'Carteira: toda, recorrente ou avulsa.' },
    },
    additionalProperties: false,
  },
  (input) => getFinanceCashFlow(input),
);

const financeMensalidadesTool = makeFinanceRead(
  'aceleriq_list_finance_mensalidades',
  'Mensalidades e MRR',
  'A carteira recorrente cliente por cliente: plano, valor mensal, situacao, renovacao, ultimo pagamento, proxima cobranca, quanto esta em aberto, quanto esta vencido e se esta em dia. O resumo traz MRR, ticket medio, quantos mensalistas ativos e quantos inadimplentes. Responde de onde vem o MRR e quem esta devendo, apontando o nome - nao um total anonimo. SOMENTE LEITURA.',
  z.object({ incluir_inativos: z.boolean().optional() }).strict(),
  {
    type: 'object',
    properties: {
      incluir_inativos: { type: 'boolean', description: 'Incluir planos pausados/inativos. Padrao: false.' },
    },
    additionalProperties: false,
  },
  (input) => listFinanceMensalidades(input),
);

const financeCapitalTool = makeFinanceRead(
  'aceleriq_get_finance_capital',
  'Capital e investimentos',
  'O dinheiro do socio, separado da operacao: total aportado, total investido por categoria (trafego, ferramentas, insumos, escritorio, outros), a receita do periodo desde o primeiro aporte e o retorno bruto. Cada aporte vem listado com data e valor. Aporte NAO e despesa: misturar faria o mes parecer prejuizo sempre que entrasse dinheiro proprio. SOMENTE LEITURA.',
  z.object({ desde: COMPETENCIA.optional() }).strict(),
  {
    type: 'object',
    properties: {
      desde: { type: 'string', description: 'Data de corte YYYY-MM-DD. Padrao: a data do primeiro aporte.' },
    },
    additionalProperties: false,
  },
  (input) => getFinanceCapital(input),
);

const financeAdsTool = makeFinanceRead(
  'aceleriq_get_finance_ads_investment',
  'Investimento em anuncio',
  'Quanto a casa investe em aquisicao (Marketing & Ads proprios + Trafego pago) contra a receita recebida, mes a mes. Traz tambem o saldo das carteiras de anuncio dos clientes e as recargas pendentes. E termometro de aquisicao, nao atribuicao por campanha - e a verba do cliente e dinheiro dele, nao investimento da casa. SOMENTE LEITURA.',
  z.object({ meses: limite(24) }).strict(),
  {
    type: 'object',
    properties: {
      meses: { type: 'integer', minimum: 1, maximum: 24, default: 12 },
    },
    additionalProperties: false,
  },
  (input) => getFinanceAdsInvestment(input),
);

const financeHistoryTool = makeFinanceRead(
  'aceleriq_list_finance_history',
  'Historico de alteracoes',
  'Quem mexeu em pagamento, quando, o que mudou (situacao e valor, antes e depois) e com que observacao. Sem isto, "esse valor estava diferente ontem" nao tem resposta e a conversa vira memoria contra memoria. SOMENTE LEITURA.',
  z.object({
    entity_type: z.string().max(40).optional(),
    entity_id: UUID.optional(),
    limit: limite(500),
    offset: z.number().int().min(0).optional(),
  }).strict(),
  {
    type: 'object',
    properties: {
      entity_type: { type: 'string', description: 'billing, installment...' },
      entity_id: { type: 'string', description: 'UUID do registro, para ver a historia de um so.' },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
      offset: { type: 'integer', minimum: 0, default: 0 },
    },
    additionalProperties: false,
  },
  (input) => listFinanceHistory(input),
);

// ─── Operadores internos (Hermes) ─────────────────────────────
const operatorReportTool: ToolDefinition = {
  name: 'aceleriq_operator_report',
  title: 'Relatar execucao de operador interno',
  description:
    'Registra um evento de execucao de um operador interno Hermes (vertice, registro, prisma, augusto): started, progress, done, failed, blocked, review, awaiting_input ou heartbeat. O banco aplica tudo numa transacao: vinculo com a tarefa (SEM tocar no responsavel humano), historico de runs com idempotencia por (operador, run_key), trilha de auditoria IMUTAVEL e notificacao interna apenas para excecoes e marcos (progress e heartbeat nunca notificam). done sem evidencia vira review: feito de verdade tem evidencia verificavel. Duas execucoes simultaneas da mesma tarefa colidem com erro claro. Evidencia com credencial na URL perde a query string. NAO atribui tarefa a humano, NAO publica, NAO gasta, NAO altera financeiro.',
  scopes: ['aceleriq:write'],
  annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  inputSchema: {
    type: 'object',
    properties: {
      operator: { type: 'string', pattern: '^[a-z][a-z0-9-]{1,38}$', description: 'Slug do operador interno, como aparece em aceleriq_operator_board. Operador desconhecido e recusado: cadastre antes com aceleriq_operator_register.' },
      event: { type: 'string', enum: [...OPERATOR_EVENTS], description: 'O que aconteceu nesta execucao.' },
      run_key: { type: 'string', minLength: 8, maxLength: 128, description: 'Chave idempotente da execucao (mesma chave = mesma run).' },
      kanban_task_id: { type: 'string', description: 'UUID da tarefa no Kanban, quando houver.' },
      painel_task_id: { type: 'string', description: 'UUID de item do painel fora do Kanban, quando houver.' },
      action: { type: 'string', maxLength: 300, description: 'A acao em uma frase.' },
      evidence: { type: 'string', maxLength: 2000, description: 'Link ou descricao da evidencia. Sem tokens/URLs assinadas.' },
      next_step: { type: 'string', maxLength: 300 },
      block_reason: { type: 'string', maxLength: 500 },
      error: { type: 'string', maxLength: 1000 },
      approval_required: { type: 'boolean', default: false },
      from_cron: { type: 'boolean', default: false },
      attempt: { type: 'integer', minimum: 1, maximum: 50, description: 'Numero da tentativa (retry com backoff e do chamador; aqui fica o registro).' },
      timeout_seconds: { type: 'integer', minimum: 30, maximum: 21600, default: 900 },
    },
    required: ['operator', 'event', 'run_key'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    const schema = z.object({
      operator: z.string().regex(/^[a-z][a-z0-9-]{1,38}$/),
      event: z.enum(OPERATOR_EVENTS),
      run_key: z.string().min(8).max(128),
      kanban_task_id: UUID.optional(),
      painel_task_id: UUID.optional(),
      action: z.string().max(300).optional(),
      evidence: z.string().max(2000).optional(),
      next_step: z.string().max(300).optional(),
      block_reason: z.string().max(500).optional(),
      error: z.string().max(1000).optional(),
      approval_required: z.boolean().optional(),
      from_cron: z.boolean().optional(),
      attempt: limite(50),
      timeout_seconds: limite(21600, 30),
    }).strict();
    const parsed = schema.safeParse(input ?? {});
    if (!parsed.success) {
      throw new Error(`Invalid input: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    }
    return await operatorReport(parsed.data, ctx.keyId);
  },
};

const operatorBoardTool = makeRead(
  'aceleriq_operator_board',
  'Quadro dos operadores internos',
  'A area Execucao da equipe em dados, com MANUAL DE USO no proprio retorno (como_usar), RESUMO em numeros e as TAREFAS DISPONIVEIS do Kanban (com kanban_task_id pronto, cliente, projeto e prazo) para o operador escolher trabalho real em vez de inventar id. Traz tambem: operadores (Vertice, Registro, Prisma, Augusto), vinculos com tarefa/projeto/cliente/RESPONSAVEL HUMANO/status/prazo/evidencia/proximo passo/bloqueio/aprovacao, runs recentes, incidentes e ultima falha. Antes de listar, expira runs sem heartbeat (timeout vira visivel e a trava libera para retomada segura). Filtra por operador e status. SOMENTE LEITURA.',
  z.object({
    operator: z.string().regex(/^[a-z][a-z0-9-]{1,38}$/).optional(),
    status: z.enum(['queued', 'in_progress', 'done', 'review', 'awaiting_input', 'blocked']).optional(),
    limit: limite(500),
  }).strict(),
  {
    type: 'object',
    properties: {
      operator: { type: 'string', pattern: '^[a-z][a-z0-9-]{1,38}$', description: 'Filtra por um operador.' },
      status: { type: 'string', enum: ['queued', 'in_progress', 'done', 'review', 'awaiting_input', 'blocked'] },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
    },
    additionalProperties: false,
  },
  (input) => operatorBoard(input),
);

const operatorRegisterTool: ToolDefinition = {
  name: 'aceleriq_operator_register',
  title: 'Cadastrar operador interno',
  description:
    'Cria um operador interno novo (Hermes) no painel: slug, nome exibido, funcao, escopo e permissoes descritivas. O elenco NAO e fixo - alem de Vertice, Registro, Prisma e Augusto, cadastre quantos precisar. Chamar duas vezes com o mesmo slug devolve o existente em vez de duplicar. O nascimento entra na trilha de auditoria imutavel. Operador NAO tem e-mail, senha nem cliente atribuido, e nunca ocupa o assigned_to de uma tarefa: quem responde pelo trabalho continua sendo gente. IMPORTANTE: reportar execucao com slug desconhecido continua sendo ERRO e nunca cria operador - assim um slug digitado errado vira erro, e nao um operador fantasma.',
  scopes: ['aceleriq:write'],
  annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  inputSchema: {
    type: 'object',
    properties: {
      slug: { type: 'string', pattern: '^[a-z][a-z0-9-]{1,38}$', description: 'Identidade estavel, minusculas com hifen (ex.: "sonar", "atlas-qa").' },
      display_name: { type: 'string', maxLength: 80, description: 'Nome exibido no painel.' },
      role: { type: 'string', maxLength: 80, description: 'Funcao em poucas palavras.' },
      scope: { type: 'string', maxLength: 300, description: 'O que este operador cobre.' },
      hermes_profile_ref: { type: 'string', maxLength: 120, description: 'Referencia do perfil Hermes. Padrao: hermes:<slug>.' },
      is_coordinator: { type: 'boolean', default: false },
      permissions: { type: 'object', description: 'Mapa descritivo do que ele cobre. A imposicao dura e o catalogo do MCP.' },
    },
    required: ['slug', 'display_name', 'role', 'scope'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    const schema = z.object({
      slug: z.string().regex(/^[a-z][a-z0-9-]{1,38}$/),
      display_name: z.string().min(1).max(80),
      role: z.string().min(1).max(80),
      scope: z.string().min(1).max(300),
      hermes_profile_ref: z.string().max(120).optional(),
      is_coordinator: z.boolean().optional(),
      permissions: z.record(z.unknown()).optional(),
    }).strict();
    const parsed = schema.safeParse(input ?? {});
    if (!parsed.success) {
      throw new Error(`Invalid input: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    }
    return await operatorRegister(parsed.data, ctx.keyId);
  },
};

const RAW_TOOLS: readonly ToolDefinition[] = [
  healthTool,
  capabilitiesTool,
  // read tools (round 3)
  searchTool,
  fetchTool,
  listClientsTool,
  listOpportunitiesTool,
  getClientContextTool,
  listProjectsTool,
  getProjectTool,
  listTasksTool,
  listEditorialCalendarTool,
  listReportsTool,
  getReportTool,
  listBriefingsTool,
  getBriefingTool,
  listWorkspaceNodesTool,
  getWorkspaceNodeTool,
  listFilesTool,
  getFileTool,
  // Financeiro: acompanhar sem poder mexer
  financeDashboardTool,
  financeOverviewTool,
  financeBillingTool,
  financeExpensesTool,
  financeProjectPaymentsTool,
  financeCashFlowTool,
  financeMensalidadesTool,
  financeCapitalTool,
  financeAdsTool,
  financeHistoryTool,
  operatorRegisterTool,
  operatorReportTool,
  operatorBoardTool,
  financeEntriesTool,
  financeClientSummariesTool,
  financePlansTool,
  financeRecurringTool,
  // Second Brain bridge (round 4)
  memoryGetContextTool,
  memorySearchTool,
  memoryFetchTool,
  memoryListPendingTool,
  memoryPulseTool,
  memoryRecentCommitsTool,
  memoryProposeTool,
  // Write tools (round 5) — controlled operational writes
  createTaskTool,
  createEditorialItemTool,
  updateTaskTool,
  completeTaskTool,
  createReportDraftTool,
  createProjectTool,
  updateProjectTool,
  updateClientTool,
  archiveProjectTool,
  restoreProjectTool,
  reopenTaskTool,
  upsertCurrentDossierTool,
  getCurrentDossierTool,
  auditIntegrityTool,
  // Contracts (Bloco B) — read + scope-gated write
  listContractsTool,
  getContractTool,
  createContractTool,
  updateContractTool,
  cancelContractTool,
  // Persistent per-client/project memory (Studio + external agents)
  getClientDossierTool,
  getWeeklyCycleTool,
  getProjectMemoryTool,
  upsertProjectMemoryTool,
  // Resultado real (v1.12.0): sem estas, o agente sabia o que a equipe fez e
  // não sabia se funcionou — e toda análise virava chute bem escrito.
  getSocialMetricsTool,
  listSocialPostsTool,
  getAdsCampaignsTool,
  getAdsPerformanceTool,
  // Files v2 (Bloco B — v1.7.0)
  ...(FILE_WRITE_ENABLED ? [
    prepareUploadTool, finalizeUploadTool, inlineUploadTool, uploadFileTool,
    updateMetadataTool, createVersionTool, archiveTool, restoreTool,
  ] : []),
  getContentTool, searchContentTool, processingStatusTool,
];

// Bloco D: augment each tool's `scopes` with its granular resource scope so
// both aggregate (`aceleriq:read`) and granular (`projects:read`) grants pass
// authorization. Aggregate → granular expansion runs in `canInvoke`.
export const TOOLS: readonly ToolDefinition[] = RAW_TOOLS.map((t) => {
  const granular = GRANULAR_SCOPE_BY_TOOL[t.name];
  if (!granular) return t;
  if (t.scopes.includes(granular)) return t;
  return { ...t, scopes: [...t.scopes, granular] };
});

export const TOOL_MAP: ReadonlyMap<string, ToolDefinition> = new Map(
  TOOLS.map(t => [t.name, t]),
);

export function canInvoke(ctx: AuthContext, tool: ToolDefinition): boolean {
  if (tool.scopes.length === 0) return true;
  const expanded = expandScopes(ctx.scopes);
  if (expanded.has('admin')) return true;
  return tool.scopes.some(s => expanded.has(s));
}

export function canUseToolWithDataScope(ctx: AuthContext, tool: ToolDefinition): boolean {
  return dataScopeAllowsTool(ctx.dataScope, tool.name, tool.scopes.length === 0);
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
    // Current ChatGPT plugin discovery reads securitySchemes from the tool
    // descriptor itself. Keep the _meta mirror for older MCP Apps clients.
    securitySchemes,
    _meta: {
      securitySchemes,
      required_mcp_scopes: t.scopes,
    },
  };
}
