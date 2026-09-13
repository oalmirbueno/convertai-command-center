// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adaptProjectAttestation } from '../../scripts/prepare-project-baseline-attestation.mjs';

const source = readFileSync('supabase/production-baseline-attestation.sql', 'utf8');
const project = 'jjjtkowvxemvituvywvf';

describe('project baseline attestation without weakening guards', () => {
  it('preserves the exact readiness gate and column allowlist', () => {
    const result = adaptProjectAttestation(source, project);
    expect(result.slice(result.lastIndexOf('SELECT CASE'))).toBe(source.slice(source.lastIndexOf('SELECT CASE')));
    const allowlist = (sql: string) => sql.slice(sql.indexOf('expected_file_column_privileges'), sql.indexOf('actual_file_column_privileges'));
    expect(allowlist(result)).toBe(allowlist(source));
    expect(result).toContain("AND NOT has_table_privilege('authenticated', 'public.files', 'SELECT')");
    expect(result).toContain("AND NOT has_table_privilege('authenticated', 'public.files', 'UPDATE')");
  });
  it('inspects effective column access independently of catalog reader identity', () => {
    const result = adaptProjectAttestation(source, project);
    expect(result).toContain("has_column_privilege('authenticated', attributes.attrelid,");
    expect(result).toContain('AND NOT attributes.attisdropped');
    expect(result).not.toContain('FROM information_schema.column_privileges');
    expect(result).toContain("CROSS JOIN (VALUES ('SELECT'::text), ('UPDATE'::text))");
  });
  it('changes only the reviewed service grant while keeping browser callers denied', () => {
    const row = (sql: string) => sql.split('\n').filter(line => line.trim().startsWith("('absorbed_task_sync', 'public.save_editorial_post_unlocked"));
    expect(row(adaptProjectAttestation(source, project))).toEqual(row(source).map(line => line.replace(/false\),$/, 'true),')));
    expect(row(adaptProjectAttestation(source, project))[0]).toContain('false, false, true');
  });
  it('refuses source drift even when the altered source still has matching anchors', () => {
    expect(() => adaptProjectAttestation(source.replace('readiness.files_ready', 'true'), project)).toThrow(/changed/);
  });
  it('refuses omitted, old or unknown project identities', () => {
    for (const ref of ['', 'gicbrgagstyvbaaumprj', '../project']) expect(() => adaptProjectAttestation(source, ref)).toThrow(/reviewed project/);
  });
  it('accepts CRLF checkout normalization without editing historical SQL', () => {
    expect(adaptProjectAttestation(source.replace(/\n/g, '\r\n'), project)).toBe(adaptProjectAttestation(source, project));
  });
});
