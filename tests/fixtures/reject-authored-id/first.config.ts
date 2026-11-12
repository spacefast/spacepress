import { defineConfig, table, text } from "first";
const notes = table({ id: text(), title: text() });
export default defineConfig({ tables: { notes } });
