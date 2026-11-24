/* global Deno */
// CI-only entry for the real mcp-server Edge Function (scripts/test-ci-corte-edge.mjs).
// It never changes the deployed function: it binds the same handler to loopback and
// refuses any fetch outside the disposable local Supabase API before importing it.
// Deno's --allow-net list is the hard boundary; this guard only makes attempts visible.
// Fixed markers only: URLs, headers and bodies never reach stdout/stderr from here.

const port = Number(Deno.env.get('CI_CORTE_EDGE_PORT'));
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('CI_CORTE_EDGE_BAD_PORT');
const supabaseOrigin = 'http://127.0.0.1:54321';
if (Deno.env.get('SUPABASE_URL') !== supabaseOrigin) throw new Error('CI_CORTE_EDGE_NONLOCAL_SUPABASE');

const nativeFetch = globalThis.fetch.bind(globalThis);
const authRoutes = new Map([
  ['/rest/v1/rpc/validate_api_key_for_audience', 'key'],
  ['/rest/v1/api_keys', 'key_state'],
  ['/rest/v1/mcp_project_grants', 'grant'],
  ['/rest/v1/internal_operators', 'operator'],
  ['/rest/v1/projects', 'project'],
  ['/rest/v1/profiles', 'profile'],
]);
function localTarget(input) {
  try {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return url.origin === supabaseOrigin && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}
function restResult(response, body) {
  if (response.ok) {
    if (!Array.isArray(body)) return 'other';
    return body.length === 0 ? 'empty' : 'rows';
  }
  const code = body?.code;
  return typeof code === 'string' && /^(?:PGRST\d{3}|[0-9][0-9A-Z]{4}|P0[0-9A-Z]{3}|XX[0-9A-Z]{3})$/.test(code)
    ? code : 'unknown';
}
globalThis.fetch = async (input, init) => {
  const url = localTarget(input);
  if (!url) {
    console.error('CI_CORTE_EDGE_EGRESS_BLOCKED');
    throw new TypeError('CI egress blocked');
  }
  const route = authRoutes.get(url.pathname);
  let response;
  try {
    response = await nativeFetch(input, { ...init, redirect: 'error' });
  } catch (error) {
    if (route) console.error(`CI_CORTE_EDGE_REST ${route} fetch_failed`);
    throw error;
  }
  if (route) {
    const body = await response.clone().json().catch(() => null);
    console.error(`CI_CORTE_EDGE_REST ${route} ${response.status} ${restResult(response, body)}`);
  }
  return response;
};

const nativeServe = Deno.serve.bind(Deno);
let servers = 0;
const loopbackServe = (...args) => {
  servers += 1;
  if (servers !== 1) throw new Error('CI_CORTE_EDGE_SECOND_SERVER');
  const handler = typeof args[0] === 'function' ? args[0]
    : typeof args[1] === 'function' ? args[1] : args[0]?.handler;
  if (typeof handler !== 'function') throw new Error('CI_CORTE_EDGE_NO_HANDLER');
  return nativeServe({ hostname: '127.0.0.1', port, onListen() { console.log('CI_CORTE_EDGE_READY'); } }, handler);
};
Deno.serve = loopbackServe;
if (Deno.serve !== loopbackServe) throw new Error('CI_CORTE_EDGE_SERVE_NOT_PATCHED');

await import('../supabase/functions/mcp-server/index.ts');
if (servers !== 1) throw new Error('CI_CORTE_EDGE_NOT_SERVED');
