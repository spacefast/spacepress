// Lane fragment for the WP test app; only this lane edits this file. ../compose.ts merges every
// export into the app and fails the build if a key collides with the shared app or another lane.
//
// Staged versions (docs/staged.md): a public kind with a URL, an owner-filtered update rule, a field
// only admins read and set, a unique field, and a hook that records every update of a row.
import { collection, db, integer, richText, slug, table, text } from "first";

export const bulletins = collection({
  title: text().min(1).max(80),
  slug: slug({ source: "title" }).optional(),
  body: richText().optional(),
  summary: text().optional(),
  code: text().unique().max(40).optional(),
  ownerId: integer().optional(),
  memo: text().access({ read: "admin", update: "admin" }).optional(),
}, {
  title: "title",
  content: "body",
  url: "/bulletins/:slug",
  access: {
    read: (ctx) => ctx.user && ctx.user.role !== "subscriber" ? true : { status: "published" },
    create: "author",
    // Editors and admins update any bulletin; an author only their own.
    update: (ctx) => ctx.user?.role === "admin" || ctx.user?.role === "editor" ? true : { ownerId: ctx.user?.id ?? -1 },
    delete: "editor",
  },
});
/** One row per update of a bulletin: what changed and who made the update. */
export const bulletinLog = table({ bulletinId: integer(), change: text(), by: text() }, { access: { read: "editor" } });
/** A kind that turned staged versions off. */
export const fixedNotes = collection({ title: text() }, { staged: false, access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export const collections = { bulletins, fixedNotes };
export const tables = { bulletinLog };
export const users = {  };
export const entities = { ...collections, ...tables, ...users };
/** Extra relations for this lane's collections: `(r) => ({ myCollection: { ... } })`. */
export const relations = (r: unknown) => ({});
export const actions = {};
export const globals = {};
/** Hooks by collection, then event. Two lanes may hook one collection, never the same event. */
export const hooks = {
  bulletins: {
    async afterUpdate(row, previous, ctx) {
      await db.insert(bulletinLog).values({ bulletinId: row.id, change: `${previous.title} -> ${row.title}`, by: ctx.user ? ctx.user.name : "nobody" });
    },
  },
};
/** Top-level options this lane owns (e.g. jobs, webhooks, files, media, locales). */
export const config = {};
