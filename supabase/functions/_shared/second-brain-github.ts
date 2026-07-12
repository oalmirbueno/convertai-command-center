// Second Brain — GitHub bridge (round 4)
// External read + inbox-only write bridge to the private OpenClaw memory repo.
// The GitHub PAT scopes to the repository; per-path enforcement lives HERE.
//
// Hierarchy:
//   1. OpenClaw memory is the official source of truth
//   2. Obsidian is the human navigation layer
//   3. GitHub is the versioned bridge
//   4. Aceleriq MCP consults GitHub read-only
//   5. External proposals land in memory/inbox/chatgpt/ ONLY
//   6. OpenClaw reviews & consolidates
//
// Nothing is copied into Supabase. No mirror table. No sync job.

const API = 'https://api.github.com';
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_PROPOSAL_BYTES = 32 * 1024;       // 32 KiB per proposal
const MAX_FETCH_BYTES = 512 * 1024;         // 512 KiB per fetched file
const MAX_SEARCH_RESULTS = 25;

/** Only path prefix the ChatGPT/agents pipeline may write to. */
export const INBOX_PREFIX = 'memory/inbox/chatgpt/';

/** Read priority mandated by AGENTS_MEMORY_BRIDGE. */
export const CONTEXT_ORDER: readonly string[] = [
  'AGENTS_MEMORY_BRIDGE.md',
  'memory/agent-context.md',
  'MEMORY.md',
  'memory/now.md',
] as const;

/** Paths that are hard-blocked for write, even inside memory/. */
const WRITE_BLOCKLIST_EXACT = new Set<string>([
  'MEMORY.md',
  'memory/now.md',
  'memory/decisions.md',
  'memory/lessons.md',
  'memory/pending.md',
  'AGENTS_MEMORY_BRIDGE.md',
  'memory/agent-context.md',
]);
const WRITE_BLOCKLIST_PREFIXES = [
  'memory/projects/',
  'memory/context/',
  'memory/inbox/openclaw/',
  'memory/inbox/hermes/',
  'memory/inbox/codex/',
  'memory/inbox/claude/',
];

export type BridgeError =
  | { kind: 'not_configured'; detail: string }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden'; detail: string }
  | { kind: 'not_found'; path: string }
  | { kind: 'branch_not_found'; branch: string }
  | { kind: 'conflict'; detail: string }
  | { kind: 'rate_limited'; resetAt?: string }
  | { kind: 'timeout' }
  | { kind: 'upstream'; status: number; detail: string }
  | { kind: 'too_large'; bytes: number }
  | { kind: 'validation'; detail: string };

export class SecondBrainError extends Error {
  constructor(public readonly error: BridgeError) {
    super(`${error.kind}: ${JSON.stringify(error)}`);
  }
}

