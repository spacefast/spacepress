// Lane fragment for the WP test app; only this lane edits this file. ../compose.ts merges every
// export into the app and fails the build if a key collides with the shared app or another lane.
//
// Lane R (core `/wp/v2` under First's rules): an admin-only collection, one whose read rule is a
// per-owner filter, and one with an admin-only field.
import { blocks, collection, db, group, HttpError, integer, json, repeater, richText, slug, text, table, ref } from "first";

export const vault = collection({ title: text(), code: text().optional() },
  { access: { read: "admin", create: "admin", update: "admin", delete: "admin" } });

export const ledger = collection({
  title: text(),
  ownerId: integer().optional(),
  // Owners and editors see the bonus: a per-row rule, so a revision is judged by its own snapshot.
  bonus: text().access({ read: (ctx) => ctx.user !== null && (ctx.user.role === "editor" || ctx.user.role === "admin" || ctx.data.ownerId === ctx.user.id) }).optional(),
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
  title: text(),
  salary: text().access({ read: "admin", update: "admin" }).optional(),
  notes: group({ open: text().optional(), sealed: text().access({ read: "admin" }).optional() }).optional(),
  entries: repeater({ open: text().optional(), sealed: text().access({ read: "admin" }).optional() }).optional(),
  sections: blocks({ private: { sealed: text().access({ read: "admin" }).optional() }, public: { open: text().optional() } }).optional(),
  policy: group({ gate: text().optional(), value: text().access({ update: (ctx) => ctx.data.gate !== "locked" }).optional() }).optional(),
  badge: integer().unique().access({ read: "admin", update: "editor" }).optional(),
  writeOnly: text().access({ read: "admin", update: "editor" }).optional(),
  // An admin-only reference: SCF links (and can embed) the post it names.
  managerId: ref(ledger).access({ read: "admin" }).optional().onDelete("restrict"),
}, { revisions: true, access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

// Designated content and slug hidden below admin: core's own columns, not SCF fields. Editors may
// still create and edit the rest of the row.
export const dossier = collection({
  title: text(),
  slug: slug({ source: "title" }).access({ read: "admin" }).optional(),
  body: richText().access({ read: "admin", update: "admin" }).optional(),
  payload: json().optional(), // native JSON drafts participate in save/leave validation
  entries: repeater({ metadata: json().optional() }).optional(),
  sections: blocks({ first: { configuration: json().optional() }, second: { configuration: json().optional() } }).optional(),
}, { title: "title", content: "body", access: { read: "anyone", create: "editor", update: "editor", delete: "admin" } });

// An update rule that needs the data: without it nothing; with it, only rows the viewer owns.
export const claims = collection({ title: text(), ownerId: integer().optional(), meta: json().optional() }, {
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
  title: text(),
  level: text().optional(),
  notes: group({ open: text().optional(), sealed: text().access({ read: "admin", update: "admin" }).optional() }).optional(),
  ownerId: integer().optional(),
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
export const fuses = collection({ title: text(), note: text().optional() },
  { revisions: true, access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
export const fuseLog = table({ msg: text() }, { access: { read: "anyone" } });

// Filtered reads and unreadable restrictive children exercise write-error confidentiality.
export const oracleRows = collection({
  title: text(), ownerId: integer().optional(), code: text().unique().max(191).optional(), badge: integer().unique().access({ read: "admin" }).optional(), publicBadge: integer().unique().optional(),
}, { uid: true, access: {
  read: (ctx) => ctx.user?.role === "admin" ? true : { ownerId: ctx.user?.id ?? -1 },
  create: "editor", update: "editor", delete: "editor",
} });
export const oracleRefs = collection({
  title: text(),
  rowId: ref(oracleRows).optional().onDelete("restrict"),
  alias: integer().optional(),
}, { access: { read: "admin", create: "editor", update: "editor", delete: "admin" } });

export const oracleSync = collection({
  title: text(), rowId: ref(oracleRows).optional().onDelete("restrict"), badgeId: integer().min(889002).optional(), publicBadgeId: integer().optional(),
}, { sync: "content/oracle-sync/*.json", access: { read: "admin", create: "editor", update: "editor", delete: "admin" } });
export const oraclePeers = collection({
  title: text().localized(), ownerId: integer().optional(),
}, { sync: "content/oracle-peers/*.json", access: {
  read: (ctx) => ctx.user?.role === "admin" ? true : { ownerId: ctx.user?.id ?? -1 },
  create: "editor", update: "editor", delete: "admin",
} });
export const oracleParents = collection({ title: text() },
  { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
export const oracleKids = collection({
  title: text(), parentId: ref(oracleParents).optional().onDelete("cascade"),
}, { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
export const oracleGrandchildren = collection({
  title: text(), childId: ref(oracleKids).optional().onDelete("restrict"),
}, { access: { read: "admin", create: "admin", update: "admin", delete: "admin" } });
export const oracleDefault = collection({
  title: text(),
  code: text().max(191).unique().default("reserved").access({ read: "admin" }).optional(),
  touched: text().max(191).unique().$onUpdate(() => "reserved-update").access({ read: "admin" }).optional(),
}, { access: { read: "anyone", create: "editor", update: "editor", delete: "admin" } });

export const nullParents = collection({ title: text() },
  { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
export const nullChildren = collection({
  title: text(), parentId: ref(nullParents).optional(),
  code: text().max(191).unique().$onUpdate(() => "null-reserved").access({ read: "admin" }).optional(),
}, { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export const hookParents = collection({ title: text() },
  { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
export const hookChildren = collection({
  title: text(), parentId: ref(hookParents).optional(),
  code: text().max(191).unique().access({ read: "admin" }).optional(),
}, { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
export const secretParents = collection({
  title: text(), secret: integer().unique().access({ read: "admin" }).optional(),
}, { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
export const secretLinks = collection({
  title: text(), secret: integer().optional(),
}, { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export const refDefaults = collection({
  title: text(), targetId: ref(oracleRows).default(444444444).optional().onDelete("restrict"),
}, { access: { read: "anyone", create: "editor", update: "editor", delete: "admin" } });

export const defaultOnly = collection({
  title: text(), code: text().max(191).unique().default("hidden-default").access({ read: "admin" }).optional(),
}, { access: { read: "anyone", create: "editor", update: "editor", delete: "admin" } });

export const derivedRefs = collection({
  title: text(),
  badgeId: integer().min(100).$default(async () => {
    const row = await db.query.oracleRows.findFirst({ where: { title: "Generated source" } });
    return row?.badge ?? null;
  }).optional(),
}, { sync: "content/derived-refs/*.json", access: {
  read: "anyone", update: "editor", delete: "admin",
  create: (ctx) => ctx.user?.role === "editor" && (ctx.data?.badgeId ?? 100) >= 100,
} });

export const deepRoots = collection({ title: text() },
  { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
export const deepNodes = collection({
  title: text(), rootId: ref(deepRoots).optional().onDelete("cascade"),
  parentId: ref(() => deepNodes).optional().onDelete("cascade"),
}, { access: { read: "admin", create: "admin", update: "admin", delete: "admin" } });

export const roundTrips = collection({
  title: text(), ownerId: integer().optional(), slug: slug({ source: "title" }).optional(),
  secretCode: text().max(191).unique().access({ read: "admin", update: "editor" }).optional(),
}, { sync: "content/round-trips/*.json", access: {
  read: (ctx) => ctx.user?.role === "admin" ? true : { ownerId: ctx.user?.id ?? -1 },
  create: "admin", update: "editor", delete: "admin",
} });

export const keyRoots = table({ code: integer().unique().optional() },
  { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
export const keyLinks = table({ rootCode: integer().optional() },
  { access: { read: "admin", create: "admin", update: "admin", delete: "admin" } });

export const collections = { vault, ledger, payroll, gated, dossier, claims, fuses, oracleRows, oracleRefs, oracleSync, oraclePeers, oracleParents, oracleKids, oracleGrand: oracleGrandchildren, oracleDefault, nullParents, nullChildren, hookParents, hookChildren, secretParents, secretLinks, refDefaults, defaultOnly, deepRoots, deepNodes, derivedRefs, roundTrips };
export const tables = { fuseLog, keyRoots, keyLinks };
export const users = {  };
export const entities = { ...collections, ...tables, ...users };
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
