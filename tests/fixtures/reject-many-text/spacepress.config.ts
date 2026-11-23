import { defineConfig, table, text, integer, json, select, group, blocks, media } from "spacepress";
export const notes = table({ names: text().many() });
export default defineConfig({});
