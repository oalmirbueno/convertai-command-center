// Persistent large-memory services for project/client scope.
// Used by MCP tools and by the Studio agent to survive across threads.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const admin = () => createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

// Os tipos gravados pelo painel (ritual, ciclo, entrega...) convivem com os
// tipos antigos usados por agentes externos. Ler a memória de um cliente
// precisa enxergar as duas origens: é a mesma história.
export type MemoryKind =
  // origem: painel Aceleriq
  | 'ritual' | 'ciclo' | 'entrega' | 'aprovacao' | 'decisao' | 'nota' | 'marco'
  // trabalho da semana fora da rotina fixa, e as listas rápidas do ciclo
  | 'avulso' | 'checklist'
  // origem: agentes externos e Studio
  | 'note' | 'summary' | 'decision' | 'fact' | 'second_brain' | 'external';

// Esta lista e os enums declarados em mcp-tools.ts precisam andar juntos:
// quando divergiram, o MCP validava contra a lista velha e o agente externo
// simplesmente não enxergava parte da história do cliente.
export const MEMORY_KINDS: readonly MemoryKind[] = [
  'ritual', 'ciclo', 'entrega', 'aprovacao', 'decisao', 'nota', 'marco',
  'avulso', 'checklist',
  'note', 'summary', 'decision', 'fact', 'second_brain', 'external',
] as const;

export async function listMemory(opts: {
  client_id: string;
  project_id?: string | null;
  kind?: MemoryKind;
  limit?: number;
}) {
  const sb = admin();
  let q = sb.from('project_memory')
    .select('id,client_id,project_id,kind,source,title,content,tags,metadata,created_at,updated_at')
    .eq('client_id', opts.client_id)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 20, 1), 200));
  if (opts.project_id) q = q.eq('project_id', opts.project_id);
  if (opts.kind) q = q.eq('kind', opts.kind);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function upsertMemory(input: {
  client_id: string;
  project_id?: string | null;
  kind?: MemoryKind;
  source?: string;
  title?: string;
  content: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  created_by?: string | null;
}) {
  const sb = admin();

  // O cliente precisa existir. project_memory tem client_id NOT NULL mas
  // NENHUMA chave estrangeira, entao ate hoje qualquer uuid era aceito e
  // virava registro orfao: o agente recebia "gravado com sucesso" e o dado
  // nao aparecia em lugar nenhum do painel. Foi exatamente o que aconteceu
  // com a Verzelo — a memoria "salvou", o dossie (que valida) recusou, e a
  // divergencia entre os dois foi lida como defeito do dossie.
  const { data: perfil, error: perfilErr } = await sb
    .from('profiles').select('id, deleted_at').eq('id', input.client_id).maybeSingle();
  if (perfilErr) throw new Error(perfilErr.message);
  if (!perfil || (perfil as { deleted_at: string | null }).deleted_at) {
    throw new Error(
      `client_id ${input.client_id} nao corresponde a nenhum cliente ativo. `
      + 'Confira o id com aceleriq_list_clients antes de gravar.',
    );
  }

  const row = {
    client_id: input.client_id,
    project_id: input.project_id ?? null,
    kind: input.kind ?? 'note',
    source: input.source ?? 'mcp',
    title: input.title ?? null,
    content: input.content,
    tags: input.tags ?? [],
    metadata: input.metadata ?? {},
    created_by: input.created_by ?? null,
  };
  const { data, error } = await sb.from('project_memory').insert(row).select('id,created_at').single();
  if (error) throw new Error(error.message);
  return { id: data.id, created_at: data.created_at };
}

/** Compact recent memory into a single markdown block for prompt injection. */
export function memoryToPromptBlock(rows: Array<{ kind: string; title: string | null; content: string; created_at: string }>) {
  if (!rows.length) return '';
  return rows.map(r => {
    const when = new Date(r.created_at).toISOString().slice(0, 16).replace('T', ' ');
    const head = `[${r.kind}${r.title ? ` · ${r.title}` : ''} · ${when}]`;
    return `${head}\n${String(r.content).slice(0, 1400)}`;
  }).join('\n\n');
}
