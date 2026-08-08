import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/deploy-supabase-public-edge.yml"),
  "utf8",
);

const expectedFunctions = [
  "admin-reset-client-access",
  "client-first-access",
  "submit-quiz",
  "api-gateway",
  "workspace-inbox",
];

const expectedDeploymentOrder = [
  "admin-reset-client-access",
  "client-first-access",
  "submit-quiz",
  "workspace-inbox",
  "api-gateway",
];

const expectedRpcContracts = [
  "public.has_role(uuid,public.app_role)",
  "public.issue_first_access_token_service(uuid)",
  "public.validate_first_access_token(text)",
  "public.claim_first_access_token(text)",
  "public.release_first_access_claim(uuid)",
  "public.consume_first_access_claim(uuid)",
  "public.issue_first_access_token(uuid)",
  "public.issue_quiz_invitation_v2()",
  "public.load_quiz_invitation(text)",
  "public.save_quiz_invitation(text,jsonb)",
  "public.submit_quiz_invitation(text,jsonb,integer,text)",
  "public.validate_api_key(text)",
  "public.validate_api_key_for_audience(text,text)",
  "public.consume_api_gateway_rate_limit(text)",
  "public.configure_api_gateway_key_scope(uuid,text,uuid[])",
  "public.inspect_workspace_inbox(uuid)",
  "public.reserve_workspace_inbox_upload(uuid,bigint,uuid,text)",
  "public.complete_workspace_inbox_upload(uuid,uuid,uuid,text,text)",
  "public.cancel_workspace_inbox_upload(uuid,text,boolean)",
  "public.manage_workspace_inbox_token(uuid,text)",
  "public.mark_workspace_inbox_scan_clean(uuid,text)",
  "public.workspace_storage_object_is_releasable(text)",
];

