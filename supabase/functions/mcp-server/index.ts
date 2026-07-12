// Aceleriq OS — MCP Server (JSON-RPC over HTTP)
// Bearer token auth via public.api_keys, scope enforcement, audit logging.
// Does NOT modify or share code with api-gateway.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, mcp-protocol-version',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GITHUB_PAT = Deno.env.get('SEGUNDO_CEREBRO_GITHUB_PAT') ?? '';
const SEGUNDO_CEREBRO_REPO = 'oalmirbueno/segundo-cerebro-almir';
const INBOX_PATH = 'memory/inbox/chatgpt';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── Types ────────────────────────────────────────────────────
interface AuthContext {
  keyId: string;
  keyName: string;
  scopes: string[];
  origin: string | null;
}

interface ToolDef {
  name: string;
  description: string;
  scopes: string[]; // any-of
  inputSchema: Record<string, unknown>;
  handler: (input: any, ctx: AuthContext) => Promise<unknown>;
}

// ─── Helpers ──────────────────────────────────────────────────
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function jsonRpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: unknown, code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } };
}

function sanitizeInput(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const cloned: any = Array.isArray(input) ? [...(input as any[])] : { ...(input as any) };
  for (const k of Object.keys(cloned)) {
    if (/token|secret|password|api[_-]?key/i.test(k)) cloned[k] = '[redacted]';
  }
  return cloned;
}

async function auditLog(entry: {
  correlationId: string;
  toolName: string;
  origin: string | null;
  keyId: string | null;
  scopes: string[] | null;
  input: unknown;
  success: boolean;
  statusCode: number;
  durationMs: number;
  errorCode?: string;
  errorMessage?: string;
}) {
  try {
    await admin.from('mcp_audit_log').insert({
      correlation_id: entry.correlationId,
      tool_name: entry.toolName,
      origin: entry.origin,
      key_id: entry.keyId,
      scopes: entry.scopes,
      sanitized_input: sanitizeInput(entry.input) as any,
      success: entry.success,
      status_code: entry.statusCode,
      duration_ms: entry.durationMs,
      error_code: entry.errorCode ?? null,
      error_message: entry.errorMessage ?? null,
    });
  } catch (e) {
    console.error('mcp audit_log insert failed', e);
  }
}

async function authenticate(req: Request): Promise<AuthContext | null> {
  const authHeader = req.headers.get('authorization') ?? '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  if (!token) return null;
  const hash = await sha256Hex(token);
  const { data, error } = await admin.rpc('validate_api_key', { _key_hash: hash });
  if (error || !data || (Array.isArray(data) && data.length === 0)) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    keyId: row.id,
    keyName: row.name,
    scopes: row.scopes ?? [],
    origin: row.origin ?? null,
  };
}

function hasScope(ctx: AuthContext, required: string[]): boolean {
  if (required.length === 0) return true;
  return required.some(s => ctx.scopes.includes(s) || ctx.scopes.includes('aceleriq:*'));
}

