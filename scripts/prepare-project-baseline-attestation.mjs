import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reviewedSourceHash = 'f90f1b730c52b49eca44dac657c495d2722bf8c960e48f85fea4fe1850277c3e';
const oldColumns = `actual_file_column_privileges AS (
  SELECT DISTINCT privilege_type, column_name
  FROM information_schema.column_privileges
  WHERE table_schema = 'public'
    AND table_name = 'files'
    AND grantee = 'authenticated'
    AND privilege_type IN ('SELECT', 'UPDATE')
)`;
const effectiveColumns = `actual_file_column_privileges AS (
  SELECT privileges.privilege_type, attributes.attname::text AS column_name
  FROM pg_attribute AS attributes
  CROSS JOIN (VALUES ('SELECT'::text), ('UPDATE'::text)) AS privileges(privilege_type)
  WHERE attributes.attrelid = to_regclass('public.files')
    AND attributes.attnum > 0
    AND NOT attributes.attisdropped
    AND has_column_privilege('authenticated', attributes.attrelid,
      attributes.attnum, privileges.privilege_type)
)`;
const oldFunction = "('absorbed_task_sync', 'public.save_editorial_post_unlocked(jsonb,integer)', true, 'search_path=\"\"', false, false, false)";
const reviewedFunction = oldFunction.replace(/false\)$/, 'true)');

/** Read-only project adaptation; retain every readiness condition and allowlist. */
export function adaptProjectAttestation(sql, projectRef) {
  if (projectRef !== 'jjjtkowvxemvituvywvf') throw new Error('An explicit reviewed project is required');
  const normalized = sql.replaceAll('\r\n', '\n');
  if (createHash('sha256').update(normalized).digest('hex') !== reviewedSourceHash) {
    throw new Error('Historical attestation changed; review the adaptation before deployment');
  }
  for (const expected of [oldColumns, oldFunction]) {
    if (normalized.split(expected).length !== 2) throw new Error('Reviewed attestation anchor is not unique');
  }
  // The service grant is versioned in 20260812120000 and later patches and was
  // confirmed on the current project. Anon/authenticated remain denied.
  // information_schema filters rows by the inspecting user; effective column
  // checks preserve the exact 34 SELECT/12 UPDATE allowlist under read-only SQL.
  return normalized.replace(oldColumns, effectiveColumns).replace(oldFunction, reviewedFunction);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4 || process.argv[2] !== '--project-ref') {
    throw new Error('Usage: prepare-project-baseline-attestation.mjs --project-ref <reviewed-project>');
  }
  process.stdout.write(adaptProjectAttestation(
    readFileSync(resolve(root, 'supabase/production-baseline-attestation.sql'), 'utf8'), process.argv[3]));
}
