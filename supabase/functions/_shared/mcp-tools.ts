// Tool registry for the MCP server.
// Round 2: only foundation tools. No client, project, task, finance,
// memory or write tools yet.

import type { AuthContext } from './mcp-auth.ts';

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
  version: '1.0.0-foundation',
} as const;

const healthTool: ToolDefinition = {
  name: 'aceleriq_health',
  title: 'Aceleriq health',
  description:
    'Verifica se o servidor MCP do Aceleriq OS está acessível. Retorna hora do servidor, nome da chave e escopos concedidos. Sem efeitos colaterais.',
  scopes: [],
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
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
    'Descreve o servidor MCP: tools disponíveis para esta chave, escopos concedidos e escopos suportados. Útil para clientes descobrirem o que podem invocar.',
  scopes: [],
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
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

export const TOOLS: readonly ToolDefinition[] = [healthTool, capabilitiesTool];

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
