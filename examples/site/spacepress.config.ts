// A small publication: authors write posts with rich fields, readers sign in
// as members and leave comments that editors moderate through an action, and editors keep the site
// settings. tests/system drives a whole user journey through this app on WordPress.
import { collection, defineConfig, env, extend, f, files, global, job, mutation, query, table } from "spacepress";
import { HttpError } from "spacepress/server";

// Who works on the site. Everyone else (anonymous readers, guests, signed-in members) is a reader.
const STAFF = ["author", "editor", "admin"];

export const authors = collection({
  name: f.text().max(80),
  bio: f.text({ multiline: true }).max(500).optional(),
  avatar: f.media({ accept: "image" }).optional(),
  userId: f.integer().optional(),                       // the User.id that writes as this author
}, { label: "Authors", title: "name", uid: true, access: { read: "anyone", create: "admin", update: "admin", delete: "admin" } });

export const manuscripts = files({
  accept: ["text/plain", "application/pdf"],
  maxBytes: 1_000_000,
  access: { create: "author", read: (ctx) => ctx.user?.role === "admin" || ctx.user?.role === "editor", delete: "editor" },
});

export const posts = collection({
  title: f.text().min(1).max(120),
  slug: f.slug({ source: "title" }).optional(),
  body: f.richText().optional(),
  dek: f.text({ multiline: true }).max(240).optional(),
  cover: f.media({ accept: "image" }).optional(),
  // The author's draft manuscript: a private file, readable by its uploader and the desk.
  manuscript: f.file(manuscripts).optional(),
  topics: f.select(["culture", "science", "tech"]).many().default([]),
  featured: f.boolean().default(false),
  // The desk's private notes: staff read and write them; readers' rows never carry the column.
  deskNotes: f.text({ multiline: true }).max(2000).access({ read: "author", create: "editor", update: "editor" }).optional(),
  authorId: f.ref(authors).optional(),
  // The editor shows metaTitle only while the post is indexable (SCF conditional logic).
  seo: f.group({ noindex: f.boolean().default(false), metaTitle: f.text().max(70).showIf({ noindex: false }).optional() }).optional(),
  related: f.repeater({ label: f.text().max(80), href: f.url() }).max(6).optional(),
  sections: f.blocks({
    pullQuote: { text: f.text({ multiline: true }), cite: f.text().max(80).optional() },
    figure: { image: f.media({ accept: "image" }), caption: f.text().max(160).optional() },
  }).optional(),
  updatedAt: f.timestamp().defaultNow().onUpdate(() => new Date()),
}, {
  label: "Posts",
  title: "title",
  content: "body",
  // Writers can draft in Markdown in the repo: `spacepress sync` keeps content/posts/*.md and the site in step.
  sync: "content/posts/*.md",
  access: {
    read: (ctx) => STAFF.includes(ctx.user?.role ?? "") ? true : { status: "published" },
    create: "author",
    update: (ctx) => ctx.user?.role === "admin" || ctx.user?.role === "editor" ? true : { authorId: { userId: ctx.user?.id ?? -1 } },
    delete: "editor",
  },
}).on({
  async afterCreate({ row }) {
    if (row.status === "published") await notifyReaders.enqueue({ postId: row.id }, { key: `publish-${row.id}` });
  },
  async afterUpdate({ row, previous }) {
    if (row.status === "published" && previous.status !== "published") {
      await notifyReaders.enqueue({ postId: row.id }, { key: `publish-${row.id}` });
    }
  },
  async beforeCreate({ data, user, db }) {
    if (data.authorId == null && user) {
      const author = await db.system.authors.get({ userId: user.id });
      if (author) data.authorId = author.id;
    }
  },
});

export const comments = table({
  postId: f.ref(posts).onDelete("cascade"),
  name: f.text().max(60),
  body: f.text({ multiline: true }).min(1).max(2000),
  approved: f.boolean().default(false),
  createdAt: f.timestamp().defaultNow(),
}, {
  access: { read: (ctx) => STAFF.includes(ctx.user?.role ?? "") ? true : { approved: true }, create: "anyone", update: "editor", delete: "editor" },
}).on({
  // Editors can close comments site-wide; readers can't approve their own; staff skip the queue.
  async beforeCreate({ data, user, db }) {
    const site = await db.settings.get();
    if (!site.commentsOpen) throw new HttpError(403, "comments_closed", "Comments are closed on this site");
    if (!STAFF.includes(user?.role ?? "")) data.approved = false;
  },
  async afterCreate({ row, user, db }) {
    if (STAFF.includes(user?.role ?? "")) {
      await db.system.comments.update(row.id, { approved: true });
    }
  },
});

