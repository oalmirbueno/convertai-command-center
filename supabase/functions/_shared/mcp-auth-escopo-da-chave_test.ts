// Frente PERF-banco (B05): o escopo de dados da chave de API usa o dono e o
// "é admin" que a RPC validate_api_key_for_audience já devolve, sem reler
// api_keys e user_roles em toda chamada do MCP.
//
// Roda sem rede: o fetch global é trocado ANTES do primeiro uso do cliente do
// Supabase (que guarda o fetch ao nascer), e cada pedido REST é registrado.
//   deno test --allow-env supabase/functions/_shared/mcp-auth-escopo-da-chave_test.ts

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

Deno.env.set('SUPABASE_URL', 'https://projeto-de-teste.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'chave-de-servico-de-teste');
Deno.env.set('APP_PUBLIC_URL', 'https://painel-de-teste.example');

type Resposta = { status?: number; body: unknown };
let rotas: Record<string, Resposta> = {};
let pedidos: string[] = [];

globalThis.fetch = ((input: RequestInfo | URL, _init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const caminho = url.pathname.replace(/^\/rest\/v1\//, '');
  pedidos.push(caminho);
  const r = rotas[caminho] ?? { status: 404, body: { message: `sem rota para ${caminho}` } };
  return Promise.resolve(new Response(JSON.stringify(r.body), {
    status: r.status ?? 200,
    headers: { 'content-type': 'application/json' },
  }));
}) as typeof fetch;

const { authenticate, dataScopeForApiKeyRow } = await import('./mcp-auth.ts');

function preparar(r: Record<string, Resposta>) {
  rotas = r;
  pedidos = [];
}

function pedidoComChave() {
  return new Request('https://projeto-de-teste.supabase.co/functions/v1/mcp-server', {
    headers: { Authorization: 'Bearer mcp_live_chave_de_teste' },
  });
}

Deno.test('dono admin: escopo irrestrito sem ler api_keys nem user_roles', async () => {
  preparar({
    'rpc/validate_api_key_for_audience': {
      body: [{ id: 'k1', name: 'Hermes', scopes: ['aceleriq:read'], origin: null, created_by: 'u1', owner_is_admin: true }],
    },
  });
  const r = await authenticate(pedidoComChave());
  assertEquals(r.ok, true);
  if (!r.ok) return;
  assertEquals(r.ctx.dataScope, { unrestricted: true, clientIds: [], principalUserId: 'u1', source: 'api_key' });
  assertEquals(pedidos, ['rpc/validate_api_key_for_audience']);
});

Deno.test('dono da equipe: lê papéis e atribuições, escopo só com os clientes dele', async () => {
  preparar({
    'user_roles': { body: [{ role: 'manager' }] },
    'team_client_assignments': { body: [{ client_id: 'c1' }, { client_id: 'c2' }] },
  });
  const escopo = await dataScopeForApiKeyRow({ id: 'k2', created_by: 'u2', owner_is_admin: false });
  assertEquals(escopo, { unrestricted: false, clientIds: ['c1', 'c2'], principalUserId: 'u2', source: 'api_key' });
  assertEquals(pedidos.includes('api_keys'), false);
  assertEquals(pedidos, ['user_roles', 'team_client_assignments']);
});

Deno.test('chave sem dono: escopo vazio (fail closed) e nenhuma leitura extra', async () => {
  preparar({});
  const escopo = await dataScopeForApiKeyRow({ id: 'k3', created_by: null, owner_is_admin: false });
  assertEquals(escopo, { unrestricted: false, clientIds: [], principalUserId: null, source: 'api_key' });
  assertEquals(pedidos, []);
});

Deno.test('escopo admin na chave: irrestrito sem dono e sem leitura extra', async () => {
  preparar({
    'rpc/validate_api_key_for_audience': {
      body: [{ id: 'k4', name: 'Admin', scopes: ['admin'], origin: null, created_by: 'u4', owner_is_admin: true }],
    },
  });
  const r = await authenticate(pedidoComChave());
  assertEquals(r.ok, true);
  if (!r.ok) return;
  assertEquals(r.ctx.dataScope, { unrestricted: true, clientIds: [], principalUserId: null, source: 'api_key' });
  assertEquals(pedidos, ['rpc/validate_api_key_for_audience']);
});

Deno.test('RPC antiga sem created_by: cai na leitura de antes em api_keys', async () => {
  preparar({
    'api_keys': { body: [{ created_by: 'u5' }] },
    'user_roles': { body: [{ role: 'admin' }] },
  });
  const escopo = await dataScopeForApiKeyRow({ id: 'k5' });
  assertEquals(escopo, { unrestricted: true, clientIds: [], principalUserId: 'u5', source: 'api_key' });
  assertEquals(pedidos, ['api_keys', 'user_roles']);
});

Deno.test('dono que não é da equipe: escopo vazio depois de ler os papéis', async () => {
  preparar({ 'user_roles': { body: [{ role: 'client' }] } });
  const escopo = await dataScopeForApiKeyRow({ id: 'k6', created_by: 'u6', owner_is_admin: false });
  assertEquals(escopo, { unrestricted: false, clientIds: [], principalUserId: 'u6', source: 'api_key' });
  assertEquals(pedidos, ['user_roles']);
});
