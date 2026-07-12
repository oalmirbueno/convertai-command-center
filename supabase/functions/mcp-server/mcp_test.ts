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

const readCtx: AuthContext = {
  keyId: '00000000-0000-0000-0000-000000000001',
  keyName: 'test-key',
  scopes: ['aceleriq:read'],
  origin: 'test',
};
const emptyCtx: AuthContext = { ...readCtx, scopes: [] };
const adminCtx: AuthContext = { ...readCtx, scopes: ['admin'] };

Deno.test('registry exposes exactly the round-2 foundation tools', () => {
  assertEquals(TOOLS.map(t => t.name).sort(), ['aceleriq_capabilities', 'aceleriq_health']);
});

Deno.test('foundation tools are open to any authenticated key', () => {
  for (const t of TOOLS) assert(canInvoke(emptyCtx, t));
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
  const out = await tool.handler({}, emptyCtx) as Record<string, unknown>;
  assertEquals(out.protocolVersion, MCP_PROTOCOL_VERSION);
  const names = (out.tools as any[]).map(t => t.name).sort();
  assertEquals(names, ['aceleriq_capabilities', 'aceleriq_health']);
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
