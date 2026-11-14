import { defineConfig, table, text, integer, json, select, group, blocks, media } from "first";
export const notes = table({ title: text().notNull() });
export default defineConfig({});
