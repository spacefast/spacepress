import { collection, defineConfig, email, global, integer, richText, table, text, query, mutation } from "spacepress";

// One collection that turns comments on and one that doesn't, for the comments switch.
// `mood` is a field SCF renders, for the schema lock.
export const notes = collection({ title: text(), body: richText().optional(), mood: text().optional() }, { title: "title", content: "body", comments: true });
export const memos = collection({ title: text(), body: richText().optional() }, { title: "title", content: "body" });

// A global, for the options page SCF shows it on (the schema lock).
export const banner = global({ motto: text().default("") });

// Personal data for agent credentials: an email field and a field with a read rule.
export const contacts = table({
  name: text(),
  email: email().optional(),
  salary: integer().access({ read: "editor" }).optional(),
}, { access: { read: "subscriber", create: "editor", update: "editor", delete: "editor" } });

// A readonly action (an agent credential without writes may run it) and a writing one.
export const countNotes = query({ access: "subscriber" }, () => ({ ok: true }));
export const touchNotes = mutation({ access: "editor" }, () => ({ ok: true }));

// XML-RPC and pings are WordPress's own by default; this app turns them off so the lane proves both
// switches (hardening.test.ts puts the defaults back for one test).
export default defineConfig({
  name: "hardening-lane",
  xmlrpc: false,
  pings: false,
});
