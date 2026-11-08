import { defineConfig } from "vite";

const backend = process.env.ZERO_DEV_URL ?? "http://localhost:8794";

export default defineConfig({
  base: "./",
  build: { outDir: "../public", emptyOutDir: true },
  server: { proxy: { "/wp-json": { target: backend, changeOrigin: true } } },
});