// ─── Segundo Cérebro (GitHub) ─────────────────────────────────
async function githubApi(path: string, init: RequestInit = {}) {
  if (!GITHUB_PAT) throw new Error('SEGUNDO_CEREBRO_GITHUB_PAT not configured');
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${GITHUB_PAT}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub ${res.status}: ${body.slice(0, 500)}`);
  }
  return res.json();
}

function ensureInboxPath(p: string): string {
  const clean = p.replace(/^\/+|\.\./g, '').trim();
  if (!clean.startsWith(INBOX_PATH + '/')) {
    throw new Error(`Path must live under ${INBOX_PATH}/`);
  }
  if (!/\.(md|markdown|txt|json)$/i.test(clean)) {
    throw new Error('Only .md, .markdown, .txt and .json are allowed');
  }
  return clean;
}

// ─── Tool registry ────────────────────────────────────────────
const TOOLS: ToolDef[] = [
  {
    name: 'aceleriq.health',
    description: 'Ping the Aceleriq OS MCP server. Returns server time and key name.',
    scopes: [],
    inputSchema: { type: 'object', properties: {} },
    handler: async (_input, ctx) => ({
      ok: true,
      server: 'aceleriq-mcp',
      version: '1.0.0',
      key: ctx.keyName,
      origin: ctx.origin,
      scopes: ctx.scopes,
      now: new Date().toISOString(),
    }),
  },
  {
    name: 'aceleriq.list_clients',
    description: 'List clients (profiles with client role). Read-only.',
    scopes: ['aceleriq:read'],
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', minimum: 1, maximum: 100, default: 25 },
        search: { type: 'string' },
      },
    },
    handler: async (input) => {
      const limit = Math.min(Math.max(Number(input?.limit ?? 25), 1), 100);
      let q = admin
        .from('profiles')
        .select('id, full_name, email, company_name, status, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (input?.search) q = q.ilike('full_name', `%${input.search}%`);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { clients: data ?? [] };
    },
  },
  {
    name: 'aceleriq.get_client',
    description: 'Fetch a client profile with related projects and open tasks count.',
    scopes: ['aceleriq:read'],
    inputSchema: {
      type: 'object',
      required: ['client_id'],
      properties: { client_id: { type: 'string', format: 'uuid' } },
    },
    handler: async (input) => {
      const clientId = String(input?.client_id ?? '');
      if (!clientId) throw new Error('client_id required');
      const [{ data: profile }, { data: projects }] = await Promise.all([
        admin.from('profiles').select('*').eq('id', clientId).maybeSingle(),
        admin.from('projects').select('id, name, status, progress, created_at').eq('client_id', clientId),
      ]);
      if (!profile) throw new Error('Client not found');
      return { client: profile, projects: projects ?? [] };
    },
  },
  {
    name: 'aceleriq.list_projects',
    description: 'List projects, optionally filtered by client_id or status.',
    scopes: ['aceleriq:read'],
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string' },
        status: { type: 'string' },
        limit: { type: 'number', default: 50 },
      },
    },
    handler: async (input) => {
      const limit = Math.min(Math.max(Number(input?.limit ?? 50), 1), 200);
      let q = admin
        .from('projects')
        .select('id, name, client_id, status, progress, created_at, updated_at')
        .order('updated_at', { ascending: false })
        .limit(limit);
      if (input?.client_id) q = q.eq('client_id', input.client_id);
      if (input?.status) q = q.eq('status', input.status);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { projects: data ?? [] };
    },
  },
  {
    name: 'aceleriq.list_tasks',
    description: 'List Kanban tasks, optionally by project_id / status / assignee.',
    scopes: ['aceleriq:read'],
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        status: { type: 'string' },
        assignee_id: { type: 'string' },
        limit: { type: 'number', default: 50 },
      },
    },
    handler: async (input) => {
      const limit = Math.min(Math.max(Number(input?.limit ?? 50), 1), 200);
      let q = admin
        .from('tasks')
        .select('id, title, status, priority, project_id, assignee_id, due_date, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (input?.project_id) q = q.eq('project_id', input.project_id);
      if (input?.status) q = q.eq('status', input.status);
      if (input?.assignee_id) q = q.eq('assignee_id', input.assignee_id);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { tasks: data ?? [] };
    },
  },
  {
    name: 'aceleriq.create_note',
    description: 'Create a workspace note (studio_docs) for internal reference.',
    scopes: ['aceleriq:write'],
    inputSchema: {
      type: 'object',
      required: ['title', 'content'],
      properties: {
        title: { type: 'string', minLength: 1 },
        content: { type: 'string' },
        scope: { type: 'string', description: 'Optional scope key (e.g. client id)' },
      },
    },
    handler: async (input, ctx) => {
      const title = String(input?.title ?? '').trim();
      const content = String(input?.content ?? '');
      if (!title) throw new Error('title required');
      const { data, error } = await admin
        .from('studio_docs')
        .insert({
          title,
          content,
          scope: input?.scope ?? `mcp:${ctx.origin ?? 'external'}`,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return { doc: data };
    },
  },
  // ─── Segundo Cérebro (whitelisted to memory/inbox/chatgpt) ───
  {
    name: 'memory.list_inbox',
    description: 'List files under memory/inbox/chatgpt in the Segundo Cérebro repo.',
    scopes: ['memory:read'],
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const items = await githubApi(`/repos/${SEGUNDO_CEREBRO_REPO}/contents/${INBOX_PATH}`);
      return {
        path: INBOX_PATH,
        items: (items as any[]).map(i => ({ name: i.name, path: i.path, size: i.size, sha: i.sha, type: i.type })),
      };
    },
  },
  {
    name: 'memory.read_note',
    description: 'Read a note file from memory/inbox/chatgpt.',
    scopes: ['memory:read'],
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string' } },
    },
    handler: async (input) => {
      const p = ensureInboxPath(String(input?.path ?? ''));
      const file = await githubApi(`/repos/${SEGUNDO_CEREBRO_REPO}/contents/${p}`);
      const content = atob((file as any).content?.replace(/\n/g, '') ?? '');
      return { path: p, sha: (file as any).sha, content };
    },
  },
  {
    name: 'memory.propose_note',
    description: 'Propose a note file inside memory/inbox/chatgpt (create or update). Strictly whitelisted.',
    scopes: ['memory:propose'],
    inputSchema: {
      type: 'object',
      required: ['path', 'content', 'message'],
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        message: { type: 'string' },
        sha: { type: 'string', description: 'Required when updating an existing file' },
      },
    },
    handler: async (input, ctx) => {
      const p = ensureInboxPath(String(input?.path ?? ''));
      const content = String(input?.content ?? '');
      const message = String(input?.message ?? '').trim() || `chore(inbox): update ${p} via MCP`;
      const body: Record<string, unknown> = {
        message: `${message}\n\nSource: aceleriq-mcp (${ctx.origin ?? 'external'})`,
        content: btoa(unescape(encodeURIComponent(content))),
        committer: { name: 'Aceleriq MCP', email: 'mcp@aceleriq.online' },
      };
      if (input?.sha) body.sha = input.sha;
      const res = await githubApi(`/repos/${SEGUNDO_CEREBRO_REPO}/contents/${p}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      return { ok: true, path: p, commit: (res as any).commit?.sha ?? null };
    },
  },
];

