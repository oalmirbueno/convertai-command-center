import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Prévia pelo túnel (cloudflared): o worker liga MOTOR_TUNEL=1 e o HMR passa pela porta 443.
const tunel = process.env.MOTOR_TUNEL === "1";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    strictPort: true,
    allowedHosts: [".trycloudflare.com", ".cfargotunnel.com", "localhost", "127.0.0.1"],
    hmr: tunel ? { clientPort: 443, protocol: "wss" } : undefined,
  },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
});
