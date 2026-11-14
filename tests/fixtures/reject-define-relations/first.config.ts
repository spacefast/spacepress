import { defineConfig, defineRelations, table, text } from "first";
export const notes = table({ title: text() });
export const relations = defineRelations({ notes }, (r) => ({}));
export default defineConfig({});
