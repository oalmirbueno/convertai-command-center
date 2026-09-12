import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'http://127.0.0.1:54321';

export function validateLocalStatus(status) {
  assert.equal(status.API_URL, origin, 'E2E refuses a nonlocal Supabase API.');
  for (const [name, role] of [['ANON_KEY', 'anon'], ['SERVICE_ROLE_KEY', 'service_role']]) {
    assert.equal(typeof status[name], 'string', 'Local CI JWT is missing.');
    const parts = status[name].split('.');
    assert.equal(parts.length, 3, 'Local CI JWT is malformed.');
    let claims;
    try { claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); }
    catch { throw new Error('Local CI JWT claims are malformed.'); }
    // GoTrue verifies the signature; this guard rejects production/privileged
    // endpoint confusion before any browser or seed process is started.
    assert(claims.iss === 'supabase-demo' && claims.role === role && !claims.ref,
      'E2E refuses a JWT that is not for the disposable local stack.');
  }
  return { ACELERIQ_E2E_SUPABASE_URL: origin,
    ACELERIQ_E2E_ANON_KEY: status.ANON_KEY,
    ACELERIQ_E2E_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY };
}

function run(command, args, env = process.env, capture = false) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) {
    // Supabase status contains ephemeral keys. Never echo stdout/stderr or
    // environment values in the exception, including unsuccessful invocations.
    throw new Error(`CI E2E command failed: ${command} ${args[0]} (exit ${result.status ?? 'unavailable'}).`);
  }
  return result.stdout;
}

async function main() {
  if (process.argv[2] === '--self-test') {
    const jwt = role => 'header.' + Buffer.from(JSON.stringify({iss:'supabase-demo',role})).toString('base64url') + '.synthetic';
    const valid = { API_URL: origin, ANON_KEY: jwt('anon'), SERVICE_ROLE_KEY: jwt('service_role') };
    assert.equal(validateLocalStatus(valid).ACELERIQ_E2E_SUPABASE_URL, origin);
    for (const patch of [{API_URL:'https://example.supabase.co'}, {API_URL:origin+'/'},
      {ANON_KEY:jwt('service_role')}, {SERVICE_ROLE_KEY:jwt('anon')}, {ANON_KEY:'not-a-key'},
      {ANON_KEY:'h.'+Buffer.from(JSON.stringify({iss:'supabase-demo',role:'anon',ref:'remote'})).toString('base64url')+'.s'}]) {
      assert.throws(() => validateLocalStatus({...valid,...patch}));
    }
    console.log('CI E2E wrapper self-test passed: exact local origin and role-specific local JWT guards.');
    return;
  }
  assert(process.platform === 'linux' && process.env.CI === 'true' && process.env.GITHUB_ACTIONS === 'true',
    'Real browser E2E requires the disposable Linux GitHub runner.');
  run(process.execPath, ['scripts/guard-ci-e2e-network.mjs', '--guard']);
  let status;
  try { status = JSON.parse(run('supabase', ['status', '--output', 'json'], process.env, true)); }
  catch { throw new Error('Could not read ephemeral Supabase status; no credentials were logged.'); }
  const localEnv = {...process.env, ...validateLocalStatus(status)};
  const browserEnv = {...localEnv};
  delete browserEnv.ACELERIQ_E2E_SERVICE_ROLE_KEY;
  let seeded = false;
  try {
    run(process.execPath, ['scripts/seed-ci-e2e.mjs', '--seed'], localEnv);
    seeded = true;
    run(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.config.ts'], browserEnv);
  } finally {
    // Keep the container firewall installed until the workflow stops Supabase.
    // Both checks run even when the browser fails; their failures also fail CI.
    const failures = [];
    try { run(process.execPath, ['scripts/seed-ci-e2e.mjs', '--restore'], localEnv); }
    catch (error) { failures.push(error.message); }
    if (seeded) {
      try { run(process.execPath, ['scripts/seed-ci-e2e.mjs', '--verify'], localEnv); }
      catch (error) { failures.push(error.message); }
    }
    if (failures.length) throw new Error(failures.join('\n'));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
