// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  compareProjectLedger, legacyProjectRef, loadReviewedProjectBaseline, reviewedProjectRef,
} from '../../scripts/prepare-project-migration-ledger.mjs';
import { buildProjectMigrationView, planProjectMigrationView } from '../../scripts/prepare-project-migration-view.mjs';

type LedgerEntry = { version: string; name: string; statements_sha256: string };
const repoRoot = resolve(process.cwd());
const options = { projectRef: reviewedProjectRef, repoRoot };
const baseline = () => loadReviewedProjectBaseline(options);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const temporaryRoots: string[] = [];
const temporaryRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'reviewed-project-migration-test-'));
  temporaryRoots.push(root);
  return root;
};
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('reviewed-project-migration-test-')) {
      throw new Error('Unexpected temporary test directory');
    }
    rmSync(root, { recursive: true });
  }
});
const csv = (entries: LedgerEntry[]) => 'remote_version,remote_name,remote_statements_sha256\r\n'
  + entries.map((entry) => [entry.version, entry.name, entry.statements_sha256]
    .map((value) => `"${value.replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n';
const plan = (entries = baseline().document.entries) => planProjectMigrationView({ ...options, ledgerCsv: csv(entries) });

describe('reviewed project forward-only migration view', () => {
  it('preserves all 206 historical versions as aborting sentinels and includes only the two reviewed SQL files', () => {
    const view = plan();
    expect(view).toMatchObject({ status: 'pending', actual_count: 206, expected_count: 208, reviewed_count: 206, sentinel_count: 206 });
    expect(view.pending_versions).toEqual(['20260912213530', '20260912213638']);
    expect(view.files).toHaveLength(208);
    expect(new Set(view.files.map((file) => file.version)).size).toBe(208);
    for (const file of view.files.filter((file) => file.kind === 'sentinel')) {
      expect(file.bytes.toString('utf8')).toContain(`RAISE EXCEPTION 'Refusing to execute audited migration sentinel ${file.version}'`);
      expect(file.bytes.toString('utf8')).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:supabase_migrations\.)?schema_migrations/i);
    }
    for (const source of baseline().document.pending_migrations) {
      const file = view.files.find((candidate) => candidate.version === source.version)!;
      expect(file.kind).toBe('pending');
      expect(file.filename).toBe(basename(source.path));
      expect(file.bytes.equals(readFileSync(resolve(repoRoot, source.path)))).toBe(true);
    }
  });

  it('resumes after the first pending migration without replaying it', () => {
    const view = plan(baseline().expected.slice(0, -1));
    expect(view.sentinel_count).toBe(207);
    expect(view.pending_versions).toEqual(['20260912213638']);
    expect(view.files.at(-2)?.kind).toBe('sentinel');
    expect(view.files.at(-1)?.kind).toBe('pending');
  });

  it('emits only sentinels when all 208 exact rows are already applied', () => {
    const view = plan(baseline().expected);
    expect(view).toMatchObject({ status: 'ready', sentinel_count: 208, pending_versions: [] });
    expect(view.files.every((file) => file.kind === 'sentinel')).toBe(true);
  });

  it.each(['missing', 'name', 'hash', 'unexpected'] as const)('rejects %s historical drift before producing a package', (kind) => {
    const entries: LedgerEntry[] = clone(baseline().document.entries);
    if (kind === 'missing') entries.shift();
    if (kind === 'name') entries[0].name += '_changed';
    if (kind === 'hash') entries[0].statements_sha256 = 'a'.repeat(64);
    if (kind === 'unexpected') entries.push({ version: '20260912000000', name: 'unexpected', statements_sha256: 'a'.repeat(64) });
    expect(() => plan(entries)).toThrow(/ledger drift/);
  });

  it('refuses a gap before a newer applied migration instead of requiring include-all', () => {
    const { document, expected } = baseline();
    expect(() => plan([...document.entries, expected.at(-1)!])).toThrow(/out of order/);
  });

  it('rejects malformed CSV, duplicate versions and every unreviewed project, including the legacy target', () => {
    const entries = baseline().document.entries;
    expect(() => planProjectMigrationView({ ...options, ledgerCsv: 'version,name\n' })).toThrow(/header/);
    expect(() => plan([entries[0], ...entries])).toThrow(/duplicate/);
    for (const projectRef of [undefined, legacyProjectRef, 'unknown-project', '../outside']) {
      expect(() => planProjectMigrationView({ projectRef, ledgerCsv: csv(entries) })).toThrow(/own reviewed deployment view/);
    }
  });

  it('validates a backup source directory for postflight without reading normalized sentinel files as source', () => {
    const root = temporaryRoot();
    const sourceDir = join(root, 'repository-migrations');
    const isolatedRepo = join(root, 'checkout');
    mkdirSync(sourceDir);
    mkdirSync(join(isolatedRepo, 'supabase/deployment-baselines'), { recursive: true });
    cpSync(resolve(repoRoot, `supabase/deployment-baselines/${reviewedProjectRef}.json`), join(isolatedRepo, `supabase/deployment-baselines/${reviewedProjectRef}.json`));
    for (const source of baseline().document.pending_migrations) cpSync(resolve(repoRoot, source.path), join(sourceDir, basename(source.path)));
    const postflight = { projectRef: reviewedProjectRef, repoRoot: isolatedRepo, sourceDir };
    expect(compareProjectLedger(baseline().expected, postflight).status).toBe('ready');
    expect(planProjectMigrationView({ ...postflight, ledgerCsv: csv(baseline().expected) }).sentinel_count).toBe(208);
    const ledgerCsvPath = join(root, 'postflight.csv');
    writeFileSync(ledgerCsvPath, csv(baseline().expected));
    const commonArgs = ['--project-ref', reviewedProjectRef, '--repo-root', isolatedRepo, '--source-dir', sourceDir];
    const inspection = spawnSync(process.execPath, [resolve(repoRoot, 'scripts/prepare-project-migration-ledger.mjs'),
      ...commonArgs, '--check-ledger-csv', ledgerCsvPath], { encoding: 'utf8' });
    expect(inspection.stderr).toBe('');
    expect(inspection.status).toBe(0);
    expect(JSON.parse(inspection.stdout).status).toBe('ready');
    const outputDir = join(root, 'postflight-view');
    const build = spawnSync(process.execPath, [resolve(repoRoot, 'scripts/prepare-project-migration-view.mjs'),
      ...commonArgs, '--ledger-csv', ledgerCsvPath, '--output-dir', outputDir], { encoding: 'utf8' });
    expect(build.stderr).toBe('');
    expect(build.status).toBe(0);
    expect(JSON.parse(build.stdout)).toMatchObject({ status: 'ready', sentinel_count: 208, pending_versions: [] });
    expect(readdirSync(outputDir)).toHaveLength(208);
    const first = join(sourceDir, basename(baseline().document.pending_migrations[0].path));
    writeFileSync(first, '-- changed source\n');
    expect(() => planProjectMigrationView({ ...postflight, ledgerCsv: csv(baseline().expected) })).toThrow(/local hash drift/);
  }, 30000);

  it('refuses a new runner_exact_sql entry because CLI deployment would produce a different ledger hash', () => {
    const root = temporaryRoot();
    const { document } = baseline();
    const changed = clone(document);
    changed.pending_migrations[0].hash_mode = 'runner_exact_sql';
    changed.pending_migrations[0].statements_sha256 = changed.pending_migrations[0].local_sha256;
    mkdirSync(join(root, 'supabase/deployment-baselines'), { recursive: true });
    writeFileSync(join(root, `supabase/deployment-baselines/${reviewedProjectRef}.json`), JSON.stringify(changed));
    expect(() => planProjectMigrationView({
      projectRef: reviewedProjectRef, repoRoot: root, sourceDir: resolve(repoRoot, 'supabase/migrations'), ledgerCsv: csv(document.entries),
    })).toThrow(/not compatible with Supabase CLI/);
  });

  it('builds a real isolated package via CLI and leaves the source unchanged', () => {
    const root = temporaryRoot();
    const ledgerCsvPath = join(root, 'ledger.csv');
    const outputDir = join(root, 'view');
    const source = baseline().document.pending_migrations[0];
    const before = readFileSync(resolve(repoRoot, source.path));
    writeFileSync(ledgerCsvPath, csv(baseline().document.entries));
    const result = spawnSync(process.execPath, [resolve(repoRoot, 'scripts/prepare-project-migration-view.mjs'),
      '--project-ref', reviewedProjectRef, '--ledger-csv', ledgerCsvPath, '--output-dir', outputDir], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ pending_versions: ['20260912213530', '20260912213638'], sentinel_count: 206 });
    expect(readdirSync(outputDir)).toHaveLength(208);
    expect(readFileSync(join(outputDir, basename(source.path))).equals(before)).toBe(true);
    expect(readFileSync(resolve(repoRoot, source.path)).equals(before)).toBe(true);
    expect(() => buildProjectMigrationView({ ...options, ledgerCsvPath, outputDir })).toThrow(/already exists/);
    expect(() => buildProjectMigrationView({ ...options, ledgerCsvPath, outputDir: join(repoRoot, 'supabase/migrations/unsafe') })).toThrow(/outside the migration source/);
  }, 30000);

  it('fails the CLI without explicit project or required paths', () => {
    const script = resolve(repoRoot, 'scripts/prepare-project-migration-view.mjs');
    for (const args of [[], ['--project-ref'], ['--unknown', 'value']]) {
      const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
    }
  });
});
