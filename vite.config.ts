import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

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
  if (command === "build") {
    const env = loadEnv(mode, process.cwd(), "");
    requireProductionUrl("VITE_SUPABASE_URL", env.VITE_SUPABASE_URL);
    requireProductionUrl("VITE_APP_PUBLIC_URL", env.VITE_APP_PUBLIC_URL);
    if (!env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()) {
      throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY is required for a production build");
    }
  }

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [react()],
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
