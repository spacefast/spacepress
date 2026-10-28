import { collection, id, text, defineConfig } from "zero";
const notes = collection("notes", { id: id(), body: text() });
export default defineConfig({ schema: { notes } });