interface Config {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

function loadConfig(): Config {
  const token =
    Deno.env.get('SECOND_BRAIN_GITHUB_TOKEN') ??
    Deno.env.get('SEGUNDO_CEREBRO_GITHUB_PAT') ??
    '';
  const owner = Deno.env.get('SECOND_BRAIN_GITHUB_OWNER') ?? '';
  const repo = Deno.env.get('SECOND_BRAIN_GITHUB_REPO') ?? '';
  const branch = Deno.env.get('SECOND_BRAIN_DEFAULT_BRANCH') ?? 'main';
  if (!token) {
    throw new SecondBrainError({
      kind: 'not_configured',
      detail: 'SECOND_BRAIN_GITHUB_TOKEN (or SEGUNDO_CEREBRO_GITHUB_PAT) is not set.',
    });
  }
  if (!owner || !repo) {
    throw new SecondBrainError({
      kind: 'not_configured',
      detail: 'SECOND_BRAIN_GITHUB_OWNER / SECOND_BRAIN_GITHUB_REPO are not set.',
    });
  }
  return { token, owner, repo, branch };
}

/** Public status probe (no token echo). Safe to expose via tools. */
export function bridgeStatus(): Record<string, unknown> {
  const owner = Deno.env.get('SECOND_BRAIN_GITHUB_OWNER') ?? null;
  const repo = Deno.env.get('SECOND_BRAIN_GITHUB_REPO') ?? null;
  const branch = Deno.env.get('SECOND_BRAIN_DEFAULT_BRANCH') ?? 'main';
  const tokenPresent =
    !!Deno.env.get('SECOND_BRAIN_GITHUB_TOKEN') ||
    !!Deno.env.get('SEGUNDO_CEREBRO_GITHUB_PAT');
  return {
    configured: tokenPresent && !!owner && !!repo,
    owner,
    repo,
    branch,
    token_present: tokenPresent,
    inbox_prefix: INBOX_PREFIX,
    context_order: CONTEXT_ORDER,
  };
}

// ─── HTTP core ───────────────────────────────────────────────
async function gh(
  cfg: Config,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  init?: { body?: unknown; query?: Record<string, string>; timeoutMs?: number },
): Promise<{ status: number; body: any; headers: Headers }> {
  const url = new URL(API + path);
  if (init?.query) {
    for (const [k, v] of Object.entries(init.query)) url.searchParams.set(k, v);
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), init?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method,
      signal: ac.signal,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'aceleriq-mcp/1.0',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new SecondBrainError({ kind: 'timeout' });
    }
    throw new SecondBrainError({ kind: 'upstream', status: 0, detail: (e as Error).message });
  } finally {
    clearTimeout(t);
  }
  const text = await res.text();
  let body: any = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (res.status === 401) throw new SecondBrainError({ kind: 'unauthorized' });
  if (res.status === 403) {
    const rem = res.headers.get('x-ratelimit-remaining');
    if (rem === '0') {
      const reset = res.headers.get('x-ratelimit-reset');
      const resetAt = reset ? new Date(Number(reset) * 1000).toISOString() : undefined;
      throw new SecondBrainError({ kind: 'rate_limited', resetAt });
    }
    throw new SecondBrainError({ kind: 'forbidden', detail: body?.message ?? 'forbidden' });
  }
  if (res.status === 429) {
    throw new SecondBrainError({ kind: 'rate_limited' });
  }
  return { status: res.status, body, headers: res.headers };
}

// ─── Path safety ─────────────────────────────────────────────
export function normalizePath(input: string): string {
  if (typeof input !== 'string') throw new SecondBrainError({ kind: 'validation', detail: 'path must be a string' });
  const raw = input.trim().replace(/\\/g, '/');
  if (!raw) throw new SecondBrainError({ kind: 'validation', detail: 'empty path' });
  if (raw.startsWith('/')) throw new SecondBrainError({ kind: 'validation', detail: 'absolute paths are forbidden' });
  if (raw.includes('//')) throw new SecondBrainError({ kind: 'validation', detail: 'empty segment in path' });
  const segs = raw.split('/');
  if (segs.some(s => s === '..' || s === '.' || s === '')) {
    throw new SecondBrainError({ kind: 'validation', detail: 'path traversal or empty segment forbidden' });
  }
  return raw;
}

export function assertReadable(path: string): string {
  const p = normalizePath(path);
  // Read is broad (repo is private), but block classic escape attempts.
  return p;
}

export function assertWritableInbox(path: string): string {
  const p = normalizePath(path);
  if (WRITE_BLOCKLIST_EXACT.has(p)) {
    throw new SecondBrainError({ kind: 'forbidden', detail: `write blocked: ${p}` });
  }
  for (const pref of WRITE_BLOCKLIST_PREFIXES) {
    if (p.startsWith(pref)) throw new SecondBrainError({ kind: 'forbidden', detail: `write blocked prefix: ${pref}` });
  }
  if (!p.startsWith(INBOX_PREFIX)) {
    throw new SecondBrainError({ kind: 'forbidden', detail: `writes allowed only under ${INBOX_PREFIX}` });
  }
  if (!p.toLowerCase().endsWith('.md')) {
    throw new SecondBrainError({ kind: 'validation', detail: 'proposal file must end with .md' });
  }
  // Server owns filename: no subfolders allowed beyond the inbox root itself.
  const rest = p.slice(INBOX_PREFIX.length);
  if (rest.includes('/')) {
    throw new SecondBrainError({ kind: 'validation', detail: 'proposals must live directly under the inbox root' });
  }
  return p;
}

