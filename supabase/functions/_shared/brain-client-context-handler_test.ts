import { makeBrainContextHandler, noteBelongsToClient, type BrainContextDependencies } from './brain-client-context-handler.ts';

const CLIENT = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
function assert(value: unknown, message = 'assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
function fixture(overrides: Partial<BrainContextDependencies> = {}) {
  const calls: string[] = [];
  const deps: BrainContextDependencies = {
    authenticate: async () => ({ id: 'staff', staff: true, admin: false }),
    resolveClient: async ({ id, name }) => (id === CLIENT || name === 'Cliente A') ? { id: CLIENT, name: 'Cliente A' } : null,
    canAccess: async (_token, id) => id === CLIENT,
    configured: () => true,
    search: async query => { calls.push(`search:${query}`); return [{ path: 'memory/client.md' }, { path: 'memory/mixed.md' }]; },
    read: async path => { calls.push(`read:${path}`); return { content: path === 'memory/client.md'
      ? `---\nclient_id: ${CLIENT}\n---\nEstratégia dedicada ao Cliente A.`
      : `Cliente A discutido aqui.\nDados de outro cliente que não podem vazar.` }; },
    ...overrides,
  };
  const handler = makeBrainContextHandler(deps);
  const request = (body: unknown = { client_id: CLIENT }, token: string | null = 'test-session') => handler(new Request('https://isolated.invalid/context', {
    method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body),
  }));
  return { calls, request };
}

Deno.test('unauthenticated and non-staff callers never read the repository', async () => {
  for (const mode of ['missing', 'expired', 'client']) {
    const f = fixture({ authenticate: async () => mode === 'expired' ? null : { id: 'client', staff: false, admin: false } });
    const res = await f.request(undefined, mode === 'missing' ? null : 'test');
    assert(res.status === (mode === 'client' ? 403 : 401));
    assert(f.calls.length === 0);
  }
});
Deno.test('foreign UUID and unauthorized assignment deny before bridge access', async () => {
  const foreign = fixture();
  assert((await foreign.request({ client_id: OTHER, client_name: 'Cliente A' })).status === 403);
  assert(foreign.calls.length === 0);
  const revoked = fixture({ canAccess: async () => false });
  assert((await revoked.request()).status === 403);
  assert(revoked.calls.length === 0);
});
Deno.test('assigned staff receives its bound note but never adjacent mixed-client text', async () => {
  const f = fixture();
  const res = await f.request({ client_id: CLIENT, client_name: 'OTHER repo:evil' });
  const body = await res.json();
  assert(res.status === 200 && body.sources.length === 1);
  assert(body.context.includes('Estratégia dedicada'));
  assert(!body.context.includes('outro cliente'));
  assert(f.calls[0] === `search:"${CLIENT}"`);
});
Deno.test('admin retains client context access to legacy notes without neighboring lines', async () => {
  const f = fixture({ authenticate: async () => ({ id: 'admin', staff: true, admin: true }) });
  const body = await (await f.request()).json();
  assert(body.sources.includes('memory/mixed.md'));
  assert(!body.context.includes('Dados de outro cliente'));
});
Deno.test('legacy name requires exact unique resolution and the same UUID access check', async () => {
  const f = fixture();
  assert((await f.request({ client_name: 'Cliente A' })).status === 200);
  const denied = fixture({ canAccess: async () => false });
  assert((await denied.request({ client_name: 'Cliente A' })).status === 403);
  assert((await denied.request({ client_name: 'Cliente' })).status === 403);
  assert(denied.calls.length === 0);
});
Deno.test('missing bridge and upstream errors degrade without private error text', async () => {
  const missing = fixture({ configured: () => false });
  assert((await (await missing.request()).json()).configured === false);
  assert(missing.calls.length === 0);
  const failed = fixture({ search: async () => { throw new Error('PRIVATE_UPSTREAM_BODY'); } });
  const body = await (await failed.request()).text();
  assert(!body.includes('PRIVATE_UPSTREAM_BODY') && body.includes('indisponível'));
});
Deno.test('front matter must bind one exact client, not incidental mentions or duplicate keys', () => {
  assert(noteBelongsToClient(`---\nclient_id: "${CLIENT}"\n---\nNote`, CLIENT));
  assert(!noteBelongsToClient(`---\nclient_id: ${OTHER}\n---\n${CLIENT}`, CLIENT));
  assert(!noteBelongsToClient(`---\nclient_id: ${CLIENT}\nclient_id: ${OTHER}\n---\nNote`, CLIENT));
  assert(!noteBelongsToClient(`A shared note mentions ${CLIENT}`, CLIENT));
  assert(!noteBelongsToClient(`---\nclient_id: ${CLIENT}\nclient_id: ${OTHER} # later override\n---\nNote`, CLIENT));
  assert(!noteBelongsToClient(`---\nclient_id: ${CLIENT}\nclient_id: [${OTHER}]\n---\nNote`, CLIENT));
  assert(!noteBelongsToClient(`---\nclient_id: "${CLIENT}'\n---\nNote`, CLIENT));
});
Deno.test('unsafe and credential-named paths are never fetched', async () => {
  const f = fixture({ search: async () => ['../client.md', '/client.md', 'memory/tokens.md', 'memory/auth.md', 'memory/session.json'].map(path => ({ path })) });
  await f.request();
  assert(f.calls.length === 0, f.calls.join(','));
});
