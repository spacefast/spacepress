// Lane fragment for the WP test app; only this lane edits this file. ../compose.ts merges every
// export into the app and fails the build if a key collides with the shared app or another lane.
//
// Lane R (core `/wp/v2` under Zero's rules): an admin-only collection, one whose read rule is a
// per-owner filter, and one with an admin-only field.
import { collection, db, group, HttpError, id, integer, richText, slug, text } from "zero";

export const vault = collection("vault", { id: id(), title: text().notNull(), code: text() },
  { access: { read: "admin", create: "admin", update: "admin", delete: "admin" } });

export const ledger = collection("ledger", {
  id: id(),
  title: text().notNull(),
  ownerId: integer(),
  // Owners and editors see the bonus: a per-row rule, so a revision is judged by its own snapshot.
  bonus: text().access({ read: (ctx) => ctx.user !== null && (ctx.user.role === "editor" || ctx.user.role === "admin" || ctx.data.ownerId === ctx.user.id) }),
}, {
  revisions: true,
  access: {
    read: (ctx) => ctx.user?.role === "admin" || ctx.user?.role === "editor" ? true : { ownerId: ctx.user?.id ?? -1 },
    create: "author",
    update: (ctx) => ctx.user?.role === "admin" || ctx.user?.role === "editor" ? true : { ownerId: ctx.user?.id ?? -1 },
    delete: "editor",
  },
});

export const payroll = collection("payroll", {
  id: id(),
  title: text().notNull(),
  salary: text().access({ read: "admin", update: "admin" }),
  // A unique value only admins see (and set): no conflict may reveal it.
  badge: text().unique().max(60).access({ read: "admin" }),
  // An admin-only reference: SCF links (and can embed) the post it names.
  managerId: integer().references(() => ledger.id).access({ read: "admin" }),
}, { revisions: true, access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

// Designated content and slug hidden below admin: core's own columns, not SCF fields. Editors may
// still create and edit the rest of the row.
export const dossier = collection("dossier", {
  id: id(),
  title: text().notNull(),
  slug: slug({ source: "title" }).access({ read: "admin" }),
  body: richText().access({ read: "admin", update: "admin" }),
}, { title: "title", content: "body", access: { read: "anyone", create: "editor", update: "editor", delete: "admin" } });

// An update rule that needs the data: without it nothing; with it, only rows the viewer owns.
export const claims = collection("claims", { id: id(), title: text().notNull(), ownerId: integer() }, {
  access: {
    read: "anyone",
    create: "authenticated",
    update: (ctx) => ctx.data == null ? false : { ownerId: ctx.user?.id ?? -1 },
    delete: "admin",
  },
});

// Rules that depend on the incoming data: anyone signed in may create or edit, but only an admin may
// mark a row "locked"; the create rule refuses a call with no data at all.
export const gated = collection("gated", {
  id: id(),
  title: text().notNull(),
  level: text(),
  notes: group({ fields: { open: text(), sealed: text().access({ read: "admin", update: "admin" }) } }),
  ownerId: integer(),
}, {
  access: {
    read: "anyone",
    create: (ctx) => ctx.user !== null && ctx.data != null && (ctx.data.level !== "locked" || ctx.user.role === "admin"),
    update: (ctx) => ctx.user !== null && (ctx.data == null || ctx.data.level !== "locked" || ctx.user.role === "admin"),
    delete: "admin",
  },
});

// Editor saves roll back when a hook throws (§1.7): each hook writes a log row first, then refuses.
export const fuses = collection("fuses", { id: id(), title: text().notNull(), note: text() },
  { revisions: true, access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
export const fuseLog = collection("fuse_log", { id: id(), msg: text().notNull() }, { editor: false, access: { read: "anyone" } });

export const schema = { vault, ledger, payroll, gated, dossier, claims, fuses, fuseLog };
/** Extra relations for this lane's collections: `(r) => ({ myCollection: { ... } })`. */
export const relations = (r: unknown) => ({});
export const actions = {};
export const globals = {};
/** Hooks by collection, then event. Two lanes may hook one collection, never the same event. */
export const hooks = {
  fuses: {
    async afterCreate(row: { id: number; title: string; note: string | null; status: string; publishedAt: string | null }) {
      await db.insert(fuseLog).values({ msg: `created ${row.title}` });
      if (row.title.startsWith("Explode")) throw new HttpError(422, "boom", "afterCreate refused this");
    },
    async afterUpdate(row: { id: number; title: string; note: string | null; status: string; publishedAt: string | null }) {
      await db.insert(fuseLog).values({ msg: `updated ${row.title}` });
      if (row.title.startsWith("Explode")) throw new HttpError(422, "boom", "afterUpdate refused this");
    },
    async beforeDelete(row: { id: number; title: string; note: string | null; status: string; publishedAt: string | null }) {
      await db.insert(fuseLog).values({ msg: `deleting ${row.title}` });
    },
    async afterDelete(row: { id: number; title: string; note: string | null; status: string; publishedAt: string | null }) {
      if (row.title.startsWith("Keep")) throw new HttpError(409, "kept", "afterDelete refused this");
    },
  },
};
/** Top-level options this lane owns (e.g. jobs, webhooks, files, media, locales). */
export const config = {};
