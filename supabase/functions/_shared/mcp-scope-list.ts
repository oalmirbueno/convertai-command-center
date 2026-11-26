// Lista de escopos do MCP, sem dependências. Mora fora do catálogo
// (mcp-tools.ts) para que o mcp-oauth-metadata leia ALL_SCOPES sem puxar o
// catálogo inteiro e seus serviços. mcp-tools.ts reexporta os dois nomes.

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
  | 'commercial:write'
  | 'contracts:read'
  | 'contracts:write'
  | 'memory:read'
  | 'memory:propose'
  | 'memory:write'
  | 'mesas:write'
  | 'escritorio:write'
  | 'automacoes:write'
  // Só identidade da chave API restrita (aceleriq_escritorio_entrar). Fora de
  // SCOPE_EXPANSIONS e do OAuth da equipe; canInvoke só o aceita com o predicado.
  | 'escritorio:identity'
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
  'commercial:write',
  'contracts:read',
  'contracts:write',
  'memory:read',
  'memory:propose',
  'memory:write',
  'mesas:write',
  'escritorio:write',
  'automacoes:write',
  'escritorio:identity',
  'admin',
] as const;
