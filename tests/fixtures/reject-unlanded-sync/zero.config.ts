import { collection, id, text, defineConfig } from "zero";
const notes = collection("notes", { id: id(), title: text().notNull() }, { editor: false, sync: "content/notes/*.json" });
export default defineConfig({ schema: { notes } });
