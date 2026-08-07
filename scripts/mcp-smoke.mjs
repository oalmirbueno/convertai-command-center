#!/usr/bin/env node

import assert from "node:assert/strict";
import { createServer } from "node:http";

const DEFAULT_TIMEOUT_MS = 15_000;
const EXPECTED_SMOKE_KEY_NAME = "github-actions-mcp-smoke";
const EXPECTED_SMOKE_ORIGIN = "github-actions-smoke";
const EXPECTED_SMOKE_SCOPES = ["clients:read"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JSON_HEADERS = {
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
  "mcp-protocol-version": "2025-06-18",
};

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.MCP_BASE_URL ?? "",
    projectRef: process.env.SUPABASE_PROJECT_ID ?? "",
    resourceUrl: process.env.MCP_RESOURCE_URL ?? "",
    metadataUrl: process.env.MCP_OAUTH_METADATA_URL ?? "",
    authIssuer: process.env.MCP_AUTH_ISSUER ?? "",
    smokeToken: process.env.MCP_SMOKE_TOKEN ?? "",
    expectedKeyId: (process.env.MCP_SMOKE_EXPECTED_KEY_ID ?? "").trim(),
    expectedClientId: (process.env.MCP_SMOKE_EXPECTED_CLIENT_ID ?? "").trim(),
    expectedPublicUrl: (process.env.MCP_SMOKE_EXPECTED_PUBLIC_URL ?? "").trim(),
    requireAuthenticated: process.env.MCP_SMOKE_REQUIRE_AUTHENTICATED === "true",
    discoverRuntimeConfig: process.env.MCP_SMOKE_DISCOVER_RUNTIME_CONFIG === "true",
    operation: process.env.MCP_DEPLOY_OPERATION ?? "verification",
    includeCompat: process.env.MCP_SMOKE_COMPAT === "true",
    selfTest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--include-compat") options.includeCompat = true;
    else if (arg === "--require-authenticated") options.requireAuthenticated = true;
    else if (arg === "--discover-runtime-config") options.discoverRuntimeConfig = true;
    else if (arg === "--self-test") options.selfTest = true;
    else if (arg === "--base-url") options.baseUrl = argv[++index] ?? "";
    else if (arg === "--project-ref") options.projectRef = argv[++index] ?? "";
    else if (arg === "--resource-url") options.resourceUrl = argv[++index] ?? "";
    else if (arg === "--metadata-url") options.metadataUrl = argv[++index] ?? "";
    else if (arg === "--auth-issuer") options.authIssuer = argv[++index] ?? "";
    else if (arg === "--expected-public-url") options.expectedPublicUrl = argv[++index] ?? "";
    else if (arg === "--operation") options.operation = argv[++index] ?? "";
    else if (arg === "--help") {
      console.log(`Usage: node scripts/mcp-smoke.mjs [options]

Options:
  --base-url <url>       Supabase project URL (or set MCP_BASE_URL)
  --project-ref <ref>    Supabase project ref (or set SUPABASE_PROJECT_ID)
  --resource-url <url>   Public canonical MCP URL (or set MCP_RESOURCE_URL)
  --metadata-url <url>   Public OAuth metadata URL (or set MCP_OAUTH_METADATA_URL)
  --auth-issuer <url>    Expected OAuth issuer (or set MCP_AUTH_ISSUER)
  --expected-public-url <url> Expected APP_PUBLIC_URL in resource_documentation
  --operation <name>     release, rollback, or verification
  --require-authenticated Require MCP_SMOKE_TOKEN, MCP_SMOKE_EXPECTED_KEY_ID,
                          and MCP_SMOKE_EXPECTED_CLIENT_ID; validate the
                          dedicated key and its single-client read boundary
  --discover-runtime-config Discover the currently effective metadata/resource
                          endpoints from the native server challenge. Intended
                          for the pre-reconciliation candidate smoke only.
  --include-compat       Also validate the optional /mcp compatibility endpoint
  --self-test            Run against an in-process mock server
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function normalizePublicUrl(candidate, label, allowHttp = false) {
  assert(candidate, `${label} is required`);
  const url = new URL(candidate);
  const isLoopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  assert(
    url.protocol === "https:" || (allowHttp && isLoopback),
    `${label} must use HTTPS (HTTP is accepted only for loopback self-tests)`,
  );
  assert(!url.username && !url.password, `${label} must not contain credentials`);
  assert(!url.search && !url.hash, `${label} must not contain query parameters or fragments`);

  return url.toString().replace(/\/$/, "");
}

function resolveEndpoints({
  baseUrl,
  projectRef,
  resourceUrl,
  metadataUrl,
  authIssuer,
  discoverRuntimeConfig = false,
  operation = "verification",
  includeCompat = false,
  allowHttp = false,
}) {
  assert(
    ["release", "rollback", "verification"].includes(operation),
    "operation must be release, rollback, or verification",
  );
  if (projectRef) {
    assert.match(
      projectRef,
      /^[a-z0-9]{20}$/,
      "SUPABASE_PROJECT_ID must be a 20-character lowercase project ref",
    );
  }

  const baseCandidate = baseUrl || (projectRef ? `https://${projectRef}.supabase.co` : "");
  const resolvedBaseUrl = baseCandidate
    ? normalizePublicUrl(baseCandidate, "MCP_BASE_URL", allowHttp)
    : "";
  const resolvedResourceUrl = normalizePublicUrl(
    resourceUrl || (resolvedBaseUrl ? `${resolvedBaseUrl}/functions/v1/mcp-server` : ""),
    "MCP_RESOURCE_URL",
    allowHttp,
  );
  const resolvedMetadataUrl = normalizePublicUrl(
    metadataUrl || (resolvedBaseUrl ? `${resolvedBaseUrl}/functions/v1/mcp-oauth-metadata` : ""),
    "MCP_OAUTH_METADATA_URL",
    allowHttp,
  );
  const authIssuerCandidate = authIssuer || (
    !discoverRuntimeConfig
      ? projectRef
        ? `https://${projectRef}.supabase.co/auth/v1`
        : resolvedBaseUrl
          ? `${resolvedBaseUrl}/auth/v1`
          : ""
      : ""
  );
  const resolvedAuthIssuer = authIssuerCandidate
    ? normalizePublicUrl(authIssuerCandidate, "MCP_AUTH_ISSUER", allowHttp)
    : "";

  if (includeCompat) {
    assert(resolvedBaseUrl, "MCP_BASE_URL is required when --include-compat is enabled");
  }

  return {
    operation,
    baseUrl: resolvedBaseUrl || new URL(resolvedResourceUrl).origin,
    resourceUrl: resolvedResourceUrl,
    metadataUrl: resolvedMetadataUrl,
    authIssuer: resolvedAuthIssuer,
  };
}

async function request(url, options = {}) {
  const timeoutMs = Number(process.env.MCP_SMOKE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
    ...options,
  });
  const text = await response.text();
  let body = null;

  if (text) {
    try {
      if ((response.headers.get("content-type") ?? "").includes("text/event-stream")) {
        const payloads = text
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .filter((line) => line && line !== "[DONE]");
        assert(payloads.length > 0, `${options.method ?? "GET"} ${url} returned an empty SSE response`);
        body = JSON.parse(payloads.at(-1));
      } else {
        body = JSON.parse(text);
      }
    } catch {
      throw new Error(`${options.method ?? "GET"} ${url} returned non-JSON (${response.status})`);
    }
  }

  return { response, body };
}

async function rpc(url, method, params = undefined, token = "") {
  const headers = { ...JSON_HEADERS };
  if (token) headers.authorization = `Bearer ${token}`;

  return request(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `${method}-smoke`,
      method,
      ...(params === undefined ? {} : { params }),
    }),
  });
}

