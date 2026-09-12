#!/usr/bin/env node
// Read-only expected-ledger generation. This script never connects to a database,
// repairs history, builds executable migration views, or applies SQL.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  listProductionLedgerEntries,
  parseRemoteLedgerCsv,
  supabaseStatementsSha256,
} from './prepare-production-migration-view.mjs';

const scriptPath = fileURLToPath(import.meta.url);
export const defaultRepoRoot = resolve(dirname(scriptPath), '..');
export const legacyProjectRef = 'gicbrgagstyvbaaumprj';
export const reviewedProjectRef = 'jjjtkowvxemvituvywvf';
const baselinePath = `supabase/deployment-baselines/${reviewedProjectRef}.json`;
const versionPattern = /^[0-9]{14}$/;
const hashPattern = /^[0-9a-f]{64}$/;
const pathPattern = /^supabase\/migrations\/([0-9]{14})_([A-Za-z0-9._-]+)\.sql$/;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fail = (message) => { throw new Error(`project migration ledger: ${message}`); };

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail(`${label} has an invalid contract`);
  }
}

function validateRows(rows, label) {
  if (!Array.isArray(rows) || rows.length === 0) fail(`${label} must contain entries`);
  let previous = '';
  for (const entry of rows) {
    exactKeys(entry, ['version', 'name', 'statements_sha256'], `${label} entry`);
    if (typeof entry.version !== 'string' || !versionPattern.test(entry.version)
      || entry.version <= previous) fail(`${label} versions must be unique and increasing`);
    if (typeof entry.name !== 'string' || /[\u0000-\u001f\u007f]/.test(entry.name)) fail(`${label} has an invalid name`);
    if (typeof entry.statements_sha256 !== 'string' || !hashPattern.test(entry.statements_sha256)) fail(`${label} has an invalid hash`);
    previous = entry.version;
  }
}

export function parseReviewedProjectBaseline(input, { projectRef, repoRoot = defaultRepoRoot } = {}) {
  if (projectRef !== reviewedProjectRef) fail('project does not have a reviewed catalog snapshot');
  const document = JSON.parse(input);
  exactKeys(document, ['schema_version', 'project_ref', 'reviewed_at', 'origin', 'scope', 'ledger_hash_mode', 'entries', 'pending_migrations'], 'baseline');
  if (document.schema_version !== 1 || document.project_ref !== projectRef
    || document.origin !== 'read_only_catalog' || document.scope !== 'ledger_stability_only'
    || document.ledger_hash_mode !== 'sha256_joined_statements_chr30'
    || typeof document.reviewed_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(document.reviewed_at)
    || !Number.isFinite(Date.parse(document.reviewed_at))) fail('baseline identity or review metadata is invalid');
  validateRows(document.entries, 'reviewed catalog');
  if (!Array.isArray(document.pending_migrations)) fail('pending_migrations must be an array');
  let previous = document.entries.at(-1).version;
  const pending = document.pending_migrations.map((entry) => {
    exactKeys(entry, ['version', 'name', 'path', 'local_sha256', 'statements_sha256', 'hash_mode'], 'pending migration');
    const match = typeof entry.path === 'string' && pathPattern.exec(entry.path);
    if (!match || match[1] !== entry.version || match[2] !== entry.name || entry.version <= previous) {
      fail('pending migrations must have matching canonical paths and increasing versions after the snapshot');
    }
    previous = entry.version;
    if (!hashPattern.test(entry.local_sha256) || !hashPattern.test(entry.statements_sha256)
      || !['supabase_cli_split', 'runner_exact_sql'].includes(entry.hash_mode)) fail('pending migration hash contract is invalid');
    const source = readFileSync(resolve(repoRoot, entry.path));
    if (hash(source) !== entry.local_sha256) fail(`pending migration local hash drift at ${entry.version}`);
    const statementsHash = entry.hash_mode === 'runner_exact_sql' ? hash(source) : supabaseStatementsSha256(source.toString('utf8'));
    if (statementsHash !== entry.statements_sha256) fail(`pending migration statement hash drift at ${entry.version}`);
    return { version: entry.version, name: entry.name, statements_sha256: entry.statements_sha256 };
  });
  return { document, expected: [...document.entries, ...pending] };
}

