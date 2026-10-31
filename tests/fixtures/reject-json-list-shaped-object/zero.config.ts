import { collection, defineConfig, group, boolean, id, json } from "zero";
// A group default is normalized against its fields, so {} is fine there; a json leaf keyed like a list is not.
const notes = collection("notes", { id: id(), flags: group({ fields: { on: boolean().default(false) } }).notNull().default({}), meta: json().notNull().default({ tags: { "0": "a", "1": "b" } }) }, { editor: false });
export default defineConfig({ schema: { notes } });
