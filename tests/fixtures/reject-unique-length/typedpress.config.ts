import { collection, text, defineConfig, table } from "typedpress";
export const a = table({ code: text().unique().optional() });
export default defineConfig({});
