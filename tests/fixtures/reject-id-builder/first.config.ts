import { defineConfig, table, text, id } from "first";
const notes = table({ id: id(), title: text() });
export default defineConfig({ tables: { notes } });
