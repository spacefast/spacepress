import { defineConfig, table, text, integer, json, select, group, blocks, media } from "spacepress";
export const notes = table({ tags: json().$type<string[]>() });
export default defineConfig({});
