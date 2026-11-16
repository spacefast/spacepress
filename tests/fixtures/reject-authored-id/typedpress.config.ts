import { defineConfig, table, text } from "typedpress";
export const notes = table({ id: text(), title: text() });
export default defineConfig({});
