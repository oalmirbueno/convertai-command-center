import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { readFileSync } from "fs";
import { chunkPara, PISO_DE_TAMANHO } from "./config/chunk-strategy";

const PUBLIC_ENV_KEYS = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PROJECT_ID",
  "VITE_APP_PUBLIC_URL",
] as const;

// Fallback público e versionado: o ambiente de build de produção não recebe o
// arquivo .env local (ignorado pelo Git). Estes valores são públicos por design
// (URL do projeto e chave publishable); segredos continuam fora do repositório.
function loadPublicEnvDefaults(): Record<string, string> {
  try {
    const raw = readFileSync(
      path.resolve(__dirname, "config/public-env.production.json"),
      "utf8",
    ) as string;
    const parsed = JSON.parse(raw) as Record<string, string>;
    return Object.fromEntries(
      PUBLIC_ENV_KEYS.filter((key) => typeof parsed[key] === "string").map((key) => [
        key,
        parsed[key],
      ]),
    );
  } catch {
    return {};
  }
}


function requireProductionUrl(name: string, value: string | undefined): string {
  const configured = value?.trim();
  if (!configured) throw new Error(`${name} is required for a production build`);

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(`${name} must use HTTPS outside loopback development`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must not contain credentials, query, or fragment`);
  }
  if (name === "VITE_APP_PUBLIC_URL" && url.pathname !== "/") {
    throw new Error(`${name} must contain only an origin without a path`);
  }
  if (configured.endsWith("/")) {
    throw new Error(`${name} must not end with a slash`);
  }
  return configured;
}

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  const define: Record<string, string> = {};

  // Carimbo único por build: o app compara este id com /version.json publicado
  // e se atualiza sozinho quando sai versão nova (fim da tela branca em PWA).
  const buildId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  define["__APP_BUILD_ID__"] = JSON.stringify(command === "build" ? buildId : "dev");

  if (command === "build") {
    const fileEnv = loadEnv(mode, process.cwd(), "");
    const defaults = loadPublicEnvDefaults();
    const env: Record<string, string | undefined> = { ...defaults, ...fileEnv };

    for (const key of PUBLIC_ENV_KEYS) {
      if (!fileEnv[key]?.trim() && env[key]) {
        define[`import.meta.env.${key}`] = JSON.stringify(env[key]);
      }
    }

    requireProductionUrl("VITE_SUPABASE_URL", env.VITE_SUPABASE_URL);
    requireProductionUrl("VITE_APP_PUBLIC_URL", env.VITE_APP_PUBLIC_URL);
    if (!env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()) {
      throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY is required for a production build");
    }
  }

  return {
    define,

    // Por padrão o Vite gera código para navegadores recentes (Chrome 87+), e
    // quem estivesse abaixo disso nem conseguia LER o arquivo do painel: a tela
    // ficava preta, sem erro visível. Baixando o alvo, o próprio build converte
    // a sintaxe moderna e o painel volta a abrir em máquinas mais antigas.
    build: {
      target: ["es2019", "chrome66", "firefox60", "safari12", "edge79"],

      // Como o código é fatiado em arquivos, e por quê, está em
      // config/chunk-strategy.ts — separado para poder ser testado, já que a
      // regra errada aqui não quebra o build: ela deixa o painel lento só na
      // máquina do cliente.
      rollupOptions: {
        output: {
          experimentalMinChunkSize: PISO_DE_TAMANHO,
          manualChunks: chunkPara,
        },
      },
    },

    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [
      react(),
      {
        name: "aceleriq-emit-version",
        apply: "build" as const,
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "version.json",
            source: JSON.stringify({ buildId }),
          });
        },
      },
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "@tanstack/react-query"],
    },
    optimizeDeps: {
      include: ["react", "react-dom", "@tanstack/react-query"],
    },
  };
});
