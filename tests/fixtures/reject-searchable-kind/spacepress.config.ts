import { defineConfig, table, f } from "spacepress";
export const a = table({ count: f.integer().searchable() });
export default defineConfig({});
