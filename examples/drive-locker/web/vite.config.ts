import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backend = env.TP_DEV_URL || "http://localhost:8796";
  return {
    base: "./",
    build: { outDir: "../public", emptyOutDir: true },
    server: {
      port: 5196,
      strictPort: true,
      proxy: {
        "/wp-json": { target: backend, changeOrigin: true },
        "/identity": { target: backend, changeOrigin: true },
        "/.well-known": { target: backend, changeOrigin: true },
      },
    },
  };
});
