import { defineConfig, table, f } from "spacepress";
export const notes = table({ title: f.text().notNull() });
export default defineConfig({});
