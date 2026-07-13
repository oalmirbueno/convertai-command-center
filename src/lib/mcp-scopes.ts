// Frontend mirror of supabase/functions/_shared/mcp-tools.ts SCOPE_DESCRIPTIONS.
// Keep in sync when adding new scopes.
export type MCPScopeInfo = { title: string; description: string; sensitive?: boolean };

export const MCP_SCOPE_DESCRIPTIONS: Record<string, MCPScopeInfo> = {
  'aceleriq:read': { title: 'Leitura ampla', description: 'Ler todos os dados operacionais (clientes, projetos, tarefas, relatórios, briefings, arquivos).' },
  'aceleriq:write': { title: 'Escrita operacional', description: 'Criar/atualizar tarefas, rascunhos de relatórios e ajustes de projetos.', sensitive: true },
  'aceleriq:finance': { title: 'Financeiro', description: 'Acessar informações financeiras agregadas.', sensitive: true },
  'clients:read': { title: 'Clientes — leitura', description: 'Listar e visualizar contextos de clientes.' },
  'projects:read': { title: 'Projetos — leitura', description: 'Listar e detalhar projetos.' },
  'projects:write': { title: 'Projetos — escrita', description: 'Atualizar prazo, status, progresso, escopo e objetivos.', sensitive: true },
  'tasks:read': { title: 'Tarefas — leitura', description: 'Listar tarefas do Kanban.' },
  'tasks:write': { title: 'Tarefas — escrita', description: 'Criar, editar e concluir tarefas.', sensitive: true },
  'reports:read': { title: 'Relatórios — leitura', description: 'Listar e ler relatórios publicados.' },
  'reports:write': { title: 'Relatórios — escrita', description: 'Criar rascunhos de relatórios.', sensitive: true },
  'briefings:read': { title: 'Briefings — leitura', description: 'Listar e ler briefings enviados.' },
  'files:read': { title: 'Arquivos — leitura', description: 'Listar e detalhar arquivos e entregas.' },
  'workspace:read': { title: 'Workspace — leitura', description: 'Navegar pastas e nós do Workspace interno.' },
  'contracts:read': { title: 'Contratos — leitura', description: 'Listar e detalhar contratos.' },
  'contracts:write': { title: 'Contratos — escrita', description: 'Criar, atualizar, enviar e cancelar contratos não assinados.', sensitive: true },
  'memory:read': { title: 'Segundo Cérebro — leitura', description: 'Consultar contexto, arquivos e commits do repositório de memória.' },
  'memory:propose': { title: 'Segundo Cérebro — propor', description: 'Criar propostas .md no inbox do OpenClaw.', sensitive: true },
  'admin': { title: 'Administrador', description: 'Bypass total de escopo. Concede acesso a todas as ferramentas.', sensitive: true },
};

export function describeScope(scope: string): MCPScopeInfo {
  return MCP_SCOPE_DESCRIPTIONS[scope] ?? {
    title: scope,
    description: 'Permissão adicional solicitada pelo cliente.',
  };
}
