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
function allowed(input) {
  try {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return url.origin === supabaseOrigin && !url.username && !url.password;
  } catch {
    return false;
  }
}
globalThis.fetch = (input, init) => {
  if (!allowed(input)) {
    console.error('CI_CORTE_EDGE_EGRESS_BLOCKED');
    return Promise.reject(new TypeError('CI egress blocked'));
  }
  return nativeFetch(input, { ...init, redirect: 'error' });
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
