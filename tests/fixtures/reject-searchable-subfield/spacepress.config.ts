import { defineConfig, group, table, text } from "spacepress";
export const a = table({ meta: group({ note: text().searchable() }).optional() });
export default defineConfig({});
