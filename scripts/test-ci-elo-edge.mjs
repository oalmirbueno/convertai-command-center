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
// Tables the real Edge reads through service_role in this proof. The first four carry an explicit
// tracked service_role grant and must already be readable; nothing here papers over them.
const trackedServiceReads = ['public.operator_key_bindings', 'public.projects', 'public.team_client_assignments', 'public.user_roles'];
// No tracked SQL grants service_role on these two: production relies on the legacy Supabase default
// table grants, which the empty CI replay does not recreate (same drift documented in
// supabase/bootstrap/ci-milestones-read-access.sql). Only a missing SELECT is restored, only in the
// disposable stack, and exactly what was added is revoked at the end. Fixed names, never input.
const legacyServiceReads = ['public.internal_operators', 'public.tasks'];
const serviceReads = [...trackedServiceReads, ...legacyServiceReads];
const privilegeProbe = `SELECT string_agg(t || '=' || has_table_privilege('service_role', t, 'SELECT')::text
    || '/' || has_table_privilege('service_role', t, 'SELECT WITH GRANT OPTION')::text, ',' ORDER BY t)
  FROM unnest(ARRAY[${serviceReads.map((t) => "'" + t + "'").join(', ')}]::text[]) AS t;`;

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

function parsePrivileges(text) {
  const entries = String(text).split(',').map((entry) => {
    const match = /^(public\.[a-z_]{2,40})=(true|false)\/(true|false)$/.exec(entry);
    if (!match || !serviceReads.includes(match[1])) fail('unexpected privilege probe.');
    return [match[1], { select: match[2] === 'true', grantOption: match[3] === 'true' }];
  });
  const privileges = new Map(entries);
  if (entries.length !== serviceReads.length || privileges.size !== serviceReads.length) fail('unexpected privilege probe.');
  return privileges;
}

function serviceReadPrivileges(label) {
  return parsePrivileges(psql(privilegeProbe, {}, label));
}

// Sanitized marker: fixed table names and booleans only.
function privilegeMarker(privileges) {
  return serviceReads.map((t) => t.slice('public.'.length) + '=' + (privileges.get(t)?.select ? 'select' : 'none')).join(',');
}

// Fills `state` before any GRANT so the finally block can revoke even after a partial failure.
function restoreLegacyServiceReads(state) {
  state.before = serviceReadPrivileges('service_role read probe');
  console.log('Elo Edge marker: service_role reads before restore [' + privilegeMarker(state.before) + '].');
  if (trackedServiceReads.some((t) => !state.before.get(t).select)) fail('tracked service_role read grant missing.');
  for (const table of legacyServiceReads.filter((t) => !state.before.get(t).select)) {
    state.restore.push(table);
    psql('GRANT SELECT ON TABLE ' + table + ' TO service_role;', {}, 'restore legacy service_role read');
  }
  const after = serviceReadPrivileges('service_role read recheck');
  if (serviceReads.some((t) => !after.get(t).select || after.get(t).grantOption !== state.before.get(t).grantOption)) {
    fail('service_role read restore did not apply exactly [' + privilegeMarker(after) + '].');
  }
  console.log('Elo Edge marker: legacy service_role SELECT restored for [' +
    (state.restore.map((t) => t.slice('public.'.length)).join(',') || 'none') + '].');
}

function revokeRestoredServiceReads(state) {
  if (!state.before) return;
  // Try every registered table and always run the final probe before reporting; fixed messages only.
  const errors = [];
  for (const table of state.restore) {
    try {
      psql('REVOKE SELECT ON TABLE ' + table + ' FROM service_role;', {}, 'revoke restored service_role read');
    } catch {
      errors.push('service_role read revoke failed for a restored table.');
    }
  }
  try {
    const after = serviceReadPrivileges('service_role read final probe');
    if (serviceReads.some((t) => after.get(t).select !== state.before.get(t).select ||
        after.get(t).grantOption !== state.before.get(t).grantOption)) errors.push('service_role read privileges were not restored.');
  } catch {
    errors.push('service_role read final probe failed.');
  }
  if (errors.length) fail(errors.join(' '));
}

