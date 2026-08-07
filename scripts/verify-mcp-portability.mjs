#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, "..");
const HOSTED_SUPABASE_URL = /https:\/\/[a-z0-9]{20}\.supabase\.co/i;
const SUPABASE_PROJECT_REF = /\b[a-z0-9]{20}\b/g;
const ALLOWED_DEPLOY_FUNCTIONS = new Set(["mcp-oauth-metadata", "mcp-server"]);
const LEGACY_OAUTH_CLIENT_BYPASS = "MCP_OAUTH_ALLOWED_CLIENT_IDS";

function parseArgs(argv) {
  const options = {
    includeCompat: false,
    selfTest: false,
    json: false,
    sourceOnly: false,
    sourceRoot: "",
    rollbackSource: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--include-compat") options.includeCompat = true;
    else if (arg === "--self-test") options.selfTest = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--source-only") options.sourceOnly = true;
    else if (arg === "--source-root") options.sourceRoot = argv[++index] ?? "";
    else if (arg === "--rollback-source") options.rollbackSource = true;
    else if (arg === "--help") {
      console.log(`Usage: node scripts/verify-mcp-portability.mjs [options]

Options:
  --include-compat  Validate the optional generated /mcp function too
  --self-test       Run in-memory checks for the verifier itself
  --json            Print machine-readable output
  --source-root     Read deployable MCP source from another repository root
  --source-only     Skip control-plane workflow and package checks
  --rollback-source Allow a historical project-bound source during explicit rollback
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function load(relativePath, root = REPOSITORY_ROOT) {
  try {
    return await readFile(path.join(root, relativePath), "utf8");
  } catch (error) {
    throw new Error(`Cannot read ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function functionConfig(config, functionName) {
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const header = new RegExp(`^\\s*\\[functions\\.${escaped}\\]\\s*$`, "m").exec(config);
  if (!header) return "";
  const bodyStart = header.index + header[0].length;
  const remainder = config.slice(bodyStart);
  const nextHeader = /^\s*\[/m.exec(remainder);
  return nextHeader ? remainder.slice(0, nextHeader.index) : remainder;
}

function verifyJwtIsFalse(config, functionName, problems) {
  const block = functionConfig(config, functionName);
  if (!block) {
    problems.push(`supabase/config.toml is missing [functions.${functionName}]`);
    return;
  }
  if (!/^\s*verify_jwt\s*=\s*false\s*$/m.test(block)) {
    problems.push(`[functions.${functionName}] must set verify_jwt = false`);
  }
}

function rejectEmbeddedProject(relativePath, source, problems) {
  const urls = source.match(HOSTED_SUPABASE_URL) ?? [];
  const refs = source.match(SUPABASE_PROJECT_REF) ?? [];
  if (urls.length > 0 || refs.length > 0) {
    problems.push(`${relativePath} embeds a Supabase project URL/ref; derive it from runtime environment`);
  }
}

function rejectLegacyOauthClientBypass(relativePath, source, problems) {
  if (source.includes(LEGACY_OAUTH_CLIENT_BYPASS)) {
    problems.push(
      `${relativePath} references the retired ${LEGACY_OAUTH_CLIENT_BYPASS} runtime bypass`,
    );
  }
}

function extractConstant(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`(?:const|version:)\\s*${escaped}[^=:\\n]*[=:]\\s*["']([^"']+)["']`))?.[1] ?? "";
}

function extractServerInfoVersion(source) {
  const block = source.match(/SERVER_INFO\s*=\s*\{([\s\S]*?)\}\s*as const/)?.[1] ?? "";
  return block.match(/version\s*:\s*["']([^"']+)["']/)?.[1] ?? "";
}

function deployCommands(workflow) {
  return [...workflow.matchAll(/supabase\s+functions\s+deploy\s+([^\s"'\\]+)/g)].map((match) => match[1]);
}

function inspectWorkflow(workflow, problems) {
  if (!/^\s*workflow_dispatch\s*:/m.test(workflow)) {
    problems.push("deploy workflow must be manual (workflow_dispatch)");
  }
  if (!/^\s*environment\s*:\s*production\s*$/m.test(workflow)) {
    problems.push("deploy workflow must use the protected production environment");
  }
  if (!/^\s*group\s*:\s*supabase-production\s*$/m.test(workflow)) {
    problems.push("deploy workflow must share the serialized Supabase production concurrency group");
  }
  if (!/^\s*cancel-in-progress\s*:\s*false\s*$/m.test(workflow)) {
    problems.push("deploy workflow must not cancel an in-progress production release");
  }
  if (/^\s*queue\s*:/m.test(workflow)) {
    problems.push("deploy workflow must not use the unsupported queue concurrency key");
  }
  if (
    /\$\{\{[^}\n]*(?:vars|secrets)\.MCP_OAUTH_ALLOWED_CLIENT_IDS\b[^}\n]*\}\}/.test(workflow)
  ) {
    problems.push("deploy workflow must not expose the retired OAuth client bypass through vars or secrets");
  }
  for (const match of workflow.matchAll(/^\s*-\s*uses:\s*([^\s#]+)/gm)) {
    const action = match[1];
    if (!action.startsWith("./") && !/@[0-9a-f]{40}$/i.test(action)) {
      problems.push("production GitHub Action must be pinned by commit SHA: " + action);
    }
  }
  if (/supabase\s+migration\s+/i.test(workflow)) {
    problems.push("MCP deploy workflow must not run migration commands");
  }

  const databaseCommands = [
    ...workflow.matchAll(/supabase\s+db\s+([^\s"'\\]+)/gi),
  ].map((match) => match[1]);
  if (databaseCommands.length !== 1 || databaseCommands[0] !== "query") {
    problems.push("MCP deploy workflow may run exactly one read-only db query preflight");
  }

  const commands = deployCommands(workflow);
  const expectedFunctions = [...ALLOWED_DEPLOY_FUNCTIONS].sort();
  if (
    commands.length !== expectedFunctions.length
    || [...commands].sort().some((name, index) => name !== expectedFunctions[index])
  ) {
    problems.push("deploy workflow must deploy exactly mcp-oauth-metadata and mcp-server once each");
  }
  for (const functionName of commands) {
    if (!ALLOWED_DEPLOY_FUNCTIONS.has(functionName)) {
      problems.push(`deploy workflow contains non-MCP function: ${functionName}`);
    }
  }
  if (/supabase\s+functions\s+deploy\s*(?:$|[;&|])/m.test(workflow)) {
    problems.push("deploy workflow must never deploy all Edge Functions implicitly");
  }

  const requiredControls = [
    [/^\s{6}operation:\s*$/m, "deploy workflow must expose an operation input"],
    [/DEPLOY_MCP_PRODUCTION/, "release must have a dedicated production confirmation"],
    [/ROLLBACK_MCP_PRODUCTION/, "rollback must have a dedicated production confirmation"],
    [/test\s+"\$TARGET_SHA"\s+=\s+"\$remote_main_sha"/, "release target must equal the current main tip"],
    [/test\s+"\$TARGET_SHA"\s+!=\s+"\$remote_main_sha"/, "rollback target must be older than the main tip"],
    [/merge-base\s+--is-ancestor/, "rollback target must be verified as an ancestor of main"],
    [/test\s+"\$EVENT_SHA"\s+=\s+"\$remote_main_sha"/, "workflow dispatch must itself run from the current main tip"],
    [/api\.supabase\.com\/v1\/projects\/\$SUPABASE_PROJECT_ID/, "access token must be checked against the exact Supabase project"],
    [/supabase\s+functions\s+list\s+--project-ref/, "Supabase CLI access to the target project must be checked"],
    [/supabase\s+link[\s\S]{0,160}--project-ref[\s\S]{0,160}--password/, "OAuth preflight must link the reviewed project with a step-scoped database password"],
    [/supabase\s+db\s+query\s+--linked[\s\S]{0,160}--output\s+csv/i, "OAuth preflight must produce a machine-checkable read-only result"],
    [/to_regclass\s*\(\s*["']public\.mcp_oauth_allowed_redirect_origins["']\s*\)/i, "OAuth preflight must verify the redirect-origin table"],
    [/to_regprocedure\s*\(\s*["']public\.is_allowed_mcp_oauth_client\(uuid\)["']\s*\)/i, "OAuth preflight must verify the client-binding function"],
    [/public\.is_allowed_mcp_oauth_client\s*\([\s\S]{0,160}00000000-0000-0000-0000-000000000000[\s\S]{0,80}is\s+false/i, "OAuth preflight must prove an unknown client is rejected"],
    [/supabase_migrations\.schema_migrations/, "MCP deploy must prove every current-main migration is already applied"],
    [/test\s+"\$preflight_status"\s+=\s+"MCP_OAUTH_PREFLIGHT_READY"/, "OAuth preflight result must be asserted before deployment"],
    [/path:\s*control/, "current main must be checked out as the deployment control plane"],
    [/path:\s*release-source/, "immutable deployment source must use an isolated checkout"],
    [/--rollback-source/, "historical rollback source must use the explicit rollback verification mode"],
    [/working-directory:\s*release-source/, "function deploys must use the isolated deployment source"],
    [/validate-mcp-overrides\.mjs/, "public MCP runtime overrides must be validated before they are applied"],
    [/supabase\s+secrets\s+set/, "defined MCP runtime overrides must be applied to Edge Function secrets"],
    [/supabase\s+secrets\s+unset[\s\S]{0,180}--yes/, "removed MCP runtime overrides must be deleted non-interactively from Edge Function secrets"],
    [/unset_names\s*=\s*\(\s*MCP_OAUTH_ALLOWED_CLIENT_IDS\s*\)/, "runtime reconciliation must always remove the retired OAuth client bypass"],
    [/MCP_SMOKE_TOKEN:\s*\$\{\{\s*secrets\.MCP_SMOKE_TOKEN\s*\}\}/, "authenticated smoke token must come from the protected GitHub Environment"],
    [/MCP_SMOKE_EXPECTED_KEY_ID:\s*\$\{\{\s*secrets\.MCP_SMOKE_EXPECTED_KEY_ID\s*\}\}/, "authenticated smoke key id must come from the protected GitHub Environment"],
    [/MCP_SMOKE_EXPECTED_CLIENT_ID:\s*\$\{\{\s*secrets\.MCP_SMOKE_EXPECTED_CLIENT_ID\s*\}\}/, "authenticated smoke client id must come from the protected GitHub Environment"],
    [/MCP_SMOKE_EXPECTED_PUBLIC_URL:\s*\$\{\{\s*vars\.APP_PUBLIC_URL\s*\}\}/, "smoke must verify the project-wide APP_PUBLIC_URL without mutating it"],
    [/test\s+-n\s+"\$MCP_SMOKE_TOKEN"/, "deployment must reject a missing authenticated smoke token"],
    [/test\s+-n\s+"\$MCP_SMOKE_EXPECTED_KEY_ID"/, "deployment must reject a missing authenticated smoke key id"],
    [/test\s+-n\s+"\$MCP_SMOKE_EXPECTED_CLIENT_ID"/, "deployment must reject a missing authenticated smoke client id"],
    [/test\s+-n\s+"\$MCP_SMOKE_EXPECTED_PUBLIC_URL"/, "deployment must reject a missing expected public URL"],
    [/--require-authenticated/, "deployment smoke must exercise a protected MCP read"],
    [/--operation\s+"\$DEPLOY_OPERATION"/, "smoke output must identify release versus rollback"],
    [/Operation:[^\n]*\$DEPLOY_OPERATION/, "job summary must identify release versus rollback"],
  ];
  for (const [pattern, message] of requiredControls) {
    if (!pattern.test(workflow)) problems.push(message);
  }

  const preflightIndex = workflow.indexOf("supabase db query --linked");
  const linkIndex = workflow.indexOf("supabase link");
  const mutationIndexes = [
    workflow.indexOf("supabase secrets set"),
    workflow.indexOf("supabase secrets unset"),
    workflow.indexOf("supabase functions deploy"),
  ].filter((index) => index >= 0);
  if (preflightIndex >= 0) {
    if (linkIndex < 0 || linkIndex > preflightIndex) {
      problems.push("reviewed project must be linked before the OAuth database preflight");
    }
    if (mutationIndexes.some((index) => index < preflightIndex)) {
      problems.push("OAuth database preflight must pass before secrets or functions are changed");
    }
  }

  const serverDeployIndex = workflow.indexOf("supabase functions deploy mcp-server");
  const metadataDeployIndex = workflow.indexOf("supabase functions deploy mcp-oauth-metadata");
  const candidateSmokeIndex = workflow.indexOf("id: smoke_candidate");
  const secretsSetIndex = workflow.indexOf("supabase secrets set");
  const finalSmokeIndex = workflow.indexOf("id: smoke\n");
  if (
    serverDeployIndex < 0
    || metadataDeployIndex < serverDeployIndex
    || candidateSmokeIndex < metadataDeployIndex
    || secretsSetIndex < candidateSmokeIndex
    || finalSmokeIndex < secretsSetIndex
  ) {
    problems.push("MCP code must deploy server-first, pass a candidate smoke, then reconcile MCP-only secrets and pass a final smoke");
  }

  if (candidateSmokeIndex >= 0 && secretsSetIndex > candidateSmokeIndex) {
    const candidateSmoke = workflow.slice(candidateSmokeIndex, secretsSetIndex);
    if (!/--discover-runtime-config/.test(candidateSmoke)) {
      problems.push("candidate smoke must discover the currently effective runtime configuration before overrides are reconciled");
    }
    for (const name of ["MCP_BASE_URL", "MCP_RESOURCE_URL", "MCP_OAUTH_METADATA_URL", "MCP_AUTH_ISSUER"]) {
      if (!new RegExp(`${name}:\\s*["']{2}`).test(candidateSmoke)) {
        problems.push(`candidate smoke must clear desired ${name} while discovering current runtime configuration`);
      }
    }
  }
  if (finalSmokeIndex >= 0 && /--discover-runtime-config/.test(workflow.slice(finalSmokeIndex))) {
    problems.push("final smoke must validate desired runtime configuration instead of discovering it");
  }

  const reconciliationStart = workflow.indexOf("Reconcile MCP-only runtime overrides");
  if (reconciliationStart < 0) {
    problems.push("workflow must label the MCP-only secret reconciliation boundary");
  } else {
    const reconciliationEnd = workflow.indexOf("Smoke final MCP runtime configuration", reconciliationStart);
    const reconciliation = workflow.slice(
      reconciliationStart,
      reconciliationEnd < 0 ? workflow.length : reconciliationEnd,
    );
    if (/\bAPP_PUBLIC_URL\b/.test(reconciliation)) {
      problems.push("MCP workflow must not mutate the project-wide APP_PUBLIC_URL secret");
    }
  }

  if (/^\s{6}SUPABASE_(?:ACCESS_TOKEN|DB_PASSWORD)\s*:/m.test(workflow)) {
    problems.push("Supabase credentials must be scoped to individual workflow steps");
  }

  for (const name of [
    "MCP_RESOURCE_URL",
    "MCP_OAUTH_METADATA_URL",
    "MCP_AUTH_ISSUER",
    "APP_PUBLIC_URL",
    "MCP_ALLOWED_ORIGINS",
  ]) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`${escaped}: \\$\\{\\{ vars\\.${escaped} \\}\\}`).test(workflow)) {
      problems.push(`${name} must come from a GitHub Environment variable`);
    }
  }
  if (!/if \[ "\$\{#override_args\[@\]\}" -gt 0 \]/.test(workflow)) {
    problems.push("runtime overrides must only be applied when at least one is defined");
  }
  if (!/if \[ "\$\{#unset_names\[@\]\}" -gt 0 \]/.test(workflow)) {
    problems.push("removed runtime overrides must be reconciled explicitly");
  }
}

function selfTest() {
  const problems = [];
  const goodConfig = `
[functions.mcp-server]
verify_jwt = false
[functions.mcp-oauth-metadata]
verify_jwt = false
`;
  verifyJwtIsFalse(goodConfig, "mcp-server", problems);
  verifyJwtIsFalse(goodConfig, "mcp-oauth-metadata", problems);
  assert.deepEqual(problems, []);

  const badConfigProblems = [];
  verifyJwtIsFalse("[functions.mcp-server]\nverify_jwt = true\n", "mcp-server", badConfigProblems);
  assert.equal(badConfigProblems.length, 1);

  const projectProblems = [];
  rejectEmbeddedProject(
    "fixture.ts",
    "const endpoint = 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/mcp-server';",
    projectProblems,
  );
  assert.equal(projectProblems.length, 1);

  const workflowProblems = [];
  const goodWorkflow = `
on:
  workflow_dispatch:
    inputs:
      operation:
      release_confirmation: DEPLOY_MCP_PRODUCTION
      rollback_confirmation: ROLLBACK_MCP_PRODUCTION
concurrency:
  group: supabase-production
  cancel-in-progress: false
jobs:
  deploy:
    environment: production
    env:
      MCP_RESOURCE_URL: \${{ vars.MCP_RESOURCE_URL }}
      MCP_OAUTH_METADATA_URL: \${{ vars.MCP_OAUTH_METADATA_URL }}
      MCP_AUTH_ISSUER: \${{ vars.MCP_AUTH_ISSUER }}
      APP_PUBLIC_URL: \${{ vars.APP_PUBLIC_URL }}
      MCP_ALLOWED_ORIGINS: \${{ vars.MCP_ALLOWED_ORIGINS }}
      MCP_SMOKE_TOKEN: \${{ secrets.MCP_SMOKE_TOKEN }}
      MCP_SMOKE_EXPECTED_KEY_ID: \${{ secrets.MCP_SMOKE_EXPECTED_KEY_ID }}
      MCP_SMOKE_EXPECTED_CLIENT_ID: \${{ secrets.MCP_SMOKE_EXPECTED_CLIENT_ID }}
      MCP_SMOKE_EXPECTED_PUBLIC_URL: \${{ vars.APP_PUBLIC_URL }}
    steps:
      - uses: actions/checkout@0000000000000000000000000000000000000000
      - with:
          path: control
      - with:
          path: release-source
      - run: |
          test "$EVENT_SHA" = "$remote_main_sha"
          test "$TARGET_SHA" = "$remote_main_sha"
          test "$TARGET_SHA" != "$remote_main_sha"
          git merge-base --is-ancestor "$TARGET_SHA" "$remote_main_sha"
          curl "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_ID"
          supabase functions list --project-ref "$SUPABASE_PROJECT_ID"
          supabase link --project-ref "$SUPABASE_PROJECT_ID" --password "$SUPABASE_DB_PASSWORD"
          supabase db query --linked --output csv "select case when to_regclass('public.mcp_oauth_allowed_redirect_origins') is not null and to_regprocedure('public.is_allowed_mcp_oauth_client(uuid)') is not null and public.is_allowed_mcp_oauth_client('00000000-0000-0000-0000-000000000000'::uuid) is false and not exists (select 1 from supabase_migrations.schema_migrations) then 'MCP_OAUTH_PREFLIGHT_READY' end"
          test "$preflight_status" = "MCP_OAUTH_PREFLIGHT_READY"
          test -n "$MCP_SMOKE_TOKEN"
          test -n "$MCP_SMOKE_EXPECTED_KEY_ID"
          test -n "$MCP_SMOKE_EXPECTED_CLIENT_ID"
          node scripts/verify-mcp-portability.mjs --rollback-source
          supabase functions deploy mcp-server --project-ref "$SUPABASE_PROJECT_ID"
          supabase functions deploy mcp-oauth-metadata --project-ref "$SUPABASE_PROJECT_ID"
          id: smoke_candidate
          MCP_BASE_URL: ""
          MCP_RESOURCE_URL: ""
          MCP_OAUTH_METADATA_URL: ""
          MCP_AUTH_ISSUER: ""
          test -n "$MCP_SMOKE_EXPECTED_PUBLIC_URL"
          node scripts/mcp-smoke.mjs --operation "$DEPLOY_OPERATION" --discover-runtime-config --require-authenticated
          Reconcile MCP-only runtime overrides
          node scripts/validate-mcp-overrides.mjs
          override_args=()
          unset_names=(MCP_OAUTH_ALLOWED_CLIENT_IDS)
          if [ "\${#override_args[@]}" -gt 0 ]; then
            supabase secrets set --project-ref "$SUPABASE_PROJECT_ID"
          fi
          if [ "\${#unset_names[@]}" -gt 0 ]; then
            supabase secrets unset --project-ref "$SUPABASE_PROJECT_ID" --yes "\${unset_names[@]}"
          fi
          id: smoke
          node scripts/mcp-smoke.mjs --operation "$DEPLOY_OPERATION" --require-authenticated
          echo "Operation: \`$DEPLOY_OPERATION\`"
        working-directory: release-source
`;
  inspectWorkflow(goodWorkflow, workflowProblems);
  assert.deepEqual(workflowProblems, []);

  const staleCandidateConfigProblems = [];
  inspectWorkflow(
    goodWorkflow.replace(" --discover-runtime-config", ""),
    staleCandidateConfigProblems,
  );
  assert(
    staleCandidateConfigProblems.some((problem) => problem.includes("currently effective runtime configuration")),
  );

  const legacySourceProblems = [];
  rejectLegacyOauthClientBypass(
    "supabase/functions/_shared/mcp-auth.ts",
    'const allowed = Deno.env.get("MCP_OAUTH_ALLOWED_CLIENT_IDS");',
    legacySourceProblems,
  );
  assert(
    legacySourceProblems.some((problem) => problem.includes("retired MCP_OAUTH_ALLOWED_CLIENT_IDS")),
  );

  const missingLegacyRemovalProblems = [];
  inspectWorkflow(
    goodWorkflow.replace(
      "unset_names=(MCP_OAUTH_ALLOWED_CLIENT_IDS)",
      "unset_names=()",
    ),
    missingLegacyRemovalProblems,
  );
  assert(
    missingLegacyRemovalProblems.some((problem) => problem.includes("always remove the retired OAuth client bypass")),
  );

  const exposedLegacyBypassProblems = [];
  inspectWorkflow(
    goodWorkflow.replace(
      "MCP_SMOKE_TOKEN: \${{ secrets.MCP_SMOKE_TOKEN }}",
      "MCP_SMOKE_TOKEN: \${{ secrets.MCP_SMOKE_TOKEN }}\n      LEGACY_BYPASS: \${{ vars.MCP_OAUTH_ALLOWED_CLIENT_IDS }}",
    ),
    exposedLegacyBypassProblems,
  );
  assert(
    exposedLegacyBypassProblems.some((problem) => problem.includes("must not expose the retired OAuth client bypass")),
  );

  const missingSmokeIdentityProblems = [];
  inspectWorkflow(
    goodWorkflow.replaceAll("MCP_SMOKE_EXPECTED_CLIENT_ID", "MCP_SMOKE_UNEXPECTED_CLIENT_ID"),
    missingSmokeIdentityProblems,
  );
  assert(
    missingSmokeIdentityProblems.some((problem) => problem.includes("smoke client id")),
  );

  const unpinnedActionProblems = [];
  inspectWorkflow(
    goodWorkflow.replace(
      "actions/checkout@0000000000000000000000000000000000000000",
      "actions/checkout@v6",
    ),
    unpinnedActionProblems,
  );
  assert(
    unpinnedActionProblems.some((problem) =>
      problem.includes("production GitHub Action must be pinned by commit SHA")
    ),
  );

  const unsafeWorkflowProblems = [];
  inspectWorkflow(
    `${goodWorkflow}\n      - run: supabase functions deploy unrelated-function --project-ref "$SUPABASE_PROJECT_ID"\n`,
    unsafeWorkflowProblems,
  );
  assert(unsafeWorkflowProblems.some((problem) => problem.includes("non-MCP function")));

  const mutatingDatabaseWorkflowProblems = [];
  inspectWorkflow(
    goodWorkflow.replace(
      /supabase db query --linked[^\n]+/,
      'supabase db push --linked',
    ),
    mutatingDatabaseWorkflowProblems,
  );
  assert(mutatingDatabaseWorkflowProblems.some((problem) => problem.includes("read-only db query")));
  console.log("MCP portability verifier self-test passed");
}

async function verifyRepository({ includeCompat, sourceOnly, sourceRoot, rollbackSource }) {
  const problems = [];
  const checked = [];
  const deploymentRoot = sourceRoot
    ? path.resolve(REPOSITORY_ROOT, sourceRoot)
    : REPOSITORY_ROOT;
  const config = await load("supabase/config.toml", deploymentRoot);
  const server = await load("supabase/functions/mcp-server/index.ts", deploymentRoot);
  const metadata = await load("supabase/functions/mcp-oauth-metadata/index.ts", deploymentRoot);
  const auth = await load("supabase/functions/_shared/mcp-auth.ts", deploymentRoot);
  const tools = await load("supabase/functions/_shared/mcp-tools.ts", deploymentRoot);
  const response = await load("supabase/functions/_shared/mcp-response.ts", deploymentRoot);

  verifyJwtIsFalse(config, "mcp-server", problems);
  verifyJwtIsFalse(config, "mcp-oauth-metadata", problems);
  checked.push("explicit JWT policy for portable MCP endpoints");

  if (!rollbackSource) {
    for (const [relativePath, source] of [
      ["supabase/functions/mcp-server/index.ts", server],
      ["supabase/functions/mcp-oauth-metadata/index.ts", metadata],
      ["supabase/functions/_shared/mcp-auth.ts", auth],
    ]) {
      rejectEmbeddedProject(relativePath, source, problems);
    }
    checked.push("runtime-derived Supabase project URLs and issuer");
  } else {
    checked.push("historical project-bound source accepted only for explicit rollback");
    const configuredOverrides = [
      "MCP_RESOURCE_URL",
      "MCP_OAUTH_METADATA_URL",
      "MCP_AUTH_ISSUER",
      "MCP_ALLOWED_ORIGINS",
    ].filter((name) => (process.env[name] ?? "").trim());
    if (configuredOverrides.length > 0) {
      const supportsRuntimeUrls = server.includes("getMcpRuntimeConfig")
        && metadata.includes("getMcpRuntimeConfig")
        && auth.includes("getMcpRuntimeConfig");
      const supportsAllowedOrigins = !configuredOverrides.includes("MCP_ALLOWED_ORIGINS")
        || server.includes("MCP_ALLOWED_ORIGINS");
      if (!supportsRuntimeUrls || !supportsAllowedOrigins) {
        problems.push(
          `rollback source does not support configured runtime overrides: ${configuredOverrides.join(", ")}`,
        );
      }
    }
  }

  for (const [relativePath, source] of [
    ["supabase/functions/mcp-server/index.ts", server],
    ["supabase/functions/mcp-oauth-metadata/index.ts", metadata],
    ["supabase/functions/_shared/mcp-auth.ts", auth],
    ["supabase/functions/_shared/mcp-tools.ts", tools],
    ["supabase/functions/_shared/mcp-response.ts", response],
  ]) {
    rejectLegacyOauthClientBypass(relativePath, source, problems);
  }
  checked.push("retired OAuth client bypass absent from deployable MCP source");

  const serverVersion = extractServerInfoVersion(tools);
  const metadataVersion = extractConstant(metadata, "MCP_VERSION");
  if (!serverVersion || !metadataVersion || serverVersion !== metadataVersion) {
    problems.push(`MCP version mismatch: server=${serverVersion || "missing"}, metadata=${metadataVersion || "missing"}`);
  }

  const protocolVersion = extractConstant(response, "MCP_PROTOCOL_VERSION");
  const metadataProtocol = extractConstant(metadata, "MCP_PROTOCOL");
  if (!protocolVersion || !metadataProtocol || protocolVersion !== metadataProtocol) {
    problems.push(`MCP protocol mismatch: server=${protocolVersion || "missing"}, metadata=${metadataProtocol || "missing"}`);
  }
  checked.push("portable MCP server/metadata version parity");

  if (!sourceOnly) {
    const workflow = await load(".github/workflows/deploy-supabase-mcp.yml");
    const packageJson = JSON.parse(await load("package.json"));
    inspectWorkflow(workflow, problems);
    checked.push("manual release/rollback workflow with an exact two-function allowlist");

    for (const script of ["mcp:smoke", "mcp:portability"]) {
      if (!packageJson.scripts?.[script]) problems.push(`package.json is missing script ${script}`);
    }
    checked.push("package scripts for portability and smoke checks");
  } else {
    checked.push("immutable deployable MCP source checkout");
  }

  if (includeCompat) {
    verifyJwtIsFalse(config, "mcp", problems);
    const compatSource = await load("supabase/functions/mcp/index.ts", deploymentRoot);
    const canonicalCompatSource = await load("src/lib/mcp/index.ts", deploymentRoot);
    rejectEmbeddedProject("src/lib/mcp/index.ts", canonicalCompatSource, problems);
    if (!compatSource.startsWith("// AUTO-GENERATED by @lovable.dev/mcp-js")) {
      problems.push("supabase/functions/mcp/index.ts must remain a generated build artifact");
    }
    const targetProjectRef = process.env.SUPABASE_PROJECT_ID ?? "";
    if (targetProjectRef) {
      const embeddedRefs = [...new Set(compatSource.match(SUPABASE_PROJECT_REF) ?? [])];
      const unexpectedRefs = embeddedRefs.filter((projectRef) => projectRef !== targetProjectRef);
      if (unexpectedRefs.length > 0) {
        problems.push("generated /mcp artifact targets a different Supabase project");
      }
    }
    checked.push("optional generated /mcp compatibility endpoint");
  }

  return {
    ok: problems.length === 0,
    includeCompat,
    sourceOnly,
    rollbackSource,
    sourceRoot: deploymentRoot,
    checked,
    problems,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) return selfTest();

  const result = await verifyRepository(options);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else if (result.ok) {
    console.log(`MCP portability checks passed (${result.checked.length} groups)`);
    for (const check of result.checked) console.log(`- ${check}`);
  } else {
    console.error(`MCP portability checks failed (${result.problems.length})`);
    for (const problem of result.problems) console.error(`- ${problem}`);
  }

  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`MCP portability verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
