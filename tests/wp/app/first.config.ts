// The WP test app: the frozen phase-1 blog's schema (tests/fixtures/blog, which run.sh copies to
// first/blog/ so the app imports it from inside first/), globals and actions, plus hooks that leave
// an observable trace for the editor-parity and rollback tests. The blog's own hooks are repeated
// verbatim (a config can't import another config's default export).
import { action, boolean, collection, date, defineConfig, db, email, integer, json, select, text, timestamp, HttpError, table, number, ref } from "first";
import { collections, tables, users, entities, settings, comments } from "./first/blog/first.config.ts";
import blog from "./first/blog/first.config.ts";
// One fragment per phase-2 lane, so lanes add test collections without editing this file.
import * as fields from "./first/lanes/fields.ts";
import * as sync from "./first/lanes/sync.ts";
import * as jobs from "./first/lanes/jobs.ts";
import * as auth from "./first/lanes/auth.ts";
import * as abilities from "./first/lanes/abilities.ts";
import * as media from "./first/lanes/media.ts";
import * as locales from "./first/lanes/locales.ts";
import * as rest from "./first/lanes/rest.ts";
import * as runtime from "./first/lanes/runtime.ts";
import { merge, mergeHooks } from "./first/compose.ts";
import uploads from "./first/uploads.ts";
const lanes = [fields, sync, jobs, auth, abilities, media, locales, rest, runtime];

// A `table()` with a real SQL UNIQUE index (the blog has none).
export const signups = table({
  email: email().unique().max(191),
  postId: ref(() => entities.posts).optional(),
  teamId: ref(() => fields.fieldTeams).optional(),
}, { access: { create: "anyone", read: "editor" } });

// A post-backed collection with one column of every scalar meta kind, for the postmeta filter suite.
export const events = collection({
  title: text(),
  seats: integer().optional(),
  price: number().optional(),
  open: boolean().default(false),
  day: date().optional(),
  startsAt: timestamp().default("2030-01-01").optional(), // a bare-date default: editor saves store it as full ISO
  kinds: select(["talk", "workshop", "social"]).many().default([]),
  postId: ref(() => entities.posts).optional(),
  extra: json().optional(), // a json() meta column: `{}` must stay an object through postmeta
}, {
  access: {
    read: "anyone",
    create: "editor",
    // Other signed-in users may only reset `extra` to the empty object: the rule must see `{}`, not `[]`.
    update: (ctx) => ctx.user?.role === "editor" || ctx.user?.role === "admin" || (ctx.user !== null && JSON.stringify(ctx.data?.extra) === "{}"),
  },
});

const appCollections = merge("collection", [collections, { events }, ...lanes.map((l) => l.collections)]);
const appTables = merge("table", [tables, { signups }, ...lanes.map((l) => l.tables)]);
const appUsers = merge("user projection", [users, ...lanes.map((l) => l.users)]);
const appSchema = merge("registered key", [appCollections, appTables, appUsers]);

// Lane-owned config options (jobs, webhooks, files, media, locales...): one owner per option.
const laneConfig = merge("config option", lanes.map((l) => l.config));

export default defineConfig({
  ...laneConfig,
  uploads,
  name: "blog",
  admin: true, // the suite proves the opt-in path; examples/blog keeps proving the default
  collections: appCollections, tables: appTables, users: appUsers,
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
