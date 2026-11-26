import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const marker = '-- CI_CORTE_CONCURRENCY_SETUP_END';
const readSql = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const [setup, remaining, ...duplicates] = readSql('../supabase/tests/database/mcp_project_video_upload.test.sql').split(marker);
// pgTAP invokes the fixture with a local, restored actor. The race reuses only
// pg_proc.prosrc, so the function must stay pure SQL without SET clauses.
const invocation = [
  "CREATE TEMP TABLE ator_antes_do_filho AS SELECT current_setting('request.jwt.claim.sub', true) AS sub;",
  "SELECT set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000003', true);",
  'SELECT pg_temp.fixture_filho_entre_projetos();',
  "SELECT set_config('request.jwt.claim.sub', coalesce((SELECT sub FROM ator_antes_do_filho), ''), true);",
].join('\n');
assert(remaining?.startsWith('\n' + invocation + '\n') && duplicates.length === 0,
  'Expected one Corte fixture boundary immediately before the restored child insertion.');
assert(/\nCREATE FUNCTION pg_temp\.fixture_filho_entre_projetos\(\) RETURNS void\nLANGUAGE sql\nAS \$\$\n/.test(setup),
  'Corte fixture must stay a pure SQL function without SET clauses.');

if (process.argv[2] === '--self-test') {
  console.log('Corte concurrency: shared fixture boundary verified.');
} else {
  assert(process.platform === 'linux' && process.env.CI === 'true' && process.env.GITHUB_ACTIONS === 'true' &&
    process.env.RUNNER_ENVIRONMENT === 'github-hosted', 'Corte concurrency requires a disposable GitHub-hosted runner.');

  const test = readSql('../tests/database-isolated/tests/corte_review_concurrency.test.sql');
  const [preflight, race] = test.split('-- CI_CORTE_RUN_RACE');
  const result = spawnSync('psql', ['-X', '-q', '-t', '-A', '-w', '-v', 'ON_ERROR_STOP=1',
    '-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres'], {
    env: { PATH: process.env.PATH, PGHOSTADDR: '127.0.0.1', PGCONNECT_TIMEOUT: '5', PGPASSWORD: 'postgres' },
    input: [preflight, setup, race].join('\n'),
    encoding: 'utf8',
    timeout: 90_000,
  });
  // Only print fixed stage labels. Database diagnostics can include connection or fixture values.
  const stages = ['preflight passed', 'fixture committed', 'staff insert verified', 'blocking verified', 'postconditions passed'];
  const completed = (result.stdout ?? '').split(/\r?\n/).filter((line) => stages.includes(line));
  console.log('Corte concurrency stages: ' + (completed.join(', ') || 'none'));
  assert(result.status === 0 && completed.join() === stages.join(), 'Corte concurrency SQL did not complete.');
}
