import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/deploy-supabase-database.yml"),
  "utf8",
);
const mcpWorkflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/deploy-supabase-mcp.yml"),
  "utf8",
);

const productionWorkflows = [workflow, mcpWorkflow];

describe("protected Supabase database release", () => {
  it("is manual, serialized, and tied to the current main tip", () => {
    expect(workflow).toMatch(/^\s{2}workflow_dispatch:/m);
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("group: supabase-production");
    expect(workflow).toContain('test "$TARGET_SHA" = "$remote_main_sha"');
    expect(workflow).toContain('[[ "$SUPABASE_PROJECT_ID" =~ ^[a-z0-9]{20}$ ]]');
    expect(workflow).toContain("APPLY_DATABASE_PRODUCTION");
    expect(workflow).toContain("BACKUP_VERIFIED");
    expect(workflow).toContain("private_security_confirmation");
    expect(workflow).toContain("PRIVATE_SECURITY_CHECKLIST_VERIFIED");
    expect(workflow).not.toContain("exposed_credentials_confirmation");
    expect(workflow).not.toContain("EXPOSED_CREDENTIALS_ROTATED_OR_RETIRED");
    expect(workflow).not.toContain("OPS_CREDENTIAL_ROTATED_OR_RETIRED");
    expect(workflow).not.toContain('echo "- Project:');
    expect(mcpWorkflow).not.toContain('echo "- Project:');

    for (const source of productionWorkflows) {
      expect(source).toMatch(
        /concurrency:\s*\n\s+group:\s*supabase-production\s*\n\s+cancel-in-progress:\s*false/,
      );
      expect(source).not.toMatch(/^\s*queue\s*:/m);
    }
  });

  it("runs exactly two previews around one forward-only push", () => {
    const pushFlags = [
      ...workflow.matchAll(/^\s*supabase db push\s+([^\n]+)$/gm),
    ].map((match) => match[1].trim());

    expect(pushFlags).toEqual([
      "--linked --dry-run",
      "--linked --yes",
      "--linked --dry-run",
    ]);
    expect(workflow).not.toMatch(/supabase\s+db\s+reset/i);
    expect(workflow).not.toMatch(/supabase\s+migration\s+repair/i);
    expect(workflow).not.toMatch(
      /supabase\s+db\s+push[^\n]*(?:--include-all|--include-roles|--include-seed|--db-url|--local)/i,
    );
    expect(workflow).toContain("supabase db push --linked --yes");
  });

  it("proves every local migration version exists in the remote ledger after push", () => {
    const verification = workflow.slice(
      workflow.indexOf("Verify migration ledger after release"),
      workflow.indexOf("Write release summary"),
    );
    expect(verification).toContain("supabase_migrations.schema_migrations");
    expect(verification).toContain("DATABASE_LEDGER_CURRENT");
    expect(verification).toContain('test "$ledger_status" = "DATABASE_LEDGER_CURRENT"');
    expect(verification).toMatch(/find supabase\/migrations/);
  });

  it("never injects the fresh-database bootstrap into production migrations", () => {
    expect(workflow).toContain(
      "test ! -e supabase/migrations/20260528163000_legacy_prerequisites.sql",
    );
    expect(workflow).toContain(
      "test -f supabase/bootstrap/legacy_prerequisites.sql",
    );
  });

  it("keeps database credentials scoped to the steps that need them", () => {
    for (const source of productionWorkflows) {
      expect(source).not.toMatch(
        /^\s{6}SUPABASE_(?:ACCESS_TOKEN|DB_PASSWORD)\s*:/m,
      );
    }
    expect(workflow).toMatch(
      /^\s{10}SUPABASE_DB_PASSWORD:\s*\$\{\{ secrets\.SUPABASE_DB_PASSWORD \}\}/m,
    );
    expect(mcpWorkflow).toMatch(
      /^\s{10}SUPABASE_DB_PASSWORD:\s*\$\{\{ secrets\.SUPABASE_DB_PASSWORD \}\}/m,
    );
  });

  it("gates every MCP mutation on the read-only OAuth database preflight", () => {
    const link = mcpWorkflow.indexOf("supabase link");
    const preflight = mcpWorkflow.indexOf("supabase db query --linked");
    const tableCheck = mcpWorkflow.indexOf(
      "to_regclass('public.mcp_oauth_allowed_redirect_origins')",
    );
    const functionCheck = mcpWorkflow.indexOf(
      "to_regprocedure('public.is_allowed_mcp_oauth_client(uuid)')",
    );
    const unknownClientCheck = mcpWorkflow.indexOf(
      "public.is_allowed_mcp_oauth_client(",
    );
    const resultAssertion = mcpWorkflow.indexOf(
      'test "$preflight_status" = "MCP_OAUTH_PREFLIGHT_READY"',
    );
    const secretMutation = mcpWorkflow.indexOf("supabase secrets set");
    const secretRemoval = mcpWorkflow.indexOf("supabase secrets unset");
    const functionDeploy = mcpWorkflow.indexOf("supabase functions deploy");
    const databaseCommands = [
      ...mcpWorkflow.matchAll(/supabase\s+db\s+([^\s"'\\]+)/g),
    ].map((match) => match[1]);

    expect(link).toBeGreaterThan(-1);
    expect(preflight).toBeGreaterThan(link);
    expect(tableCheck).toBeGreaterThan(preflight);
    expect(functionCheck).toBeGreaterThan(tableCheck);
    expect(unknownClientCheck).toBeGreaterThan(functionCheck);
    expect(mcpWorkflow).toMatch(/is_allowed_mcp_oauth_client\([\s\S]+?\) is false/);
    expect(mcpWorkflow).toContain("--output csv");
    expect(mcpWorkflow).toContain("supabase_migrations.schema_migrations");
    expect(mcpWorkflow).toContain("expected_migrations");
    expect(mcpWorkflow).toContain("find ../control/supabase/migrations");
    expect(resultAssertion).toBeGreaterThan(unknownClientCheck);
    expect(secretMutation).toBeGreaterThan(resultAssertion);
    expect(secretRemoval).toBeGreaterThan(resultAssertion);
    expect(functionDeploy).toBeGreaterThan(resultAssertion);
    expect(databaseCommands).toEqual(["query"]);
    expect(mcpWorkflow).not.toMatch(/supabase\s+migration\s+/i);
  });

  it("reconciles removed MCP overrides instead of preserving stale secrets", () => {
    expect(mcpWorkflow).toContain("unset_names=(MCP_OAUTH_ALLOWED_CLIENT_IDS)");
    expect(mcpWorkflow).toContain('unset_names+=("$name")');
    expect(mcpWorkflow).toContain('if [ "${#unset_names[@]}" -gt 0 ]; then');
    expect(mcpWorkflow).toMatch(
      /supabase secrets unset\s+\\\s*\n\s*--project-ref "\$SUPABASE_PROJECT_ID"\s+\\\s*\n\s*--yes/,
    );
    expect(mcpWorkflow).toContain('echo "removed=$removed" >> "$GITHUB_OUTPUT"');
    expect(mcpWorkflow).toContain("Runtime overrides removed");
    expect(
      [...mcpWorkflow.matchAll(/MCP_OAUTH_ALLOWED_CLIENT_IDS/g)],
    ).toHaveLength(1);
    expect(mcpWorkflow).not.toMatch(
      /\$\{\{[^}\n]*(?:vars|secrets)\.MCP_OAUTH_ALLOWED_CLIENT_IDS\b[^}\n]*\}\}/,
    );
    const reconciliation = mcpWorkflow.slice(
      mcpWorkflow.indexOf("Reconcile MCP-only runtime overrides"),
      mcpWorkflow.indexOf("Smoke final MCP runtime configuration"),
    );
    expect(reconciliation).not.toContain("APP_PUBLIC_URL");
  });

  it("runs an authenticated MCP smoke with a pinned key and one-client boundary", () => {
    expect(mcpWorkflow).toMatch(
      /MCP_SMOKE_TOKEN:\s*\$\{\{ secrets\.MCP_SMOKE_TOKEN \}\}/,
    );
    expect(mcpWorkflow).toMatch(
      /MCP_SMOKE_EXPECTED_KEY_ID:\s*\$\{\{ secrets\.MCP_SMOKE_EXPECTED_KEY_ID \}\}/,
    );
    expect(mcpWorkflow).toMatch(
      /MCP_SMOKE_EXPECTED_CLIENT_ID:\s*\$\{\{ secrets\.MCP_SMOKE_EXPECTED_CLIENT_ID \}\}/,
    );
    expect(mcpWorkflow).toMatch(
      /MCP_SMOKE_EXPECTED_PUBLIC_URL:\s*\$\{\{ vars\.APP_PUBLIC_URL \}\}/,
    );
    expect(mcpWorkflow).toContain('test -n "$MCP_SMOKE_TOKEN"');
    expect(mcpWorkflow).toContain('test -n "$MCP_SMOKE_EXPECTED_KEY_ID"');
    expect(mcpWorkflow).toContain('test -n "$MCP_SMOKE_EXPECTED_CLIENT_ID"');
    expect(mcpWorkflow).toContain('test -n "$MCP_SMOKE_EXPECTED_PUBLIC_URL"');
    expect(mcpWorkflow).toContain("--require-authenticated");

    const serverDeploy = mcpWorkflow.indexOf("supabase functions deploy mcp-server");
    const metadataDeploy = mcpWorkflow.indexOf("supabase functions deploy mcp-oauth-metadata");
    const candidateSmoke = mcpWorkflow.indexOf("id: smoke_candidate");
    const secretMutation = mcpWorkflow.indexOf("supabase secrets set");
    const finalSmoke = mcpWorkflow.indexOf("id: smoke\n");
    expect(serverDeploy).toBeGreaterThan(-1);
    expect(metadataDeploy).toBeGreaterThan(serverDeploy);
    expect(candidateSmoke).toBeGreaterThan(metadataDeploy);
    expect(secretMutation).toBeGreaterThan(candidateSmoke);
    expect(finalSmoke).toBeGreaterThan(secretMutation);

    const candidateStep = mcpWorkflow.slice(candidateSmoke, secretMutation);
    expect(candidateStep).toContain("--discover-runtime-config");
    expect(candidateStep).toMatch(/MCP_BASE_URL:\s*""/);
    expect(candidateStep).toMatch(/MCP_RESOURCE_URL:\s*""/);
    expect(candidateStep).toMatch(/MCP_OAUTH_METADATA_URL:\s*""/);
    expect(candidateStep).toMatch(/MCP_AUTH_ISSUER:\s*""/);
    expect(mcpWorkflow.slice(finalSmoke)).not.toContain("--discover-runtime-config");
  });
});
