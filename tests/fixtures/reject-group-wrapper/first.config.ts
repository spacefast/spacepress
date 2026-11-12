import { defineConfig, table, text, integer, json, select, group, blocks, media } from "first";
const notes = table({ seo: group({ fields: { title: text() } }) });
export default defineConfig({ tables: { notes } });
