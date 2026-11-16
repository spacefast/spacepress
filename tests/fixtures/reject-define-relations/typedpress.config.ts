import { defineConfig, defineRelations, table, text } from "typedpress";
export const notes = table({ title: text() });
export const relations = defineRelations({ notes }, (r) => ({}));
export default defineConfig({});
