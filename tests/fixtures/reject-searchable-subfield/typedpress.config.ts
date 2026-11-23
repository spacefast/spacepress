import { defineConfig, group, table, text } from "typedpress";
export const a = table({ meta: group({ note: text().searchable() }).optional() });
export default defineConfig({});