// ─── Read operations ─────────────────────────────────────────
function b64decode(b64: string): string {
  const clean = b64.replace(/\n/g, '');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function b64encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export interface FetchedFile {
  path: string;
  sha: string;
  size: number;
  content: string;
  truncated: boolean;
}

export async function getFile(path: string, ref?: string): Promise<FetchedFile> {
  const cfg = loadConfig();
  const safe = assertReadable(path);
  const res = await gh(cfg, 'GET', `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURI(safe)}`, {
    query: { ref: ref ?? cfg.branch },
  });
  if (res.status === 404) throw new SecondBrainError({ kind: 'not_found', path: safe });
  if (res.status >= 400) throw new SecondBrainError({ kind: 'upstream', status: res.status, detail: String(res.body?.message ?? '') });
  const b = res.body;
  if (Array.isArray(b)) throw new SecondBrainError({ kind: 'validation', detail: 'path is a directory, not a file' });
  const size = Number(b.size ?? 0);
  if (size > MAX_FETCH_BYTES) {
    return { path: safe, sha: b.sha, size, content: '', truncated: true };
  }
  const encoding = b.encoding as string | undefined;
  const content = encoding === 'base64' && typeof b.content === 'string' ? b64decode(b.content) : (b.content ?? '');
  return { path: safe, sha: b.sha, size, content, truncated: false };
}

export async function getContextBundle(extra?: string[]): Promise<{
  order: string[];
  files: Array<{ path: string; ok: boolean; size?: number; content?: string; error?: string }>;
}> {
  const paths = [...CONTEXT_ORDER, ...(extra ?? []).map(assertReadable)];
  const results = await Promise.all(paths.map(async (p) => {
    try {
      const f = await getFile(p);
      return { path: p, ok: true, size: f.size, content: f.truncated ? '' : f.content };
    } catch (e) {
      const err = e instanceof SecondBrainError ? e.error.kind : (e as Error).message;
      return { path: p, ok: false, error: String(err) };
    }
  }));
  return { order: paths, files: results };
}

export async function searchCode(query: string, limit = 10): Promise<Array<{ path: string; sha: string; url: string }>> {
  const cfg = loadConfig();
  if (!query || query.length < 2) throw new SecondBrainError({ kind: 'validation', detail: 'query too short' });
  const q = `${query} repo:${cfg.owner}/${cfg.repo}`;
  const res = await gh(cfg, 'GET', '/search/code', {
    query: { q, per_page: String(Math.min(Math.max(limit, 1), MAX_SEARCH_RESULTS)) },
  });
  if (res.status >= 400) throw new SecondBrainError({ kind: 'upstream', status: res.status, detail: String(res.body?.message ?? '') });
  const items = Array.isArray(res.body?.items) ? res.body.items : [];
  return items.map((it: any) => ({ path: it.path, sha: it.sha, url: it.html_url }));
}

export async function listInboxPending(limit = 25): Promise<Array<{ path: string; sha: string; size: number }>> {
  const cfg = loadConfig();
  const inboxPath = INBOX_PREFIX.replace(/\/$/, '');
  const res = await gh(cfg, 'GET', `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURI(inboxPath)}`, {
    query: { ref: cfg.branch },
  });
  if (res.status === 404) return [];
  if (res.status >= 400) throw new SecondBrainError({ kind: 'upstream', status: res.status, detail: String(res.body?.message ?? '') });
  if (!Array.isArray(res.body)) return [];
  return res.body
    .filter((e: any) => e.type === 'file' && String(e.name).toLowerCase().endsWith('.md'))
    .slice(0, limit)
    .map((e: any) => ({ path: e.path, sha: e.sha, size: e.size }));
}

// ─── Proposal (inbox-only write) ─────────────────────────────
export interface ProposalInput {
  title: string;
  summary: string;
  origin: string;                 // required — who/what is proposing
  suggested_destination?: string; // where OpenClaw might file this eventually
  context?: string;               // free-form context
  risks?: string;                 // risks/side-effects
  correlation_id: string;         // MCP call correlation
  body_markdown?: string;         // optional extra body
}

const SLUG_MAX = 48;
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX) || 'proposal';
}

