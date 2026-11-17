// A small publication: authors write posts with rich fields in English and German, readers sign in
// as members and leave comments that editors moderate through an action, and editors keep the site
// settings. tests/system drives a whole user journey through this app on WordPress.
import {
  collection, global, text, integer, boolean, timestamp, richText, media, slug, select,
  repeater, group, blocks, email, url, defineConfig, job, env, file, files, db, HttpError,
  table, userProjection, ref, query, mutation,
} from "typedpress";

// Who works on the site. Everyone else (anonymous readers, guests, signed-in members) is a reader.
const STAFF = ["author", "editor", "admin"];

export const authors = collection({
  name: text().max(80),
  bio: text({ multiline: true }).max(500).optional(),
  avatar: media({ accept: "image" }).optional(),
  userId: integer().optional(),                       // the User.id that writes as this author
}, { label: "Authors", title: "name", uid: true, access: { read: "anyone", create: "admin", update: "admin", delete: "admin" } });

export const manuscripts = files({
      accept: ["text/plain", "application/pdf"],
      maxBytes: 1_000_000,
      access: { create: "author", read: (ctx) => ctx.user?.role === "admin" || ctx.user?.role === "editor", delete: "editor" },
    });

export const posts = collection({
  // Translated per locale. The other fields are shared by a post's translations, except each
  // row's own slug, status and dates.
  title: text().min(1).max(120).localized(),
  slug: slug({ source: "title" }).optional(),
  body: richText().localized().optional(),
  dek: text({ multiline: true }).max(240).localized().optional(),
  cover: media({ accept: "image" }).optional(),
  // The author's draft manuscript: a private file, readable by its uploader and the desk.
  manuscript: file(manuscripts).optional(),
  topics: select(["culture", "science", "tech"]).many().default([]),
  featured: boolean().default(false),
  // The desk's private notes: staff read and write them; readers' rows never carry the column.
  deskNotes: text({ multiline: true }).max(2000).access({ read: "author", create: "editor", update: "editor" }).optional(),
  authorId: ref(authors).optional(),
  // The editor shows metaTitle only while the post is indexable (SCF conditional logic).
  seo: group({ noindex: boolean().default(false), metaTitle: text().max(70).showIf({ noindex: false }).optional() }).optional(),
  related: repeater({ label: text().max(80), href: url() }).max(6).optional(),
  sections: blocks({
    pullQuote: { text: text({ multiline: true }), cite: text().max(80).optional() },
    figure: { image: media({ accept: "image" }), caption: text().max(160).optional() },
  }).optional(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()),
}, {
  label: "Posts",
  title: "title",
  content: "body",
  // Writers can draft in Markdown in the repo: `typedpress sync` keeps content/posts/*.md and the site in step.
  sync: "content/posts/*.md",
  access: {
    read: (ctx) => STAFF.includes(ctx.user?.role ?? "") ? true : { status: "published" },
    create: "author",
    update: (ctx) => ctx.user?.role === "admin" || ctx.user?.role === "editor" ? true : { authorId: { userId: ctx.user?.id ?? -1 } },
    delete: "editor",
  },
}).on({
  // Each time a post becomes published (through the API or the editor) readers hear about it;
  // the job key collapses repeats still waiting on the queue. Scheduled posts that the clock
  // publishes run no hooks (both targets), so they announce nothing.
  async afterCreate(row) {
    if (row.status === "published") await notifyReaders.enqueue({ postId: row.id }, { key: `publish-${row.id}` });
  },
  async afterUpdate(row, previous) {
    if (row.status === "published" && previous.status !== "published") {
      await notifyReaders.enqueue({ postId: row.id }, { key: `publish-${row.id}` });
    }
  },
  async beforeCreate(data, ctx) {
    if (data.authorId == null && ctx.user) {
      const author = await db.query.authors.findFirst({ where: { userId: ctx.user.id } });
      if (author) data.authorId = author.id;
    }
  },
});

export const comments = table({
  postId: ref(posts).onDelete("cascade"),
  name: text().max(60),
  body: text({ multiline: true }).min(1).max(2000),
  approved: boolean().default(false),
  createdAt: timestamp().defaultNow(),
}, {
  access: { read: (ctx) => STAFF.includes(ctx.user?.role ?? "") ? true : { approved: true }, create: "anyone", update: "editor", delete: "editor" },
}).on({
  // Editors can close comments site-wide; readers can't approve their own; staff skip the queue.
  async beforeCreate(data, ctx) {
    const site = await db.globals.settings.get();
    if (!site.commentsOpen) throw new HttpError(403, "comments_closed", "Comments are closed on this site");
    if (!STAFF.includes(ctx.user?.role ?? "")) data.approved = false;
  },
  async afterCreate(row, ctx) {
    if (STAFF.includes(ctx.user?.role ?? "")) {
      await db.update(comments).set({ approved: true }).where({ id: row.id });
    }
  },
});

