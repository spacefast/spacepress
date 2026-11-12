import { defineConfig, table, text, integer, json, select, group, blocks, media } from "first";
const notes = table({ names: text().many() });
export default defineConfig({ tables: { notes } });
