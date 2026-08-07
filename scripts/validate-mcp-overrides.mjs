#!/usr/bin/env node

import assert from "node:assert/strict";

export const MCP_URL_OVERRIDE_NAMES = [
  "MCP_RESOURCE_URL",
  "MCP_OAUTH_METADATA_URL",
  "MCP_AUTH_ISSUER",
  "APP_PUBLIC_URL",
];

export const MCP_OVERRIDE_NAMES = [
  ...MCP_URL_OVERRIDE_NAMES,
  "MCP_ALLOWED_ORIGINS",
];

function securePublicUrl(name, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }

  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(`${name} must use HTTPS outside loopback hosts`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must not contain credentials, query, or fragment`);
  }
  return url;
}

export function validateMcpOverrides(env = process.env) {
  if (!(env.APP_PUBLIC_URL ?? "").trim()) {
    throw new Error("APP_PUBLIC_URL is required for a portable MCP release");
  }
  const defined = [];
  for (const name of MCP_URL_OVERRIDE_NAMES) {
    const value = (env[name] ?? "").trim();
    if (!value) continue;
    const url = securePublicUrl(name, value);
    if (name === "APP_PUBLIC_URL" && (url.pathname !== "/" || value.endsWith("/"))) {
      throw new Error("APP_PUBLIC_URL must contain only an origin without a path or trailing slash");
    }
    defined.push(name);
  }

  const allowedOrigins = (env.MCP_ALLOWED_ORIGINS ?? "").trim();
  if (allowedOrigins) {
    for (const entry of allowedOrigins.split(",")) {
      const value = entry.trim();
      if (!value || value === "*") {
        throw new Error("MCP_ALLOWED_ORIGINS must contain exact origins");
      }
      const url = securePublicUrl("MCP_ALLOWED_ORIGINS", value);
      if (url.origin !== value && `${url.origin}/` !== value) {
        throw new Error("MCP_ALLOWED_ORIGINS entries must not contain paths");
      }
    }
    defined.push("MCP_ALLOWED_ORIGINS");
  }

  return Object.freeze({ defined });
}

function selfTest() {
  assert.throws(
    () => validateMcpOverrides({}),
    /APP_PUBLIC_URL is required/,
  );
  assert.deepEqual(validateMcpOverrides({
    MCP_RESOURCE_URL: "https://mcp.example.com/transport",
    MCP_OAUTH_METADATA_URL: "https://mcp.example.com/oauth/metadata",
    MCP_AUTH_ISSUER: "https://auth.example.com",
    APP_PUBLIC_URL: "https://app.example.com",
    MCP_ALLOWED_ORIGINS: "https://chatgpt.com, https://admin.example.com/",
  }).defined, MCP_OVERRIDE_NAMES);
  assert.throws(
    () => validateMcpOverrides({
      APP_PUBLIC_URL: "https://app.example.com",
      MCP_RESOURCE_URL: "http://mcp.example.com",
    }),
    /must use HTTPS/,
  );
  assert.throws(
    () => validateMcpOverrides({
      APP_PUBLIC_URL: "https://app.example.com",
      MCP_ALLOWED_ORIGINS: "*",
    }),
    /exact origins/,
  );
  assert.throws(
    () => validateMcpOverrides({
      APP_PUBLIC_URL: "https://app.example.com",
      MCP_ALLOWED_ORIGINS: "https://example.com/path",
    }),
    /must not contain paths/,
  );
  for (const APP_PUBLIC_URL of [
    "https://app.example.com/",
    "https://app.example.com/aceleriq",
  ]) {
    assert.throws(
      () => validateMcpOverrides({ APP_PUBLIC_URL }),
      /only an origin/,
    );
  }
  console.log("MCP override validator self-test passed");
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--self-test") return selfTest();
  if (args.length > 0) throw new Error(`Unknown argument: ${args[0]}`);
  const result = validateMcpOverrides();
  console.log(JSON.stringify({ ok: true, ...result }));
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    main();
  } catch (error) {
    console.error(`MCP override validation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
