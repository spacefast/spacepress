// A Zero v2 0.3.0 app with one of each kind of stored data, built by the 0.3.0 compiler for
// tests/wp/zero-upgrade/run.sh: the site it runs on is then upgraded to First.
import { collection, table, text, integer, boolean, select, email, file, files, global, userProjection, defineConfig, action, job, jobs, db } from "zero";

export const notes = table({
  title: text().notNull().max(120),
  done: boolean().notNull().default(false),
}, { access: { read: "anyone", create: "anyone", update: "anyone", delete: "admin" } });

export const posts = collection({
  title: text().notNull().max(120),
  summary: text({ multiline: true }).max(500),
  tags: select({ options: ["news", "guide"], multiple: true }).notNull().default([]),
  deck: file({ bucket: "decks" }),
}, { label: "Posts", title: "title", revisions: true, uid: true, access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export const members = userProjection({
  email: email().notNull().unique().max(191),
  name: text().notNull().max(80),
  plan: select({ options: ["free", "pro"] }).notNull().default("free"),
}, { access: { read: "self", update: "self", create: "anyone", delete: "admin" } });

export const settings = global("settings", {
  siteTitle: text().notNull().default("Carry").max(80),
}, { label: "Settings" });

export default defineConfig({
  name: "carry",
  tables: { notes },
  collections: { posts },
  users: { members },
  globals: { settings },
  files: { decks: files("decks", { accept: ["text/plain"], maxBytes: 100000, access: { read: "anyone", create: "editor", delete: "editor" } }) },
  jobs: {
    stamp: job({
      input: { id: integer().notNull() },
      handler: async ({ id }) => {
        await db.update(notes).set({ done: true }).where({ id });
      },
    }),
  },
  actions: {
    later: action({
      input: { id: integer().notNull() },
      access: "anyone",
      async handler({ id }) {
        await jobs.stamp.enqueue({ id }, { key: `note-${id}` });
        return { queued: id };
      },
    }),
  },
});
