import { collection, text, defineConfig } from "zero";
const notes = collection("notes", { code: text().primaryKey(), title: text() }, { editor: false, sync: "content/*.json" });
export default defineConfig({ schema: { notes } });
