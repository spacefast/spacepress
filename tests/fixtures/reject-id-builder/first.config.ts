import { defineConfig, table, text, id } from "first";
export const notes = table({ id: id(), title: text() });
export default defineConfig({});
