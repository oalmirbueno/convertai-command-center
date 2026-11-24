// End-to-end Corte flow through the REAL mcp-server Edge (Deno, loopback) against the
// disposable CI Supabase. Synthetic only: random IDs, @test.local actors, a random
// mcp:project key that is revoked at the end. Never prints secrets, URLs, env or raw
// responses: only fixed labels, HTTP status codes and fixed tool error codes.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { validateLocalStatus } from './run-ci-e2e.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const supabaseOrigin = 'http://127.0.0.1:54321';
const edgePath = '/functions/v1/mcp-server';
const entry = 'scripts/ci-corte-edge-entry.mjs';
const fixturePath = 'tests/database-isolated/fixtures/corte_edge_e2e.sql';
const videoUrl = new URL('../supabase/tests/corte-storage-synthetic.mp4', import.meta.url);
const bucket = 'mcp-files';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const FIXTURE_VARS = ['admin_id', 'author_id', 'staff_id', 'client_id', 'project_id', 'other_project_id',
  'task_id', 'other_task_id', 'human_file_id', 'key_id', 'key_hash', 'suffix'];
const GRANT_TOOLS = new Set(['aceleriq_escritorio_entrar', 'aceleriq_projeto_identidade', 'aceleriq_projeto_resumo',
  'aceleriq_projeto_tarefas', 'aceleriq_projeto_arquivos', 'aceleriq_projeto_arquivo_ler',
  'aceleriq_projeto_video_preparar', 'aceleriq_projeto_video_finalizar', 'aceleriq_projeto_video_pedir_aprovacao']);
const WRITE_TOOLS = ['aceleriq_projeto_video_preparar', 'aceleriq_projeto_video_finalizar', 'aceleriq_projeto_video_pedir_aprovacao'];
// Deno's own denial text if any code path tries a socket outside --allow-net.
const DENIED_NET = /CI_CORTE_EDGE_EGRESS_BLOCKED|NotCapable|PermissionDenied|Requires net access/;

const fail = (label) => { throw new Error(`Corte Edge: ${label}`); };
const code = (value) => (typeof value === 'string' && /^[a-z_]{1,40}$/.test(value) ? value : 'unknown');
const digest = (data) => createHash('sha256').update(data).digest('hex');
// Library errors (fetch, URL, JSON) may echo inputs; only our fixed-label messages are kept.
const safeMessage = (error) => (String(error?.message).startsWith('Corte Edge') ? error.message : 'Corte Edge: unexpected failure.');

export function denoArgs(port) {
  return ['run', '--quiet', '--no-prompt', '--cached-only', '--frozen',
    `--allow-net=127.0.0.1:54321,127.0.0.1:${port}`, '--allow-env', `--allow-read=${root}`, entry];
}

export function localUrl(input, edgeOrigin) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  assert(!url.username && !url.password, 'Corte Edge requires URLs without credentials.');
  if (url.origin === supabaseOrigin) {
    assert(/^\/storage\/v1\//.test(url.pathname), 'Corte Edge only talks to local Storage directly.');
  } else {
    assert(edgeOrigin && url.origin === edgeOrigin && url.pathname === edgePath && !url.search,
      'Corte Edge requires the loopback mcp-server.');
  }
  return url;
}

export function psqlVar(name, value) {
  assert(/^[a-z_]{2,32}$/.test(name), 'Corte Edge: unexpected SQL variable name.');
  assert(typeof value === 'string' && /^[0-9a-z][0-9a-z/._-]{0,159}$/.test(value) && !value.includes('..'),
    'Corte Edge: unexpected SQL variable value.');
  return ['-v', `${name}=${value}`];
}

function psql(input, vars, label) {
  const result = spawnSync('psql', ['-X', '-q', '-t', '-A', '-w', '-v', 'ON_ERROR_STOP=1',
    '-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres',
    ...Object.entries(vars).flatMap(([k, v]) => psqlVar(k, v))], {
    cwd: root, input, encoding: 'utf8', timeout: 60_000,
    env: { PATH: process.env.PATH, PGHOSTADDR: '127.0.0.1', PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '5', PGPASSWORD: 'postgres' },
  });
  // Database diagnostics can include fixture values. Only the fixed label leaves.
  if (result.error || result.status !== 0) fail(`${label} failed.`);
  return result.stdout.trim();
}

