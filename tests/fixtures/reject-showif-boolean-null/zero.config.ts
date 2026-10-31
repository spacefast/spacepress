import { boolean, collection, defineConfig, id, text } from "zero";
const notes = collection("notes", { id: id(), active: boolean(), x: text().showIf({ active: { in: [null, true] } }) }, { editor: false });
export default defineConfig({ schema: { notes } });
