import { collection, json, defineConfig, table } from "first";
const a = table({ meta: json().optional() });
export default defineConfig({ tables: { a }, hooks: { a: { afterCreate(row) { const x = row.id + row.meta; } } } });
