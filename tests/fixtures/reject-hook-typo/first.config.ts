import { collection, text, defineConfig, table } from "first";
export const a = table({ name: text() }).on({ beforeCreat(d) {} });
export default defineConfig({});
