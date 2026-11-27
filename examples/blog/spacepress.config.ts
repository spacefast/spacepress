import { collection, defineConfig, env, extend, f, files, global, job, mutation, query, table } from "spacepress";
import { HttpError } from "spacepress/server";

export const authors = collection({
  name: f.text().max(80),
  // Public profiles, private inboxes: only editors see an author's address (§4.7).
  email: f.email().unique().max(191).access({ read: "editor" }),
  bio: f.text({ multiline: true }).max(500).optional(),
  avatar: f.media({ accept: "image" }).optional(),
  userId: f.integer().optional(),                       // the User.id that owns this author profile
}, { label: "Authors", title: "name", uid: true, access: { read: "anyone", create: "admin", update: "admin", delete: "admin" } });

export const decks = files({ accept: ["application/pdf"], maxBytes: 20_000_000, access: { read: "anyone", create: "author", delete: "editor" } });

export const posts = collection({
  title: f.text().min(1).max(120),
  slug: f.slug({ source: "title" }).optional(),
  body: f.richText().optional(),
  excerpt: f.text({ multiline: true }).max(300).optional(),
  cover: f.media({ accept: "image" }).optional(),
  tags: f.select(["news", "guide", "release"]).many().default([]),
  authorId: f.ref(authors).optional(),
  // Only worth filling in for published posts: the editor hides it otherwise (§4.7).
  seo: f.group({
    metaTitle: f.text().max(70).optional(),
    metaDescription: f.text().max(160).optional(),
    noindex: f.boolean().default(false),
  }).showIf({ status: "published" }).optional(),
  // The talk's slide deck: a private file, downloaded through a signed link (§7.2).
  deck: f.file(decks).optional(),
  gallery: f.repeater({ image: f.media({ accept: "image" }), caption: f.text().max(120).optional() }).max(12).optional(),
  sections: f.blocks({
    hero: { heading: f.text().max(80), image: f.media({ accept: "image" }).optional() },
    quote: { text: f.text({ multiline: true }), cite: f.text().max(80).optional() },
  }).optional(),
  createdAt: f.timestamp().defaultNow(),
  updatedAt: f.timestamp().defaultNow().onUpdate(() => new Date()),
}, {
  label: "Posts",
  title: "title",
  content: "body",
  // Write posts as Markdown in content/posts/; `spacepress sync` keeps files and site in step (§5).
  sync: "content/posts/*.md",
  access: {
    read: (ctx) => ["author", "editor", "admin"].includes(ctx.user?.role ?? "") ? true : { status: "published" },
    create: "author",
    update: (ctx) => ctx.user?.role === "admin" || ctx.user?.role === "editor" ? true : { authorId: { userId: ctx.user?.id ?? -1 } },
    delete: "editor",
  },
}).on({
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
  body: f.text({ multiline: true }).min(1).max(2000).validate((v) => v.includes("http://") ? "No links in comments" : true),
  approved: f.boolean().default(false),
  notifiedAt: f.timestamp().optional(),                 // set by the notifyEditors job
  createdAt: f.timestamp().defaultNow(),
}, {
  access: { read: (ctx) => ["author", "editor", "admin"].includes(ctx.user?.role ?? "") ? true : { approved: true }, create: "anyone", update: "editor", delete: "editor" },
}).on({
  // Readers can't approve their own comments, whatever they send.
  async beforeCreate({ data, user }) {
    if (!["author", "editor", "admin"].includes(user?.role ?? "")) data.approved = false;
  },
  async afterCreate({ row, user, db }) {
    if (["author", "editor", "admin"].includes(user?.role ?? "")) {
      await db.system.comments.update(row.id, { approved: true });
    } else {
      await notifyEditors.enqueue({ commentId: row.id }, { key: `comment-${row.id}` });
    }
  },
});

// Readers who sign in (§6.2): the spacepress-identity screens on WordPress.
export const members = extend("users", {
  fields: {
    plan: f.select(["free", "pro"]).default("free"),
  },
  access: { read: "self", update: "self", create: "anyone", delete: "admin" },
});

export const collections = { authors, posts };
export const tables = { comments };
export const users = { members };
export const entities = { ...collections, ...tables, ...users };

export const settings = global({
  siteTitle: f.text().default("My blog").max(80),
  tagline: f.text().max(160).optional(),
  postsPerPage: f.integer().default(10).min(1).max(50),
  social: f.repeater({ label: f.text().max(40), href: f.url() }).optional(),
}, { label: "Site settings" });

// Runs after the comment's request commits, on the queue (Action Scheduler on WordPress).
export const notifyEditors = job({ retries: 3 }, async ({ db }, { commentId }: { commentId: number }) => {
  if (!Number.isInteger(commentId)) throw new HttpError(422, "invalid_input", "commentId must be an integer", "/commentId");
  await db.comments.update(commentId, { notifiedAt: new Date().toISOString() });
});

export const approveComment = mutation({ access: "editor" }, async ({ db }, { id }: { id: number }) => {
  if (!Number.isInteger(id)) throw new HttpError(422, "invalid_input", "id must be an integer", "/id");
  const existing = await db.system.comments.get(id);
  if (!existing) throw new HttpError(404, "not_found", `No comment ${id}`);
  return await db.system.comments.update(id, { approved: true });
});

export const publishedCount = query({ access: "anyone" }, async ({ db }) => {
  const rows = await db.posts.list({ where: { status: "published" }, columns: { id: true } });
  return { count: rows.length };
});

export default defineConfig({
  name: "blog",
  // A 600×400 crop of every image for cards, centred on the image's focal point (§7.2).
  media: { sizes: { card: { width: 600, height: 400, fit: "cover" } } },
  // Every post change is POSTed, signed, to BLOG_HOOK_URL and retried on failure (§6.1).
  webhooks: [{ url: env("BLOG_HOOK_URL"), secret: env("BLOG_HOOK_SECRET"), events: ["posts.created", "posts.updated", "posts.deleted"] }],
});
