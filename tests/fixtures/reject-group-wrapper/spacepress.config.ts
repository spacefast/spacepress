import { defineConfig, table, f } from "spacepress";
export const notes = table({ seo: f.group({ fields: { title: f.text() } }) });
export default defineConfig({});
