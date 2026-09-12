// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { listProductionLedgerEntries } from '../../scripts/prepare-production-migration-view.mjs';
import {
  compareProjectLedger,
  formatProjectLedgerSqlValues,
  legacyProjectRef,
  listProjectLedgerEntries,
  loadReviewedProjectBaseline,
  parseReviewedProjectBaseline,
  reviewedProjectRef,
} from '../../scripts/prepare-project-migration-ledger.mjs';

const options = { projectRef: reviewedProjectRef };
const snapshot = () => loadReviewedProjectBaseline(options).document;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe('project-specific read-only deployment ledger', () => {
  it('keeps the 206 reviewed rows and explicitly requires both reviewed migrations', () => {
    const expected = listProjectLedgerEntries(options);
    expect(snapshot().entries).toHaveLength(206);
    expect(expected).toHaveLength(208);
    expect(expected.slice(0, 206)).toEqual(snapshot().entries);
    expect(expected.slice(-2).map((entry) => entry.version)).toEqual(['20260912213530', '20260912213638']);
    expect(new Set(expected.map((entry) => entry.version)).size).toBe(208);
  });

  it('reports the current snapshot as pending two, never ready', () => {
    expect(compareProjectLedger(snapshot().entries, options)).toMatchObject({
      status: 'pending', expected_count: 208, actual_count: 206,
      pending_versions: ['20260912213530', '20260912213638'],
      missing_reviewed_versions: [], unexpected_versions: [], changed_versions: [],
    });
  });

  it('requires the exact complete ledger for readiness, including pending hashes', () => {
    const expected = listProjectLedgerEntries(options);
    expect(compareProjectLedger(expected, options).status).toBe('ready');
    expect(compareProjectLedger(expected.slice(0, -1), options)).toMatchObject({
      status: 'pending', pending_versions: ['20260912213638'],
    });
    const tampered = clone(expected);
    tampered.at(-1)!.statements_sha256 = 'f'.repeat(64);
    expect(compareProjectLedger(tampered, options)).toMatchObject({ status: 'drift', changed_versions: ['20260912213638'] });
  });

  it('rejects missing, extra, renamed and hash-drifted historical rows', () => {
    const entries = snapshot().entries;
    expect(compareProjectLedger(entries.slice(1), options).status).toBe('drift');
    expect(compareProjectLedger([...entries, { version: '20260912000000', name: 'unreviewed', statements_sha256: 'a'.repeat(64) }], options).status).toBe('drift');
    for (const field of ['name', 'statements_sha256']) {
      const altered = clone(entries);
      altered[0][field] = field === 'name' ? 'renamed' : 'b'.repeat(64);
      expect(compareProjectLedger(altered, options)).toMatchObject({ status: 'drift', changed_versions: [entries[0].version] });
    }
  });

  it('does not mistake empty statement hashes for proof of historical SQL contents', () => {
    const document = snapshot();
    expect(document.origin).toBe('read_only_catalog');
    expect(document.scope).toBe('ledger_stability_only');
    expect(document.entries.filter((entry) => entry.statements_sha256 === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toHaveLength(201);
    expect(JSON.stringify(document)).not.toContain('CREATE OR REPLACE');
  });

  it('fails closed for unknown, omitted and traversal project refs', () => {
    for (const projectRef of [undefined, '', 'unknown-project', '../jjjtkowvxemvituvywvf']) {
      expect(() => listProjectLedgerEntries({ projectRef })).toThrow(/unknown project ref/);
    }
  });

  it('uses the existing legacy generator only for its explicit project ref', () => {
    expect(listProjectLedgerEntries({ projectRef: legacyProjectRef })).toEqual(
      listProductionLedgerEntries().map((entry) => ({ version: entry.version, name: entry.name, statements_sha256: entry.statementsSha256 })),
    );
  });

  it('pins pending source hashes and refuses mismatched review identity or arbitrary keys', () => {
    const document = snapshot();
    const changed = clone(document);
    changed.pending_migrations[0].local_sha256 = 'a'.repeat(64);
    expect(() => parseReviewedProjectBaseline(JSON.stringify(changed), options)).toThrow(/local hash drift/);
    const statementDrift = clone(document);
    statementDrift.pending_migrations[0].statements_sha256 = 'b'.repeat(64);
    expect(() => parseReviewedProjectBaseline(JSON.stringify(statementDrift), options)).toThrow(/statement hash drift/);
    expect(() => parseReviewedProjectBaseline(JSON.stringify({ ...document, project_ref: legacyProjectRef }), options)).toThrow(/identity/);
    expect(() => parseReviewedProjectBaseline(JSON.stringify({ ...document, statements: 'unexpected SQL' }), options)).toThrow(/invalid contract/);
  });

  it('rejects duplicate or unsorted snapshot versions and pending path traversal', () => {
    const duplicate = clone(snapshot());
    duplicate.entries[1] = duplicate.entries[0];
    expect(() => parseReviewedProjectBaseline(JSON.stringify(duplicate), options)).toThrow(/unique and increasing/);
    const traversal = clone(snapshot());
    traversal.pending_migrations[0].path = '../outside.sql';
    expect(() => parseReviewedProjectBaseline(JSON.stringify(traversal), options)).toThrow(/canonical paths/);
  });

  it('emits the same exact triples accepted by the SQL full-join preflight', () => {
    const sql = formatProjectLedgerSqlValues(options);
    expect(sql.split('\n')).toHaveLength(208);
    expect(sql).toContain("('20260912213638','secure_publication_cancellation_dispatch','729d13f5f279099152e7647925d6efded95470a1ad5e788c3a0a86243baa5190')");
    expect(sql).not.toMatch(/\b(?:DELETE|UPDATE|INSERT|ALTER|TRUNCATE|CREATE)\b/);
  });

  it('CLI requires explicit identity and output mode without writing files', () => {
    const script = resolve('scripts/prepare-project-migration-ledger.mjs');
    const file = resolve(`supabase/deployment-baselines/${reviewedProjectRef}.json`);
    const before = readFileSync(file, 'utf8');
    const good = spawnSync(process.execPath, [script, '--project-ref', reviewedProjectRef, '--ledger-sql-values'], { encoding: 'utf8' });
    expect(good.status).toBe(0);
    expect(good.stdout.trim().split('\n')).toHaveLength(208);
    expect(readFileSync(file, 'utf8')).toBe(before);
    const bad = spawnSync(process.execPath, [script, '--ledger-sql-values'], { encoding: 'utf8' });
    expect(bad.status).toBe(1);
    expect(bad.stdout).toBe('');
  });
});
