-- Read-only fingerprint of the audited Lovable production migration ledger.
-- The two schema-attested local versions are intentionally included in this
-- fingerprint if they ever appear. The verifier rejects such rows because the
-- approved baseline covers their effects without adding migration history.

SELECT
  version AS remote_version,
  COALESCE(name, '') AS remote_name,
  encode(
    digest(
      COALESCE(array_to_string(statements, chr(30)), ''),
      'sha256'
    ),
    'hex'
  ) AS remote_statements_sha256
FROM supabase_migrations.schema_migrations
ORDER BY version;
