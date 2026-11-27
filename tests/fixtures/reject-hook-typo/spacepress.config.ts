import { collection, defineConfig, table, f } from "spacepress";
export const a = table({ name: f.text() }).on({ beforeCreat(d) {} });
export default defineConfig({});
