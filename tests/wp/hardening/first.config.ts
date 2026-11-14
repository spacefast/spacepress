import { action, collection, defineConfig, email, global, integer, richText, table, text } from "first";

// One collection that turns comments on and one that doesn't, for the comments switch.
// `mood` is a field SCF renders, for the schema lock.
const notes = collection({ title: text(), body: richText().optional(), mood: text().optional() }, { title: "title", content: "body", comments: true });
const memos = collection({ title: text(), body: richText().optional() }, { title: "title", content: "body" });

// A global, for the options page SCF shows it on (the schema lock).
const banner = global({ motto: text().default("") });

// Personal data for agent credentials: an email field and a field with a read rule.
const contacts = table({
  name: text(),
  email: email().optional(),
  salary: integer().access({ read: "editor" }).optional(),
}, { access: { read: "subscriber", create: "editor", update: "editor", delete: "editor" } });

// A readonly action (an agent credential without writes may run it) and a writing one.
const countNotes = action({ input: {}, access: "subscriber", readonly: true, handler: () => ({ ok: true }) });
const touchNotes = action({ input: {}, access: "editor", handler: () => ({ ok: true }) });

export default defineConfig({
  name: "hardening-lane",
  collections: { notes, memos },
  tables: { contacts },
  globals: { banner },
  actions: { countNotes, touchNotes },
});
