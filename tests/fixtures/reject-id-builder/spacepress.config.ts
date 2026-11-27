import { defineConfig, table, id, f } from "spacepress";
export const notes = table({ id: id(), title: f.text() });
export default defineConfig({});
