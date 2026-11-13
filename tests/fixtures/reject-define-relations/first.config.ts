import { defineConfig, defineRelations, table, text } from "first";
const notes = table({ title: text() });
export const relations = defineRelations({ notes }, (r) => ({}));
export default defineConfig({ tables: { notes } });
