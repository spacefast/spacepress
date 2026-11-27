import { defineConfig, table, f } from "spacepress";
export const notes = table({ kind: f.select({ options: ["a", "b"], multiple: true }) });
export default defineConfig({});
