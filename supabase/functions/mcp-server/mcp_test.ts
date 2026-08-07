// Unit tests for the MCP server dispatch layer.
// Runs without network: we import the shared modules directly and craft
// synthetic AuthResult objects, so we don't need Supabase credentials.

import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { canInvoke, canUseToolWithDataScope, TOOL_MAP, TOOLS } from '../_shared/mcp-tools.ts';
import {
  fetchJwksDocument,
  hasScope,
  MAX_JWKS_BODY_BYTES,
  type AuthContext,
  validateJwksDocument,
} from '../_shared/mcp-auth.ts';
import { sanitize } from '../_shared/mcp-audit.ts';
import {
  canonicalizeEditorialIdempotencyInput,
  createEditorialItemSchema,
  createTaskSchema,
  deterministicEditorialTaskId,
  editorialPayloadFingerprint,
  updateTaskSchema,
} from '../_shared/mcp-write-services.ts';
import {
  acceptsMcpResponse,
  isMcpOriginAllowed,
  isMcpProtocolVersionSupported,
  MAX_MCP_REQUEST_BODY_BYTES,
  McpRequestBodyTooLargeError,
  MCP_PROTOCOL_VERSION,
  prefersSse,
  readMcpJsonBody,
  resolveMcpAllowedOrigins,
  rpcError,
  RpcErrors,
  rpcResult,
  validateJsonRpcRequest,
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
  dataScope: {
    unrestricted: true,
    clientIds: [],
    principalUserId: '00000000-0000-0000-0000-000000000001',
    source: 'api_key',
  },
};
const emptyCtx: AuthContext = { ...readCtx, scopes: [] };
const adminCtx: AuthContext = { ...readCtx, scopes: ['admin'] };
const restrictedCtx: AuthContext = {
  ...readCtx,
  dataScope: {
    unrestricted: false,
    clientIds: ['00000000-0000-0000-0000-0000000000aa'],
    principalUserId: '00000000-0000-0000-0000-000000000001',
    source: 'oauth',
  },
};

Deno.test('MCP JSON reader parses bounded requests', async () => {
  const body = await readMcpJsonBody(new Request('https://mcp.example.test', {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list' }),
  })) as Record<string, unknown>;
  assertEquals(body.jsonrpc, '2.0');
  assertEquals(body.method, 'tools/list');
});

Deno.test('MCP JSON reader rejects streamed bodies above the hard limit', async () => {
  const testLimit = 32;
  let error: unknown;
  try {
    await readMcpJsonBody(new Request('https://mcp.example.test', {
      method: 'POST',
      body: 'x'.repeat(testLimit + 1),
    }), testLimit);
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof McpRequestBodyTooLargeError);
});

Deno.test('MCP JSON reader rejects a declared body above the hard limit before parsing', async () => {
  const testLimit = 32;
  let error: unknown;
  try {
    await readMcpJsonBody(new Request('https://mcp.example.test', {
      method: 'POST',
      headers: { 'content-length': String(testLimit + 1) },
      body: '{}',
    }), testLimit);
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof McpRequestBodyTooLargeError);
});

Deno.test('MCP JSON reader rejects invalid UTF-8 instead of replacing bytes', async () => {
  let error: unknown;
  try {
    await readMcpJsonBody(new Request('https://mcp.example.test', {
      method: 'POST',
      body: new Uint8Array([0xff]),
    }));
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof TypeError);
});

Deno.test('MCP transport limit preserves the 10 MiB inline-file contract', () => {
  const inlineFileBytes = 10 * 1024 * 1024;
  const base64Bytes = 4 * Math.ceil(inlineFileBytes / 3);
  assert(
    MAX_MCP_REQUEST_BODY_BYTES >= base64Bytes + 64 * 1024,
    'transport limit must leave room for the base64 file and JSON-RPC envelope',
  );
});

