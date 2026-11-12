import { defineConfig, table, text, integer, json, select, group, blocks, media } from "first";
const notes = table({ kind: text({ enum: ["a", "b"] }) });
export default defineConfig({ tables: { notes } });
