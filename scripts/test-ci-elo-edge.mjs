// Exercises the production MCP handler against the disposable Supabase from CI.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { validateLocalStatus } from './run-ci-e2e.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = new URL('../tests/database-isolated/fixtures/elo_edge_e2e.sql', import.meta.url);
const lock = new URL('../deno.lock', import.meta.url);
const supabaseOrigin = 'http://127.0.0.1:54321';
const edgePath = '/functions/v1/mcp-server';
const enter = 'aceleriq_escritorio_entrar';
const listTasks = 'aceleriq_list_tasks';
const sha = (value) => createHash('sha256').update(value).digest('hex');
const fail = (message) => { throw new Error('Elo Edge: ' + message); };
const safe = (error) => String(error?.message).startsWith('Elo Edge: ') ? error.message : 'Elo Edge: unexpected failure.';
const ids = ['staff_id', 'client_x_id', 'client_y_id', 'project_x_id', 'project_y_id', 'task_x_id', 'task_y_id', 'key_id'];

function denoArgs(port) {
  return ['run', '--quiet', '--no-prompt', '--cached-only', '--frozen',
    '--allow-net=127.0.0.1:54321,127.0.0.1:' + port, '--allow-env', '--allow-read=' + root,
    'scripts/ci-elo-edge-entry.mjs'];
}

function localEdgeUrl(url, port) {
  const expected = 'http://127.0.0.1:' + port + edgePath;
  if (url !== expected) fail('unexpected MCP destination.');
  return url;
}

function checked(command, args, label, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 60_000, stdio: 'pipe', ...options });
  if (result.error || result.status !== 0) fail(label + ' failed.');
  return result.stdout.trim();
}

function psql(input, data, label) {
  const vars = Object.entries(data).flatMap(([key, value]) => {
    if (!/^[a-z_]{2,32}$/.test(key) || !/^[0-9a-f-]{12,64}$/.test(value)) fail('unexpected SQL variable.');
    return ['-v', key + '=' + value];
  });
  return checked('psql', ['-X', '-qAtw', '-v', 'ON_ERROR_STOP=1',
    '-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres', ...vars], label, {
    input, env: { PATH: process.env.PATH, PGHOSTADDR: '127.0.0.1', PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '5', PGPASSWORD: 'postgres' },
  });
}

const revokeBinding = `DELETE FROM public.operator_key_bindings
  WHERE principal = 'key:' || :'key_id' AND operator_slug = 'elo';`;
const cleanup = `BEGIN;
${revokeBinding}
UPDATE public.api_keys SET is_active = false, revoked_at = coalesce(revoked_at, now()) WHERE id = :'key_id';
COMMIT;`;
const counters = `SELECT json_build_object(
  'tasks', (SELECT count(*) FROM public.tasks),
  'messages', (SELECT count(*) FROM public.escritorio_mensagens),
  'notifications', (SELECT count(*) FROM public.notifications),
  'queued', (SELECT count(*) FROM net.http_request_queue),
  'sequence',
  (xpath('/row/c/text()', query_to_xml(format(
     'SELECT last_value::text || '':'' || is_called::text AS c FROM %s',
     pg_get_serial_sequence('net.http_request_queue', 'id')::regclass), false, true, '')))[1]::text
);`;

function readCounters(label) {
  return JSON.parse(psql(counters, {}, label));
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function startEdge(port, local) {
  const child = spawn('deno', denoArgs(port), {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NO_COLOR: '1',
      ...(process.env.DENO_DIR ? { DENO_DIR: process.env.DENO_DIR } : {}),
      ...(process.env.XDG_CACHE_HOME ? { XDG_CACHE_HOME: process.env.XDG_CACHE_HOME } : {}),
      DENO_NO_UPDATE_CHECK: '1', CI_ELO_EDGE_PORT: String(port), SUPABASE_URL: supabaseOrigin,
      SUPABASE_SERVICE_ROLE_KEY: local.ACELERIQ_E2E_SERVICE_ROLE_KEY,
      SUPABASE_ANON_KEY: local.ACELERIQ_E2E_ANON_KEY, APP_PUBLIC_URL: 'https://app.example.com',
    },
  });
  const state = { child, ready: false, denied: false, exited: false };
  for (const stream of [child.stdout, child.stderr]) {
    let tail = '';
    stream.on('data', (chunk) => {
      const text = tail + chunk.toString('utf8');
      if (text.includes('CI_ELO_EDGE_READY')) state.ready = true;
      if (/CI_ELO_EDGE_EGRESS_BLOCKED|NotCapable|Requires net access/.test(text)) state.denied = true;
      tail = text.slice(-100);
    });
  }
  child.once('exit', () => { state.exited = true; });
  child.once('error', () => { state.exited = true; });
  return state;
}

