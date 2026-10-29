import { collection, id, text, defineConfig } from "zero";
const notes = collection("notes", { id: id(), kind: text(), label: text().showIf({ kind: { in: [() => true] } }) }, { editor: false });
export default defineConfig({ schema: { notes } });
