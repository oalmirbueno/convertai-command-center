// Unit tests for the MCP server dispatch layer.
// Runs without network: we import the shared modules directly and craft
// synthetic AuthResult objects, so we don't need Supabase credentials.

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { canInvoke, TOOL_MAP, TOOLS } from '../_shared/mcp-tools.ts';
import { hasScope, type AuthContext } from '../_shared/mcp-auth.ts';
import { sanitize } from '../_shared/mcp-audit.ts';
import {
  MCP_PROTOCOL_VERSION,
  prefersSse,
  rpcError,
  RpcErrors,
  rpcResult,
} from '../_shared/mcp-response.ts';
import {
  assertWritableInbox,
  buildProposalMarkdown,
  CONTEXT_ORDER,
  INBOX_PREFIX,
  normalizePath,
  SecondBrainError,
} from '../_shared/second-brain-github.ts';

const readCtx: AuthContext = {
  keyId: '00000000-0000-0000-0000-000000000001',
  keyName: 'test-key',
  scopes: ['aceleriq:read'],
  origin: 'test',
};
const emptyCtx: AuthContext = { ...readCtx, scopes: [] };
const adminCtx: AuthContext = { ...readCtx, scopes: ['admin'] };

Deno.test('registry exposes foundation + read + memory + write tools', () => {
  const names = TOOLS.map(t => t.name).sort();
  assertEquals(names, [
    'aceleriq_capabilities',
    'aceleriq_complete_task',
    'aceleriq_create_report_draft',
    'aceleriq_create_task',
    'aceleriq_fetch',
    'aceleriq_get_briefing',
    'aceleriq_get_client_context',
    'aceleriq_get_file',
    'aceleriq_get_project',
    'aceleriq_get_report',
    'aceleriq_get_workspace_node',
    'aceleriq_health',
    'aceleriq_list_briefings',
    'aceleriq_list_clients',
    'aceleriq_list_files',
    'aceleriq_list_projects',
    'aceleriq_list_reports',
    'aceleriq_list_tasks',
    'aceleriq_list_workspace_nodes',
    'aceleriq_search',
    'aceleriq_update_project',
    'aceleriq_update_task',
    'memory_fetch',
    'memory_get_context',
    'memory_list_pending_proposals',
    'memory_propose_update',
    'memory_search',
  ]);
});

Deno.test('foundation tools are open to any authenticated key; gated tools require the right scope', () => {
  const foundation = ['aceleriq_health', 'aceleriq_capabilities'];
  for (const t of TOOLS) {
    if (foundation.includes(t.name)) {
      assert(canInvoke(emptyCtx, t), `${t.name} should be public-auth`);
      continue;
    }
    assert(!canInvoke(emptyCtx, t), `${t.name} should be gated`);
    assert(canInvoke(adminCtx, t), `${t.name} should allow admin`);
    if (t.name.startsWith('memory_')) continue; // memory scopes tested separately
    if (t.scopes.includes('aceleriq:write' as any)) continue; // write scopes tested separately
    assert(canInvoke(readCtx, t), `${t.name} should allow aceleriq:read`);
  }
});

Deno.test('read tools reject invalid input via Zod', async () => {
  const tool = TOOL_MAP.get('aceleriq_get_project')!;
  let threw = false;
  try { await tool.handler({ project_id: 'not-a-uuid' }, readCtx); }
  catch (e) { threw = true; assert(/Invalid input/.test((e as Error).message)); }
  assert(threw, 'expected Zod validation to reject invalid UUID');
});

Deno.test('fetch rejects unsupported entity types', async () => {
  const tool = TOOL_MAP.get('aceleriq_fetch')!;
  let threw = false;
  try { await tool.handler({ type: 'expenses', id: '00000000-0000-0000-0000-000000000000' }, readCtx); }
  catch { threw = true; }
  assert(threw, 'expected fetch to reject non-whitelisted entity');
});

