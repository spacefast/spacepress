import { defineConfig, table, text, integer, json, select, group, blocks, media } from "first";
const notes = table({ kind: select({ options: ["a", "b"], multiple: true }) });
export default defineConfig({ tables: { notes } });
