// The WP test app: the frozen phase-1 blog (tests/fixtures/blog, which run.sh copies to
// sp/blog/ with the WP suites' extra post hooks from tests/wp/blog-test-hooks.ts), the lane
// modules in sp/lanes/, and what this file exports. Every kind, global, action and job registers
// by its export name; a name taken twice fails the build.
import { boolean, collection, date, defineConfig, db, email, integer, json, select, text, timestamp, table, number, ref, mutation } from "spacepress";
import { posts } from "./sp/blog/spacepress.config.ts";
// One module per phase-2 lane, so lanes add test kinds without editing this file.
import * as fields from "./sp/lanes/fields.ts";
import * as sync from "./sp/lanes/sync.ts";
import * as jobs from "./sp/lanes/jobs.ts";
import * as auth from "./sp/lanes/auth.ts";
import * as abilities from "./sp/lanes/abilities.ts";
import * as media from "./sp/lanes/media.ts";
import * as locales from "./sp/lanes/locales.ts";
import * as rest from "./sp/lanes/rest.ts";
import * as runtime from "./sp/lanes/runtime.ts";
import * as staged from "./sp/lanes/staged.ts";
import { merge } from "./sp/compose.ts";
import uploads from "./sp/uploads.ts";
const lanes = [fields, sync, jobs, auth, abilities, media, locales, rest, runtime, staged];

// A `table()` with a real SQL UNIQUE index (the blog has none).
export const signups = table({
  email: email().unique().max(191),
  postId: ref(() => posts).optional(),
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
  postId: ref(() => posts).optional(),
  extra: json().optional(), // a json() meta column: `{}` must stay an object through postmeta
}, {
  access: {
    read: "anyone",
    create: "editor",
    // Other signed-in users may only reset `extra` to the empty object: the rule must see `{}`, not `[]`.
    update: (ctx) => ctx.user?.role === "editor" || ctx.user?.role === "admin" || (ctx.user !== null && JSON.stringify(ctx.data?.extra) === "{}"),
  },
});

// Lane-owned config options (webhooks, media, locales...): one owner per option.
const laneConfig = merge("config option", lanes.map((l) => l.config));

// Trusted db.globals from compiled code, against the WP options-backed global store.
export const bumpPostsPerPage = mutation({}, async () => {
  const before = await db.globals.settings.get();
  const after = await db.globals.settings.update({ postsPerPage: before.postsPerPage + 1 });
  return [before.postsPerPage, after.postsPerPage];
});

export default defineConfig({
  ...laneConfig,
  uploads,
  name: "blog",
});