function isoStamp(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
}

export function buildProposalMarkdown(input: ProposalInput, meta: { path: string; created_at: string }): string {
  return [
    '---',
    `title: ${JSON.stringify(input.title)}`,
    `origin: ${JSON.stringify(input.origin)}`,
    `correlation_id: ${JSON.stringify(input.correlation_id)}`,
    `created_at: ${meta.created_at}`,
    input.suggested_destination ? `suggested_destination: ${JSON.stringify(input.suggested_destination)}` : null,
    'status: pending-review',
    '---',
    '',
    `# ${input.title}`,
    '',
    '## Resumo',
    input.summary.trim(),
    '',
    input.context ? '## Contexto\n' + input.context.trim() + '\n' : null,
    input.risks ? '## Riscos\n' + input.risks.trim() + '\n' : null,
    input.body_markdown ? '## Detalhes\n' + input.body_markdown.trim() + '\n' : null,
    '---',
    `_Proposta gerada via Aceleriq MCP. Arquivo destino sugerido: \`${input.suggested_destination ?? 'a decidir'}\`._`,
    '',
  ].filter(Boolean).join('\n');
}

export interface ProposalResult {
  path: string;
  sha: string;
  commit_sha: string;
  commit_url: string;
  bytes: number;
  branch: string;
}

export async function proposeUpdate(input: ProposalInput): Promise<ProposalResult> {
  const cfg = loadConfig();

  // Structural validation
  if (!input?.title || input.title.length < 3) throw new SecondBrainError({ kind: 'validation', detail: 'title required (>=3 chars)' });
  if (!input?.summary || input.summary.length < 10) throw new SecondBrainError({ kind: 'validation', detail: 'summary required (>=10 chars)' });
  if (!input?.origin) throw new SecondBrainError({ kind: 'validation', detail: 'origin required' });
  if (!input?.correlation_id) throw new SecondBrainError({ kind: 'validation', detail: 'correlation_id required' });

  const created_at = new Date().toISOString();
  const filename = `${isoStamp()}--${slugify(input.title)}--${input.correlation_id.slice(0, 8)}.md`;
  const path = assertWritableInbox(INBOX_PREFIX + filename);

  const md = buildProposalMarkdown(input, { path, created_at });
  const bytes = new TextEncoder().encode(md).length;
  if (bytes > MAX_PROPOSAL_BYTES) throw new SecondBrainError({ kind: 'too_large', bytes });

  // Ensure the branch exists (fast check, avoids a confusing PUT error).
  const branchRes = await gh(cfg, 'GET', `/repos/${cfg.owner}/${cfg.repo}/branches/${encodeURIComponent(cfg.branch)}`);
  if (branchRes.status === 404) throw new SecondBrainError({ kind: 'branch_not_found', branch: cfg.branch });
  if (branchRes.status >= 400) throw new SecondBrainError({ kind: 'upstream', status: branchRes.status, detail: String(branchRes.body?.message ?? '') });

  // Refuse to overwrite: 404 on the target path is required.
  const probe = await gh(cfg, 'GET', `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURI(path)}`, {
    query: { ref: cfg.branch },
  });
  if (probe.status !== 404) {
    throw new SecondBrainError({ kind: 'conflict', detail: `path already exists (unexpected): ${path}` });
  }

  const put = await gh(cfg, 'PUT', `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURI(path)}`, {
    body: {
      message: `chatgpt-inbox: ${input.title} [${input.correlation_id.slice(0, 8)}]`,
      content: b64encode(md),
      branch: cfg.branch,
    },
  });
  if (put.status === 422 || put.status === 409) {
    throw new SecondBrainError({ kind: 'conflict', detail: String(put.body?.message ?? 'conflict') });
  }
  if (put.status >= 400) throw new SecondBrainError({ kind: 'upstream', status: put.status, detail: String(put.body?.message ?? '') });

  const commitSha: string = put.body?.commit?.sha ?? '';
  const commitUrl: string = put.body?.commit?.html_url ?? '';
  const sha: string = put.body?.content?.sha ?? '';
  return { path, sha, commit_sha: commitSha, commit_url: commitUrl, bytes, branch: cfg.branch };
}