function sqlJson(query, vars, label) {
  try { return JSON.parse(psql(`SET statement_timeout = '10s';\n${query}`, vars, label)); }
  catch (error) { if (error.message.startsWith('Corte Edge')) throw error; return fail(`${label} returned malformed data.`); }
}

const COUNTERS = `SELECT json_build_object(
  'notifications', (SELECT count(*) FROM public.notifications),
  'events', (SELECT count(*) FROM public.file_approval_events),
  -- Same pg_net evidence as the E2E seed guard: any enqueue advances the sequence, even if
  -- already consumed. A missing pg_net makes format() fail, so the check fails closed.
  'net_queue', (SELECT count(*) FROM net.http_request_queue),
  'net_sequence', (xpath('/row/c/text()', query_to_xml(format('SELECT last_value::text || '':'' || is_called::text AS c FROM %s',
    pg_get_serial_sequence('net.http_request_queue', 'id')::regclass), false, true, '')))[1]::text
)::text;`;

const FINALIZED = `SELECT json_build_object(
  'file', (SELECT row_to_json(f) FROM (SELECT client_id, project_id, uploaded_by, storage_bucket, storage_path, file_url,
    visibility, agency_approval_status, approval_status, status, source FROM public.files WHERE id = :'file_id') f),
  'files_for_path', (SELECT count(*) FROM public.files WHERE storage_bucket = 'mcp-files' AND storage_path = :'path'),
  'attachments', (SELECT coalesce(json_agg(json_build_object('id', id, 'task_id', task_id, 'uploaded_by', uploaded_by)), '[]'::json)
    FROM public.task_attachments WHERE file_url = 'mcp-files://' || :'path'),
  'objects', (SELECT count(*) FROM storage.objects WHERE bucket_id = 'mcp-files' AND name = :'path'),
  'session', (SELECT row_to_json(s) FROM (SELECT status, file_id, attachment_id, task_id, storage_path
    FROM public.mcp_project_video_uploads WHERE id = :'upload_id') s),
  'other_sessions', (SELECT count(*) FROM public.mcp_project_video_uploads WHERE task_id = :'other_task_id'),
  'agent_files', (SELECT count(*) FROM public.files WHERE client_id = :'client_id' AND uploaded_by = :'author_id')
)::text;`;

const REVIEWED = `SELECT json_build_object(
  'file', (SELECT row_to_json(f) FROM (SELECT agency_approval_status, approval_status, visibility, locked_at IS NULL AS unlocked
    FROM public.files WHERE id = :'file_id') f),
  'events', (SELECT coalesce(json_agg(json_build_object('event_type', event_type, 'actor_id', actor_id, 'to_status', to_status)), '[]'::json)
    FROM public.file_approval_events WHERE file_id = :'file_id'),
  'human', (SELECT row_to_json(h) FROM (SELECT agency_approval_status, approval_status, visibility FROM public.files WHERE id = :'human_file_id') h),
  'human_events', (SELECT count(*) FROM public.file_approval_events WHERE file_id = :'human_file_id'),
  'session_status', (SELECT status FROM public.mcp_project_video_uploads WHERE id = :'upload_id'),
  'agent_files', (SELECT count(*) FROM public.files WHERE client_id = :'client_id' AND uploaded_by = :'author_id')
)::text;`;