function rpcResult(body, method) {
  assert.equal(body?.jsonrpc, "2.0", `${method} must return JSON-RPC 2.0`);
  assert(!body?.error, `${method} returned JSON-RPC error: ${body?.error?.message ?? "unknown"}`);
  assert(body?.result, `${method} did not return a result`);
  return body.result;
}

function authenticatedRpcResult(body, method) {
  assert.equal(body?.jsonrpc, "2.0", `${method} must return JSON-RPC 2.0`);
  assert(!body?.error, `${method} returned a JSON-RPC error`);
  assert(body?.result, `${method} did not return a result`);
  return body.result;
}

function assertExactSmokeScopes(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  assert.equal(value.length, EXPECTED_SMOKE_SCOPES.length, `${label} must contain exactly clients:read`);
  assert.equal(value[0], EXPECTED_SMOKE_SCOPES[0], `${label} must contain exactly clients:read`);
}

function validateAuthenticatedHealth(health, expectedKeyId) {
  assert(health && typeof health === "object", "Authenticated health must return structured content");
  assert(health.key && typeof health.key === "object", "Authenticated health must identify the smoke key");
  assert(health.key.id === expectedKeyId, "Authenticated health returned an unexpected key id");
  assert.equal(health.key.name, EXPECTED_SMOKE_KEY_NAME, "Authenticated health returned an unexpected key name");
  assert.equal(health.key.origin, EXPECTED_SMOKE_ORIGIN, "Authenticated health returned an unexpected key origin");
  for (const field of ["rawGrantedScopes", "consentedScopes", "scopes"]) {
    assertExactSmokeScopes(health[field], `Authenticated health ${field}`);
  }
}

