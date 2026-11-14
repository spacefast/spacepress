import { defineConfig, table, text, integer, json, select, group, blocks, media } from "first";
export const notes = table({ kind: text({ enum: ["a", "b"] }) });
export default defineConfig({});
