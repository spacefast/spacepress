import { defineConfig } from "astro/config";

// Static output: every page is built from the SpacePress site's content at `astro build`.
// ASTRO_OUT_DIR lets a test build outside the repository.
export default defineConfig({
  output: "static",
  ...(process.env.ASTRO_OUT_DIR ? { outDir: process.env.ASTRO_OUT_DIR } : {}),
});