// Newsletter sign-ups are acknowledged by subscribeNewsletter and processed privately on the queue.
// Direct writes and subscriber identities stay admin-only.
export const subscribers = table({
  email: email().unique().max(191),
  postId: ref(posts).optional(),
  createdAt: timestamp().defaultNow(),
}, { access: { create: "admin", read: "admin", update: "admin", delete: "admin" } }).on({
  beforeCreate(data) { data.email = data.email.toLowerCase(); },
  beforeUpdate(data) { const email = data.email; if (email != null) data.email = email.toLowerCase(); },
});

// Staff see announcement receipts; exact counts stay with the subscriber administrators.
export const announcements = table({
  postId: ref(posts).onDelete("cascade"),
  recipients: integer().access({ read: "admin", update: "admin" }),
  attempt: integer(),
}, { access: { read: "editor", create: "admin", update: "admin", delete: "admin" } });

// Readers who sign in: WordPress users through the typedpress-identity screens. Readers see and edit their own row; administrators can read the identities they manage.
export const members = userProjection({
  email: email().unique().max(191),
  name: text().max(80),
  plan: select(["free", "supporter"]).default("free"),
}, { access: { read: (ctx) => ctx.user?.role === "admin" ? true : ctx.user ? { id: ctx.user.id } : false, update: "self", create: "admin", delete: "admin" } });

export const collections = { authors, posts };
export const tables = { comments, subscribers, announcements };
export const users = { members };
export const entities = { ...collections, ...tables, ...users };

export const settings = global({
  siteTitle: text().default("The TypedPress Review").max(80),
  tagline: text().max(160).optional(),
  commentsOpen: boolean().default(true),
  social: repeater({ label: text().max(40), href: url() }).optional(),
}, { label: "Site settings" });

export const subscribeReader = job({ agents: false }, async ({ email, postId }: { email: string; postId?: number }) => {
  if (email.length > 191) throw new HttpError(422, "invalid_input", "email must be at most 191 characters", "/email");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(422, "invalid_input", "email must be an email address", "/email");
  if (await db.query.subscribers.findFirst({ where: { email } })) return;
  const post = postId == null ? null : await db.query.posts.findFirst({ where: { id: postId, status: "published" }, locale: "*" });
  await db.insert(subscribers).values({ email, postId: post?.id ?? null });
});

// Runs after the publishing request commits, on the queue (Action Scheduler on WordPress).
export const notifyReaders = job({ retries: 3 }, async ({ postId }: { postId: number }, ctx) => {
  const readers = await db.query.subscribers.findMany({ columns: { id: true } });
  await db.insert(announcements).values({ postId, recipients: readers.length, attempt: ctx.attempt });
});

export const subscribeNewsletter = mutation({ access: "anyone" }, async ({ email, postId }: { email: string; postId?: number }) => {
  if (email.length > 191) throw new HttpError(422, "invalid_input", "email must be at most 191 characters", "/email");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(422, "invalid_input", "email must be an email address", "/email");
  const normalized = email.toLowerCase();
  await subscribeReader.enqueue({ email: normalized, postId }, { key: normalized });
  return { accepted: true };
});

// Editors may remove posts and detach private subscriptions; no subscription data is returned.
export const removePost = mutation({ access: "editor" }, async ({ id }: { id: number }) => {
  const [gone] = await db.delete(posts).where({ id }).returning();
  if (!gone) throw new HttpError(404, "not_found", `No post ${id}`);
  return { id: gone.id };
});

export const moderateComment = mutation({ access: "editor" }, async ({ id, decision }: { id: number; decision: "approve" | "reject" }) => {
  if (decision === "reject") {
    const [gone] = await db.delete(comments).where({ id }).returning();
    if (!gone) throw new HttpError(404, "not_found", `No comment ${id}`);
    return { id, approved: false, removed: true };
  }
  const [row] = await db.update(comments).set({ approved: true }).where({ id }).returning();
  if (!row) throw new HttpError(404, "not_found", `No comment ${id}`);
  return { id, approved: true, removed: false };
});

export const frontPage = query({ access: "anyone" }, async () => {
  const featured = await db.query.posts.findMany({ where: { status: "published", featured: true }, columns: { id: true } });
  return { featured: featured.map((p) => p.id) };
});

export default defineConfig({
  name: "site",
  locales: { default: "en", all: ["en", "de"] },
  // A square `card` crop of every image for listings, centred on the image's focal point.
  media: { sizes: { card: { width: 120, height: 120, fit: "cover" } } },
  // Every new comment is POSTed, signed, to the moderation tool at SITE_HOOK_URL (retried on failure).
  webhooks: [{ url: env("SITE_HOOK_URL"), secret: env("SITE_HOOK_SECRET"), events: ["comments.created"] }],
});
