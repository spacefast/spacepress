import { defineConfig, table, f } from "spacepress";
export const notes = table({ id: f.text(), title: f.text() });
export default defineConfig({});
