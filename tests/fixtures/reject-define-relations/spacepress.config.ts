import { defineConfig, defineRelations, table, f } from "spacepress";
export const notes = table({ title: f.text() });
export const relations = defineRelations({ notes }, (r) => ({}));
export default defineConfig({});
