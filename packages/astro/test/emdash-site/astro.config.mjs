import { defineConfig } from "astro/config";
import { spEmdash } from "@spacepress/astro/emdash";

const out = process.env.ASTRO_TEST_OUT;
export default defineConfig({
  output: "static",
  integrations: [spEmdash()],
  ...(out ? { outDir: `${out}/dist`, cacheDir: `${out}/cache` } : {}),
});
