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

Deno.test('registry exposes foundation + read + memory tools', () => {
  const names = TOOLS.map(t => t.name).sort();
  assertEquals(names, [
    'aceleriq_capabilities',
    'aceleriq_fetch',
    'aceleriq_get_briefing',
    'aceleriq_get_client_context',
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
    'memory_fetch',
    'memory_get_context',
    'memory_list_pending_proposals',
    'memory_propose_update',
    'memory_search',
  ]);
});

Deno.test('foundation tools are open to any authenticated key; read tools require aceleriq:read', () => {
  const foundation = ['aceleriq_health', 'aceleriq_capabilities'];
  for (const t of TOOLS) {
    if (foundation.includes(t.name)) assert(canInvoke(emptyCtx, t), `${t.name} should be public-auth`);
    else {
      assert(!canInvoke(emptyCtx, t), `${t.name} should be gated`);
      assert(canInvoke(readCtx, t), `${t.name} should allow read scope`);
      assert(canInvoke(adminCtx, t), `${t.name} should allow admin`);
    }
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
  assert(prefersSse(mk('application/json, text/event-stream')));
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
