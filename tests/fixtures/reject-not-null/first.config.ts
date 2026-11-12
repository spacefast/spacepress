import { defineConfig, table, text, integer, json, select, group, blocks, media } from "first";
const notes = table({ title: text().notNull() });
export default defineConfig({ tables: { notes } });
