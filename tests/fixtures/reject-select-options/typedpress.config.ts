import { defineConfig, table, text, integer, json, select, group, blocks, media } from "typedpress";
export const notes = table({ kind: select({ options: ["a", "b"], multiple: true }) });
export default defineConfig({});
