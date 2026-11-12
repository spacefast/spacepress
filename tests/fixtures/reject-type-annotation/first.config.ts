import { defineConfig, table, text, integer, json, select, group, blocks, media } from "first";
const notes = table({ tags: json().$type<string[]>() });
export default defineConfig({ tables: { notes } });