export function loadReviewedProjectBaseline(options = {}) {
  return parseReviewedProjectBaseline(readFileSync(resolve(options.repoRoot ?? defaultRepoRoot, baselinePath), 'utf8'), options);
}

export function listProjectLedgerEntries({ projectRef, repoRoot = defaultRepoRoot } = {}) {
  if (projectRef === legacyProjectRef) {
    // Explicit legacy rollback target: preserve its existing reviewed contract.
    // No network calls or fallback selection occur here.
    return listProductionLedgerEntries({ repoRoot }).map((entry) => ({
      version: entry.version, name: entry.name, statements_sha256: entry.statementsSha256,
    }));
  }
  if (projectRef !== reviewedProjectRef) fail('unknown project ref; an explicit reviewed baseline is required');
  return loadReviewedProjectBaseline({ projectRef, repoRoot }).expected;
}

export function formatProjectLedgerSqlValues(options) {
  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  return listProjectLedgerEntries(options)
    .map((entry) => `(${quote(entry.version)},${quote(entry.name)},${quote(entry.statements_sha256)})`)
    .join(',\n');
}

// An inspection result never relaxes the SQL preflight: readiness requires every
// reviewed row plus every explicit pending migration, with exactly matching hashes.
export function compareProjectLedger(actual, options) {
  validateRows(actual, 'actual ledger');
  const expected = listProjectLedgerEntries(options);
  const oldVersions = options.projectRef === reviewedProjectRef
    ? new Set(loadReviewedProjectBaseline(options).document.entries.map((entry) => entry.version))
    : new Set(expected.map((entry) => entry.version));
  const actualByVersion = new Map(actual.map((entry) => [entry.version, entry]));
  const expectedByVersion = new Map(expected.map((entry) => [entry.version, entry]));
  const missing = expected.filter((entry) => !actualByVersion.has(entry.version)).map((entry) => entry.version);
  const unexpected = actual.filter((entry) => !expectedByVersion.has(entry.version)).map((entry) => entry.version);
  const changed = actual.filter((entry) => {
    const wanted = expectedByVersion.get(entry.version);
    return wanted && (entry.name !== wanted.name || entry.statements_sha256 !== wanted.statements_sha256);
  }).map((entry) => entry.version);
  const pending = missing.filter((version) => !oldVersions.has(version));
  const missingReviewed = missing.filter((version) => oldVersions.has(version));
  const status = unexpected.length || changed.length || missingReviewed.length ? 'drift' : pending.length ? 'pending' : 'ready';
  return { project_ref: options.projectRef, status, expected_count: expected.length, actual_count: actual.length,
    pending_versions: pending, missing_reviewed_versions: missingReviewed, unexpected_versions: unexpected, changed_versions: changed };
}

export function main(argv = process.argv.slice(2)) {
  const options = { projectRef: undefined, repoRoot: defaultRepoRoot };
  let mode;
  let ledgerCsv;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--project-ref' || argument === '--repo-root') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) fail(`${argument} requires a value`);
      if (argument === '--project-ref') options.projectRef = value;
      else options.repoRoot = resolve(value);
    } else if (['--ledger-sql-values', '--list-versions', '--check-ledger-csv'].includes(argument)) {
      if (mode) fail('choose exactly one output mode');
      mode = argument;
      if (argument === '--check-ledger-csv') {
        ledgerCsv = argv[++index];
        if (!ledgerCsv || ledgerCsv.startsWith('--')) fail('--check-ledger-csv requires a file');
      }
    } else fail(`unknown argument: ${argument}`);
  }
  if (!options.projectRef || !mode) fail('--project-ref and one output mode are required');
  if (mode === '--ledger-sql-values') process.stdout.write(`${formatProjectLedgerSqlValues(options)}\n`);
  else if (mode === '--list-versions') process.stdout.write(`${listProjectLedgerEntries(options).map((entry) => entry.version).join('\n')}\n`);
  else {
    const actual = parseRemoteLedgerCsv(readFileSync(resolve(ledgerCsv), 'utf8')).map((entry) => ({
      version: entry.remoteVersion, name: entry.remoteName, statements_sha256: entry.remoteStatementsSha256,
    }));
    const result = compareProjectLedger(actual, options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== 'ready') process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
