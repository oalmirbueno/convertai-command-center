import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const marker = '-- CI_CORTE_CONCURRENCY_SETUP_END';
const readSql = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const [setup, remaining, ...duplicates] = readSql('../supabase/tests/database/mcp_project_video_upload.test.sql').split(marker);
assert(remaining?.startsWith('\nSELECT pg_temp.fixture_filho_entre_projetos();') && duplicates.length === 0,
  'Expected one Corte fixture boundary immediately before the child insertion.');

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
