// Lane fragment for the WP test app; only this lane edits this file. ../compose.ts merges every
// export into the app and fails the build if a key collides with the shared app or another lane.
//
// Lane R (core `/wp/v2` under Zero's rules): an admin-only collection, one whose read rule is a
// per-owner filter, and one with an admin-only field.
import { collection, id, integer, text } from "zero";

export const vault = collection("vault", { id: id(), title: text().notNull(), code: text() },
  { access: { read: "admin", create: "admin", update: "admin", delete: "admin" } });

export const ledger = collection("ledger", { id: id(), title: text().notNull(), ownerId: integer() }, {
  access: {
    read: (ctx) => ctx.user?.role === "admin" || ctx.user?.role === "editor" ? true : { ownerId: ctx.user?.id ?? -1 },
    create: "author",
    update: (ctx) => ctx.user?.role === "admin" || ctx.user?.role === "editor" ? true : { ownerId: ctx.user?.id ?? -1 },
    delete: "editor",
  },
});

export const payroll = collection("payroll", { id: id(), title: text().notNull(), salary: text().access({ read: "admin", update: "admin" }) },
  { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export const schema = { vault, ledger, payroll };
/** Extra relations for this lane's collections: `(r) => ({ myCollection: { ... } })`. */
export const relations = (r: unknown) => ({});
export const actions = {};
export const globals = {};
/** Hooks by collection, then event. Two lanes may hook one collection, never the same event. */
export const hooks = {};
/** Top-level options this lane owns (e.g. jobs, webhooks, files, media, locales). */
export const config = {};