const CLEANUP = `SET statement_timeout = '15s';
BEGIN;
UPDATE public.mcp_project_grants SET revoked_at = now() WHERE api_key_id = :'key_id' AND revoked_at IS NULL;
UPDATE public.api_keys SET is_active = false WHERE id = :'key_id' AND is_active;
UPDATE public.mcp_operator_author_profiles SET revoked_at = now() WHERE profile_id = :'author_id' AND revoked_at IS NULL;
UPDATE public.mcp_agent_author_attestations SET revoked_at = now() WHERE profile_id = :'author_id' AND revoked_at IS NULL;
DO $$
BEGIN
  -- The Corte race inserts its own author binding next; one active binding per operator.
  IF EXISTS (SELECT 1 FROM public.mcp_operator_author_profiles WHERE operator_slug = 'corte' AND revoked_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.mcp_agent_author_attestations WHERE operator_slug = 'corte' AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Corte author binding still active';
  END IF;
END $$;
COMMIT;`;

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function startEdge(port, env) {
  const child = spawn('deno', denoArgs(port), { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { child, ready: false, denied: false, exited: null, tail: '' };
  // Output stays in memory, never printed: Edge logs may contain local keys or URLs.
  const scan = (chunk) => {
    const text = state.tail + chunk.toString('utf8');
    if (text.includes('CI_CORTE_EDGE_READY')) state.ready = true;
    if (DENIED_NET.test(text)) state.denied = true;
    state.tail = text.slice(-128);
  };
  child.stdout.on('data', scan);
  child.stderr.on('data', scan);
  child.on('exit', (status) => { state.exited = status ?? -1; });
  child.on('error', () => { state.exited = -1; });
  return state;
}

async function stopEdge(state) {
  if (state.exited !== null) return;
  state.child.kill('SIGTERM');
  const deadline = Date.now() + 5000;
  while (state.exited === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  if (state.exited === null) state.child.kill('SIGKILL');
}

function edgeClient(edgeOrigin) {
  const localFetch = (input, init) => {
    localUrl(input, edgeOrigin);
    return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  };
  let seq = 0;
  const rpc = async (token, method, params) => {
    const res = await localFetch(edgeOrigin + edgePath, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, ...(params ? { params } : {}) }),
    });
    const text = await res.text();
    try { return { status: res.status, body: JSON.parse(text) }; }
    catch { return fail(`${method} returned non-JSON (HTTP ${res.status}).`); }
  };
  const tool = (token, name, args) => rpc(token, 'tools/call', { name, arguments: args });
  return { localFetch, rpc, tool };
}

function success(res, label) {
  if (res.status !== 200 || !res.body?.result || res.body.result.isError) {
    fail(`${label} failed (HTTP ${res.status}, ${code(res.body?.result?.structuredContent?.erro?.codigo)}).`);
  }
  return res.body.result.structuredContent;
}

function toolError(res, expected, label) {
  const got = res.body?.result?.structuredContent?.erro?.codigo;
  assert(res.status === 200 && res.body?.result?.isError === true && got === expected,
    `Corte Edge: ${label} expected ${expected}, got HTTP ${res.status}/${code(got)}.`);
}

function rpcDenied(res, status, label) {
  assert(res.status === status && res.body?.error && res.body.result === undefined,
    `Corte Edge: ${label} was not denied (HTTP ${res.status}).`);
}

async function waitReady(state, rpc) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (state.exited !== null) fail(`Edge exited before serving (exit ${state.exited}). Is the Deno cache from the type-check step present?`);
    if (state.ready) {
      try { if ((await rpc(null, 'ping')).status === 200) return; } catch { /* still binding */ }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  fail('Edge did not become ready.');
}