Deno.test('search rejects empty query', async () => {
  const tool = TOOL_MAP.get('aceleriq_search')!;
  let threw = false;
  try { await tool.handler({ query: '' }, readCtx); }
  catch { threw = true; }
  assert(threw);
});

Deno.test('hasScope: empty required = allowed, admin overrides everything', () => {
  assert(hasScope(emptyCtx, []));
  assert(!hasScope(emptyCtx, ['aceleriq:write']));
  assert(hasScope(adminCtx, ['aceleriq:finance']));
  assert(hasScope(readCtx, ['aceleriq:read']));
});

Deno.test('aceleriq_health returns server info + key context', async () => {
  const tool = TOOL_MAP.get('aceleriq_health')!;
  const out = await tool.handler({}, readCtx) as Record<string, unknown>;
  assertEquals(out.ok, true);
  assertEquals(out.server, 'aceleriq-mcp');
  assertEquals((out.key as any).name, 'test-key');
  assert(typeof out.now === 'string' && (out.now as string).endsWith('Z'));
});

Deno.test('aceleriq_capabilities lists only tools the key can invoke', async () => {
  const tool = TOOL_MAP.get('aceleriq_capabilities')!;
  const outEmpty = await tool.handler({}, emptyCtx) as Record<string, unknown>;
  assertEquals((outEmpty.tools as any[]).map(t => t.name).sort(), ['aceleriq_capabilities', 'aceleriq_health']);
  const outRead = await tool.handler({}, readCtx) as Record<string, unknown>;
  assert((outRead.tools as any[]).length > 2);
});

Deno.test('sanitize redacts secret-like keys and preserves shape', () => {
  const out = sanitize({
    name: 'ok',
    api_key: 'sk-xxx',
    nested: { authorization: 'Bearer abc', keep: 1 },
    list: [{ password: 'pw' }],
  }) as any;
  assertEquals(out.name, 'ok');
  assertEquals(out.api_key, '[redacted]');
  assertEquals(out.nested.authorization, '[redacted]');
  assertEquals(out.nested.keep, 1);
  assertEquals(out.list[0].password, '[redacted]');
});

Deno.test('rpcResult / rpcError shape', () => {
  assertEquals(rpcResult(1, { a: 1 }), { jsonrpc: '2.0', id: 1, result: { a: 1 } });
  const err = rpcError(2, RpcErrors.unauthorized, 'no');
  assertEquals(err.error?.code, -32001);
});

Deno.test('prefersSse honors Accept header', () => {
  const mk = (accept: string) => new Request('http://x', { headers: { accept } });
  assert(prefersSse(mk('text/event-stream')));
  assert(!prefersSse(mk('application/json, text/event-stream')));
  assert(!prefersSse(mk('application/json')));
  assert(!prefersSse(mk('')));
});

// ─── Round 4: Second Brain bridge ────────────────────────────
const memoryReadCtx: AuthContext = { ...readCtx, scopes: ['memory:read'] };
const memoryProposeCtx: AuthContext = { ...readCtx, scopes: ['memory:propose'] };

Deno.test('memory tools require correct scopes', () => {
  const t = (name: string) => TOOL_MAP.get(name)!;
  assert(!canInvoke(emptyCtx, t('memory_get_context')));
  assert(canInvoke(memoryReadCtx, t('memory_get_context')));
  assert(canInvoke(memoryReadCtx, t('memory_search')));
  assert(canInvoke(memoryReadCtx, t('memory_fetch')));
  assert(canInvoke(memoryReadCtx, t('memory_list_pending_proposals')));
  assert(!canInvoke(memoryReadCtx, t('memory_propose_update')));
  assert(canInvoke(memoryProposeCtx, t('memory_propose_update')));
  assert(canInvoke(adminCtx, t('memory_propose_update')));
});

