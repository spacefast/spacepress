import { collection, defineConfig, global, richText, text } from "first";

// One collection that turns comments on and one that doesn't, for the comments switch.
// `mood` is a field SCF renders, for the schema lock.
const notes = collection({ title: text(), body: richText().optional(), mood: text().optional() }, { title: "title", content: "body", comments: true });
const memos = collection({ title: text(), body: richText().optional() }, { title: "title", content: "body" });

// A global, for the options page SCF shows it on (the schema lock).
const banner = global("banner", { motto: text().default("") });

export default defineConfig({ name: "hardening-lane", collections: { notes, memos }, globals: { banner } });
