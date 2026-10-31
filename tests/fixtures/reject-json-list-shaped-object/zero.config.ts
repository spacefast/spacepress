import { collection, defineConfig, group, boolean, id, json } from "zero";
// A group default is normalized against its fields, so {} is fine there; a json sub-field holding {} is not.
const notes = collection("notes", { id: id(), flags: group({ fields: { on: boolean().default(false) } }).notNull().default({}), meta: group({ fields: { extra: json() } }).notNull().default({ extra: {} }) }, { editor: false });
export default defineConfig({ schema: { notes } });
