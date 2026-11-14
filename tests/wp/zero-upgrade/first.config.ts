// The 0.3.0 app in zero.config.ts, ported to First by its owner: the same kinds, fields and stored
// names, in the current authoring form (fields are required unless `.optional()`). run.sh builds
// it against the 0.3.0 ledger; it must plan no new migration.
import { collection, table, text, integer, boolean, select, email, file, files, global, userProjection, defineConfig, action, job, jobs, db } from "first";

export const notes = table({
  title: text().max(120),
  done: boolean().default(false),
}, { access: { read: "anyone", create: "anyone", update: "anyone", delete: "admin" } });

export const decks = files({ accept: ["text/plain"], maxBytes: 100000, access: { read: "anyone", create: "editor", delete: "editor" } });

export const posts = collection({
  title: text().max(120),
  summary: text({ multiline: true }).max(500).optional(),
  tags: select(["news", "guide"]).many().default([]),
  deck: file(decks).optional(),
}, { label: "Posts", title: "title", revisions: true, uid: true, access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export const members = userProjection({
  email: email().unique().max(191),
  name: text().max(80),
  plan: select(["free", "pro"]).default("free"),
}, { access: { read: "self", update: "self", create: "anyone", delete: "admin" } });

export const settings = global({
  siteTitle: text().default("Carry").max(80),
}, { label: "Settings" });

export const stamp = job({
  input: { id: integer() },
  handler: async ({ id }) => {
    await db.update(notes).set({ done: true }).where({ id });
  },
});

export const later = action({
  input: { id: integer() },
  access: "anyone",
  async handler({ id }) {
    await jobs.stamp.enqueue({ id }, { key: `note-${id}` });
    return { queued: id };
  },
});

export default defineConfig({
  name: "carry",
});