async function exercise(edge, ids, token, video, service, sha) {
  const { localFetch, rpc, tool } = edge;

  // Catalog: only the prepared project tools, the three writes included.
  const listed = await rpc(token, 'tools/list', {});
  assert(listed.status === 200 && Array.isArray(listed.body?.result?.tools), 'Corte Edge: tools/list failed.');
  const names = new Set(listed.body.result.tools.map((t) => t.name));
  assert([...names].every((n) => GRANT_TOOLS.has(n)) && WRITE_TOOLS.every((n) => names.has(n)),
    'Corte Edge: unexpected tool catalog for the Corte grant.');

  // Enter: the slug comes from the grant; a different operator is refused.
  const voce = success(await tool(token, 'aceleriq_escritorio_entrar', {}), 'enter')?.voce;
  assert(voce?.slug === 'corte' && voce.projeto_id === ids.project_id && voce.cliente_id === ids.client_id,
    'Corte Edge: enter did not return the granted Corte identity.');
  success(await tool(token, 'aceleriq_escritorio_entrar', { operator: 'corte' }), 'enter as corte');
  rpcDenied(await tool(token, 'aceleriq_escritorio_entrar', { operator: 'outro' }), 200, 'enter as another operator');

  // Outside the project: task of another project, forged project_id, foreign task read.
  const idem = `ci-edge-${ids.suffix}`;
  const prepareArgs = (taskId, key) => ({ task_id: taskId, tamanho_bytes: video.length, sha256: sha, idempotency_key: key, confirmar: true });
  toolError(await tool(token, 'aceleriq_projeto_video_preparar', prepareArgs(ids.other_task_id, `${idem}-fora`)), 'tarefa', 'prepare outside the project');
  rpcDenied(await tool(token, 'aceleriq_projeto_tarefas', { project_id: ids.other_project_id }), 200, 'forged project_id');
  const foreign = success(await tool(token, 'aceleriq_projeto_tarefas', { task_id: ids.other_task_id }), 'foreign task read');
  assert(foreign?.ok === false && foreign.codigo === 'not_found', 'Corte Edge: a task outside the project was readable.');

  // Prepare (idempotent) and the signed, server-chosen destination.
  const prepared = success(await tool(token, 'aceleriq_projeto_video_preparar', prepareArgs(ids.task_id, idem)), 'prepare');
  assert(uuid.test(prepared?.upload_id ?? '') && prepared.status === 'prepared' && prepared.metodo === 'PUT', 'Corte Edge: unexpected prepare result.');
  const path = `${ids.client_id}/mcp-project-video/${prepared.upload_id}.mp4`;
  const signed = localUrl(prepared.upload_url);
  assert(signed.origin === supabaseOrigin && signed.pathname === `/storage/v1/object/upload/sign/${bucket}/${path}` &&
    signed.searchParams.has('token'), 'Corte Edge: upload URL is not the private server-generated object.');
  const again = success(await tool(token, 'aceleriq_projeto_video_preparar', prepareArgs(ids.task_id, idem)), 'prepare retry');
  assert(again?.upload_id === prepared.upload_id && again.reaproveitado === true, 'Corte Edge: prepare retry created another session.');
  const session = { upload_id: prepared.upload_id, idempotency_key: idem, confirmar: true };
  toolError(await tool(token, 'aceleriq_projeto_video_finalizar', session), 'objeto_invalido', 'finalize before the PUT');

  // Private PUT, exactly once.
  const put = await localFetch(signed, { method: 'PUT', headers: { 'content-type': 'video/mp4' }, body: video });
  assert(put.ok, `Corte Edge: signed PUT failed (HTTP ${put.status}).`);
  await put.body?.cancel();
  const altered = Buffer.from(video); altered[altered.length - 1] ^= 1;
  const replay = await localFetch(signed, { method: 'PUT', headers: { 'content-type': 'video/mp4', 'x-upsert': 'true' }, body: altered });
  assert(replay.status >= 400 && replay.status < 500, 'Corte Edge: a second PUT replaced the object.');
  await replay.body?.cancel();

  // Finalize (idempotent): authorship, single attachment and byte readback.
  const fin = success(await tool(token, 'aceleriq_projeto_video_finalizar', session), 'finalize');
  assert(uuid.test(fin?.file_id ?? '') && uuid.test(fin.anexo_id ?? '') && fin.reaproveitado === false, 'Corte Edge: unexpected finalize result.');
  const fin2 = success(await tool(token, 'aceleriq_projeto_video_finalizar', session), 'finalize retry');
  assert(fin2?.file_id === fin.file_id && fin2.anexo_id === fin.anexo_id && fin2.reaproveitado === true, 'Corte Edge: finalize retry diverged.');
  const vars = { ...pick(ids, ['client_id', 'author_id', 'other_task_id', 'human_file_id']), file_id: fin.file_id, upload_id: prepared.upload_id, path };
  const db = sqlJson(FINALIZED, vars, 'finalize postconditions');
  assert.deepEqual(db.file, { client_id: ids.client_id, project_id: ids.project_id, uploaded_by: ids.author_id, storage_bucket: bucket,
    storage_path: path, file_url: `mcp-files://${path}`, visibility: 'internal', agency_approval_status: 'not_requested',
    approval_status: 'none', status: 'ready', source: 'mcp:project-video' }, 'Corte Edge: canonical file row or authorship is wrong.');
  assert(db.files_for_path === 1 && db.objects === 1 && db.agent_files === 1, 'Corte Edge: expected one file, one object, one agent upload.');
  assert.deepEqual(db.attachments, [{ id: fin.anexo_id, task_id: ids.task_id, uploaded_by: ids.author_id }], 'Corte Edge: expected exactly one agent attachment.');
  assert(db.session?.status === 'finalized' && db.session.file_id === fin.file_id && db.session.task_id === ids.task_id &&
    db.session.storage_path === path && db.other_sessions === 0, 'Corte Edge: upload session state is wrong.');
  const downloaded = await service.download(path);
  assert(!downloaded.error && downloaded.data, 'Corte Edge: service readback failed.');
  assert(digest(Buffer.from(await downloaded.data.arrayBuffer())) === sha, 'Corte Edge: stored bytes differ from the synthetic MP4.');
  const listedFiles = success(await tool(token, 'aceleriq_projeto_arquivos', {}), 'project files');
  const mine = listedFiles?.arquivos?.find((f) => f.id === fin.file_id);
  assert(mine && mine.aprovado === false && !('storage_path' in mine), 'Corte Edge: Edge readback of the file metadata is wrong.');
  const unapproved = success(await tool(token, 'aceleriq_projeto_arquivo_ler', { file_id: fin.file_id }), 'read unapproved');
  assert(unapproved?.ok === false && unapproved.codigo === 'not_approved' && !('url_assinada' in unapproved),
    'Corte Edge: an unapproved file produced a read URL.');

  // Internal agency review only (Gate 1), idempotent, no notification.
  const review = success(await tool(token, 'aceleriq_projeto_video_pedir_aprovacao', session), 'request review');
  assert(review?.file_id === fin.file_id && review.revisao_agencia === 'pending' && review.reaproveitado === false, 'Corte Edge: unexpected review result.');
  const review2 = success(await tool(token, 'aceleriq_projeto_video_pedir_aprovacao', session), 'request review retry');
  assert(review2?.reaproveitado === true, 'Corte Edge: review retry was not idempotent.');
  const rv = sqlJson(REVIEWED, vars, 'review postconditions');
  assert.deepEqual(rv.file, { agency_approval_status: 'pending', approval_status: 'none', visibility: 'internal', unlocked: true },
    'Corte Edge: review went beyond the internal agency request.');
  assert.deepEqual(rv.events, [{ event_type: 'agency_review_requested', actor_id: ids.author_id, to_status: 'pending' }],
    'Corte Edge: expected one review event by the dedicated author.');
  assert.deepEqual(rv.human, { agency_approval_status: 'not_requested', approval_status: 'none', visibility: 'internal' },
    'Corte Edge: the human attachment entered the review.');
  assert(rv.human_events === 0 && rv.session_status === 'review_requested', 'Corte Edge: review touched another file or the session is wrong.');

  // Revocation takes effect on the very next call (no credential cache for grants).
  psql(`UPDATE public.mcp_project_grants SET revoked_at = now() WHERE api_key_id = :'key_id' AND revoked_at IS NULL;`,
    pick(ids, ['key_id']), 'revoke grant');
  rpcDenied(await tool(token, 'aceleriq_escritorio_entrar', {}), 401, 'enter after revocation');
  rpcDenied(await tool(token, 'aceleriq_projeto_video_finalizar', session), 401, 'finalize after revocation');
  rpcDenied(await tool(token, 'aceleriq_projeto_video_preparar', prepareArgs(ids.task_id, `${idem}-depois`)), 401, 'prepare after revocation');

  const revoked = sqlJson(`SELECT json_build_object(
    'uploads', (SELECT count(*) FROM public.mcp_project_video_uploads WHERE api_key_id = :'key_id'),
    'files', (SELECT count(*) FROM public.files WHERE client_id = :'client_id' AND uploaded_by = :'author_id')
  );`, pick(ids, ['key_id', 'client_id', 'author_id']), 'post-revocation state');
  assert(revoked.uploads === 1 && revoked.files === 1, 'Corte Edge: a write happened after revocation.');
}

