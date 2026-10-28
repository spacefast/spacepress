import { collection, id, text, defineConfig } from "zero";
const a = collection("a", { id: id(), note: text() }, { editor: false });
export default defineConfig({ schema: { a }, hooks: { a: { afterCreate(row) { const n = row.note.length; } } } });
