import { defineConfig, table, text, integer, json, select, group, blocks, media } from "typedpress";
export const notes = table({ seo: group({ fields: { title: text() } }) });
export default defineConfig({});
