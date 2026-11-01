import { collection, defineConfig, group, boolean, id, json } from "zero";
// A group default is normalized against its fields; a json sub-field holding a "0".."n" keyed object reads back as a list.
const notes = collection("notes", { id: id(), flags: group({ fields: { on: boolean().default(false) } }).notNull().default({}), meta: group({ fields: { extra: json() } }).notNull().default({ extra: { "0": "a" } }) }, { editor: false });
export default defineConfig({ schema: { notes } });