Deno.test('CONTEXT_ORDER matches AGENTS_MEMORY_BRIDGE hierarchy', () => {
  assertEquals(CONTEXT_ORDER, [
    'AGENTS_MEMORY_BRIDGE.md',
    'memory/agent-context.md',
    'MEMORY.md',
    'memory/now.md',
  ]);
});

Deno.test('normalizePath rejects traversal, absolute paths, and empty segments', () => {
  for (const bad of ['../etc/passwd', '/absolute/path', 'memory/../MEMORY.md', 'a//b', '', './x']) {
    let threw = false;
    try { normalizePath(bad); } catch (e) { threw = e instanceof SecondBrainError; }
    assert(threw, `expected reject: ${bad}`);
  }
  assertEquals(normalizePath('memory/agent-context.md'), 'memory/agent-context.md');
  assertEquals(normalizePath('memory\\inbox\\chatgpt\\x.md'), 'memory/inbox/chatgpt/x.md');
});

Deno.test('assertWritableInbox: only inbox/chatgpt/*.md at root, everything else blocked', () => {
  // allowed
  assertEquals(
    assertWritableInbox(INBOX_PREFIX + '2026-07-12T12-00-00Z--x--abcd1234.md'),
    'memory/inbox/chatgpt/2026-07-12T12-00-00Z--x--abcd1234.md',
  );
  // blocked cases
  const blocked = [
    'MEMORY.md',
    'memory/now.md',
    'memory/decisions.md',
    'memory/lessons.md',
    'memory/pending.md',
    'memory/projects/site/plan.md',
    'memory/context/anything.md',
    'memory/inbox/openclaw/note.md',
    'memory/inbox/hermes/note.md',
    'AGENTS_MEMORY_BRIDGE.md',
    'memory/inbox/chatgpt/sub/nested.md',   // no subfolders
    'memory/inbox/chatgpt/no-ext',          // must be .md
    'README.md',                            // root writes blocked
  ];
  for (const p of blocked) {
    let threw = false;
    try { assertWritableInbox(p); } catch (e) { threw = e instanceof SecondBrainError; }
    assert(threw, `expected block: ${p}`);
  }
});

Deno.test('buildProposalMarkdown emits YAML front-matter + required sections', () => {
  const md = buildProposalMarkdown({
    title: 'Teste',
    summary: 'Este é um resumo suficientemente longo.',
    origin: 'chatgpt-work',
    correlation_id: 'abcd12345678',
    context: 'ctx',
    risks: 'risco baixo',
  }, { path: 'memory/inbox/chatgpt/x.md', created_at: '2026-07-12T00:00:00.000Z' });
  assert(md.startsWith('---\n'), 'must open with YAML front-matter');
  assert(md.includes('status: pending-review'));
  assert(md.includes('# Teste'));
  assert(md.includes('## Resumo'));
  assert(md.includes('## Contexto'));
  assert(md.includes('## Riscos'));
  assert(md.includes('correlation_id: "abcd12345678"'));
});

Deno.test('memory_propose_update rejects invalid input via Zod (short title, missing origin)', async () => {
  const tool = TOOL_MAP.get('memory_propose_update')!;
  let threw = false;
  try { await tool.handler({ title: 'x', summary: 'y', correlation_id: '123456' }, memoryProposeCtx); }
  catch (e) { threw = true; assert(/Invalid input/.test((e as Error).message)); }
  assert(threw);
});

// ─── Round 5: write tools ────────────────────────────────────
const writeCtx: AuthContext = { ...readCtx, scopes: ['aceleriq:write'], correlationId: '00000000-0000-0000-0000-0000000000aa' };

Deno.test('write tools require aceleriq:write scope', () => {
  for (const name of ['aceleriq_create_task', 'aceleriq_update_task', 'aceleriq_complete_task', 'aceleriq_create_report_draft']) {
    const t = TOOL_MAP.get(name)!;
    assert(!canInvoke(readCtx, t), `${name} must not accept read-only key`);
    assert(canInvoke(writeCtx, t), `${name} must accept write key`);
    assert(canInvoke(adminCtx, t), `${name} must accept admin key`);
    assertEquals(t.scopes, ['aceleriq:write']);
  }
});

