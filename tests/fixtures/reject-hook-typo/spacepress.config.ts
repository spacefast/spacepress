import { collection, text, defineConfig, table } from "spacepress";
export const a = table({ name: text() }).on({ beforeCreat(d) {} });
export default defineConfig({});
