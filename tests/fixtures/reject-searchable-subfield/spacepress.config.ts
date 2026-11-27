import { defineConfig, table, f } from "spacepress";
export const a = table({ meta: f.group({ note: f.text().searchable() }).optional() });
export default defineConfig({});
