import { defineConfig, table, text, integer, json, select, group, blocks, media } from "first";
export const notes = table({ tags: json().$type<string[]>() });
export default defineConfig({});
