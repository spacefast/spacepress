// The WP test app: the frozen phase-1 blog's schema (tests/fixtures/blog), relations, globals and actions, plus hooks that leave
// an observable trace for the editor-parity and rollback tests. The blog's own hooks are repeated
// verbatim (a config can't import another config's default export).
import { action, boolean, collection, date, defineConfig, defineRelations, db, email, id, integer, json, real, select, text, timestamp, HttpError } from "zero";
import { schema, settings, comments } from "../../fixtures/blog/zero.config.ts";
import blog from "../../fixtures/blog/zero.config.ts";
// One fragment per phase-2 lane, so lanes add test collections without editing this file.
import * as fields from "./lanes/fields.ts";
import * as sync from "./lanes/sync.ts";
import * as jobs from "./lanes/jobs.ts";
import * as auth from "./lanes/auth.ts";
import * as abilities from "./lanes/abilities.ts";
import * as media from "./lanes/media.ts";
import * as locales from "./lanes/locales.ts";
import * as rest from "./lanes/rest.ts";
import { merge, mergeHooks } from "./compose.ts";
const lanes = [fields, sync, jobs, auth, abilities, media, locales, rest];

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
  startsAt: timestamp().default("2030-01-01"), // a bare-date default: editor saves store it as full ISO
  kinds: select({ options: ["talk", "workshop", "social"], multiple: true }).notNull().default([]),
  postId: integer().references(() => schema.posts.id, { onDelete: "set null" }),
  extra: json(), // a json() meta column: `{}` must stay an object through postmeta
}, {
  access: {
    read: "anyone",
    create: "editor",
    // Other signed-in users may only reset `extra` to the empty object: the rule must see `{}`, not `[]`.
    update: (ctx) => ctx.user?.role === "editor" || ctx.user?.role === "admin" || (ctx.user !== null && JSON.stringify(ctx.data?.extra) === "{}"),
  },
});

const appSchema = merge("collection", [schema, { signups, events }, ...lanes.map((l) => l.schema)]);
// The blog's relations, plus events → posts and posts → signups (an editor-only relation target).
const appRelations = defineRelations(appSchema, (r) => merge("relations for", [{
  posts: { author: r.one.authors({ from: r.posts.authorId, to: r.authors.id }), comments: r.many.comments(), signups: r.many.signups({ from: r.posts.id, to: r.signups.postId }) },
  authors: { posts: r.many.posts() },
  comments: { post: r.one.posts({ from: r.comments.postId, to: r.posts.id, optional: false }) },
  events: { post: r.one.posts({ from: r.events.postId, to: r.posts.id }) },
}, ...lanes.map((l) => l.relations(r))]));

// Lane-owned config options (jobs, webhooks, files, media, locales...): one owner per option.
const laneConfig = merge("config option", lanes.map((l) => l.config));

export default defineConfig({
  ...laneConfig,
  name: "blog",
  schema: appSchema,
  relations: appRelations,
  globals: merge("global", [{ settings }, ...lanes.map((l) => l.globals)]),
  actions: merge("action", [blog.actions, {
    // Trusted db.globals from compiled code, against the WP options-backed global store.
    bumpPostsPerPage: action({ input: {}, handler: async () => {
      const before = await db.globals.settings.get();
      const after = await db.globals.settings.update({ postsPerPage: before.postsPerPage + 1 });
      return [before.postsPerPage, after.postsPerPage];
    } }),
  }, ...lanes.map((l) => l.actions)]),
  hooks: mergeHooks([
    {
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
    ...lanes.map((l) => l.hooks),
  ]),
});
