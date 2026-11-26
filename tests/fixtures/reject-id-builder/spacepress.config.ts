import { defineConfig, table, text, id } from "spacepress";
export const notes = table({ id: id(), title: text() });
export default defineConfig({});
