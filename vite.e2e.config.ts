import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { ciE2eEnvironment } from "./config/ci-e2e-environment";

// Same application and real auth client; only the disposable server's public
// connection configuration differs. Do not import vite.config.ts here: its
// production pin intentionally overrides all environment values for Lovable.
export default defineConfig(({ command, mode }) => {
  if (command !== "serve" || mode !== "e2e") {
    throw new Error("E2E configuration is only a CI development server.");
  }
  const publicEnv = ciE2eEnvironment(process.env);
  const emptyEnv = path.resolve(__dirname, "e2e/.empty-env");
  if (existsSync(emptyEnv) && readdirSync(emptyEnv).length > 0) {
    throw new Error("The E2E environment directory must remain empty.");
  }
  return {
    // Vite 5 expects a directory string. This untracked, empty test namespace
    // avoids loading the repository's .env files; public values are explicit.
    envDir: emptyEnv,
    envPrefix: "ACELERIQ_E2E_UNUSED_PUBLIC_",
    define: {
      __APP_BUILD_ID__: JSON.stringify("ci-e2e"),
      ...Object.fromEntries(Object.entries(publicEnv).map(([key, value]) => [
        `import.meta.env.${key}`, JSON.stringify(value),
      ])),
    },
    plugins: [react(), {
      name: "ci-e2e-local-fonts-only",
      // Functional authorization tests do not need external fonts. Remove only
      // the three known font links; unexpected network use still fails the
      // independent browser guard. Production HTML remains unchanged.
      transformIndexHtml: (html) => html.replace(
        /\s*<link\b[^>]*href=["']https:\/\/fonts\.(?:googleapis|gstatic)\.com(?:\/[^"']*)?["'][^>]*>/g,
        "",
      ),
    }],
    server: { host: "127.0.0.1", port: 4173, strictPort: true, hmr: false },
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "@tanstack/react-query"],
    },
  };
});