function edgeClient(port, token) {
  const url = localEdgeUrl('http://127.0.0.1:' + port + edgePath, port);
  let id = 0;
  return async (method, params, unauthenticated = false) => {
    const response = await fetch(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/json', accept: 'application/json',
        ...(unauthenticated ? {} : { authorization: 'Bearer ' + token }) },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    });
    if (response.status !== 200) fail('unexpected HTTP status ' + response.status + '.');
    return response.json();
  };
}

async function exercise(rpc, values) {
  const call = (name, args) => rpc('tools/call', { name, arguments: args });
  const result = async (name, args) => {
    const answer = await call(name, args);
    if (!answer.result?.structuredContent || answer.result.isError) fail('expected an authorized tool result.');
    return answer.result.structuredContent;
  };
  const denied = async (name, args) => {
    const answer = await call(name, args);
    if (answer.error?.code !== -32003 || answer.result) fail('expected an authorization denial.');
  };
  const deniedIdentity = async (operator, code) => {
    const answer = await call(enter, { operator });
    if (answer.result?.isError !== true || answer.result?.structuredContent?.erro?.codigo !== code ||
        JSON.stringify(answer).includes('fred')) fail('expected identity denial without revealing Fred.');
  };

  const { result: catalog } = await rpc('tools/list', {});
  if (!Array.isArray(catalog?.tools)) fail('expected authenticated catalog.');
  const names = catalog.tools.map((tool) => tool.name);
  if (!names.includes(enter) || !names.includes(listTasks) ||
      names.some((name) => name.startsWith('aceleriq_escritorio_') && name !== enter) ||
      catalog.tools.some((tool) => tool.annotations?.readOnlyHint !== true)) fail('catalog exposes unexpected access.');
  for (const args of [{}, { operator: 'elo' }, { operator: ' ELO ' }]) {
    const identity = await result(enter, args);
    if (identity.voce?.slug !== 'elo' || identity.modo !== 'identidade_restrita' ||
        Object.keys(identity).sort().join() !== 'aviso,modo,voce' ||
        JSON.stringify(identity).includes('fred')) fail('expected only the Elo identity.');
  }
  await deniedIdentity('fred', 'nao_e_voce');

  const onlyX = async (filters) => {
    const { items } = await result(listTasks, filters);
    if (items?.length !== 1 || items[0].id !== values.task_x_id ||
        items[0].client_id !== values.client_x_id) fail('expected only the task assigned to client X.');
  };
  await onlyX({});
  await onlyX({ client_id: values.client_x_id });
  await denied(listTasks, { client_id: values.client_y_id });
  await denied(listTasks, { project_id: values.project_y_id });
  await denied('aceleriq_escritorio_diretorio', {});
  await denied('aceleriq_escritorio_caixa', {});
  await denied('aceleriq_create_task', { project_id: values.project_x_id, title: 'Mutação proibida no teste' });
  await denied('aceleriq_escritorio_enviar', { para: 'fred', texto: 'Mutação proibida no teste' });

  const key = { key_id: values.key_id };
  psql(revokeBinding, key, 'remove synthetic operator binding');
  if (psql(`SELECT count(*) FROM public.operator_key_bindings WHERE principal = 'key:' || :'key_id';`,
    key, 'check binding removal') !== '0') fail('binding still exists.');
  await deniedIdentity('elo', 'identidade_restrita_sem_vinculo');
  await onlyX({ project_id: values.project_x_id });
}

