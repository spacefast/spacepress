// Lane fragment for the WP test app; only this lane edits this file. ../compose.ts merges every
// export into the app and fails the build if a key collides with the shared app or another lane.
//
// Lane R (core `/wp/v2` under First's rules): an admin-only collection, one whose read rule is a
// per-owner filter, and one with an admin-only field.
import { blocks, collection, db, group, HttpError, id, integer, json, repeater, richText, slug, text, table } from "first";

export const vault = collection({ id: id(), title: text().notNull(), code: text() },
  { access: { read: "admin", create: "admin", update: "admin", delete: "admin" } });

export const ledger = collection({
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

export const payroll = collection({
  id: id(),
  title: text().notNull(),
  salary: text().access({ read: "admin", update: "admin" }),
  notes: group({ fields: { open: text(), sealed: text().access({ read: "admin" }) } }),
  entries: repeater({ fields: { open: text(), sealed: text().access({ read: "admin" }) } }),
  sections: blocks({ layouts: { private: { sealed: text().access({ read: "admin" }) }, public: { open: text() } } }),
  policy: group({ fields: { gate: text(), value: text().access({ update: (ctx) => ctx.data.gate !== "locked" }) } }),
  badge: integer().unique().access({ read: "admin", update: "editor" }),
  writeOnly: text().access({ read: "admin", update: "editor" }),
  // An admin-only reference: SCF links (and can embed) the post it names.
  managerId: integer().references(() => ledger.id).access({ read: "admin" }),
}, { revisions: true, access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

// Designated content and slug hidden below admin: core's own columns, not SCF fields. Editors may
// still create and edit the rest of the row.
export const dossier = collection({
  id: id(),
  title: text().notNull(),
  slug: slug({ source: "title" }).access({ read: "admin" }),
  body: richText().access({ read: "admin", update: "admin" }),
  payload: json(), // native JSON drafts participate in save/leave validation
  entries: repeater({ fields: { metadata: json() } }),
  sections: blocks({ layouts: { first: { configuration: json() }, second: { configuration: json() } } }),
}, { title: "title", content: "body", access: { read: "anyone", create: "editor", update: "editor", delete: "admin" } });

// An update rule that needs the data: without it nothing; with it, only rows the viewer owns.
export const claims = collection({ id: id(), title: text().notNull(), ownerId: integer(), meta: json() }, {
  access: {
    read: "anyone",
    create: "authenticated",
    update: (ctx) => ctx.user?.role === "admin" ? { meta: { eq: ctx.data?.title === "restricted" ? [] : {} } } : ctx.data == null ? false : { ownerId: ctx.user?.id ?? -1 },
    delete: "admin",
  },
});

// Rules that depend on the incoming data: anyone signed in may create or edit, but only an admin may
// mark a row "locked"; the create rule refuses a call with no data at all.
export const gated = collection({
  id: id(),
  title: text().notNull(),
  level: text(),
  notes: group({ fields: { open: text(), sealed: text().access({ read: "admin", update: "admin" }) } }),
  ownerId: integer(),
}, {
  revisions: true,
  access: {
    read: "anyone",
    create: (ctx) => ctx.user !== null && ctx.data != null && (ctx.data.level !== "locked" || ctx.user.role === "admin"),
    update: (ctx) => ctx.user !== null && (ctx.data == null || ctx.data.level !== "locked" || ctx.user.role === "admin"),
    delete: "admin",
  },
});

// Editor saves roll back when a hook throws (§1.7): each hook writes a log row first, then refuses.
export const fuses = collection({ id: id(), title: text().notNull(), note: text() },
  { revisions: true, access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
export const fuseLog = table({ id: id(), msg: text().notNull() }, { access: { read: "anyone" } });

// Filtered reads and unreadable restrictive children exercise write-error confidentiality.
export const oracleRows = collection({
  id: id(), title: text().notNull(), ownerId: integer(), code: text().unique().max(191), badge: integer().unique().access({ read: "admin" }), publicBadge: integer().unique(),
}, { uid: true, access: {
  read: (ctx) => ctx.user?.role === "admin" ? true : { ownerId: ctx.user?.id ?? -1 },
  create: "editor", update: "editor", delete: "editor",
} });
export const oracleRefs = collection({
  id: id(), title: text().notNull(),
  rowId: integer().references(() => oracleRows.id),
  alias: integer().references(() => payroll.badge),
}, { access: { read: "admin", create: "editor", update: "editor", delete: "admin" } });

export const oracleSync = collection({
  id: id(), title: text().notNull(), rowId: integer().references(() => oracleRows.id), badgeId: integer().references(() => oracleRows.badge).min(889002), publicBadgeId: integer().references(() => oracleRows.publicBadge),
}, { sync: "content/oracle-sync/*.json", access: { read: "admin", create: "editor", update: "editor", delete: "admin" } });
export const oraclePeers = collection({
  id: id(), title: text().notNull().localized(), ownerId: integer(),
}, { sync: "content/oracle-peers/*.json", access: {
  read: (ctx) => ctx.user?.role === "admin" ? true : { ownerId: ctx.user?.id ?? -1 },
  create: "editor", update: "editor", delete: "admin",
} });
export const oracleParents = collection({ id: id(), title: text().notNull() },
  { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
export const oracleKids = collection({
  id: id(), title: text().notNull(), parentId: integer().references(() => oracleParents.id, { onDelete: "cascade" }),
}, { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
export const oracleGrandchildren = collection({
  id: id(), title: text().notNull(), childId: integer().references(() => oracleKids.id),
}, { access: { read: "admin", create: "admin", update: "admin", delete: "admin" } });
export const oracleDefault = collection({
  id: id(), title: text().notNull(),
  code: text().max(191).unique().default("reserved").access({ read: "admin" }),
  touched: text().max(191).unique().$onUpdate(() => "reserved-update").access({ read: "admin" }),
}, { access: { read: "anyone", create: "editor", update: "editor", delete: "admin" } });

export const nullParents = collection({ id: id(), title: text().notNull() },
  { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
export const nullChildren = collection({
  id: id(), title: text().notNull(), parentId: integer().references(() => nullParents.id, { onDelete: "set null" }),
  code: text().max(191).unique().$onUpdate(() => "null-reserved").access({ read: "admin" }),
}, { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export const hookParents = collection({ id: id(), title: text().notNull() },
  { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
export const hookChildren = collection({
  id: id(), title: text().notNull(), parentId: integer().references(() => hookParents.id, { onDelete: "set null" }),
  code: text().max(191).unique().access({ read: "admin" }),
}, { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
export const secretParents = collection({
  id: id(), title: text().notNull(), secret: integer().unique().access({ read: "admin" }),
}, { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
export const secretLinks = collection({
  id: id(), title: text().notNull(), secret: integer().references(() => secretParents.secret),
}, { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export const refDefaults = collection({
  id: id(), title: text().notNull(), targetId: integer().references(() => oracleRows.id).default(444444444),
}, { access: { read: "anyone", create: "editor", update: "editor", delete: "admin" } });

export const defaultOnly = collection({
  id: id(), title: text().notNull(), code: text().max(191).unique().default("hidden-default").access({ read: "admin" }),
}, { access: { read: "anyone", create: "editor", update: "editor", delete: "admin" } });

export const derivedRefs = collection({
  id: id(), title: text().notNull(),
  badgeId: integer().references(() => oracleRows.badge).min(100).$default(async () => {
    const row = await db.query.oracleRows.findFirst({ where: { title: "Generated source" } });
    return row?.badge ?? null;
  }),
}, { sync: "content/derived-refs/*.json", access: {
  read: "anyone", update: "editor", delete: "admin",
  create: (ctx) => ctx.user?.role === "editor" && (ctx.data?.badgeId ?? 100) >= 100,
} });

export const deepRoots = collection({ id: id(), title: text().notNull() },
  { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
export const deepNodes = collection({
  id: id(), title: text().notNull(), rootId: integer().references(() => deepRoots.id, { onDelete: "cascade" }),
  parentId: integer().references(() => deepNodes.id, { onDelete: "cascade" }),
}, { access: { read: "admin", create: "admin", update: "admin", delete: "admin" } });

export const roundTrips = collection({
  id: id(), title: text().notNull(), ownerId: integer(), slug: slug({ source: "title" }),
  secretCode: text().max(191).unique().access({ read: "admin", update: "editor" }),
}, { sync: "content/round-trips/*.json", access: {
  read: (ctx) => ctx.user?.role === "admin" ? true : { ownerId: ctx.user?.id ?? -1 },
  create: "admin", update: "editor", delete: "admin",
} });

export const keyRoots = table({ id: id(), code: integer().unique() },
  { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
export const keyLinks = table({ id: id(), rootCode: integer().references(() => keyRoots.code) },
  { access: { read: "admin", create: "admin", update: "admin", delete: "admin" } });

export const collections = { vault, ledger, payroll, gated, dossier, claims, fuses, oracleRows, oracleRefs, oracleSync, oraclePeers, oracleParents, oracleKids, oracleGrand: oracleGrandchildren, oracleDefault, nullParents, nullChildren, hookParents, hookChildren, secretParents, secretLinks, refDefaults, defaultOnly, deepRoots, deepNodes, derivedRefs, roundTrips };
export const tables = { fuseLog, keyRoots, keyLinks };
export const users = {  };
export const entities = { ...collections, ...tables, ...users };
/** Extra relations for this lane's collections: `(r) => ({ myCollection: { ... } })`. */
export const relations = (r: unknown) => ({});
export const actions = {};
export const globals = {};
/** Hooks by collection, then event. Two lanes may hook one collection, never the same event. */
export const hooks = {
  derivedRefs: {
    async beforeCreate(data) {
      if (data.title === "Hook reference") {
        const row = await db.query.oracleRows.findFirst({ where: { title: "Generated source" } });
        data.badgeId = row?.badge ?? null;
      }
      return data;
    },
  },
  hookChildren: {
    async beforeUpdate(data) { data.code = "hook-reserved"; return data; },
  },
  oracleSync: {
    async beforeCreate(data) {
      if (data.title === "Swap reference") {
        const other = await db.query.oracleRows.findFirst({ where: { title: "Other private" } });
        if (other !== undefined && other !== null) data.rowId = other.id;
      }
      return data;
    },
  },
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