function validateAuthenticatedClientList(clientList, expectedClientId) {
  assert(clientList && typeof clientList === "object", "Authenticated client read must return structured content");
  assert(Array.isArray(clientList.items), "Authenticated client read must return an items array");
  assert.equal(clientList.items.length, 1, "Authenticated client read must return exactly one client");
  assert(clientList.items[0]?.id === expectedClientId, "Authenticated client read returned an unexpected client");
  assert.equal(clientList.total, 1, "Authenticated client read must report exactly one visible client");
  assert.equal(clientList.limit, 2, "Authenticated client read must preserve the requested limit");
  assert.equal(clientList.offset, 0, "Authenticated client read must preserve the requested offset");
}

async function smokePortable({
  resourceUrl: serverUrl,
  metadataUrl,
  authIssuer,
  smokeToken = "",
  expectedKeyId = "",
  expectedClientId = "",
  expectedPublicUrl = "",
  requireAuthenticated = false,
  discoverRuntimeConfig = false,
  allowHttp = false,
}) {

  const challenge = await request(serverUrl);
  assert.equal(challenge.response.status, 401, "GET /mcp-server without a token must return 401");
  const authenticate = challenge.response.headers.get("www-authenticate") ?? "";
  assert.match(authenticate, /^Bearer\b/i, "Missing Bearer WWW-Authenticate challenge");
  assert.match(authenticate, /resource_metadata=/i, "Challenge must advertise protected resource metadata");
  const advertisedMetadataMatch = authenticate.match(/\bresource_metadata=(?:"([^"]+)"|([^,\s]+))/i);
  assert(advertisedMetadataMatch, "Challenge resource_metadata is not a valid URL parameter");
  const advertisedMetadataUrl = normalizePublicUrl(
    advertisedMetadataMatch[1] ?? advertisedMetadataMatch[2] ?? "",
    "Challenge resource_metadata",
    allowHttp,
  );
  if (!discoverRuntimeConfig) {
    assert(
      advertisedMetadataUrl === metadataUrl,
      "Challenge resource_metadata does not match the configured public metadata URL",
    );
  }
  const runtimeMetadataUrl = discoverRuntimeConfig ? advertisedMetadataUrl : metadataUrl;

  const metadata = await request(runtimeMetadataUrl, { headers: { accept: "application/json" } });
  assert.equal(metadata.response.status, 200, "Protected resource metadata must return 200");
  const runtimeResourceUrl = normalizePublicUrl(
    metadata.body?.resource ?? "",
    "Metadata resource URL",
    allowHttp,
  );
  if (!discoverRuntimeConfig) {
    assert.equal(runtimeResourceUrl, serverUrl, "Metadata resource URL does not match MCP server URL");
  }
  assert(Array.isArray(metadata.body?.authorization_servers), "Metadata must list authorization_servers");
  assert(metadata.body.authorization_servers.length > 0, "Metadata authorization_servers cannot be empty");
  const runtimeAuthorizationServers = metadata.body.authorization_servers.map((value) =>
    normalizePublicUrl(value, "Metadata authorization server", allowHttp)
  );
  if (authIssuer) {
    assert(
      runtimeAuthorizationServers.includes(authIssuer),
      "Metadata authorization_servers does not include MCP_AUTH_ISSUER",
    );
  }
  if (expectedPublicUrl) {
    assert.equal(
      metadata.body?.resource_documentation,
      `${expectedPublicUrl}/conectar-mcp`,
      "Metadata resource_documentation does not match APP_PUBLIC_URL",
    );
  }
  assert(Array.isArray(metadata.body?.scopes_supported), "Metadata must list OAuth scopes");
  assert(
    metadata.body.scopes_supported.every((scope) => !String(scope).includes(":")),
    "Internal application permissions must not be advertised as OAuth scopes",
  );

  const initialize = await rpc(serverUrl, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "aceleriq-mcp-smoke", version: "1.0.0" },
  });
  assert.equal(initialize.response.status, 200, "initialize must return HTTP 200");
  const initialized = rpcResult(initialize.body, "initialize");
  assert.equal(initialized.protocolVersion, "2025-06-18", "Unexpected MCP protocol version");
  assert(initialized.serverInfo?.version, "initialize must expose serverInfo.version");

  const toolsResponse = await rpc(serverUrl, "tools/list", {});
  assert.equal(toolsResponse.response.status, 200, "tools/list must return HTTP 200");
  const tools = rpcResult(toolsResponse.body, "tools/list").tools;
  assert(Array.isArray(tools) && tools.length > 0, "tools/list must return at least one tool");
  assert(
    tools.some((tool) => tool?.name === "aceleriq_list_clients"),
    "Protected smoke-test tool aceleriq_list_clients is missing",
  );

  const protectedCall = await rpc(serverUrl, "tools/call", {
    name: "aceleriq_list_clients",
    arguments: {},
  });
  assert.equal(protectedCall.response.status, 200, "Unauthenticated tools/call must use a successful MCP transport response");
  const protectedResult = rpcResult(protectedCall.body, "tools/call");
  assert.equal(protectedResult.isError, true, "Protected tools/call must be marked as an MCP tool error");
  const toolChallenge = protectedResult?._meta?.["mcp/www_authenticate"];
  assert(Array.isArray(toolChallenge) && toolChallenge.length > 0, "Missing mcp/www_authenticate tool challenge");

  if (requireAuthenticated || smokeToken) {
    assert(smokeToken, "MCP_SMOKE_TOKEN is required for an authenticated deployment smoke");
    assert(expectedKeyId, "MCP_SMOKE_EXPECTED_KEY_ID is required for an authenticated deployment smoke");
    assert(expectedClientId, "MCP_SMOKE_EXPECTED_CLIENT_ID is required for an authenticated deployment smoke");
    assert.match(expectedKeyId, UUID, "MCP_SMOKE_EXPECTED_KEY_ID must be a UUID");
    assert.match(expectedClientId, UUID, "MCP_SMOKE_EXPECTED_CLIENT_ID must be a UUID");
  }
  let authenticated = null;
  if (smokeToken) {
    const healthCall = await rpc(serverUrl, "tools/call", {
      name: "aceleriq_health",
      arguments: {},
    }, smokeToken);
    assert.equal(healthCall.response.status, 200, "Authenticated health smoke must return HTTP 200");
    const healthResult = authenticatedRpcResult(healthCall.body, "authenticated health");
    assert.notEqual(healthResult.isError, true, "Authenticated health smoke returned an MCP tool error");
    validateAuthenticatedHealth(healthResult.structuredContent, expectedKeyId);

    const clientCall = await rpc(serverUrl, "tools/call", {
      name: "aceleriq_list_clients",
      arguments: { limit: 2, offset: 0 },
    }, smokeToken);
    assert.equal(
      clientCall.response.status,
      200,
      "Authenticated read smoke must return HTTP 200",
    );
    const clientResult = authenticatedRpcResult(clientCall.body, "authenticated client read");
    assert.notEqual(clientResult.isError, true, "Authenticated read smoke returned an MCP tool error");
    validateAuthenticatedClientList(clientResult.structuredContent, expectedClientId);
    authenticated = {
      verified: true,
      healthTool: "aceleriq_health",
      readTool: "aceleriq_list_clients",
      visibleClients: 1,
    };
  }

  return {
    endpoint: serverUrl,
    runtimeConfig: {
      resource: runtimeResourceUrl,
      oauthMetadata: runtimeMetadataUrl,
      authIssuer: authIssuer || runtimeAuthorizationServers[0],
    },
    version: initialized.serverInfo.version,
    protocol: initialized.protocolVersion,
    tools: tools.length,
    authenticated,
  };
}

