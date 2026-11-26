// Lane fragment for the WP test app; only this lane edits this file. Every kind, action and job it
// exports registers under its export name, and a name another lane or the app uses fails the build.
//
// Lane R (core `/wp/v2` under SpacePress's rules): an admin-only collection, one whose read rule is a
// per-owner filter, and one with an admin-only field.
import { blocks, collection, group, integer, json, repeater, richText, slug, text, table, ref, taxonomy, query, mutation } from "spacepress";
import { db, HttpError } from "spacepress/server";
import { jottings, vault as vaultKind } from "spacepress/server/db";

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

// The query API (spec §3): `jottings.list/paginate/get/count/create/update/delete` from "spacepress/server/db" run as
// the visitor; `jottings.system.*` is trusted. Editors read every memo, others only published ones and
// their own drafts.
export const jottings = collection({ title: text(), note: text().optional(), ownerId: integer().optional() }, {
  drafts: true,
  access: {
    read: (ctx) => ctx.user?.role === "editor" || ctx.user?.role === "admin" ? true : { OR: [{ status: "published" }, { ownerId: ctx.user?.id ?? -1 }] },
    create: "authenticated",
    update: (ctx) => ctx.user?.role === "editor" || ctx.user?.role === "admin" ? true : { ownerId: ctx.user?.id ?? -1 },
    delete: "editor",
  },
});

