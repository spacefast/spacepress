import { collection, defineConfig, richText, text } from "zero";

// One collection that turns comments on and one that doesn't, for the comments switch.
const notes = collection({ title: text().notNull(), body: richText() }, { title: "title", content: "body", comments: true });
const memos = collection({ title: text().notNull(), body: richText() }, { title: "title", content: "body" });

export default defineConfig({ name: "hardening-lane", collections: { notes, memos } });
