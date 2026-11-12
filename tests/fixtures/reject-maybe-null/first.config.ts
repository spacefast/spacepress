import { collection, text, defineConfig, table } from "first";
const a = table({ note: text().optional() });
export default defineConfig({ tables: { a }, hooks: { a: { afterCreate(row) { const n = row.note.length; } } } });
