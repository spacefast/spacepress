import { collection, defineConfig, id, text } from "zero";
const notes = collection("notes", { id: id(), x: text().access({ read: async () => true }) }, { editor: false });
export default defineConfig({ schema: { notes } });
