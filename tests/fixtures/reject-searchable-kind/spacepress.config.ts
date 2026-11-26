import { defineConfig, integer, table } from "spacepress";
export const a = table({ count: integer().searchable() });
export default defineConfig({});