const TOOL_MAP = new Map(TOOLS.map(t => [t.name, t]));

function toolDescriptor(t: ToolDef) {
  return { name: t.name, description: t.description, inputSchema: t.inputSchema };
}

// ─── JSON-RPC dispatch ────────────────────────────────────────
async function handleRpc(msg: any, ctx: AuthContext | null): Promise<any> {
  const id = msg?.id ?? null;
  const method = String(msg?.method ?? '');
  const params = msg?.params ?? {};

  if (method === 'initialize') {
    return jsonRpcResult(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'aceleriq-mcp', version: '1.0.0' },
    });
  }

  if (method === 'tools/list') {
    if (!ctx) return jsonRpcError(id, -32001, 'Unauthorized');
    return jsonRpcResult(id, { tools: TOOLS.filter(t => hasScope(ctx, t.scopes)).map(toolDescriptor) });
  }

  if (method === 'tools/call') {
    if (!ctx) return jsonRpcError(id, -32001, 'Unauthorized');
    const name = String(params?.name ?? '');
    const args = params?.arguments ?? {};
    const tool = TOOL_MAP.get(name);
    const correlationId = crypto.randomUUID();
    const started = Date.now();

    if (!tool) {
      await auditLog({
        correlationId, toolName: name || '(unknown)', origin: ctx.origin, keyId: ctx.keyId, scopes: ctx.scopes,
        input: args, success: false, statusCode: 404, durationMs: Date.now() - started,
        errorCode: 'tool_not_found', errorMessage: 'Tool not registered',
      });
      return jsonRpcError(id, -32601, `Unknown tool: ${name}`);
    }

    if (!hasScope(ctx, tool.scopes)) {
      await auditLog({
        correlationId, toolName: name, origin: ctx.origin, keyId: ctx.keyId, scopes: ctx.scopes,
        input: args, success: false, statusCode: 403, durationMs: Date.now() - started,
        errorCode: 'scope_denied', errorMessage: `Requires one of: ${tool.scopes.join(', ')}`,
      });
      return jsonRpcError(id, -32003, `Insufficient scope. Required: ${tool.scopes.join(' | ')}`);
    }

    try {
      const result = await tool.handler(args, ctx);
      await auditLog({
        correlationId, toolName: name, origin: ctx.origin, keyId: ctx.keyId, scopes: ctx.scopes,
        input: args, success: true, statusCode: 200, durationMs: Date.now() - started,
      });
      return jsonRpcResult(id, {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      await auditLog({
        correlationId, toolName: name, origin: ctx.origin, keyId: ctx.keyId, scopes: ctx.scopes,
        input: args, success: false, statusCode: 500, durationMs: Date.now() - started,
        errorCode: 'handler_error', errorMessage: msg,
      });
      return jsonRpcError(id, -32000, msg);
    }
  }

  if (method === 'ping') return jsonRpcResult(id, {});

  return jsonRpcError(id, -32601, `Method not found: ${method}`);
}

// ─── HTTP entry ───────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // Discovery endpoint (helpful for humans and clients)
  if (req.method === 'GET') {
    return new Response(
      JSON.stringify({
        name: 'aceleriq-mcp',
        version: '1.0.0',
        protocol: 'mcp/json-rpc',
        transport: 'http',
        auth: { type: 'bearer', header: 'Authorization' },
        tools: TOOLS.map(t => ({ name: t.name, description: t.description, scopes: t.scopes })),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const ctx = await authenticate(req);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify(jsonRpcError(null, -32700, 'Parse error')),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const process = (msg: any) => handleRpc(msg, ctx);
  const result = Array.isArray(body) ? await Promise.all(body.map(process)) : await process(body);

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
