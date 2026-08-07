import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";
import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(__dirname, "../..");
const compatibilityManifest = JSON.parse(readFileSync(
  path.resolve(repositoryRoot, ".lovable/mcp/manifest.json"),
  "utf8",
)) as { auth?: { issuer?: string } };
const compatibilityIssuer = new URL(compatibilityManifest.auth?.issuer || "");
if (!compatibilityIssuer.hostname.endsWith(".supabase.co")) {
  throw new Error("Lovable MCP compatibility manifest has an invalid issuer");
}
const compatibilityProjectRef = compatibilityIssuer.hostname.split(".")[0];
const compatibilitySupabaseUrl = compatibilityIssuer.origin;

// The compatibility package deliberately derives its target from the tracked
// legacy manifest. Do not duplicate the production project reference here.
process.env.VITE_SUPABASE_PROJECT_ID = compatibilityProjectRef;
process.env.VITE_SUPABASE_URL = compatibilitySupabaseUrl;

// This config is intentionally separate from the canonical frontend build.
// It only regenerates the versioned legacy /functions/v1/mcp artifact when
// an operator explicitly runs this package's `generate` script.
export default defineConfig({
  root: repositoryRoot,
  plugins: [mcpPlugin()],
  define: {
    "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify(compatibilityProjectRef),
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(compatibilitySupabaseUrl),
  },
  build: {
    write: false,
    rollupOptions: {
      input: path.resolve(__dirname, "noop.html"),
    },
  },
});
