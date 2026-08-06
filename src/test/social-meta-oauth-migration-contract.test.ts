import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const migration = read(
  "supabase/migrations/20260731175633_meta_oauth_foundation.sql",
);
const auditMigration = read(
  "supabase/migrations/20260805204443_social_account_audit_trail.sql",
);
const editor = read("src/components/editorial/EditorialEditor.tsx");
const config = read("supabase/config.toml");

function functionBody(name: string, nextMarker: string) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION ${name}`);
  const end = migration.indexOf(nextMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}

describe("Meta OAuth migration security contract", () => {
  it("exposes only sanitized connection state and keeps OAuth storage private", () => {
    expect(migration).toContain(
      "CREATE TABLE public.external_account_connections",
    );
    expect(migration).toContain(
      "CREATE SCHEMA IF NOT EXISTS social_private AUTHORIZATION postgres",
    );
    expect(migration).toContain(
      "REVOKE ALL ON SCHEMA social_private",
    );
    expect(migration).toContain(
      "REVOKE ALL ON ALL TABLES IN SCHEMA social_private",
    );
    expect(migration).toContain(
      "GRANT SELECT ON public.external_account_connections TO authenticated",
    );

    const publicTable = migration.slice(
      migration.indexOf(
        "CREATE TABLE public.external_account_connections",
      ),
      migration.indexOf(
        "CREATE TABLE social_private.oauth_sessions",
      ),
    );
    expect(publicTable).not.toMatch(
      /access_token|refresh_token|client_secret|vault_secret/i,
    );
    expect(publicTable).toContain(
      "CHECK (NOT automation_enabled OR connection_status = 'connected')",
    );
  });

  it("stores only a hash of the random state and consumes it once", () => {
    const createSession = functionBody(
      "public.social_meta_oauth_create_session",
      "CREATE OR REPLACE FUNCTION public.social_meta_oauth_consume_session",
    );
    const consumeSession = functionBody(
      "public.social_meta_oauth_consume_session",
      "CREATE OR REPLACE FUNCTION public.social_meta_oauth_store_resources",
    );

    expect(createSession).toContain("extensions.gen_random_bytes(32)");
    expect(createSession).toContain(
      "encode(sha256(convert_to(_state, 'UTF8')), 'hex')",
    );
    expect(createSession).not.toMatch(/INSERT[\s\S]*\bstate\s*,/i);
    expect(consumeSession).toContain("FOR UPDATE");
    expect(consumeSession).toContain("_session.status <> 'pending'");
    expect(consumeSession).toContain("status = 'consumed'");
    expect(consumeSession).toContain(
      "GRANT EXECUTE ON FUNCTION public.social_meta_oauth_consume_session(text)",
    );
  });

  it("moves user and resource tokens directly into Vault behind service_role", () => {
    const storeResources = functionBody(
      "public.social_meta_oauth_store_resources",
      "CREATE OR REPLACE FUNCTION public.social_meta_oauth_finish_session",
    );

    expect(storeResources).toContain("vault.create_secret(");
    expect(storeResources).toContain("_user_access_token");
    expect(storeResources).toContain("_page_access_token");
    expect(storeResources).toContain("user_access_token_secret_id");
    expect(storeResources).toContain("resource_access_token_secret_id");
    expect(storeResources).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.social_meta_oauth_store_resources\([\s\S]*\) TO service_role;/,
    );
    expect(storeResources).not.toMatch(
      /\) TO (?:anon|authenticated|PUBLIC);/,
    );

    const returnedPayload = storeResources.slice(
      storeResources.lastIndexOf("RETURN jsonb_build_object("),
    );
    expect(returnedPayload).not.toMatch(
      /access_token|secret_id|page_id|provider_resource_id/i,
    );
  });

  it("connects within the authenticated scope but leaves automation off", () => {
    const connect = functionBody(
      "public.social_meta_connect_resource",
      "CREATE OR REPLACE FUNCTION public.social_meta_disconnect_account",
    );
    const disconnect = functionBody(
      "public.social_meta_disconnect_account",
      "ALTER TABLE public.editorial_publications",
    );

    expect(connect).toContain("public.can_manage_client(_client_id)");
    expect(connect).toContain("session.actor_id = _actor_id");
    expect(connect).toContain("candidate.client_id = _client_id");
    expect(connect).toContain("automation_enabled = false");
    expect(connect).toContain("'external_account_id', _external_account_id");
    expect(disconnect).toContain("connection_status = 'revoked'");
    expect(disconnect).toContain("automation_enabled = false");
    expect(disconnect).toContain("social_private.revoke_meta_secret(");
    expect(disconnect).toContain("social_private.cleanup_meta_grant(");
  });

  it("revokes abandoned and superseded Vault credentials", () => {
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION social_private.cleanup_meta_oauth_session",
    );
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION social_private.cleanup_expired_meta_oauth",
    );
    expect(migration).toContain("candidate.discarded_at IS NULL");
    expect(migration).toContain("Superseded Meta resource token");
    expect(migration).toContain("cleanup-meta-oauth-secrets");
    expect(migration).toContain("'*/10 * * * *'");
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION social_private.lock_meta_oauth_lifecycle",
    );
    expect(
      migration.match(
        /PERFORM social_private\.lock_meta_oauth_lifecycle\(\);/g,
      ),
    ).toHaveLength(8);
    expect(migration).toMatch(
      /mapping\.grant_id = _grant_id\s+AND mapping\.revoked_at IS NULL/,
    );

    const finish = functionBody(
      "public.social_meta_oauth_finish_session",
      "CREATE OR REPLACE FUNCTION public.social_meta_connect_resource",
    );
    expect(finish).toContain("session.actor_id = _actor_id");
    expect(finish).toContain("public.can_manage_client(_client_id)");
    expect(finish).toContain("social_private.cleanup_meta_oauth_session(");
    expect(finish).toContain(
      "GRANT EXECUTE ON FUNCTION public.social_meta_oauth_finish_session",
    );
  });

  it("freezes ordered assets and blocks automatic delivery without integrity gates", () => {
    expect(editor).toContain("asset_file_ids:");
    expect(editor).toContain("asset.files.map((file) => file.id)");
    expect(migration).toContain(
      "CREATE TABLE social_private.editorial_publication_assets",
    );
    expect(migration).toContain("WITH ORDINALITY AS asset(file_id, position)");
    expect(migration).toContain(
      "editorial asset snapshot must match the complete approved asset",
    );
    expect(migration).toContain(
      "automatic delivery requires an enabled official connection",
    );
    expect(migration).toContain(
      "automatic delivery requires sha256 for every approved asset",
    );
    expect(migration).toContain("automation_enabled boolean NOT NULL DEFAULT false");
  });

  it("requires a valid JWT at the Edge gateway", () => {
    expect(config).toMatch(
      /\[functions\.social-meta-oauth\]\s+verify_jwt = true/,
    );
  });

  it("keeps an append-only, client-scoped routing history without secrets", () => {
    expect(auditMigration).toContain(
      "CREATE TABLE public.social_account_events",
    );
    expect(auditMigration).toContain(
      "ALTER TABLE public.social_account_events ENABLE ROW LEVEL SECURITY",
    );
    expect(auditMigration).toContain(
      "USING (public.can_manage_client(client_id))",
    );
    expect(auditMigration).toContain(
      "GRANT SELECT ON public.social_account_events TO authenticated",
    );
    expect(auditMigration).toContain(
      "BEFORE UPDATE OR DELETE ON public.social_account_events",
    );
    expect(auditMigration).toContain(
      "sensitive fields are forbidden in social account events",
    );
    expect(auditMigration).toContain(
      "reason ~ '^[a-z0-9_:-]{1,100}$'",
    );
    expect(auditMigration).toContain("project_external_accounts_audit_trg");
    expect(auditMigration).toContain("external_account_connections_audit_trg");
    expect(auditMigration).toContain(
      "external_account_grants_reconnect_audit_trg",
    );
    expect(auditMigration).toContain(
      "account.platform IN ('facebook', 'instagram')",
    );
    expect(auditMigration).toContain(
      "platform and external_id are immutable for connected accounts",
    );
    expect(auditMigration).toContain(
      "disconnect it before reassignment",
    );

    const publicTable = auditMigration.slice(
      auditMigration.indexOf("CREATE TABLE public.social_account_events"),
      auditMigration.indexOf(
        "CREATE INDEX social_account_events_client_created_idx",
      ),
    );
    expect(publicTable).not.toMatch(
      /access_token|refresh_token|client_secret|password_hash|vault_secret/i,
    );
    expect(auditMigration.match(/\nEND;\n\$\$;/g)).toHaveLength(7);
  });
});
