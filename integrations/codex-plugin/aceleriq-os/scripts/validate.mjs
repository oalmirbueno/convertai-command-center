#!/usr/bin/env node
// Validador do plugin aceleriq-os.
// Verifica: JSON schemas locais, presença de skills/docs/examples e
// (opcional) handshake HTTP contra o MCP quando ACELERIQ_MCP_URL estiver setado.

import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const ok = (m) => console.log(`✔ ${m}`);
const fail = (m) => { errors.push(m); console.log(`✘ ${m}`); };

function readJson(rel) {
  const p = resolve(ROOT, rel);
  if (!existsSync(p)) { fail(`missing ${rel}`); return null; }
  try { return JSON.parse(readFileSync(p, "utf8")); }
  catch (e) { fail(`invalid JSON ${rel}: ${e.message}`); return null; }
}

// 1. plugin.json
const plugin = readJson(".codex-plugin/plugin.json");
if (plugin) {
  for (const k of ["name","version","mcp","skills","env"]) {
    if (!plugin[k]) fail(`plugin.json missing "${k}"`);
  }
  if (plugin?.name === "aceleriq-os") ok("plugin.json name");
  if (Array.isArray(plugin?.skills) && plugin.skills.length === 6) ok("6 skills declared");
  else fail(`expected 6 skills, got ${plugin?.skills?.length}`);
}

// 2. .mcp.json
const mcp = readJson(".mcp.json");
if (mcp?.mcpServers?.aceleriq?.url) ok(".mcp.json aceleriq server declared");
else fail(".mcp.json missing mcpServers.aceleriq.url");

// 3. skills exist
for (const s of plugin?.skills ?? []) {
  const p = resolve(ROOT, s.file);
  if (existsSync(p) && statSync(p).isFile()) ok(`skill ${s.id}`);
  else fail(`skill file missing: ${s.file}`);
}

// 4. docs
const docs = [
  "docs/chatgpt-work.md","docs/codex.md","docs/claude-code.md","docs/hermes.md",
  "docs/openclaw.md","docs/second-brain.md","docs/security.md","docs/tools-catalog.md","docs/adapters.md",
];
for (const d of docs) existsSync(resolve(ROOT,d)) ? ok(`doc ${d}`) : fail(`missing ${d}`);

// 5. examples
for (const e of ["01-health-check.md","02-client-dossier.md","03-create-task.md","04-report-draft.md","05-memory-proposal.md"]) {
  existsSync(resolve(ROOT,"examples",e)) ? ok(`example ${e}`) : fail(`missing example ${e}`);
}

// 6. .env.example must not carry a real token
const env = readFileSync(resolve(ROOT,".env.example"),"utf8");
if (/mcp_live_[A-Za-z0-9]{20,}/.test(env)) fail(".env.example contains what looks like a real token");
else ok(".env.example has no real token");

// 7. Optional live handshake — public discovery é sanitizado (sem lista de tools).
const url = process.env.ACELERIQ_MCP_URL;
if (url) {
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    const j = await r.json();
    if (j?.name && typeof j?.toolCount === "number" && j?.status === "ok") {
      ok(`live MCP reachable (${j.name} v${j.version}, ${j.toolCount} tools, secondBrain.configured=${j.secondBrain?.configured})`);
    } else {
      fail("live MCP responded but payload unexpected");
    }
  } catch (e) { fail(`live MCP fetch failed: ${e.message}`); }
} else {
  console.log("· skipping live handshake (ACELERIQ_MCP_URL not set)");
}

if (errors.length) {
  console.error(`\n${errors.length} problem(s).`);
  process.exit(1);
}
console.log("\nAll checks passed.");