describe("protected public Edge release", () => {
  it("is release-only, manual, serialized, and bound to the current main tip", () => {
    expect(workflow).toMatch(/^on:\s*\n\s{2}workflow_dispatch:/m);
    expect(workflow).not.toMatch(/^\s{2}(?:push|pull_request|schedule):/m);
    expect(workflow).not.toMatch(/^\s{6}operation:/m);
    expect(workflow).not.toMatch(/rollback/i);
    expect(workflow).toContain("environment: production");
    expect(workflow).toMatch(
      /concurrency:\s*\n\s+group: supabase-production\s*\n\s+cancel-in-progress: false/,
    );
    expect(workflow).toContain("DEPLOY_PUBLIC_EDGE_PRODUCTION");
    expect(workflow).toContain("PUBLIC_EDGE_DATABASE_GATES_VERIFIED");
    expect(workflow).toContain('[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]]');
    expect(workflow).toContain('test "$EVENT_REF" = "refs/heads/main"');
    expect(workflow).toContain('test "$EVENT_SHA" = "$remote_main_sha"');
    expect(workflow).toContain('test "$TARGET_SHA" = "$remote_main_sha"');
    expect(workflow).toContain('test "$checked_out_sha" = "$remote_main_sha"');
  });

  it("pins every action and release tool version", () => {
    const actions = [
      ...workflow.matchAll(
        /^\s*uses:\s*([^@\s]+)@([0-9a-f]{40})(?:\s+#\s*([^\n]+))?$/gm,
      ),
    ].map((match) => [match[1], match[2], match[3]]);

    expect(actions).toEqual([
      [
        "actions/checkout",
        "de0fac2e4500dabe0009e67214ff5f5447ce83dd",
        "v6.0.2",
      ],
      [
        "actions/setup-node",
        "249970729cb0ef3589644e2896645e5dc5ba9c38",
        "v6.5.0",
      ],
      [
        "denoland/setup-deno",
        "22d081ff2d3a40755e97629de92e3bcbfa7cf2ed",
        "v2.0.5",
      ],
      [
        "supabase/setup-cli",
        "3c2f5e2ae34c34e428e8e206e2c4d21fa2d20fbf",
        "v2.1.1",
      ],
    ]);
    expect(workflow).toContain("node-version: 24");
    expect(workflow).toContain("deno-version: v2.5.1");
    expect(workflow).toContain("version: 2.109.1");
    expect(workflow).toContain("npm install --global npm@11.9.0");
    expect(workflow).toContain('test "$(npm --version)" = "11.9.0"');
  });

  it("runs tests, typecheck, and Deno checks for exactly the five functions", () => {
    const testStep = workflow.slice(
      workflow.indexOf("Test the exact release source"),
      workflow.indexOf("Show deploy tool versions"),
    );
    const checkedFunctions = [
      ...testStep.matchAll(
        /supabase\/functions\/([a-z0-9-]+)\/index\.ts/g,
      ),
    ].map((match) => match[1]);

    expect(testStep).toContain("npm test -- --run");
    expect(testStep).toContain("npm run typecheck");
    expect(testStep).toContain("git diff --exit-code");
    expect(checkedFunctions).toEqual(expectedFunctions);
  });

  it("fails closed unless migrations, v2 RPC grants, and gateway scope are ready", () => {
    const preflight = workflow.slice(
      workflow.indexOf("Verify public Edge database gates"),
      workflow.indexOf("Deploy the exact five-function allowlist"),
    );

    expect(preflight).toContain("prepare-production-migration-view.mjs");
    expect(preflight).toContain("--ledger-sql-values");
    expect(preflight).toContain("expected_migrations(version, migration_name, statements_sha256)");
    expect(preflight).toMatch(/full outer join applied_migrations/);
    expect(preflight).toContain("applied.migration_name <> expected.migration_name");
    expect(preflight).toContain("applied.statements_sha256 <> expected.statements_sha256");
    for (const contract of expectedRpcContracts) {
      expect(preflight).toContain(`('${contract}',`);
    }

    expect(preflight).toContain("supabase_migrations.schema_migrations");
    expect(preflight).toContain("required_v2_rpcs(signature, grantee)");
    expect(preflight).toContain("has_function_privilege(");
    expect(preflight).toContain("to_regprocedure(required.signature)");
    expect(preflight).toContain("app_private.first_access_tokens");
    expect(preflight).toContain("app_private.quiz_invitation_tokens");
    expect(preflight).toContain(
      "api_gateway_private.api_gateway_key_client_scopes",
    );
    expect(preflight).toContain("api_gateway_private.api_gateway_rate_limits");
    expect(preflight).toContain("public.workspace_inbox_scan_events");
    expect(preflight).toMatch(
      /api_key\.is_active = true[\s\S]+?api_key\.revoked_at is null[\s\S]+?api_key\.expires_at is null or api_key\.expires_at > now\(\)[\s\S]+?api_key\.audience = 'api-gateway'[\s\S]+?api_key\.client_scope_mode = 'none'/,
    );
    expect(preflight).toMatch(
      /api_key\.audience is null[\s\S]+?coalesce\(lower\(btrim\(api_key\.origin\)\), ''\) <> 'mcp'/,
    );
    expect(preflight).toContain("PUBLIC_EDGE_PREFLIGHT_READY");
    expect(preflight).toContain(
      'test "$preflight_status" = "PUBLIC_EDGE_PREFLIGHT_READY"',
    );
    expect(workflow.indexOf("PUBLIC_EDGE_PREFLIGHT_READY")).toBeLessThan(
      workflow.indexOf("supabase functions deploy"),
    );
  });

  it("deploys only the exact five-function allowlist and mutates nothing else", () => {
    const deployedFunctions = [
      ...workflow.matchAll(
        /^\s*supabase functions deploy ([a-z0-9-]+) --project-ref /gm,
      ),
    ].map((match) => match[1]);
    const databaseCommands = [
      ...workflow.matchAll(/^\s*supabase db ([a-z-]+)/gm),
    ].map((match) => match[1]);

    expect(deployedFunctions).toEqual(expectedDeploymentOrder);
    expect(databaseCommands).toEqual(["query"]);
    expect(workflow).not.toMatch(/^\s*supabase functions deploy --/m);
    expect(workflow).not.toMatch(/supabase secrets (?:set|unset)/);
    expect(workflow).not.toMatch(/supabase migration /);
    expect(workflow).not.toMatch(/supabase db (?:push|reset)/);
    expect(workflow).not.toMatch(/supabase seed /);
    expect(workflow).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("keeps deployment credentials step-scoped", () => {
    expect(workflow).not.toMatch(
      /^\s{6}SUPABASE_(?:ACCESS_TOKEN|DB_PASSWORD):/m,
    );
    expect(workflow).toMatch(
      /^\s{10}SUPABASE_ACCESS_TOKEN:\s*\$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/m,
    );
    expect(workflow).toMatch(
      /^\s{10}SUPABASE_DB_PASSWORD:\s*\$\{\{ secrets\.SUPABASE_DB_PASSWORD \}\}/m,
    );
  });

  it("smokes safe credential-free rejection contracts after every deploy", () => {
    const deployStep = workflow.slice(
      workflow.indexOf("Deploy the exact five-function allowlist"),
      workflow.indexOf("Run credential-free negative smoke"),
    );
    const smoke = workflow.slice(
      workflow.indexOf("Run credential-free negative smoke"),
      workflow.indexOf("Write release summary"),
    );
    const expectedSmokes = [
      ["admin-reset-client-access", "POST", "401"],
      ["client-first-access", "GET", "405"],
      ["submit-quiz", "GET", "405"],
      ["api-gateway", "GET", "401"],
      ["workspace-inbox", "GET", "404"],
    ];
    const actualSmokes = [
      ...smoke.matchAll(
        /^\s*assert_status ([a-z0-9-]+) (GET|POST) ([0-9]{3})$/gm,
      ),
    ].map((match) => [match[1], match[2], match[3]]);

    expect(deployStep).toContain("supabase functions deploy api-gateway");
    expect(actualSmokes).toEqual(expectedSmokes);
    expect(smoke).toContain(
      'edge_base_url="https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1"',
    );
    expect(smoke).not.toContain("${{ secrets.");
    expect(smoke).not.toMatch(/--header|-H\b/);
    expect(smoke).not.toMatch(/Authorization:\s*Bearer|x-inbox-token\s*:/i);
    expect(smoke).toContain('.code == "invalid_or_expired_link"');
    expect(smoke).toContain("workspace-inbox.headers");
    expect(smoke).toContain("cache-control: no-store");
    expect(smoke).toContain(
      '.success == false and .error == "Missing API key. Send X-API-Key header."',
    );
  });
});
