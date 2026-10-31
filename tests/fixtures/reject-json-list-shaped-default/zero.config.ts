import { collection, defineConfig, id, json } from "zero";
const notes = collection("notes", { id: id(), meta: json().notNull().default({ tags: { "0": "a", "1": "b" } }) }, { editor: false });
export default defineConfig({ schema: { notes } });
