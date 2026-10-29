import { collection, id, text, defineConfig } from "zero";
const notes = collection("notes", { id: id(), secret: text().access({ read: () => { return; } }) }, { editor: false });
export default defineConfig({ schema: { notes } });