async function smokeCompat(baseUrl) {
  const compatUrl = `${baseUrl}/functions/v1/mcp`;
  const initialize = await rpc(compatUrl, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "aceleriq-mcp-smoke", version: "1.0.0" },
  });
  assert.equal(initialize.response.status, 200, "Compatibility MCP initialize must return HTTP 200");
  const initialized = rpcResult(initialize.body, "compat initialize");
  assert(initialized.serverInfo?.version, "Compatibility MCP must expose serverInfo.version");

  const toolsResponse = await rpc(compatUrl, "tools/list", {});
  assert.equal(toolsResponse.response.status, 200, "Compatibility MCP tools/list must return HTTP 200");
  const tools = rpcResult(toolsResponse.body, "compat tools/list").tools;
  assert(Array.isArray(tools) && tools.length >= 8, "Compatibility MCP must expose the expected tool catalog");
  assert(tools.some((tool) => tool?.name === "health"), "Compatibility MCP health tool is missing");

  return {
    endpoint: compatUrl,
    version: initialized.serverInfo.version,
    tools: tools.length,
  };
}

export async function runSmoke(options) {
  const endpoints = resolveEndpoints(options.discoverRuntimeConfig
    ? { ...options, resourceUrl: "", metadataUrl: "", authIssuer: "" }
    : options);
  const expectedPublicUrl = options.expectedPublicUrl
    ? normalizePublicUrl(
      options.expectedPublicUrl,
      "MCP_SMOKE_EXPECTED_PUBLIC_URL",
      options.allowHttp,
    )
    : "";
  const portable = await smokePortable({
    ...endpoints,
    smokeToken: options.smokeToken,
    expectedKeyId: options.expectedKeyId,
    expectedClientId: options.expectedClientId,
    expectedPublicUrl,
    requireAuthenticated: options.requireAuthenticated,
    discoverRuntimeConfig: options.discoverRuntimeConfig,
    allowHttp: options.allowHttp,
  });
  const compat = options.includeCompat ? await smokeCompat(endpoints.baseUrl) : null;
  return {
    operation: endpoints.operation,
    baseUrl: endpoints.baseUrl,
    publicEndpoints: {
      resource: portable.runtimeConfig.resource,
      oauthMetadata: portable.runtimeConfig.oauthMetadata,
      authIssuer: portable.runtimeConfig.authIssuer || null,
    },
    portable,
    compat,
  };
}