// The Edge logs only fixed labels plus a database code (escritorio.ts falhou, autoria.ts). Keep
// exactly that: label and SQLSTATE/PostgREST code, never URLs, headers, bodies or messages.
const edgeDbMarker = /\[mcp (escritorio|autoria)\] ([a-z][a-z ]{1,60}?) \{ code: (?:["']([0-9A-Z]{5}|PGRST[0-9]{3})["']|undefined) \}/g;
const edgeDbLabels = { escritorio: ['operador', 'caixa'], autoria: ['leitura dos vinculos falhou'] };
function edgeDbMarkers(text) {
  return [...String(text).matchAll(edgeDbMarker)].filter((m) => edgeDbLabels[m[1]].includes(m[2])).map((m) => m[1] + '/' + m[2].replaceAll(' ', '_') + ':' + (m[3] ?? 'none'));
}

// The tool's own error code is a fixed enum from the handler (ErroDaFerramenta), not service text.
const toolCodes = new Set(['falha_no_banco', 'vinculos_indisponiveis', 'escritorio_nao_instalado',
  'identidade_restrita_negada', 'identidade_restrita_sem_vinculo', 'identidade_restrita_inativa',
  'nao_e_voce', 'entrada_invalida']);
function toolCodeMarker(answer) {
  const code = answer?.result?.structuredContent?.erro?.codigo;
  if (typeof code === 'string') return toolCodes.has(code) ? code : 'codigo_fora_da_lista';
  if (answer?.error) return Number.isInteger(answer.error.code) ? 'rpc' + answer.error.code : 'rpc_error';
  return answer?.result?.isError ? 'is_error_without_code' : 'no_structured_content';
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
  const state = { child, ready: false, denied: false, exited: false, dbMarkers: new Set() };
  for (const stream of [child.stdout, child.stderr]) {
    let tail = '';
    stream.on('data', (chunk) => {
      const text = tail + chunk.toString('utf8');
      if (text.includes('CI_ELO_EDGE_READY')) state.ready = true;
      if (/CI_ELO_EDGE_EGRESS_BLOCKED|NotCapable|Requires net access/.test(text)) state.denied = true;
      const lines = text.split('\n');
      for (const line of lines.slice(0, -1)) {
        for (const marker of edgeDbMarkers(line)) if (state.dbMarkers.size < 8) state.dbMarkers.add(marker);
      }
      tail = lines.at(-1).slice(-200);
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
  // Failure markers: the fixed step label, the tool name constant and the sanitized code only.
  const result = async (step, name, args) => {
    const answer = await call(name, args);
    if (!answer.result?.structuredContent || answer.result.isError) {
      fail('expected an authorized tool result [step=' + step + ' tool=' + name + ' code=' + toolCodeMarker(answer) + '].');
    }
    return answer.result.structuredContent;
  };
  const denied = async (step, name, args) => {
    const answer = await call(name, args);
    if (answer.error?.code !== -32003 || answer.result) {
      fail('expected an authorization denial [step=' + step + ' tool=' + name + ' code=' + toolCodeMarker(answer) + '].');
    }
  };
  const deniedIdentity = async (step, operator, code) => {
    const answer = await call(enter, { operator });
    if (answer.result?.isError !== true || answer.result?.structuredContent?.erro?.codigo !== code ||
        JSON.stringify(answer).includes('fred')) {
      fail('expected identity denial without revealing Fred [step=' + step + ' code=' + toolCodeMarker(answer) + '].');
    }
  };

  const { result: catalog } = await rpc('tools/list', {});
  if (!Array.isArray(catalog?.tools)) fail('expected authenticated catalog.');
  const names = catalog.tools.map((tool) => tool.name);
  if (!names.includes(enter) || !names.includes(listTasks) ||
      names.some((name) => name.startsWith('aceleriq_escritorio_') && name !== enter) ||
      catalog.tools.some((tool) => tool.annotations?.readOnlyHint !== true)) fail('catalog exposes unexpected access.');
  for (const [step, args] of [['identity-default', {}], ['identity-elo', { operator: 'elo' }],
    ['identity-elo-padded', { operator: ' ELO ' }]]) {
    const identity = await result(step, enter, args);
    if (identity.voce?.slug !== 'elo' || identity.modo !== 'identidade_restrita' ||
        Object.keys(identity).sort().join() !== 'aviso,modo,voce' ||
        JSON.stringify(identity).includes('fred')) fail('expected only the Elo identity.');
  }
  await deniedIdentity('identity-fred', 'fred', 'nao_e_voce');

  const onlyX = async (step, filters) => {
    const { items } = await result(step, listTasks, filters);
    if (items?.length !== 1 || items[0].id !== values.task_x_id ||
        items[0].client_id !== values.client_x_id) fail('expected only the task assigned to client X [step=' + step + '].');
  };
  await onlyX('tasks-scope', {});
  await onlyX('tasks-client-x', { client_id: values.client_x_id });
  await denied('tasks-client-y', listTasks, { client_id: values.client_y_id });
  await denied('tasks-project-y', listTasks, { project_id: values.project_y_id });
  await denied('directory', 'aceleriq_escritorio_diretorio', {});
  await denied('inbox', 'aceleriq_escritorio_caixa', {});
  await denied('create-task', 'aceleriq_create_task', { project_id: values.project_x_id, title: 'Mutação proibida no teste' });
  await denied('send', 'aceleriq_escritorio_enviar', { para: 'fred', texto: 'Mutação proibida no teste' });

  const key = { key_id: values.key_id };
  psql(revokeBinding, key, 'remove synthetic operator binding');
  if (psql(`SELECT count(*) FROM public.operator_key_bindings WHERE principal = 'key:' || :'key_id';`,
    key, 'check binding removal') !== '0') fail('binding still exists.');
  await deniedIdentity('identity-unbound', 'elo', 'identidade_restrita_sem_vinculo');
  await onlyX('tasks-project-x-unbound', { project_id: values.project_x_id });
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
    !workflow.slice(step, end).includes('continue-on-error') &&
    workflow.slice(step, end).includes('deno info --frozen scripts/ci-elo-edge-entry.mjs') &&
    !workflow.slice(step, end).includes('deno cache'));

  // Restoration stays SELECT-only, limited to the two legacy tables and kept apart from tracked grants.
  assert.deepEqual(legacyServiceReads, ['public.internal_operators', 'public.tasks']);
  assert(!legacyServiceReads.some((t) => trackedServiceReads.includes(t)));
  const source = await readFile(new URL(import.meta.url), 'utf8');
  assert.deepEqual([...source.matchAll(/'(GRANT|REVOKE) ([A-Z ]+) ON TABLE '/g)].map((m) => m[1] + ' ' + m[2]),
    ['GRANT SELECT', 'REVOKE SELECT']);
  const probe = serviceReads.map((t, i) => t + '=' + (i % 2 === 0) + '/false').sort().join(',');
  assert.equal(parsePrivileges(probe).get('public.operator_key_bindings').select, true);
  for (const bad of [probe + ',public.api_keys=true/false', probe.replace('public.tasks', 'public.tasks;'),
    probe.split(',').slice(1).join(','), [probe.split(',')[0], ...probe.split(',').slice(0, -1)].join(','),
    'ERROR']) assert.throws(() => parsePrivileges(bad));
  assert.equal(privilegeMarker(parsePrivileges(probe)).includes('='), true);

  // Markers keep only fixed labels and codes; messages, arguments and tokens never pass.
  assert.deepEqual(edgeDbMarkers('[mcp escritorio] operador { code: "42501" }\n' +
    '[mcp autoria] leitura dos vinculos falhou { code: "PGRST301" }\n[mcp escritorio] caixa { code: undefined }'),
  ['escritorio/operador:42501', 'autoria/leitura_dos_vinculos_falhou:PGRST301', 'escritorio/caixa:none']);
  assert.deepEqual(edgeDbMarkers('[mcp escritorio] operador { code: "42501", message: "Bearer mcp_live_x" }'), []);
  assert.deepEqual(edgeDbMarkers('[mcp escritorio] https://x { code: "42501" }'), []);
  assert.equal(toolCodeMarker({ result: { isError: true, structuredContent: { ok: false, erro: { codigo: 'falha_no_banco' } } } }), 'falha_no_banco');
  assert.equal(toolCodeMarker({ result: { isError: true, structuredContent: { erro: { codigo: 'Bearer mcp_live_x' } } } }), 'codigo_fora_da_lista');
  assert.deepEqual(edgeDbMarkers('[mcp escritorio] segredo_interno { code: "42501" }\n' +
    '[mcp escritorio] segredo interno { code: "42501" }\n[mcp autoria] operador { code: "42501" }'), []);
  assert.equal(toolCodeMarker({ result: { isError: true, structuredContent: { erro: { codigo: 'segredo_interno' } } } }), 'codigo_fora_da_lista');
  assert.equal(toolCodeMarker({ error: { code: -32003, message: 'segredo' } }), 'rpc-32003');
  assert.equal(toolCodeMarker({ result: {} }), 'no_structured_content');
  console.log('Elo Edge self-test passed: strict loopback, frozen Deno, synthetic SQL, CI step order, SELECT-only legacy restore and sanitized markers.');
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
  const reads = { before: null, restore: [] };
  let edge;
  try {
    const seeded = psql(await readFile(fixture, 'utf8'), values, 'commit synthetic SQL fixture');
    if (seeded !== 'elo edge fixture committed') fail('synthetic fixture did not report its commit.');
    // Only after the fixture attested the disposable stack and paused jobs.
    restoreLegacyServiceReads(reads);
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
    if (failures.length && edge?.dbMarkers.size) {
      failures.push('Elo Edge: Edge database markers [' + [...edge.dbMarkers].join(',') + '].');
    }
    try {
      revokeRestoredServiceReads(reads);
    } catch (error) {
      failures.push(safe(error));
    }
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
