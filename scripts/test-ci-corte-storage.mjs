import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { validateLocalStatus } from './run-ci-e2e.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'http://127.0.0.1:54321';
const fixtureUrl = new URL('../e2e/.auth/ci-fixture.json', import.meta.url);
const videoUrl = new URL('../supabase/tests/corte-storage-synthetic.mp4', import.meta.url);
const bucket = 'mcp-files';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

function localUrl(input) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  assert(url.origin === origin && !url.username && !url.password, 'Storage smoke requires literal loopback.');
  assert(/^\/(auth|storage)\/v1\//.test(url.pathname), 'Storage smoke requires local Auth or Storage.');
  return url;
}

function localFetch(input, init) {
  localUrl(input);
  return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) });
}

function command(executable, args, label, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: root, encoding: 'utf8', stdio: 'pipe', ...options,
  });
  // stdout/stderr can contain local test secrets. Only fixed labels leave this function.
  if (result.error || result.status !== 0) throw new Error(`Storage smoke: ${label} failed.`);
  return result.stdout.trim();
}

function client(key) {
  return createClient(origin, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: localFetch },
  });
}

async function syntheticFixture(localEnv) {
  let raw;
  try {
    raw = await readFile(fixtureUrl, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Chromium is independent. Seed the same isolated actors if the browser
    // suite was skipped before its seed, preserving its existing guardrails.
    command(process.execPath, ['scripts/seed-ci-e2e.mjs', '--seed'], 'synthetic Auth seed', {
      env: { ...process.env, ...localEnv },
    });
    raw = await readFile(fixtureUrl, 'utf8');
  }
  let fixture;
  try { fixture = JSON.parse(raw); } catch { throw new Error('Storage smoke: malformed synthetic fixture.'); }
  assert(fixture.supabaseUrl === origin && fixture.version === 1, 'Storage smoke: invalid fixture origin or version.');
  for (const [name, role] of [['assignedStaff', 'design'], ['clientA', 'client']]) {
    const user = fixture.users[name];
    assert(user.role === role && uuid.test(user.id) && user.password.length >= 24 &&
      /^ci-e2e\.[a-z]+\+[0-9a-f]{12}@example\.test$/.test(user.email), 'Storage smoke: invalid synthetic actor.');
  }
  return fixture.users;
}

async function signIn(key, user) {
  const session = client(key);
  const result = await session.auth.signInWithPassword({ email: user.email, password: user.password });
  assert(!result.error && result.data.user?.id === user.id, 'Storage smoke: synthetic Auth login failed.');
  return session.storage.from(bucket);
}

function objectVersion(path) {
  assert(/^[-a-z0-9/.]+$/.test(path), 'Storage smoke: unexpected object path.');
  return command('psql', ['-X', '-qAtw', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1',
    '-p', '54322', '-U', 'postgres', '-d', 'postgres'], 'read Storage object version', {
    input: `SET statement_timeout='10s';
SELECT coalesce(version::text, '') FROM storage.objects WHERE bucket_id = '${bucket}' AND name = '${path}';`,
    env: { PATH: process.env.PATH, PGHOSTADDR: '127.0.0.1', PGCONNECT_TIMEOUT: '5', PGPASSWORD: 'postgres' },
  });
}

function digest(data) {
  return createHash('sha256').update(data).digest('hex');
}

async function testStorage(localEnv, users, video) {
  const staff = await signIn(localEnv.ACELERIQ_E2E_ANON_KEY, users.assignedStaff);
  const clientStorage = await signIn(localEnv.ACELERIQ_E2E_ANON_KEY, users.clientA);
  const service = client(localEnv.ACELERIQ_E2E_SERVICE_ROLE_KEY).storage.from(bucket);
  const legacyPath = `${users.clientA.id}/ci-storage/${randomUUID()}.mp4`;
  const reservedPath = `${users.clientA.id}/mcp-project-video/${randomUUID()}.mp4`;
  const options = { contentType: 'video/mp4', upsert: false };

  assert(!(await staff.upload(legacyPath, video, options)).error, 'Assigned staff lost its legacy upload path.');
  assert(!(await staff.download(legacyPath)).error, 'Assigned staff lost its legacy read path.');
  assert((await staff.upload(reservedPath, video, options)).error, 'Assigned staff wrote to the reserved path.');
  assert((await staff.createSignedUploadUrl(reservedPath)).error, 'Assigned staff signed a reserved upload.');
  assert(!objectVersion(reservedPath), 'Rejected uploads left a reserved Storage object.');

  const signed = await service.createSignedUploadUrl(reservedPath);
  assert(!signed.error && signed.data?.signedUrl, 'Service could not sign the reserved upload.');
  const signedUrl = localUrl(signed.data.signedUrl);
  assert(signedUrl.pathname === `/storage/v1/object/upload/sign/${bucket}/${reservedPath}` &&
    signedUrl.searchParams.has('token'), 'Signed upload was issued for a different object.');
  const first = await localFetch(signedUrl, {
    method: 'PUT', headers: { 'content-type': 'video/mp4' }, body: video,
  });
  assert(first.ok, `Synthetic MP4 upload failed (HTTP ${first.status}).`);
  await first.body?.cancel();
  const version = objectVersion(reservedPath);
  assert(uuid.test(version), 'Storage did not assign a single version to the uploaded object.');

  const altered = Buffer.from(video);
  altered[altered.length - 1] ^= 1;
  const repeat = await localFetch(signedUrl, {
    method: 'PUT', headers: { 'content-type': 'video/mp4', 'x-upsert': 'true' }, body: altered,
  });
  assert(repeat.status >= 400 && repeat.status < 500, 'Signed PUT without upsert failed to reject replacement.');
  await repeat.body?.cancel();
  assert((await staff.upload(reservedPath, altered, { ...options, upsert: true })).error,
    'Assigned staff replaced reserved bytes.');
  // Supabase can return an empty result for an RLS-blocked delete. Read back
  // the exact version and contents to verify the object survived either way.
  await staff.remove([reservedPath]);
  assert(objectVersion(reservedPath) === version, 'The protected Storage version changed.');
  const downloaded = await service.download(reservedPath);
  assert(!downloaded.error && downloaded.data, 'The protected Storage object disappeared.');
  assert(digest(Buffer.from(await downloaded.data.arrayBuffer())) === digest(video), 'The protected MP4 bytes changed.');
  assert((await staff.download(reservedPath)).error, 'Assigned staff received an unregistered reserved object.');
  assert((await staff.createSignedUrl(reservedPath, 60)).error, 'Assigned staff signed an unregistered reserved object.');
  assert((await clientStorage.download(reservedPath)).error, 'The client received an unpublished reserved object.');
  assert((await clientStorage.createSignedUrl(reservedPath, 60)).error, 'The client signed an unpublished reserved object.');
}

async function main() {
  const video = await readFile(videoUrl);
  assert(video.length >= 1024 && video.toString('ascii', 4, 8) === 'ftyp', 'Invalid synthetic MP4 fixture.');
  if (process.argv[2] === '--self-test') {
    localUrl(origin + '/storage/v1/object/test');
    for (const url of ['https://example.supabase.co/storage/v1/test', origin + '/rest/v1/test',
      'http://localhost:54321/storage/v1/test', 'http://127.0.0.1:54322/storage/v1/test']) {
      assert.throws(() => localUrl(url));
    }
    console.log('Storage smoke self-test passed: MP4 fixture and loopback-only HTTP.');
    return;
  }
  assert(process.platform === 'linux' && process.env.CI === 'true' && process.env.GITHUB_ACTIONS === 'true',
    'Storage smoke requires the disposable Linux GitHub runner.');
  command(process.execPath, ['scripts/guard-ci-e2e-network.mjs', '--guard'], 'CI network attestation');
  let status;
  try {
    status = JSON.parse(command('supabase', ['status', '--output', 'json'], 'local Supabase status'));
  } catch { throw new Error('Storage smoke: could not read local Supabase status.'); }
  const localEnv = validateLocalStatus(status);
  const users = await syntheticFixture(localEnv);
  await testStorage(localEnv, users, video);
  console.log('Storage smoke passed: scoped real MP4 PUT, immutable version and bytes, unpublished client denial, legacy upload preserved.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
