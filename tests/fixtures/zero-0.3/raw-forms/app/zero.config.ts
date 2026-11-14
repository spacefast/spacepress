// forms/app without its plugin package: what a raw upload can hold. Every other authoring form the 0.3.0 compiler accepted, in one app. Captured by that compiler
// (tests/fixtures/zero-0.3/README.md); do not edit by hand.
import {
  action, blocks, boolean, collection, date, db, defineConfig, defineRelations, email, env, file,
  files, global, group, HttpError, id, integer, job, jobs, json, media, once, mail, real, repeater,
  richText, route, select, slug, table, text, timestamp, url, userProjection,
} from "zero";
import { abilities, current_user_can, esc_html, get_option } from "php/wordpress";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { clamp, MAX_TITLE } from "./lib/util";

class Counter { n = 0; bump() { this.n += 1; return this.n; } }

// Content: a WordPress post type with every field builder and modifier.
export const posts = collection({
  title: text().notNull().min(1).max(MAX_TITLE).localized(),
  slug: slug({ source: "title" }),
  body: richText().localized(),
  summary: text({ multiline: true }).max(300).ui({ label: "Summary", help: "Shown in lists", width: 50 }),
  secret: text().access({ read: "editor", update: (ctx) => ctx.user?.role === "admin" }),
  kind: text({ enum: ["note", "guide"] }).notNull().default("note"),
  tags: select({ options: ["news", "guide"], multiple: true }).notNull().default([]),
  level: select({ options: ["a", "b"] }).localized(),
  cover: media({ accept: "image" }),
  gallery: media({ multiple: true }),
  deck: file({ bucket: "decks" }),
  meta: json().$type<{ score: number }>().localized(),
  seo: group({ fields: { title: text().max(70), noindex: boolean().notNull().default(false) } }).showIf({ status: "published" }),
  links: repeater({ fields: { label: text().notNull(), href: url().notNull() } }).max(5),
  sections: blocks({ layouts: {
    hero: { heading: text().notNull().max(80), image: media({ accept: "image" }) },
    quote: { text: text({ multiline: true }).notNull(), cite: text().max(80) },
  } }),
  extra: text().showIf({ OR: [{ status: "published" }, { kind: "guide" }] }),
  authorId: integer().references(() => authors.id, { onDelete: "set null" }),
}, {
  label: "Posts", title: "title", content: "body", sync: "content/posts/*.md", api: { delete: false },
  access: {
    read: (ctx) => ["author", "editor", "admin"].includes(ctx.user?.role ?? "") ? true : { status: "published" },
    create: "author", update: "editor", delete: "admin",
  },
});

export const authors = collection({
  name: text().notNull().max(80),
  email: email().notNull().unique().max(191).access({ read: "editor" }),
  site: url(),
}, { title: "name", uid: true, agents: false, access: { read: "anyone", create: true, update: "editor", delete: false } });

// App data: tables with an explicit primary key, a text primary key, every scalar column and default.
export const things = table({
  id: id(),
  n: integer().notNull().min(0).max(10),
  r: real(),
  t: text(),
  day: date(),
  at: timestamp(),
  plain: json(),
  mail: email().unique().max(191),
  code: text().pattern(/^[a-z]+$/).max(40),
  checked: text().validate((v) => v.length > 2 ? true : "too short"),
  flag: boolean().notNull().default(false),
  token: text().notNull().$default(() => "t"),
  m: integer().notNull().$defaultFn(() => 1),
  createdAt: timestamp().notNull().defaultNow(),
  today: date().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow().$onUpdate(() => new Date()),
  touched: integer().$onUpdateFn(() => 2),
}, { access: { read: "anyone", create: "subscriber", update: "authenticated", delete: "admin" } });

export const codes = table({ code: text().primaryKey().max(40), label: text().notNull() });

export const log = table({
  postId: integer().notNull().references(() => posts.id, { onDelete: "cascade" }),
  memberId: integer().references(() => members.id, { onDelete: "cascade" }),
  message: text().notNull(),
}, { storageName: "post_log", drafts: true, revisions: true });

export const pinned = table({ name: text().notNull() }, { existingTable: "wp_external_pinned" });

// WordPress users with profile fields.
export const members = userProjection({
  email: email().notNull().unique().max(191),
  name: text().notNull().max(80),
  plan: select({ options: ["free", "pro"] }).notNull().default("free"),
}, { access: { read: "self", create: "anyone", update: "self", delete: "admin" } });

const relations = defineRelations({ posts, authors, log, members }, (r) => ({
  posts: { author: r.one.authors({ from: r.posts.authorId, to: r.authors.id }), log: r.many.log() },
  authors: { posts: r.many.posts() },
  log: {
    post: r.one.posts({ from: r.log.postId, to: r.posts.id, optional: false }),
    member: r.one.members({ from: r.log.memberId, to: r.members.id }),
  },
  members: { log: r.many.log() },
}));

export const settings = global("settings", {
  siteTitle: text().notNull().default("Site"),
  contact: email(),
  links: repeater({ fields: { label: text().notNull(), href: url().notNull() } }),
}, { label: "Site settings", access: { read: "anyone", update: "admin" } });