function checkCounters(before, after) {
  assert(after.events - before.events === 1, 'Corte Edge: unexpected review history writes.');
  assert(after.notifications === before.notifications, 'Corte Edge: the flow created notifications.');
  assert(typeof before.net_sequence === 'string' && after.net_queue === before.net_queue && after.net_sequence === before.net_sequence,
    'Corte Edge: the flow queued outbound HTTP.');
}

function pick(object, keys) {
  return Object.fromEntries(keys.map((k) => [k, object[k]]));
}

async function selfTest(video) {
  const edgeOrigin = 'http://127.0.0.1:54400';
  localUrl(`${supabaseOrigin}/storage/v1/object/upload/sign/${bucket}/a/b.mp4?token=x`);
  localUrl(edgeOrigin + edgePath, edgeOrigin);
  for (const url of ['https://example.supabase.co/storage/v1/x', `${supabaseOrigin}/rest/v1/x`, `${supabaseOrigin}/functions/v1/mcp-server`,
    'http://localhost:54321/storage/v1/x', 'http://127.0.0.1:54322/storage/v1/x', 'http://u:p@127.0.0.1:54321/storage/v1/x',
    `${edgeOrigin}/other`, `${edgeOrigin}${edgePath}?x=1`, `http://127.0.0.1:54401${edgePath}`]) {
    assert.throws(() => localUrl(url, edgeOrigin));
  }
  for (const value of ["a'b", 'a;b', 'a b', '../x', '', 'A'.repeat(200), ':x']) assert.throws(() => psqlVar('key_id', value));
  psqlVar('path', `${randomUUID()}/mcp-project-video/${randomUUID()}.mp4`);

  const args = denoArgs(54400);
  assert(args.includes('--cached-only') && args.includes('--frozen') && args.includes('--allow-net=127.0.0.1:54321,127.0.0.1:54400'));
  assert(!args.some((a) => /^(-A|--allow-all|--allow-(run|write|ffi|sys|import)|--no-lock|--reload)/.test(a)), 'Deno flags widened.');
  assert(args.filter((a) => a.startsWith('--allow-net')).length === 1);

  const entrySource = await readFile(new URL(`../${entry}`, import.meta.url), 'utf8');
  for (const needle of ["hostname: '127.0.0.1'", 'CI_CORTE_EDGE_EGRESS_BLOCKED', "'http://127.0.0.1:54321'", "redirect: 'error'",
    "await import('../supabase/functions/mcp-server/index.ts')"]) {
    assert(entrySource.includes(needle), 'Edge entry lost a loopback guard.');
  }
  assert(DENIED_NET.test('CI_CORTE_EDGE_EGRESS_BLOCKED') && DENIED_NET.test('NotCapable: Requires net access') && !DENIED_NET.test('CI_CORTE_EDGE_READY'));

  const sql = await readFile(new URL(`../${fixturePath}`, import.meta.url), 'utf8');
  assert(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(sql), 'Edge fixture must not hardcode IDs.');
  const domains = [...sql.matchAll(/'(@[^']+)'/g)].map((match) => match[1]);
  assert(domains.length === 4 && domains.every((domain) => domain === '@test.local'), 'Edge fixture must use test.local addresses.');
  assert(sql.includes("to_regclass('aceleriq_ci_replay.background_job_attestation')"), 'Edge fixture must require CI attestation.');
  const used = new Set([...sql.matchAll(/:'([a-z_]+)'/g)].map((m) => m[1]));
  assert.deepEqual([...used].sort(), [...FIXTURE_VARS].sort(), 'Edge fixture variables drifted.');
  assert(sql.match(/^COMMIT;$/gm)?.length === 1 && sql.includes('\\gexec'), 'Edge fixture must restore triggers and commit once.');

  const workflow = await readFile(new URL('../.github/workflows/supabase-db-tests.yml', import.meta.url), 'utf8');
  const at = (needle) => { const i = workflow.indexOf(needle); assert(i >= 0, `Workflow step missing: ${needle}`); return i; };
  const edgeStep = at('- name: Verify Corte Edge end to end in the disposable stack');
  assert(at('- name: Type-check portable and public Edge Functions') < edgeStep &&
    at('- name: Restore synthetic seed hooks before stopping Supabase') < edgeStep &&
    edgeStep < at('- name: Verify Corte review concurrency in the disposable stack before stopping'),
    'Corte Edge step must follow the Deno cache and seed restore, and precede the Corte race.');
  assert(!/continue-on-error/.test(workflow.slice(edgeStep, at('- name: Verify Corte review concurrency'))), 'Corte Edge step must not be masked.');

  assert(video.length >= 1024 && video.toString('ascii', 4, 12) === 'ftypisom', 'Invalid synthetic MP4 fixture.');
  console.log('Corte Edge self-test passed: loopback URLs, strict Deno flags, synthetic fixture and step order.');
}

