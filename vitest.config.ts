import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Acima do prazo das esperas (5 s em src/test/setup.ts): a espera que falha
    // mostra o DOM em vez de virar "Test timed out".
    testTimeout: 15000,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    env: {
      VITE_SUPABASE_URL: "https://ci-placeholder.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "ci-public-placeholder",
      VITE_APP_PUBLIC_URL: "https://app.example.com",
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
