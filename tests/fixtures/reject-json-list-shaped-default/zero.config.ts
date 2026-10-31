import { collection, defineConfig, id, json } from "zero";
const notes = collection("notes", { id: id(), meta: json().notNull().default({ tags: { "1": "b", "0": "a" } }) }, { editor: false });
export default defineConfig({ schema: { notes } });
