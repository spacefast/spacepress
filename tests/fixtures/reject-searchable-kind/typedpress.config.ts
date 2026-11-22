import { defineConfig, integer, table } from "typedpress";
export const a = table({ count: integer().searchable() });
export default defineConfig({});