export default defineConfig({
  name: "forms",
  admin: true,
  collections: { posts, authors },
  tables: { things, codes, log, pinned },
  users: { members },
  globals: { settings },
  relations,
  locales: { default: "en", all: ["en", "de"], fallback: false },
  media: { sizes: { card: { width: 600, height: 400, fit: "cover" } } },
  files: { decks: files("decks", { accept: ["application/pdf"], maxBytes: 5_000_000, access: { read: "owner", create: "editor", delete: "admin" } }) },
  uploads: { backend: "s3", bucket: env("UPLOAD_BUCKET"), region: "us-east-1", prefix: "forms", credentials: { accessKeyId: env("UPLOAD_KEY"), secretAccessKey: env("UPLOAD_SECRET") } },
  webhooks: [{ url: env("HOOK_URL"), secret: env("HOOK_SECRET"), events: ["posts.created", "posts.updated"] }],
  services: {
    forms: { contact: { fields: { email: { type: "email", notNull: true }, message: { type: "text", notNull: true, rules: { max: 2000 } } }, recipient: env("CONTACT_TO"), sender: env("CONTACT_FROM"), limit: 5 } },
    search: { posts: ["title", "summary"] },
    products: { tee: { name: "Tee", amount: 2500, currency: "usd" } },
    checkoutReturnUrl: "https://example.com/thanks",
  },
  hooks: {
    posts: {
      beforeCreate(data) {
        data.title = data.title.trim();
        if (data.title === "") throw new HttpError(422, "invalid_input", "Give this post a title");
      },
      async afterCreate(post, ctx) {
        await jobs.record.enqueue({ postId: post.id }, { key: `post-${post.id}`, delay: 30 });
        await db.insert(log).values({ postId: post.id, message: ctx.user === null ? "guest" : "user" });
      },
      beforeUpdate(patch, existing) { if (existing.kind === "guide" && patch.kind === "note") throw new HttpError(409, "locked", "guides stay guides"); },
      async afterUpdate(row, previous) { if (row.title !== previous.title) await db.insert(log).values({ postId: row.id, message: "renamed" }); },
      beforeDelete(row) { if (row.status === "published") throw new HttpError(409, "published", "unpublish first"); },
      async afterDelete(row) { await db.delete(log).where({ postId: row.id }); },
    },
  },
  jobs: {
    record: job({ input: { postId: integer().notNull() }, retries: 3, async handler({ postId }, ctx) {
      await db.insert(log).values({ postId, message: `attempt ${ctx.attempt} of ${ctx.jobId}` });
    } }),
  },
  routes: {
    feed: route({ method: "GET", path: "/api/feed.json", access: "anyone", async handler(req) {
      const limit = Number(req.query.get("limit") ?? "20");
      const rows = await db.query.posts.findMany({ where: { status: "published" }, limit, with: { author: true } });
      return { headers: { "content-type": "application/feed+json" }, body: JSON.stringify(rows.map((p) => ({ id: String(p.id), title: p.title }))) };
    } }),
    one: route({ method: "GET", path: "/api/posts/:id", access: (ctx) => ctx.user !== null, handler(req) { return { body: req.params.id }; } }),
    files: route({ method: "PUT", path: "/files/*path", access: "editor", handler(req) { return { status: 204, body: req.params.path }; } }),
    stripe: route({ method: "POST", path: "/webhooks/stripe", signature: { secret: env("STRIPE_SECRET"), header: "stripe-signature", scheme: "hmac-sha256" }, handler(req) {
      const event = JSON.parse(req.body) as { type: string };
      return { status: 202, body: "ok " + event.type };
    } }),
  },
  actions: {
    first: action({ input: { title: text().notNull() }, access: "anyone", async handler({ title }) {
      const row = await db.query.posts.findFirst({ where: { title: { like: `%${title}%` }, OR: [{ kind: "guide" }, { log: true }] }, columns: { id: true, title: true }, orderBy: { id: "desc" } });
      if (!row) throw new HttpError(404, "not_found", "none");
      return row;
    } }),
    rename: action({ input: { id: integer().notNull(), name: text().notNull() }, access: "admin", agents: false, async handler({ id, name }) {
      const [member] = await db.update(members).set({ name }).where({ id }).returning();
      if (!member) throw new HttpError(404, "not_found", "Member not found");
      return member;
    } }),
    add: action({ input: { label: text().notNull(), code: text().notNull() }, access: "editor", idempotent: true, async handler({ label, code }) {
      await db.insert(codes).values([{ code, label }, { code: code + "x", label }]);
      return await once(`add-${code}`, async () => (await mail.send({ to: "ops@example.com", subject: "added", text: label })).id);
    } }),
    title: action({ input: {}, access: "anyone", async handler() {
      const s = await db.globals.settings.get();
      if (!current_user_can("edit_posts")) return s.siteTitle;
      return esc_html(String(get_option("blogname")));
    } }),
    count: action({ input: {}, access: "authenticated", async handler() { return await abilities.call("forms/things-list", {}); } }),
    sign: action({ input: { body: text().notNull(), sig: text().notNull() }, access: "anyone", async handler({ body, sig }) {
      const mine = createHmac("sha256", "k").update(body).digest("hex");
      if (Buffer.byteLength(mine) !== Buffer.byteLength(sig) || !timingSafeEqual(Buffer.from(mine), Buffer.from(sig))) throw new HttpError(401, "bad", "bad");
      const r = await fetch("https://example.com/api", { method: "POST", body: JSON.stringify({ body }) });
      return { id: randomUUID(), ok: r.ok };
    } }),
    bump: action({ input: { n: integer().notNull() }, access: (ctx) => ctx.user?.role === "admin", handler({ n }) {
      const c = new Counter();
      for (let i = 0; i < clamp(n, 0, 5); i++) c.bump();
      return c.n;
    } }),
    hook: action({ input: { title: text().notNull() }, signature: { secret: env("SIG"), header: "x-sig", scheme: "zero" }, async handler({ title }) {
      await db.insert(codes).values({ code: title, label: title });
      return null;
    } }),
  },
});
