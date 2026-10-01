import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Prévia pelo túnel (cloudflared): o worker liga MOTOR_TUNEL=1 e o HMR passa pela porta 443.
const tunel = process.env.MOTOR_TUNEL === "1";

/**
 * Ponte da prévia editável da Mesa Site (casca v5): SÓ no servidor de
 * desenvolvimento (a prévia do motor). O worker grava .aceleriq/ponte.js a
 * cada pacote; aqui ele é servido em /__aq/ponte.js e entra no fim do body.
 * O build do site (o que vai ao ar) não leva nada disso.
 */
function ponteDaPrevia(): Plugin {
  const arquivo = resolve(process.cwd(), ".aceleriq", "ponte.js");
  return {
    name: "aceleriq-ponte-da-previa",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__aq/ponte.js", (_req, res) => {
        res.setHeader("Content-Type", "text/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(existsSync(arquivo) ? readFileSync(arquivo, "utf8") : "");
      });
    },
    transformIndexHtml() {
      return [{ tag: "script", attrs: { src: "/__aq/ponte.js", defer: true }, injectTo: "body" }];
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), ponteDaPrevia()],
  server: {
    host: "127.0.0.1",
    strictPort: true,
    allowedHosts: [".trycloudflare.com", ".cfargotunnel.com", "localhost", "127.0.0.1"],
    hmr: tunel ? { clientPort: 443, protocol: "wss" } : undefined,
  },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
});
