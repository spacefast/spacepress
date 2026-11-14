import { defineConfig, table, text } from "first";
export const notes = table({ id: text(), title: text() });
export default defineConfig({});
