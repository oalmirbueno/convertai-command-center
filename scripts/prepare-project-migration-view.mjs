#!/usr/bin/env node
// Local packaging only: no database connection, ledger repair or SQL execution.
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSentinelSql, parseRemoteLedgerCsv } from './prepare-production-migration-view.mjs';
import {
  compareProjectLedger, defaultRepoRoot, loadReviewedProjectBaseline, reviewedProjectRef,
} from './prepare-project-migration-ledger.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const fail = (message) => { throw new Error(`project migration view: ${message}`); };

export function planProjectMigrationView({
  projectRef, ledgerCsv, repoRoot = defaultRepoRoot, sourceDir = resolve(repoRoot, 'supabase/migrations'),
} = {}) {
  if (projectRef !== reviewedProjectRef) fail('project requires its own reviewed deployment view; no legacy fallback');
  const options = { projectRef, repoRoot, sourceDir };
  const actual = parseRemoteLedgerCsv(ledgerCsv).map((entry) => ({
    version: entry.remoteVersion, name: entry.remoteName, statements_sha256: entry.remoteStatementsSha256,
  }));
  const comparison = compareProjectLedger(actual, options);
  if (comparison.status === 'drift') fail(`ledger drift: ${JSON.stringify(comparison)}`);
  const { document, expected } = loadReviewedProjectBaseline(options);
  // db push is strictly forward-only. A hole before an applied newer version
  // must be investigated, never filled with --include-all or migration repair.
  if (comparison.pending_versions.some((version) => version < actual.at(-1).version)) {
    fail('pending migrations are out of order before an already applied version');
  }
  const pending = new Set(comparison.pending_versions);
  const sources = new Map(document.pending_migrations.map((entry) => [entry.version, entry]));
  const files = expected.map((entry) => {
    if (!pending.has(entry.version)) {
      return { version: entry.version, kind: 'sentinel', filename: `${entry.version}_production_ledger_sentinel.sql`, bytes: createSentinelSql(entry.version) };
    }
    const source = sources.get(entry.version);
    if (source.hash_mode !== 'supabase_cli_split') fail(`pending migration ${entry.version} is not compatible with Supabase CLI statement hashing`);
    const bytes = readFileSync(resolve(sourceDir, basename(source.path)));
    if (createHash('sha256').update(bytes).digest('hex') !== source.local_sha256) {
      fail(`pending migration changed while preparing ${entry.version}`);
    }
    return { version: entry.version, kind: 'pending', filename: basename(source.path), bytes };
  });
  return { ...comparison, reviewed_count: document.entries.length, sentinel_count: files.length - pending.size, files };
}

export function buildProjectMigrationView({ ledgerCsvPath, outputDir, ...options } = {}) {
  if (!ledgerCsvPath || !outputDir) fail('--ledger-csv and --output-dir are required');
  const target = resolve(outputDir);
  const source = resolve(options.sourceDir ?? resolve(options.repoRoot ?? defaultRepoRoot, 'supabase/migrations'));
  const nested = relative(source, target);
  if (!nested || (nested !== '..' && !nested.startsWith(`..${sep}`) && !isAbsolute(nested))) {
    fail('output directory must be outside the migration source directory');
  }
  if (lstatSync(target, { throwIfNoEntry: false })) fail('output directory already exists; refusing to overwrite');
  const { files, ...summary } = planProjectMigrationView({ ...options, ledgerCsv: readFileSync(resolve(ledgerCsvPath), 'utf8') });
  mkdirSync(dirname(target), { recursive: true });
  const staging = mkdtempSync(resolve(dirname(target), `.${basename(target)}-pending-`));
  // Leave staging intact if a filesystem operation fails; never replace source
  // or existing output, and never expose a partial package at the target path.
  for (const file of files) writeFileSync(resolve(staging, file.filename), file.bytes, { flag: 'wx' });
  if (lstatSync(target, { throwIfNoEntry: false })) fail('output directory appeared while preparing the view');
  renameSync(staging, target);
  return { ...summary, output_dir: target };
}

export function main(argv = process.argv.slice(2)) {
  const options = {};
  const names = { '--project-ref': 'projectRef', '--repo-root': 'repoRoot', '--source-dir': 'sourceDir', '--ledger-csv': 'ledgerCsvPath', '--output-dir': 'outputDir' };
  for (let index = 0; index < argv.length; index += 1) {
    const key = names[argv[index]];
    if (!key || key in options) fail(`unknown or duplicate argument: ${argv[index]}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) fail(`${argv[index - 1]} requires a value`);
    options[key] = value;
  }
  process.stdout.write(`${JSON.stringify(buildProjectMigrationView(options), null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