// Newsletter sign-ups are acknowledged by subscribeNewsletter and processed privately on the queue.
export const subscribers = table({
  email: f.email().unique().max(191),
  postId: f.ref(posts).optional(),
  createdAt: f.timestamp().defaultNow(),
}, { access: { create: "admin", read: "admin", update: "admin", delete: "admin" } }).on({
  beforeCreate({ data }) { data.email = data.email.toLowerCase(); },
  beforeUpdate({ patch }) { const email = patch.email; if (email != null) patch.email = email.toLowerCase(); },
});

// Staff see announcement receipts; exact counts stay with the subscriber administrators.
export const announcements = table({
  postId: f.ref(posts).onDelete("cascade"),
  recipients: f.integer().access({ read: "admin", update: "admin" }),
  attempt: f.integer(),
}, { access: { read: "editor", create: "admin", update: "admin", delete: "admin" } });

// Readers who sign in: WordPress users through the spacepress-identity screens.
export const members = extend("users", {
  fields: {
    plan: f.select(["free", "supporter"]).default("free"),
  },
  access: { read: (ctx) => ctx.user?.role === "admin" ? true : ctx.user ? { id: ctx.user.id } : false, update: "self", create: "admin", delete: "admin" },
});

export const collections = { authors, posts };
export const tables = { comments, subscribers, announcements };
export const users = { members };
export const entities = { ...collections, ...tables, ...users };

export const settings = global({
  siteTitle: f.text().default("The SpacePress Review").max(80),
  tagline: f.text().max(160).optional(),
  commentsOpen: f.boolean().default(true),
  social: f.repeater({ label: f.text().max(40), href: f.url() }).optional(),
}, { label: "Site settings" });

export const subscribeReader = job({ agents: false }, async ({ db }, { email, postId }: { email: string; postId?: number }) => {
  if (postId !== undefined && !Number.isInteger(postId)) throw new HttpError(422, "invalid_input", "postId must be an integer", "/postId");
  if (email.length > 191) throw new HttpError(422, "invalid_input", "email must be at most 191 characters", "/email");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(422, "invalid_input", "email must be an email address", "/email");
  if (await db.subscribers.get({ email })) return;
  const post = postId == null ? null : await db.posts.get({ id: postId, status: "published" });
  await db.subscribers.create({ email, postId: post?.id ?? null });
});

// Runs after the publishing request commits, on the queue (Action Scheduler on WordPress).
export const notifyReaders = job({ retries: 3 }, async ({ db, attempt }, { postId }: { postId: number }) => {
  if (!Number.isInteger(postId)) throw new HttpError(422, "invalid_input", "postId must be an integer", "/postId");
  const readers = await db.subscribers.list({ columns: { id: true } });
  await db.announcements.create({ postId, recipients: readers.length, attempt });
});

export const subscribeNewsletter = mutation({ access: "anyone" }, async (_ctx, { email, postId }: { email: string; postId?: number }) => {
  if (postId !== undefined && !Number.isInteger(postId)) throw new HttpError(422, "invalid_input", "postId must be an integer", "/postId");
  if (email.length > 191) throw new HttpError(422, "invalid_input", "email must be at most 191 characters", "/email");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(422, "invalid_input", "email must be an email address", "/email");
  const normalized = email.toLowerCase();
  await subscribeReader.enqueue({ email: normalized, postId }, { key: normalized });
  return { accepted: true };
});

// Editors may remove posts and detach private subscriptions; no subscription data is returned.
export const removePost = mutation({ access: "editor" }, async ({ db }, { id }: { id: number }) => {
  if (!Number.isInteger(id)) throw new HttpError(422, "invalid_input", "id must be an integer", "/id");
  const existing = await db.system.posts.get(id);
  if (!existing) throw new HttpError(404, "not_found", `No post ${id}`);
  const gone = await db.system.posts.delete(id);
  return { id: gone.id };
});

export const moderateComment = mutation({ access: "editor" }, async ({ db }, { id, decision }: { id: number; decision: "approve" | "reject" }) => {
  if (!Number.isInteger(id)) throw new HttpError(422, "invalid_input", "id must be an integer", "/id");
  const existing = await db.system.comments.get(id);
  if (!existing) throw new HttpError(404, "not_found", `No comment ${id}`);
  if (decision === "reject") {
    await db.system.comments.delete(id);
    return { id, approved: false, removed: true };
  }
  await db.system.comments.update(id, { approved: true });
  return { id, approved: true, removed: false };
});

export const frontPage = query({ access: "anyone" }, async ({ db }) => {
  const featured = await db.posts.list({ where: { status: "published", featured: true }, columns: { id: true } });
  return { featured: featured.map((p) => p.id) };
});

export default defineConfig({
  name: "site",
  media: { sizes: { card: { width: 120, height: 120, fit: "cover" } } },
  webhooks: [{ url: env("SITE_HOOK_URL"), secret: env("SITE_HOOK_SECRET"), events: ["comments.created"] }],
});
