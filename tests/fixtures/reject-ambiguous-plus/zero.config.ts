import { collection, id, json, defineConfig } from "zero";
const a = collection("a", { id: id(), meta: json() }, { editor: false });
export default defineConfig({ schema: { a }, hooks: { a: { afterCreate(row) { const x = row.id + row.meta; } } } });
