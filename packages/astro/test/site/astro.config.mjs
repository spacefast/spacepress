import { defineConfig } from "astro/config";

// The test build writes outside the package (ASTRO_TEST_OUT) so the repo stays clean.
const out = process.env.ASTRO_TEST_OUT;
export default defineConfig({
  output: "static",
  ...(out ? { outDir: `${out}/dist`, cacheDir: `${out}/cache` } : {}),
  vite: { cacheDir: out ? `${out}/vite` : undefined },
});
