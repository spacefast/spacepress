import { defineConfig, table, text, integer, json, select, group, blocks, media } from "first";
const notes = table({ tags: json<string[]>().default(() => []) });
export default defineConfig({ tables: { notes } });
