import { collection, text, defineConfig, table } from "typedpress";
export const a = table({ name: text() }).on({ beforeCreat(d) {} });
export default defineConfig({});