export function publicSmokeSummary(result) {
  return {
    ok: true,
    operation: result.operation,
    version: result.portable.version,
    protocol: result.portable.protocol,
    authenticated: result.portable.authenticated?.verified === true,
    compatibilityChecked: result.compat !== null,
  };
}

function json(response, body, status = 200, extraHeaders = {}) {
  response.writeHead(status, { "content-type": "application/json", ...extraHeaders });
  response.end(JSON.stringify(body));
}

async function runSelfTest() {
  const nativeIssuerFallback = resolveEndpoints({
    baseUrl: "https://mcp-proxy.example.com",
    projectRef: "abcdefghijklmnopqrst",
    resourceUrl: "",
    metadataUrl: "",
    authIssuer: "",
  });
  assert.equal(
    nativeIssuerFallback.authIssuer,
    "https://abcdefghijklmnopqrst.supabase.co/auth/v1",
    "An empty issuer override must fall back to the native Supabase Auth issuer",
  );

  let baseUrl = "";
  const expectedKeyId = "11111111-1111-4111-8111-111111111111";
  const expectedClientId = "22222222-2222-4222-8222-222222222222";
  const authenticatedCalls = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", baseUrl);
    const portableUrl = `${baseUrl}/functions/v1/mcp-server`;

    if (url.pathname === "/functions/v1/mcp-oauth-metadata") {
      return json(res, {
        resource: portableUrl,
        authorization_servers: [`${baseUrl}/auth/v1`],
        scopes_supported: ["openid", "email", "profile"],
        resource_documentation: `${baseUrl}/conectar-mcp`,
      });
    }

    if (url.pathname === "/functions/v1/mcp-server" && req.method === "GET") {
      return json(
        res,
        { error: "unauthorized" },
        401,
        { "www-authenticate": `Bearer resource_metadata="${baseUrl}/functions/v1/mcp-oauth-metadata"` },
      );
    }

    if (!["/functions/v1/mcp-server", "/functions/v1/mcp"].includes(url.pathname)) {
      return json(res, { error: "not_found" }, 404);
    }

    let raw = "";
    for await (const chunk of req) raw += chunk;
    const message = JSON.parse(raw);
    if (message.method === "initialize") {
      return json(res, {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "mock", version: url.pathname.endsWith("/mcp") ? "1.1.0" : "1.8.1" },
        },
      });
    }
    if (message.method === "tools/list") {
      const names = url.pathname.endsWith("/mcp")
        ? ["health", "list_clients", "list_projects", "list_tasks", "list_contracts", "create_task", "list_editorial_calendar", "create_editorial_item"]
        : ["aceleriq_health", "aceleriq_list_clients"];
      return json(res, {
        jsonrpc: "2.0",
        id: message.id,
        result: { tools: names.map((name) => ({ name, inputSchema: { type: "object" } })) },
      });
    }
    if (
      message.method === "tools/call"
      && message.params?.name === "aceleriq_health"
      && req.headers.authorization === "Bearer self-test-token"
    ) {
      authenticatedCalls.push({ name: message.params.name, arguments: message.params.arguments });
      return json(res, {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: "authenticated health" }],
          structuredContent: {
            key: {
              id: expectedKeyId,
              name: EXPECTED_SMOKE_KEY_NAME,
              origin: EXPECTED_SMOKE_ORIGIN,
            },
            rawGrantedScopes: [...EXPECTED_SMOKE_SCOPES],
            consentedScopes: [...EXPECTED_SMOKE_SCOPES],
            scopes: [...EXPECTED_SMOKE_SCOPES],
          },
        },
      });
    }
    if (
      message.method === "tools/call"
      && message.params?.name === "aceleriq_list_clients"
      && req.headers.authorization === "Bearer self-test-token"
    ) {
      authenticatedCalls.push({ name: message.params.name, arguments: message.params.arguments });
      return json(res, {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: "authenticated client list" }],
          structuredContent: {
            items: [{ id: expectedClientId }],
            total: 1,
            limit: 2,
            offset: 0,
            has_more: false,
            next_offset: null,
          },
        },
      });
    }
    return json(res, {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [{ type: "text", text: "Authentication required" }],
        isError: true,
        _meta: { "mcp/www_authenticate": ["Bearer resource_metadata=mock"] },
      },
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const result = await runSmoke({
      baseUrl,
      projectRef: "",
      resourceUrl: `${baseUrl}/functions/v1/mcp-server`,
      metadataUrl: `${baseUrl}/functions/v1/mcp-oauth-metadata`,
      authIssuer: `${baseUrl}/auth/v1`,
      smokeToken: "self-test-token",
      expectedKeyId,
      expectedClientId,
      expectedPublicUrl: baseUrl,
      requireAuthenticated: true,
      operation: "rollback",
      includeCompat: true,
      allowHttp: true,
    });
    assert.equal(result.operation, "rollback");
    assert.equal(result.publicEndpoints.resource, `${baseUrl}/functions/v1/mcp-server`);
    assert.equal(result.publicEndpoints.oauthMetadata, `${baseUrl}/functions/v1/mcp-oauth-metadata`);
    assert.equal(result.publicEndpoints.authIssuer, `${baseUrl}/auth/v1`);
    assert.equal(result.portable.version, "1.8.1");
    assert.equal(result.portable.authenticated?.verified, true);
    assert.equal(result.portable.authenticated?.healthTool, "aceleriq_health");
    assert.equal(result.portable.authenticated?.readTool, "aceleriq_list_clients");
    assert.equal(result.portable.authenticated?.visibleClients, 1);
    assert.deepEqual(authenticatedCalls, [
      { name: "aceleriq_health", arguments: {} },
      { name: "aceleriq_list_clients", arguments: { limit: 2, offset: 0 } },
    ]);
    assert.equal(result.compat?.tools, 8);
    const publicSummary = publicSmokeSummary(result);
    assert.deepEqual(publicSummary, {
      ok: true,
      operation: "rollback",
      version: "1.8.1",
      protocol: "2025-06-18",
      authenticated: true,
      compatibilityChecked: true,
    });
    const publicOutput = JSON.stringify(publicSummary);
    assert(!publicOutput.includes(baseUrl), "Public smoke output must redact deployment URLs");
    assert(!publicOutput.includes(expectedKeyId), "Public smoke output must redact key identifiers");
    assert(!publicOutput.includes(expectedClientId), "Public smoke output must redact client identifiers");

    const discovered = await runSmoke({
      baseUrl,
      resourceUrl: "https://desired.invalid/functions/v1/mcp-server",
      metadataUrl: "https://desired.invalid/functions/v1/mcp-oauth-metadata",
      authIssuer: "https://desired.invalid/auth/v1",
      discoverRuntimeConfig: true,
      operation: "release",
      includeCompat: false,
      allowHttp: true,
    });
    assert.equal(discovered.publicEndpoints.resource, `${baseUrl}/functions/v1/mcp-server`);
    assert.equal(discovered.publicEndpoints.oauthMetadata, `${baseUrl}/functions/v1/mcp-oauth-metadata`);
    assert.equal(discovered.publicEndpoints.authIssuer, `${baseUrl}/auth/v1`);

    const validHealth = {
      key: { id: expectedKeyId, name: EXPECTED_SMOKE_KEY_NAME, origin: EXPECTED_SMOKE_ORIGIN },
      rawGrantedScopes: [...EXPECTED_SMOKE_SCOPES],
      consentedScopes: [...EXPECTED_SMOKE_SCOPES],
      scopes: [...EXPECTED_SMOKE_SCOPES],
    };
    assert.throws(
      () => validateAuthenticatedHealth({ ...validHealth, scopes: ["clients:read", "projects:read"] }, expectedKeyId),
      /exactly clients:read/,
    );
    assert.throws(
      () => validateAuthenticatedHealth({ ...validHealth, key: { ...validHealth.key, origin: "unexpected" } }, expectedKeyId),
      /unexpected key origin/,
    );
    assert.throws(
      () => validateAuthenticatedHealth({ ...validHealth, key: { ...validHealth.key, id: expectedClientId } }, expectedKeyId),
      (error) => {
        assert.match(error.message, /unexpected key id/);
        assert(!error.message.includes(expectedKeyId), "Key mismatch errors must not expose the expected key id");
        assert(!error.message.includes(expectedClientId), "Key mismatch errors must not expose the actual key id");
        return true;
      },
    );
    assert.throws(
      () => validateAuthenticatedClientList({ items: [], total: 0, limit: 2, offset: 0 }, expectedClientId),
      /exactly one client/,
    );
    assert.throws(
      () => validateAuthenticatedClientList({
        items: [{ id: expectedKeyId }],
        total: 1,
        limit: 2,
        offset: 0,
      }, expectedClientId),
      (error) => {
        assert.match(error.message, /unexpected client/);
        assert(!error.message.includes(expectedClientId), "Client mismatch errors must not expose the expected client id");
        assert(!error.message.includes(expectedKeyId), "Client mismatch errors must not expose the actual client id");
        return true;
      },
    );
    await assert.rejects(
      runSmoke({
        baseUrl,
        operation: "unsupported",
        includeCompat: false,
        allowHttp: true,
      }),
      /operation must be release, rollback, or verification/,
    );
    console.log("MCP smoke self-test passed");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) return runSelfTest();

  const result = await runSmoke(options);
  console.log(JSON.stringify(publicSmokeSummary(result), null, 2));
}

main().catch((error) => {
  console.error(`MCP smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
