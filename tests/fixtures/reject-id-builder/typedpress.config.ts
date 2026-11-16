import { defineConfig, table, text, id } from "typedpress";
export const notes = table({ id: id(), title: text() });
export default defineConfig({});