Deno.test('create_task rejects unknown fields (strict allowlist)', async () => {
  const tool = TOOL_MAP.get('aceleriq_create_task')!;
  let threw = false;
  try {
    await tool.handler({
      project_id: '00000000-0000-0000-0000-000000000001',
      title: 'x', idempotency_key: 'abcd1234',
      client_id: '00000000-0000-0000-0000-000000000002', // NOT allowed
    }, writeCtx);
  } catch (e) { threw = true; assert(/Invalid input/.test((e as Error).message)); }
  assert(threw);
});

Deno.test('create_task requires project_id, title, idempotency_key', async () => {
  const tool = TOOL_MAP.get('aceleriq_create_task')!;
  let threw = false;
  try { await tool.handler({ title: 'x' }, writeCtx); }
  catch (e) { threw = true; assert(/Invalid input/.test((e as Error).message)); }
  assert(threw);
});

Deno.test('create_task rejects too-short idempotency_key', async () => {
  const tool = TOOL_MAP.get('aceleriq_create_task')!;
  let threw = false;
  try {
    await tool.handler({
      project_id: '00000000-0000-0000-0000-000000000001',
      title: 'x', idempotency_key: 'abc',
    }, writeCtx);
  } catch (e) { threw = true; }
  assert(threw);
});

Deno.test('update_task requires at least one updatable field', async () => {
  const tool = TOOL_MAP.get('aceleriq_update_task')!;
  let threw = false;
  try {
    await tool.handler({
      task_id: '00000000-0000-0000-0000-000000000001',
      idempotency_key: 'abcd1234',
    }, writeCtx);
  } catch (e) { threw = true; assert(/Invalid input/.test((e as Error).message)); }
  assert(threw);
});

Deno.test('update_task rejects unknown/forbidden fields (project_id switch, source, created_by)', async () => {
  const tool = TOOL_MAP.get('aceleriq_update_task')!;
  for (const bad of [{ project_id: '00000000-0000-0000-0000-000000000009' }, { source: 'x' }, { created_by: '00000000-0000-0000-0000-000000000009' }]) {
    let threw = false;
    try {
      await tool.handler({
        task_id: '00000000-0000-0000-0000-000000000001',
        idempotency_key: 'abcd1234',
        title: 'ok',
        ...bad,
      }, writeCtx);
    } catch (e) { threw = true; }
    assert(threw, `expected reject: ${JSON.stringify(bad)}`);
  }
});

Deno.test('create_report_draft rejects status, file_url, internal_notes, client_id (allowlist)', async () => {
  const tool = TOOL_MAP.get('aceleriq_create_report_draft')!;
  const base = {
    project_id: '00000000-0000-0000-0000-000000000001',
    title: 'Rascunho', idempotency_key: 'abcd12345',
  };
  for (const bad of [{ status: 'published' }, { file_url: 'https://x' }, { internal_notes: 'x' }, { client_id: '00000000-0000-0000-0000-000000000009' }, { created_by: '00000000-0000-0000-0000-000000000009' }, { images: [] }]) {
    let threw = false;
    try { await tool.handler({ ...base, ...bad }, writeCtx); }
    catch (e) { threw = true; assert(/Invalid input/.test((e as Error).message)); }
    assert(threw, `expected reject: ${JSON.stringify(bad)}`);
  }
});

Deno.test('complete_task minimal schema: only task_id + idempotency_key', () => {
  const tool = TOOL_MAP.get('aceleriq_complete_task')!;
  assertEquals((tool.inputSchema as any).required, ['task_id', 'idempotency_key']);
  assertEquals((tool.inputSchema as any).additionalProperties, false);
});
