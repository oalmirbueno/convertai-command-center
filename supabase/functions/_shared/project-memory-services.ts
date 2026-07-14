// Persistent large-memory services for project/client scope.
// Used by MCP tools and by the Studio agent to survive across threads.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const admin = () => createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

export type MemoryKind = 'note' | 'summary' | 'decision' | 'fact' | 'second_brain' | 'external';

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