async function selfTest() {
  const url = 'http://127.0.0.1:54899' + edgePath;
  assert.equal(localEdgeUrl(url, 54899), url);
  for (const bad of [url + '?x=1', url.replace('127.0.0.1', 'localhost'), url.replace('http:', 'https:'), supabaseOrigin]) {
    assert.throws(() => localEdgeUrl(bad, 54899));
  }
  const options = denoArgs(54899);
  assert(options.includes('--frozen') && options.includes('--cached-only') && options.includes('--no-prompt') &&
    options.includes('--allow-net=127.0.0.1:54321,127.0.0.1:54899') && !options.includes('--no-lock'));
  const fixtureSql = await readFile(fixture, 'utf8');
  assert(fixtureSql.includes('background_job_attestation') && fixtureSql.includes('@test.local') &&
    fixtureSql.includes("ARRAY['escritorio:identity', 'tasks:read']") &&
    [...ids, 'key_hash', 'suffix'].every((field) => fixtureSql.includes(":'" + field + "'")) &&
    !/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i.test(fixtureSql));
  const workflow = await readFile(new URL('../.github/workflows/supabase-db-tests.yml', import.meta.url), 'utf8');
  const step = workflow.indexOf('- name: Verify Elo Edge end to end in the disposable stack');
  const end = workflow.indexOf('- name: Stop Supabase local stack');
  assert(step > workflow.indexOf('- name: Restore synthetic seed hooks before stopping Supabase') && end > step &&
    !workflow.slice(step, end).includes('continue-on-error'));
  console.log('Elo Edge self-test passed: strict loopback, frozen Deno, synthetic SQL and CI step order.');
}

async function main() {
  if (process.argv[2] === '--self-test') return selfTest();
  if (process.argv.length !== 2 || process.platform !== 'linux' || process.env.CI !== 'true' ||
      process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
    fail('requires a disposable GitHub-hosted Linux runner.');
  }

  checked(process.execPath, ['scripts/guard-ci-e2e-network.mjs', '--guard'], 'CI network attestation');
  const local = validateLocalStatus(JSON.parse(checked('supabase', ['status', '--output', 'json'], 'local Supabase status')));
  const lockBefore = sha(await readFile(lock));
  const before = readCounters('pre-fixture counters');
  const token = 'mcp_live_ci_' + randomBytes(32).toString('hex');
  const values = { ...Object.fromEntries(ids.map((id) => [id, randomUUID()])),
    key_hash: sha(token), suffix: randomBytes(6).toString('hex') };
  const failures = [];
  let edge;
  try {
    const seeded = psql(await readFile(fixture, 'utf8'), values, 'commit synthetic SQL fixture');
    if (seeded !== 'elo edge fixture committed') fail('synthetic fixture did not report its commit.');
    const port = await freePort();
    edge = startEdge(port, local);
    const rpc = edgeClient(port, token);
    for (let attempt = 0; !edge.ready && !edge.exited && attempt < 120; attempt += 1) await delay(250);
    if (!edge.ready || edge.exited) fail('Deno Edge did not serve from the frozen cache.');
    if (!(await rpc('ping', {}, true)).result) fail('real Edge ping failed.');
    await exercise(rpc, values);
  } catch (error) {
    failures.push(safe(error));
  } finally {
    if (edge && !edge.exited) {
      edge.child.kill('SIGTERM');
      for (let attempt = 0; !edge.exited && attempt < 20; attempt += 1) await delay(100);
      if (!edge.exited) edge.child.kill('SIGKILL');
    }
    if (edge?.denied) failures.push('Elo Edge: the Edge attempted network access outside the isolated API.');
    try {
      psql(cleanup, { key_id: values.key_id }, 'revoke synthetic key');
      const after = readCounters('final counters');
      if (after.tasks !== before.tasks + 2 || after.messages !== before.messages ||
          after.notifications !== before.notifications || after.queued !== before.queued ||
          after.sequence !== before.sequence) fail('unexpected task, message, notification or network-queue change.');
      if (sha(await readFile(lock)) !== lockBefore) fail('deno.lock changed.');
    } catch (error) {
      failures.push(safe(error));
    }
  }
  if (failures.length) fail(failures.map((message) => message.slice('Elo Edge: '.length)).join(' '));
  console.log('Elo Edge passed: real MCP returns only Elo, rejects Fred and client Y, keeps client X accessible, and denies removed binding.');
}

main().catch((error) => {
  console.error(process.argv[2] === '--self-test' ? error.message : safe(error));
  process.exitCode = 1;
});
