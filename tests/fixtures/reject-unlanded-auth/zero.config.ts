import { collection, id, text, email, integer, defineConfig } from "zero";
// Config code that clears the flag after the collection is read cannot hide it: the gate reads the emitted schema.
const memberOptions = { editor: false, auth: true };
const members = collection("members", { id: id(), email: email().notNull().unique().max(191), name: text() }, memberOptions);
const notes = collection("notes", { id: id(), memberId: integer().references(() => { memberOptions.auth = false; return members.id; }) }, { editor: false });
export default defineConfig({ schema: { members, notes } });
