import { defineConfig, table, text } from "spacepress";
export const notes = table({ id: text(), title: text() });
export default defineConfig({});
