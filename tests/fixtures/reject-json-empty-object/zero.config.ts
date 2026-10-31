import { collection, defineConfig, id, json } from "zero";
const notes = collection("notes", { id: id(), meta: json().notNull().default({ tags: {} }) }, { editor: false });
export default defineConfig({ schema: { notes } });
