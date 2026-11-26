import { defineConfig, defineRelations, table, text } from "spacepress";
export const notes = table({ title: text() });
export const relations = defineRelations({ notes }, (r) => ({}));
export default defineConfig({});