async function main() {
  const video = await readFile(videoUrl);
  if (process.argv[2] === '--self-test') return selfTest(video);
  assert(process.argv.length === 2, 'Usage: node scripts/test-ci-corte-edge.mjs [--self-test]');
  assert(process.platform === 'linux' && process.env.CI === 'true' && process.env.GITHUB_ACTIONS === 'true' &&
    process.env.RUNNER_ENVIRONMENT === 'github-hosted', 'Corte Edge requires a disposable GitHub-hosted runner.');
  if (spawnSync(process.execPath, ['scripts/guard-ci-e2e-network.mjs', '--guard'], { cwd: root, stdio: 'ignore' }).status !== 0) {
    fail('CI network attestation failed.');
  }
  let local;
  try {
    const status = spawnSync('supabase', ['status', '--output', 'json'], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
    local = validateLocalStatus(JSON.parse(status.stdout));
  } catch { fail('could not read the local Supabase status.'); }
  const lockBefore = digest(await readFile(new URL('../deno.lock', import.meta.url)));

  const ids = Object.fromEntries(FIXTURE_VARS.filter((k) => k.endsWith('_id')).map((k) => [k, randomUUID()]));
  ids.suffix = randomBytes(6).toString('hex');
  const token = `mcp_live_ci_${randomBytes(32).toString('hex')}`;
  ids.key_hash = digest(token);
  const sha = digest(video);

  const fixture = await readFile(new URL(`../${fixturePath}`, import.meta.url), 'utf8');
  const before = sqlJson(COUNTERS, {}, 'baseline counters');
  let committed = false;
  let edge = null;
  const failures = [];
  try {
    const seeded = psql(fixture, ids, 'synthetic fixture');
    committed = true; // psql exited 0: revoke in finally even if the marker is unexpected.
    if (seeded !== 'corte edge fixture committed') fail('synthetic fixture did not report its commit.');
    const port = await freePort();
    edge = startEdge(port, {
      PATH: process.env.PATH, HOME: process.env.HOME, NO_COLOR: '1', DENO_NO_UPDATE_CHECK: '1',
      // Same module cache the type-check step filled; nothing else from the runner env.
      ...(process.env.DENO_DIR ? { DENO_DIR: process.env.DENO_DIR } : {}),
      ...(process.env.XDG_CACHE_HOME ? { XDG_CACHE_HOME: process.env.XDG_CACHE_HOME } : {}),
      CI_CORTE_EDGE_PORT: String(port), SUPABASE_URL: supabaseOrigin,
      SUPABASE_SERVICE_ROLE_KEY: local.ACELERIQ_E2E_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY: local.ACELERIQ_E2E_ANON_KEY,
      APP_PUBLIC_URL: 'https://app.example.com', MCP_PROJECT_VIDEO_WRITE: 'true', MCP_PROJECT_VIDEO_PROJECT_ID: ids.project_id,
    });
    const client = edgeClient(`http://127.0.0.1:${port}`);
    await waitReady(edge, client.rpc);
    const service = createClient(supabaseOrigin, local.ACELERIQ_E2E_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: client.localFetch },
    }).storage.from(bucket);
    await exercise(client, ids, token, video, service, sha);
  } catch (error) {
    failures.push(safeMessage(error));
  } finally {
    if (edge) {
      await stopEdge(edge);
      if (edge.denied) failures.push('Corte Edge: the Edge attempted network access outside loopback Supabase.');
    }
    if (committed) {
      try { psql(CLEANUP, pick(ids, ['key_id', 'author_id']), 'revoke synthetic key, grant and author binding'); }
      catch (error) { failures.push(safeMessage(error)); }
    }
    if (digest(await readFile(new URL('../deno.lock', import.meta.url))) !== lockBefore) failures.push('Corte Edge: deno.lock changed.');
  }
  if (failures.length) throw new Error(failures.join('\n'));
  checkCounters(before, sqlJson(COUNTERS, {}, 'final counters'));
  console.log('Corte Edge passed: real loopback Edge entered as corte, prepared, PUT privately once, finalized with dedicated ' +
    'authorship, byte readback and one attachment, requested internal review only, denied outside the project and after revocation.');
}

main().catch((error) => {
  // Offline self-test messages carry no runtime values; live failures print only our fixed labels.
  console.error(process.argv[2] === '--self-test' ? String(error?.message) : safeMessage(error));
  process.exitCode = 1;
});
