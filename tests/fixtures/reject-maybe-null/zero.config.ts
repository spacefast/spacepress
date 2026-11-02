import { collection, id, text, defineConfig, table } from "zero";
const a = table({ id: id(), note: text() });
export default defineConfig({ tables: { a }, hooks: { a: { afterCreate(row) { const n = row.note.length; } } } });