Deno.test('JWKS fetch is bounded, non-redirecting, and accepts supported signing keys', async () => {
  let capturedInit: RequestInit | undefined;
  const validKey = {
    kty: 'RSA',
    alg: 'RS256',
    use: 'sig',
    kid: 'primary-key',
    n: 'test-modulus',
    e: 'AQAB',
  };
  const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => {
    capturedInit = init;
    return Promise.resolve(new Response(JSON.stringify({ keys: [validKey] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
  }) as typeof fetch;

  const keys = await fetchJwksDocument('https://issuer.example.test/.well-known/jwks.json', fetchImpl);
  assertEquals(keys.length, 1);
  assertEquals(keys[0].kid, 'primary-key');
  assertEquals(capturedInit?.redirect, 'error');
  assert(capturedInit?.signal instanceof AbortSignal);
  assertEquals(new Headers(capturedInit?.headers).get('accept'), 'application/json');
});

Deno.test('JWKS validation rejects empty, excessive, and unsupported key sets', () => {
  assertThrows(() => validateJwksDocument({ keys: [] }), Error, 'invalid number of keys');
  assertThrows(
    () => validateJwksDocument({
      keys: Array.from({ length: 17 }, (_, index) => ({
        kty: 'RSA', alg: 'RS256', use: 'sig', kid: `key-${index}`,
      })),
    }),
    Error,
    'invalid number of keys',
  );
  assertThrows(
    () => validateJwksDocument({ keys: [{ kty: 'oct', alg: 'HS256', kid: 'shared-secret' }] }),
    Error,
    'unsupported signing key',
  );
});

Deno.test('JWKS fetch rejects an oversized document before reading it', async () => {
  const fetchImpl = (() => Promise.resolve(new Response('{}', {
    status: 200,
    headers: { 'content-length': String(MAX_JWKS_BODY_BYTES + 1) },
  }))) as typeof fetch;
  await assertRejects(
    () => fetchJwksDocument('https://issuer.example.test/.well-known/jwks.json', fetchImpl),
    Error,
    'exceeds the allowed limit',
  );
});

Deno.test('registry exposes foundation + read + memory + write + contracts tools', () => {
  const names = TOOLS.map(t => t.name).sort();
  assertEquals(names, [
    'aceleriq_archive_file',
    'aceleriq_cancel_contract',
    'aceleriq_capabilities',
    'aceleriq_complete_task',
    'aceleriq_create_contract',
    'aceleriq_create_editorial_item',
    'aceleriq_create_file_version',
    'aceleriq_create_report_draft',
    'aceleriq_create_task',
    'aceleriq_fetch',
    'aceleriq_finalize_file_upload',
    'aceleriq_get_briefing',
    'aceleriq_get_client_context',
    'aceleriq_get_contract',
    'aceleriq_get_file',
    'aceleriq_get_file_content',
    'aceleriq_get_file_processing_status',
    'aceleriq_get_project',
    'aceleriq_get_project_memory',
    'aceleriq_get_report',
    'aceleriq_get_workspace_node',
    'aceleriq_health',
    'aceleriq_list_briefings',
    'aceleriq_list_clients',
    'aceleriq_list_contracts',
    'aceleriq_list_editorial_calendar',
    'aceleriq_list_files',
    'aceleriq_list_projects',
    'aceleriq_list_reports',
    'aceleriq_list_tasks',
    'aceleriq_list_workspace_nodes',
    'aceleriq_prepare_file_upload',
    'aceleriq_restore_file',
    'aceleriq_search',
    'aceleriq_search_file_content',
    'aceleriq_update_contract',
    'aceleriq_update_file_metadata',
    'aceleriq_update_project',
    'aceleriq_update_task',
    'aceleriq_upload_file',
    'aceleriq_upload_file_inline',
    'aceleriq_upsert_project_memory',
    'memory_fetch',
    'memory_get_context',
    'memory_get_pulse',
    'memory_list_pending_proposals',
    'memory_propose_update',
    'memory_recent_commits',
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
    if (t.scopes.some(scope => scope.endsWith(':write') || scope === 'files:archive')) {
      assert(!canInvoke(readCtx, t), `${t.name} should reject aceleriq:read`);
      continue;
    }
    assert(canInvoke(readCtx, t), `${t.name} should allow aceleriq:read`);
  }
});

Deno.test('restricted service-role principals only see explicitly client-scoped handlers', () => {
  assert(canUseToolWithDataScope(restrictedCtx, TOOL_MAP.get('aceleriq_list_clients')!));
  assert(canUseToolWithDataScope(restrictedCtx, TOOL_MAP.get('aceleriq_list_tasks')!));
  assert(canUseToolWithDataScope(restrictedCtx, TOOL_MAP.get('aceleriq_list_editorial_calendar')!));
  assert(!canUseToolWithDataScope(restrictedCtx, TOOL_MAP.get('aceleriq_list_reports')!));
  assert(!canUseToolWithDataScope(restrictedCtx, TOOL_MAP.get('aceleriq_list_contracts')!));
  assert(canUseToolWithDataScope(restrictedCtx, TOOL_MAP.get('memory_get_context')!));
  assert(canUseToolWithDataScope(restrictedCtx, TOOL_MAP.get('memory_propose_update')!));
  assert(canUseToolWithDataScope(adminCtx, TOOL_MAP.get('aceleriq_list_reports')!));
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
  const outRestricted = await tool.handler({}, {
    ...restrictedCtx,
    scopes: ['aceleriq:read', 'aceleriq:write', 'memory:read', 'memory:propose'],
  }) as Record<string, unknown>;
  const restrictedNames = (outRestricted.tools as any[]).map(t => t.name);
  assert(restrictedNames.includes('aceleriq_list_clients'));
  assert(restrictedNames.includes('aceleriq_list_editorial_calendar'));
  assert(restrictedNames.includes('memory_get_context'));
  assert(!restrictedNames.includes('aceleriq_list_reports'));
  assert(!restrictedNames.includes('aceleriq_list_contracts'));
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

Deno.test('MCP transport Accept negotiation requires JSON or SSE', () => {
  const mk = (accept?: string) => new Request('https://mcp.example/functions/v1/mcp', {
    headers: accept === undefined ? undefined : { accept },
  });
  assert(acceptsMcpResponse(mk('application/json')));
  assert(acceptsMcpResponse(mk('text/event-stream')));
  assert(acceptsMcpResponse(mk('application/json, text/event-stream')));
  assert(acceptsMcpResponse(mk('*/*')));
  assert(!acceptsMcpResponse(mk('text/html')));
  assert(!acceptsMcpResponse(mk()));
});

Deno.test('MCP protocol version accepts current, compatibility baseline, and absent only', () => {
  const mk = (version?: string) => new Request('https://mcp.example/functions/v1/mcp', {
    headers: version === undefined ? undefined : { 'MCP-Protocol-Version': version },
  });
  assert(isMcpProtocolVersionSupported(mk()));
  assert(isMcpProtocolVersionSupported(mk(MCP_PROTOCOL_VERSION)));
  assert(isMcpProtocolVersionSupported(mk('2025-03-26')));
  assert(!isMcpProtocolVersionSupported(mk('2099-01-01')));
});

Deno.test('MCP origin policy allows native, ChatGPT, same-origin, and configured origins only', () => {
  const allowed = resolveMcpAllowedOrigins(
    'https://admin.example, *, javascript:alert(1), https://bad.example/path',
    ['https://project.supabase.co/functions/v1/mcp'],
  );
  const request = (origin?: string, url = 'https://project.supabase.co/functions/v1/mcp') =>
    new Request(url, { headers: origin === undefined ? undefined : { origin } });

  assert(allowed.has('https://chatgpt.com'));
  assert(allowed.has('https://chat.openai.com'));
  assert(allowed.has('https://admin.example'));
  assert(allowed.has('https://project.supabase.co'));
  assert(!allowed.has('*'));
  assert(isMcpOriginAllowed(request(), allowed));
  assert(isMcpOriginAllowed(request('https://chatgpt.com'), allowed));
  assert(isMcpOriginAllowed(request('https://admin.example'), allowed));
  assert(isMcpOriginAllowed(request('https://same.example', 'https://same.example/mcp'), allowed));
  assert(!isMcpOriginAllowed(request('https://evil.example'), allowed));
  assert(!isMcpOriginAllowed(request('null'), allowed));
});

Deno.test('MCP JSON-RPC envelope rejects batches and malformed fields', () => {
  assert(validateJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }).ok);
  assert(validateJsonRpcRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }).ok);

  const batch = validateJsonRpcRequest([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]);
  assertEquals(batch.ok, false);
  if (!batch.ok) assertEquals(batch.code, RpcErrors.invalidRequest);

  for (const malformed of [
    null,
    { id: 1, method: 'tools/list' },
    { jsonrpc: '1.0', id: 1, method: 'tools/list' },
    { jsonrpc: '2.0', id: 1, method: '' },
    { jsonrpc: '2.0', id: {}, method: 'tools/list' },
  ]) {
    assertEquals(validateJsonRpcRequest(malformed).ok, false);
  }

  const badParams = validateJsonRpcRequest({
    jsonrpc: '2.0',
    id: 'x',
    method: 'tools/list',
    params: [],
  });
  assertEquals(badParams.ok, false);
  if (!badParams.ok) assertEquals(badParams.code, RpcErrors.invalidParams);
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
  assert(canInvoke(memoryReadCtx, t('memory_get_pulse')));
  assert(canInvoke(memoryReadCtx, t('memory_recent_commits')));
  assert(!canInvoke(emptyCtx, t('memory_get_pulse')));
  assert(!canInvoke(emptyCtx, t('memory_recent_commits')));
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
    assert(t.scopes.includes('aceleriq:write' as any), `${name} keeps aggregate write scope`);
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

Deno.test('task write contracts expose optional delivery_type with unspecified compatibility', () => {
  const deliveryTypes = [
    'unspecified',
    'design',
    'branding',
    'static',
    'carousel',
    'reel',
    'story',
    'video',
    'short',
    'article',
    'google_post',
    'planning',
    'copywriting',
    'website',
    'landing_page',
    'automation',
    'traffic',
    'seo',
    'document',
    'report',
    'other',
  ];
  const createTool = TOOL_MAP.get('aceleriq_create_task')!;
  const updateTool = TOOL_MAP.get('aceleriq_update_task')!;
  assertEquals(
    ((createTool.inputSchema as any).properties.delivery_type as any).enum,
    deliveryTypes,
  );
  assertEquals(
    ((updateTool.inputSchema as any).properties.delivery_type as any).enum,
    deliveryTypes,
  );
  assert(
    !(createTool.inputSchema as any).required.includes('delivery_type'),
  );
  assert(
    !(updateTool.inputSchema as any).required.includes('delivery_type'),
  );

  const createBase = {
    project_id: '00000000-0000-0000-0000-000000000001',
    title: 'Tarefa MCP',
    idempotency_key: 'delivery-type-create',
  };
  assert(createTaskSchema.safeParse(createBase).success);
  assert(
    createTaskSchema.safeParse({
      ...createBase,
      delivery_type: 'unspecified',
    }).success,
  );
  assert(
    updateTaskSchema.safeParse({
      task_id: '00000000-0000-0000-0000-000000000002',
      delivery_type: 'carousel',
      idempotency_key: 'delivery-type-update',
    }).success,
  );
  assert(
    !createTaskSchema.safeParse({
      ...createBase,
      delivery_type: 'invalid',
    }).success,
  );
  assert(
    !updateTaskSchema.safeParse({
      task_id: '00000000-0000-0000-0000-000000000002',
      delivery_type: 'invalid',
      idempotency_key: 'delivery-type-update-invalid',
    }).success,
  );
});

Deno.test('editorial tools expose safe, strict contracts and dedicated scopes', () => {
  const list = TOOL_MAP.get('aceleriq_list_editorial_calendar')!;
  const create = TOOL_MAP.get('aceleriq_create_editorial_item')!;
  assert(list.scopes.includes('editorial:read' as any));
  assert(create.scopes.includes('editorial:write' as any));
  assert(!canInvoke(readCtx, create));
  assert(canInvoke({ ...readCtx, scopes: ['editorial:write'] }, create));
  assertEquals((list.inputSchema as any).required, ['client_id']);
  assertEquals((create.inputSchema as any).additionalProperties, false);
  assert(!(create.inputSchema as any).properties.status, 'create must not approve or complete');
  assert(!(create.inputSchema as any).properties.scheduled_at, 'create must not schedule');
  assert(!(create.inputSchema as any).properties.external_account_id, 'create must not publish');

  const base = {
    client_id: '00000000-0000-0000-0000-000000000001',
    project_id: '00000000-0000-0000-0000-000000000002',
    title: 'Carrossel educativo',
    description: 'Briefing editorial completo.',
    delivery_type: 'carousel',
    due_date: '2026-08-20',
    idempotency_key: 'editorial-create-001',
  };
  assert(createEditorialItemSchema.safeParse(base).success);
  assert(!createEditorialItemSchema.safeParse({ ...base, delivery_type: 'planning' }).success);
  assert(!createEditorialItemSchema.safeParse({ ...base, due_date: '2026-02-31' }).success);
  assert(!createEditorialItemSchema.safeParse({ ...base, description: undefined, context: undefined }).success);
});

Deno.test('editorial idempotency canonicalizes aliases and ignores later task state', async () => {
  const original = canonicalizeEditorialIdempotencyInput({
    client_id: '00000000-0000-0000-0000-000000000001',
    project_id: '00000000-0000-0000-0000-000000000002',
    title: '  Carrossel educativo  ',
    description: ' Briefing editorial completo. ',
    delivery_type: 'carousel',
    due_date: '2026-08-20',
  });
  const replay = canonicalizeEditorialIdempotencyInput({
    client_id: '00000000-0000-0000-0000-000000000001',
    project_id: '00000000-0000-0000-0000-000000000002',
    title: 'Carrossel educativo',
    description: 'Briefing editorial completo.',
    format: 'carousel',
    due_date: '2026-08-20',
    status: 'doing',
  });
  assertEquals(replay, original);
  const changed = canonicalizeEditorialIdempotencyInput({
    ...replay,
    title: 'Outro conteúdo',
  });
  assert(JSON.stringify(changed) !== JSON.stringify(original));

  const taskId = await deterministicEditorialTaskId('oauth:user-a', 'editorial-create-001');
  assertEquals(
    taskId,
    await deterministicEditorialTaskId('oauth:user-a', 'editorial-create-001'),
  );
  assert(taskId !== await deterministicEditorialTaskId('oauth:user-b', 'editorial-create-001'));
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(taskId));
  assertEquals(
    await editorialPayloadFingerprint(original),
    await editorialPayloadFingerprint(replay),
  );
  assert(
    await editorialPayloadFingerprint(changed)
      !== await editorialPayloadFingerprint(original),
  );
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

// ─── Bloco B: contracts scope gating ─────────────────────────
const contractsReadCtx: AuthContext = { ...readCtx, scopes: ['contracts:read'] };
const contractsWriteCtx: AuthContext = { ...readCtx, scopes: ['contracts:write'], correlationId: '00000000-0000-0000-0000-0000000000bb' };

Deno.test('contracts read tools accept contracts:read OR aceleriq:read', () => {
  for (const name of ['aceleriq_list_contracts', 'aceleriq_get_contract']) {
    const t = TOOL_MAP.get(name)!;
    assert(canInvoke(contractsReadCtx, t), `${name} must accept contracts:read`);
    assert(canInvoke(readCtx, t), `${name} must accept aceleriq:read`);
    assert(canInvoke(adminCtx, t));
    assert(!canInvoke(emptyCtx, t));
  }
});

Deno.test('contracts write tools require contracts:write; aceleriq:write is NOT enough', () => {
  const writeOnly: AuthContext = { ...readCtx, scopes: ['aceleriq:write'] };
  for (const name of ['aceleriq_create_contract', 'aceleriq_update_contract', 'aceleriq_cancel_contract']) {
    const t = TOOL_MAP.get(name)!;
    assert(!canInvoke(readCtx, t), `${name} must reject read-only`);
    assert(!canInvoke(writeOnly, t), `${name} must NOT accept plain aceleriq:write`);
    assert(canInvoke(contractsWriteCtx, t), `${name} must accept contracts:write`);
    assert(canInvoke(adminCtx, t));
    assertEquals(t.scopes, ['contracts:write']);
  }
});

Deno.test('generic MCP contract sending is not exposed', () => {
  assertEquals(TOOL_MAP.has('aceleriq_send_contract'), false);
});

Deno.test('create_contract requires client_id, title, file fields, idempotency_key', async () => {
  const tool = TOOL_MAP.get('aceleriq_create_contract')!;
  let threw = false;
  try { await tool.handler({ title: 'x' }, contractsWriteCtx); }
  catch (e) { threw = true; assert(/Invalid input/.test((e as Error).message)); }
  assert(threw);
});

Deno.test('update_contract requires at least one updatable field', async () => {
  const tool = TOOL_MAP.get('aceleriq_update_contract')!;
  let threw = false;
  try {
    await tool.handler({
      contract_id: '00000000-0000-0000-0000-000000000001',
      idempotency_key: 'abcd1234',
    }, contractsWriteCtx);
  } catch (e) { threw = true; assert(/Invalid input/.test((e as Error).message)); }
  assert(threw);
});

Deno.test('contracts write tools reject unknown fields (strict allowlist)', async () => {
  const tool = TOOL_MAP.get('aceleriq_create_contract')!;
  let threw = false;
  try {
    await tool.handler({
      client_id: '00000000-0000-0000-0000-000000000002',
      title: 'x',
      original_file_url: 'https://example.com/a.pdf',
      original_file_name: 'a.pdf',
      idempotency_key: 'abcd1234',
      status: 'signed', // forbidden: status is server-controlled
    }, contractsWriteCtx);
  } catch (e) { threw = true; assert(/Invalid input/.test((e as Error).message)); }
  assert(threw);
});

// ─── Bloco D: granular OAuth scopes ──────────────────────────
import { SCOPE_DESCRIPTIONS, ALL_SCOPES, expandScopes, GRANULAR_SCOPE_BY_TOOL } from '../_shared/mcp-tools.ts';

Deno.test('every scope has a human-readable description', () => {
  for (const s of ALL_SCOPES) {
    const d = SCOPE_DESCRIPTIONS[s];
    assert(d && d.title && d.description, `missing description for ${s}`);
  }
});

Deno.test('aggregate aceleriq:read expands to all granular reads', () => {
  const exp = expandScopes(['aceleriq:read']);
  for (const s of ['clients:read','projects:read','tasks:read','reports:read','briefings:read','files:read','workspace:read','contracts:read','editorial:read']) {
    assert(exp.has(s), `expected expansion to include ${s}`);
  }
  assert(!exp.has('projects:write'), 'read must not grant writes');
});

Deno.test('aggregate aceleriq:write grants editorial creation but never through read scope', () => {
  const write = expandScopes(['aceleriq:write']);
  const read = expandScopes(['aceleriq:read']);
  assert(write.has('editorial:write'));
  assert(!read.has('editorial:write'));
});

Deno.test('granular scope alone authorizes only its own tools', () => {
  const projectsRead: AuthContext = { ...readCtx, scopes: ['projects:read'] };
  const projectsTool = TOOL_MAP.get('aceleriq_list_projects')!;
  const clientsTool = TOOL_MAP.get('aceleriq_list_clients')!;
  assert(canInvoke(projectsRead, projectsTool));
  assert(!canInvoke(projectsRead, clientsTool));
});

Deno.test('every mapped granular scope is on the resolved tool', () => {
  for (const [name, scope] of Object.entries(GRANULAR_SCOPE_BY_TOOL)) {
    const t = TOOL_MAP.get(name);
    assert(t, `missing tool ${name}`);
    assert(t!.scopes.includes(scope as any), `${name} missing scope ${scope}`);
  }
});
