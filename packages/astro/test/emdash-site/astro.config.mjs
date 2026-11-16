import { defineConfig } from "astro/config";
import { tpEmdash } from "@typedpress/astro/emdash";

const out = process.env.ASTRO_TEST_OUT;
export default defineConfig({
  output: "static",
  integrations: [tpEmdash()],
  ...(out ? { outDir: `${out}/dist`, cacheDir: `${out}/cache` } : {}),
});
