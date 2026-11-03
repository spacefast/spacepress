import { collection, id, json, defineConfig, table } from "zero";
const a = table({ id: id(), meta: json() });
export default defineConfig({ tables: { a }, hooks: { a: { afterCreate(row) { const x = row.id + row.meta; } } } });
