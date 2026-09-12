/** Authorization and response assembly, testable without GitHub or real users. */
export interface BrainClient { id: string; name: string }
export interface BrainContextDependencies {
  authenticate(token: string): Promise<{ id: string; staff: boolean; admin: boolean } | null>;
  resolveClient(input: { id?: string; name?: string }): Promise<BrainClient | null>;
  canAccess(token: string, clientId: string): Promise<boolean>;
  configured(): boolean;
  search(query: string, limit: number): Promise<Array<{ path: string }>>;
  read(path: string): Promise<{ content?: string }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Staff notes must bind one client in front matter; mixed logs are not a tenant boundary.
 * Admins retain their existing repository access for operational history. */
export function noteBelongsToClient(content: string, id: string): boolean {
  const front = content.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]{0,4000}?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!front) return false;
  // Count every declaration, including malformed/commented/array values. YAML
  // duplicate-key behavior must never turn a mixed note into a tenant-bound note.
  const declarations = front.split(/\r?\n/).filter(line => /^\s*client_id\s*:/i.test(line));
  if (declarations.length !== 1) return false;
  const binding = declarations[0].match(/^client_id:\s*(?:"([0-9a-f-]+)"|'([0-9a-f-]+)'|([0-9a-f-]+))\s*$/i);
  return !!binding && (binding[1] || binding[2] || binding[3]).toLowerCase() === id.toLowerCase();
}

function safeMarkdownPath(path: string): boolean {
  return /\.md$/i.test(path) && !path.startsWith('/') && !path.includes('\\')
    && !path.split('/').some(p => p === '..' || p === '.' || p === '')
    && !/(?:^|[/._-])(?:secrets?|tokens?|passwords?|api_keys?|credentials?|auth)(?:[/._-]|$)/i.test(path);
}

export function makeBrainContextHandler(deps: BrainContextDependencies, headers: Record<string, string> = {}) {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...headers, 'Content-Type': 'application/json' },
  });
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers });
    if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
    try {
      const token = req.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
      if (!token) return json({ error: 'Sessão expirada.' }, 401);
      const actor = await deps.authenticate(token);
      if (!actor) return json({ error: 'Sessão expirada.' }, 401);
      if (!actor.staff) return json({ error: 'Somente equipe.' }, 403);
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Requisição inválida.' }, 400);
      const id = typeof body.client_id === 'string' ? body.client_id.trim() : undefined;
      const name = typeof body.client_name === 'string' ? body.client_name.trim() : undefined;
      if ((id && !UUID.test(id)) || (!id && (!name || name.length < 2 || name.length > 200))) {
        return json({ error: 'Informe client_id válido.' }, 400);
      }
      // Legacy name requests resolve an exact unique profile; they never define a search scope.
      const client = await deps.resolveClient(id ? { id } : { name });
      if (!client || !(await deps.canAccess(token, client.id))) {
        return json({ error: 'Cliente indisponível para esta sessão.' }, 403);
      }
      if (!deps.configured()) return json({ configured: false, context: '', sources: [] });
      const term = client.name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/)[0];
      const query = actor.admin ? `"${term}"` : `"${client.id}"`;
      const files = await deps.search(query, 10);
      const blocks: string[] = [];
      const sources: string[] = [];
      for (const file of files.filter(f => safeMarkdownPath(f.path)).slice(0, 8)) {
        try {
          const content = (await deps.read(file.path)).content ?? '';
          if (!actor.admin && !noteBelongsToClient(content, client.id)) continue;
          const lines = content.split(/\r?\n/);
          const snippets = actor.admin
            ? lines.filter(line => line.toLocaleLowerCase().includes(client.name.toLocaleLowerCase())).slice(0, 3)
            : [content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').slice(0, 1500)];
          const text = snippets.join('\n').trim().slice(0, 1500);
          if (!text) continue;
          blocks.push(`[${file.path}]\n${text}`);
          sources.push(file.path);
          if (sources.length === 4) break;
        } catch { /* A failed note does not erase other authorized sources. */ }
      }
      return json({ configured: true, context: blocks.join('\n\n').slice(0, 4000), sources,
        ...(sources.length ? {} : { note: 'Sem notas disponíveis no escopo deste cliente.' }) });
    } catch {
      // Do not log upstream bodies, credentials or private repository diagnostics.
      return json({ configured: true, context: '', sources: [], note: 'Contexto temporariamente indisponível.' });
    }
  };
}