// `api` flags switch operations off on the API (a 405) while core's routes keep serving wp-admin.
export const notices = collection({ title: text() },
  { revisions: true, api: { create: false, update: false, delete: false }, access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

// Editor saves roll back when a hook throws (§1.7): each hook writes a log row first, then refuses.
export const fuses = collection({ title: text(), note: text().optional() },
  { revisions: true, softDelete: false, access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } }).on({
  async afterCreate(row) {
    await db.insert(fuseLog).values({ msg: `created ${row.title}` });
    if (row.title.startsWith("Explode")) throw new HttpError(422, "boom", "afterCreate refused this");
  },
  async afterUpdate(row) {
    await db.insert(fuseLog).values({ msg: `updated ${row.title}` });
    if (row.title.startsWith("Explode")) throw new HttpError(422, "boom", "afterUpdate refused this");
  },
  async beforeDelete(row) {
    await db.insert(fuseLog).values({ msg: `deleting ${row.title}` });
  },
  async afterDelete(row) {
    if (row.title.startsWith("Keep")) throw new HttpError(409, "kept", "afterDelete refused this");
  },
});

export const fuseLog = table({ msg: text() }, { access: { read: "anyone" } });

// Filtered reads and unreadable restrictive children exercise write-error confidentiality.
export const oracleRows = collection({
  title: text(), ownerId: integer().optional(), code: text().unique().max(191).optional(), badge: integer().unique().access({ read: "admin" }).optional(), publicBadge: integer().unique().optional(),
}, { uid: true, access: {
  read: (ctx) => ctx.user?.role === "admin" ? true : { ownerId: ctx.user?.id ?? -1 },
  create: "editor", update: "editor", delete: "editor", purge: "editor",
} });

export const oracleRefs = collection({
  title: text(),
  rowId: ref(oracleRows).optional().onDelete("restrict"),
  alias: integer().optional(),
}, { access: { read: "admin", create: "editor", update: "editor", delete: "admin" } });

export const oracleSync = collection({
  title: text(), rowId: ref(oracleRows).optional().onDelete("restrict"), badgeId: integer().min(889002).optional(), publicBadgeId: integer().optional(),
}, { sync: "content/oracle-sync/*.json", access: { read: "admin", create: "editor", update: "editor", delete: "admin" } }).on({
  async beforeCreate(data) {
    if (data.title === "Swap reference") {
      const other = await db.query.oracleRows.findFirst({ where: { title: "Other private" } });
      if (other !== undefined && other !== null) data.rowId = other.id;
    }
    return data;
  },
});

export const oraclePeers = collection({
  title: text().localized(), ownerId: integer().optional(),
}, { sync: "content/oracle-peers/*.json", access: {
  read: (ctx) => ctx.user?.role === "admin" ? true : { ownerId: ctx.user?.id ?? -1 },
  create: "editor", update: "editor", delete: "admin",
} });

export const oracleParents = collection({ title: text() },
  { access: { read: "anyone", create: "editor", update: "editor", delete: "editor", purge: "editor" } });

export const oracleKids = collection({
  title: text(), parentId: ref(oracleParents).optional().onDelete("cascade"),
  // A many-ref between two post-backed kinds: links in SpacePress's join table, a post_object (multiple) in the editor.
  mentors: ref(oracleParents).many().optional().reverse("mentees"),
}, { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
// A taxonomy (docs/decisions/2026-11-11-authoring-surface.md, rulings 25-34): terms in core's term
// tables, a `oracleTopics` field on oracleKids, a term URL and its terms in core's sitemap; the app
// has `locales`, so it is one vocabulary for every locale and stays out of Polylang.
export const oracleTopics = taxonomy({ color: text().optional() },
  { hierarchical: true, url: "/oracle-topics/:path", on: [oracleKids], translations: false });

export const oracleGrand = collection({
  title: text(), childId: ref(oracleKids).optional().onDelete("restrict"),
}, { access: { read: "admin", create: "admin", update: "admin", delete: "admin" } });

export const oracleDefault = collection({
  title: text(),
  code: text().max(191).unique().default("reserved").access({ read: "admin" }).optional(),
  touched: text().max(191).unique().$onUpdate(() => "reserved-update").access({ read: "admin" }).optional(),
}, { access: { read: "anyone", create: "editor", update: "editor", delete: "admin" } });

export const nullParents = collection({ title: text() },
  { access: { read: "anyone", create: "editor", update: "editor", delete: "editor", purge: "editor" } });

export const nullChildren = collection({
  title: text(), parentId: ref(nullParents).optional(),
  code: text().max(191).unique().$onUpdate(() => "null-reserved").access({ read: "admin" }).optional(),
}, { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export const hookParents = collection({ title: text() },
  { access: { read: "anyone", create: "editor", update: "editor", delete: "editor", purge: "editor" } });

export const hookChildren = collection({
  title: text(), parentId: ref(hookParents).optional(),
  code: text().max(191).unique().access({ read: "admin" }).optional(),
}, { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } }).on({
  async beforeUpdate(data) { data.code = "hook-reserved"; return data; },
});

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
} }).on({
  async beforeCreate(data) {
    if (data.title === "Hook reference") {
      const row = await db.query.oracleRows.findFirst({ where: { title: "Generated source" } });
      data.badgeId = row?.badge ?? null;
    }
    return data;
  },
});

export const deepRoots = collection({ title: text() },
  { access: { read: "anyone", create: "editor", update: "editor", delete: "editor", purge: "editor" } });

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

export const jotQuery = query({ access: "anyone" }, async ({ tag }: { tag: string }) => {
  const where = { title: { like: `${tag}%` } };
  const rows = await jottings.list({ where, orderBy: { title: "asc" }, columns: { title: true, status: true } });
  const page1 = await jottings.paginate({ where, orderBy: { title: "asc" }, limit: 2 });
  const page2 = page1.cursor === null ? null : await jottings.paginate({ where, orderBy: { title: "asc" }, limit: 2, cursor: page1.cursor });
  const head = rows[0];
  const first = head === undefined ? null : await jottings.get({ title: head.title });
  const byId = first === null ? null : await jottings.get(first.id);
  return {
    titles: rows.map((r) => r.title),
    statuses: rows.map((r) => r.status),
    pages: [page1.rows.map((r) => r.title), page2 === null ? null : page2.rows.map((r) => r.title), page2 === null ? null : page2.cursor],
    total: await jottings.count({ where }),
    searched: await jottings.count({ where, search: "needle" }),
    get: byId === null ? null : byId.title,
    trusted: (await jottings.system.list({ where, columns: { title: true } })).length,
    trustedCount: await jottings.system.count({ where }),
  };
});

export const jotWrite = mutation({ access: "anyone" }, async ({ tag, step }: { tag: string; step: string }) => {
  if (step === "create") return (await jottings.create({ title: `${tag} written`, note: "first" })).title;
  const row = await jottings.system.get({ title: `${tag} written` });
  if (row === null) return "missing";
  if (step === "update") return (await jottings.update(row.id, { note: "second" })).note ?? "none";
  if (step === "delete") return (await jottings.delete(row.id)).title;
  return "unknown step";
});

export const vaultPeek = query({ access: "anyone" }, async ({ title, system }: { title: string; system?: number }) => {
  if (system !== undefined && !Number.isInteger(system)) throw new HttpError(422, "invalid_input", "system must be an integer", "/system");
  if (system !== 1) return (await vaultKind.get({ title }))?.title ?? null;
  const trusted = await vaultKind.system.get({ title });
  return { system: trusted === null ? null : trusted.title, count: await vaultKind.system.count({ where: { title } }) };
});
/** Top-level options this lane owns (e.g. webhooks, media, locales). */
export const config = {};
