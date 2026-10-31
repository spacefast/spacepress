import { collection, defineConfig, id, text } from "zero";
const notes = collection("notes", { id: id(), kind: text(), x: text().showIf({ kind: { in: [] } }) }, { editor: false });
export default defineConfig({ schema: { notes } });
