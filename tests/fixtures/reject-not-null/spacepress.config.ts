import { defineConfig, table, text, integer, json, select, group, blocks, media } from "spacepress";
export const notes = table({ title: text().notNull() });
export default defineConfig({});
