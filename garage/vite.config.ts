import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { fileURLToPath } from "node:url";

// Static single-page app: every screen is behind sign-in and every figure
// comes from the database under row-level security (see docs/ARCHITECTURE.md).
export default defineConfig(({ mode }) => {
  // `.stack/env.local` is written by the local stack (npm run stack).
  const env = { ...loadEnv(mode, fileURLToPath(new URL(".stack", import.meta.url)), "VITE_"), ...loadEnv(mode, process.cwd(), "VITE_") };
  return {
    define: Object.fromEntries(Object.entries(env).map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)])),
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    plugins: [
      tanstackRouter({ target: "react", autoCodeSplitting: true }),
      react(),
      tailwindcss(),
    ],
    server: { port: 5173, strictPort: true },
    build: { chunkSizeWarningLimit: 900 },
  };
});
