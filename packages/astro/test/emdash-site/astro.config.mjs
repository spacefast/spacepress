import { defineConfig } from "astro/config";
import { firstEmdash } from "@first/astro/emdash";

const out = process.env.ASTRO_TEST_OUT;
export default defineConfig({
  output: "static",
  integrations: [firstEmdash()],
  ...(out ? { outDir: `${out}/dist`, cacheDir: `${out}/cache` } : {}),
});
