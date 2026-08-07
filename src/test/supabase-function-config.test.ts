import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = readFileSync("supabase/config.toml", "utf8");
const functionDirectories = readdirSync("supabase/functions", {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory() && entry.name !== "_shared")
  .map((entry) => entry.name)
  .sort();

function configuredFunctions(): string[] {
  return [...config.matchAll(/^\s*\[functions\.([^\]]+)\]\s*$/gm)]
    .map((match) => match[1])
    .sort();
}

describe("Supabase Edge Function deployment inventory", () => {
  it("declares an explicit JWT gateway policy for every function", () => {
    expect(configuredFunctions()).toEqual(functionDirectories);

    for (const functionName of functionDirectories) {
      const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const block = config.match(
        new RegExp(
          `\\[functions\\.${escaped}\\]([\\s\\S]*?)(?=\\n\\s*\\[functions\\.|$)`,
        ),
      )?.[1];
      expect(block, `${functionName} must have a config block`).toMatch(
        /verify_jwt\s*=\s*(?:true|false)/,
      );
    }
  });

  it("keeps local project identity portable and MCP gateway auth explicit", () => {
    expect(config).toContain('project_id = "aceleriq-os"');
    expect(config).not.toMatch(/project_id\s*=\s*"[a-z0-9]{20}"/i);

    for (const endpoint of ["mcp", "mcp-server", "mcp-oauth-metadata"]) {
      expect(config).toMatch(
        new RegExp(`\\[functions\\.${endpoint}\\]\\s+verify_jwt\\s*=\\s*false`),
      );
    }
  });
});
