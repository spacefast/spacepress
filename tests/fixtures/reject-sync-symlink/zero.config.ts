import { collection, id, defineConfig } from "zero";
const notes = collection("notes", { id: id() }, { editor: false, sync: "content/*.json" });
export default defineConfig({ schema: { notes } });
