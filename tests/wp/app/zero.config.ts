// The WP test app: the blog example's schema, relations, globals and actions, plus hooks that leave
// an observable trace for the editor-parity and rollback tests. The blog's own hooks are repeated
// verbatim (a config can't import another config's default export).
import { boolean, collection, date, defineConfig, defineRelations, db, email, id, integer, real, select, text, timestamp, HttpError } from "zero";
import { schema, settings, comments } from "../../../examples/blog/zero.config.ts";
import blog from "../../../examples/blog/zero.config.ts";
// One fragment per phase-2 lane, so lanes add test collections without editing this file.
import * as fields from "./lanes/fields.ts";
import * as sync from "./lanes/sync.ts";
import * as jobs from "./lanes/jobs.ts";
import * as auth from "./lanes/auth.ts";
import * as abilities from "./lanes/abilities.ts";
import * as media from "./lanes/media.ts";
import * as locales from "./lanes/locales.ts";

// An `editor: false` table with a real SQL UNIQUE index (the blog has none).
export const signups = collection("signups", {
  id: id(),
  email: email().notNull().unique().max(191),
  postId: integer().references(() => schema.posts.id, { onDelete: "set null" }),
}, { editor: false, access: { create: "anyone", read: "editor" } });

// A post-backed collection with one column of every scalar meta kind, for the postmeta filter suite.
export const events = collection("events", {
  id: id(),
  title: text().notNull(),
  seats: integer(),
  price: real(),
  open: boolean().notNull().default(false),
  day: date(),
  startsAt: timestamp(),
  kinds: select({ options: ["talk", "workshop", "social"], multiple: true }).notNull().default([]),
  postId: integer().references(() => schema.posts.id, { onDelete: "set null" }),
}, { access: { read: "anyone", create: "editor" } });

const appSchema = {
  ...schema, signups, events,
  ...fields.schema, ...sync.schema, ...jobs.schema, ...auth.schema, ...abilities.schema, ...media.schema, ...locales.schema,
};
// The blog's relations, plus events → posts.
const appRelations = defineRelations(appSchema, (r) => ({
  posts: { author: r.one.authors({ from: r.posts.authorId, to: r.authors.id }), comments: r.many.comments() },
  authors: { posts: r.many.posts() },
  comments: { post: r.one.posts({ from: r.comments.postId, to: r.posts.id, optional: false }) },
  events: { post: r.one.posts({ from: r.events.postId, to: r.posts.id }) },
}));

export default defineConfig({
  ...fields.config, ...sync.config, ...jobs.config, ...auth.config, ...abilities.config, ...media.config, ...locales.config,
  name: "blog",
  schema: appSchema,
  relations: appRelations,
  globals: { settings, ...fields.globals, ...sync.globals, ...jobs.globals, ...auth.globals, ...abilities.globals, ...media.globals, ...locales.globals },
  actions: { ...blog.actions, ...fields.actions, ...sync.actions, ...jobs.actions, ...auth.actions, ...abilities.actions, ...media.actions, ...locales.actions },
  hooks: {
    ...fields.hooks, ...sync.hooks, ...jobs.hooks, ...auth.hooks, ...abilities.hooks, ...media.hooks, ...locales.hooks,
    posts: {
      async beforeCreate(data, ctx) {
        if (data.authorId == null && ctx.user) {
          const author = await db.query.authors.findFirst({ where: { userId: ctx.user.id } });
          if (author) data.authorId = author.id;
        }
      },
      // Every post titled "Audit…" gets a comment naming the hook and the user that triggered it.
      async afterCreate(row, ctx) {
        if (row.title.startsWith("Audit")) {
          const who = ctx.user ? ctx.user.name : "nobody";
          await db.insert(comments).values({ postId: row.id, name: "afterCreate", body: `by ${who}` });
        }
        if (row.title === "Explode") {
          throw new HttpError(500, "boom", "afterCreate exploded");
        }
      },
      async afterUpdate(row, previous, ctx) {
        if (row.title.startsWith("Audit")) {
          await db.insert(comments).values({ postId: row.id, name: "afterUpdate", body: `${previous.title} -> ${row.title}` });
        }
      },
    },
    comments: {
      async afterCreate(row, ctx) {
        if (ctx.user && ctx.user.role !== "subscriber") {
          await db.update(comments).set({ approved: true }).where({ id: row.id });
        }
      },
    },
  },
});
