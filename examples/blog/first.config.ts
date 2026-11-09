import {
  collection, global, text, integer, boolean, timestamp, richText, media, slug, select,
  repeater, group, blocks, email, url, file, files, defineRelations, defineConfig, action, job, jobs, env,
  db, HttpError,
  table, userProjection,
} from "first";

export const authors = collection({
  name: text().notNull().max(80),
  // Public profiles, private inboxes: only editors see an author's address (§4.7).
  email: email().notNull().unique().max(191).access({ read: "editor" }),
  bio: text({ multiline: true }).max(500),
  avatar: media({ accept: "image" }),
  userId: integer(),                       // the User.id that owns this author profile
}, { label: "Authors", title: "name", uid: true, access: { read: "anyone", create: "admin", update: "admin", delete: "admin" } });

export const posts = collection({
  // Translated per locale (§7.3). The other fields are shared by a post's translations, except
  // each row's own slug, status and dates.
  title: text().notNull().min(1).max(120).localized(),
  slug: slug({ source: "title" }),
  body: richText().localized(),
  excerpt: text({ multiline: true }).max(300).localized(),
  cover: media({ accept: "image" }),
  tags: select({ options: ["news", "guide", "release"], multiple: true }).notNull().default([]),
  authorId: integer().references(() => authors.id, { onDelete: "set null" }),
  // Only worth filling in for published posts: the editor hides it otherwise (§4.7).
  seo: group({ fields: {
    metaTitle: text().max(70),
    metaDescription: text().max(160),
    noindex: boolean().notNull().default(false),
  } }).showIf({ status: "published" }),
  // The talk's slide deck: a private file, downloaded through a signed link (§7.2).
  deck: file({ bucket: "decks" }),
  gallery: repeater({ fields: { image: media({ accept: "image" }).notNull(), caption: text().max(120) } }).max(12),
  sections: blocks({ layouts: {
    hero: { heading: text().notNull().max(80), image: media({ accept: "image" }) },
    quote: { text: text({ multiline: true }).notNull(), cite: text().max(80) },
  } }),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow().$onUpdate(() => new Date()),
}, {
  label: "Posts",
  title: "title",
  content: "body",
  // Write posts as Markdown in content/posts/; `first sync` keeps files and site in step (§5).
  sync: "content/posts/*.md",
  access: {
    read: (ctx) => ["author", "editor", "admin"].includes(ctx.user?.role ?? "") ? true : { status: "published" },
    create: "author",
    update: (ctx) => ctx.user?.role === "admin" || ctx.user?.role === "editor" ? true : { author: { userId: ctx.user?.id ?? -1 } },
    delete: "editor",
  },
});

export const comments = table({
  postId: integer().notNull().references(() => posts.id, { onDelete: "cascade" }),
  name: text().notNull().max(60),
  body: text({ multiline: true }).notNull().min(1).max(2000).validate((v) => v.includes("http://") ? "No links in comments" : true),
  approved: boolean().notNull().default(false),
  notifiedAt: timestamp(),                 // set by the notifyEditors job
  createdAt: timestamp().notNull().defaultNow(),
}, {
  access: { read: (ctx) => ["author", "editor", "admin"].includes(ctx.user?.role ?? "") ? true : { approved: true }, create: "anyone", update: "editor", delete: "editor" },
});

// Readers who sign in (§6.2): the first-identity screens on WordPress.
export const members = userProjection({
  email: email().notNull().unique().max(191),
  name: text().notNull().max(80),
  plan: select({ options: ["free", "pro"] }).notNull().default("free"),
}, { access: { read: "self", update: "self", create: "anyone", delete: "admin" } });

export const collections = { authors, posts };
export const tables = { comments };
export const users = { members };
export const entities = { ...collections, ...tables, ...users };

export const relations = defineRelations(entities, (r) => ({
  posts: { author: r.one.authors({ from: r.posts.authorId, to: r.authors.id }), comments: r.many.comments() },
  authors: { posts: r.many.posts() },
  comments: { post: r.one.posts({ from: r.comments.postId, to: r.posts.id, optional: false }) },
}));

export const settings = global("settings", {
  siteTitle: text().notNull().default("My blog").max(80),
  tagline: text().max(160),
  postsPerPage: integer().notNull().default(10).min(1).max(50),
  social: repeater({ fields: { label: text().notNull().max(40), href: url().notNull() } }),
}, { label: "Site settings" });

export default defineConfig({
  name: "blog",
  collections, tables, users,
  relations,
  globals: { settings },
  locales: { default: "en", all: ["en", "de"] },
  // A 600×400 crop of every image for cards, centred on the image's focal point (§7.2).
  media: { sizes: { card: { width: 600, height: 400, fit: "cover" } } },
  files: {
    decks: files("decks", { accept: ["application/pdf"], maxBytes: 20_000_000, access: { read: "anyone", create: "author", delete: "editor" } }),
  },
  // Every post change is POSTed, signed, to BLOG_HOOK_URL and retried on failure (§6.1).
  webhooks: [{ url: env("BLOG_HOOK_URL"), secret: env("BLOG_HOOK_SECRET"), events: ["posts.created", "posts.updated", "posts.deleted"] }],
  jobs: {
    // Runs after the comment's request commits, on the queue (Action Scheduler on WordPress).
    notifyEditors: job({
      input: { commentId: integer().notNull() },
      retries: 3,
      // A real site would email its editors here; this one stamps the comment so you can see it ran.
      handler: async ({ commentId }) => {
        await db.update(comments).set({ notifiedAt: new Date().toISOString() }).where({ id: commentId });
      },
    }),
  },
  hooks: {
    posts: {
      async beforeCreate(data, ctx) {
        if (data.authorId == null && ctx.user) {
          const author = await db.query.authors.findFirst({ where: { userId: ctx.user.id } });
          if (author) data.authorId = author.id;
        }
      },
    },
    comments: {
      // Readers can't approve their own comments, whatever they send.
      async beforeCreate(data, ctx) {
        if (!["author", "editor", "admin"].includes(ctx.user?.role ?? "")) data.approved = false;
      },
      async afterCreate(row, ctx) {
        if (["author", "editor", "admin"].includes(ctx.user?.role ?? "")) {
          await db.update(comments).set({ approved: true }).where({ id: row.id });
        } else {
          await jobs.notifyEditors.enqueue({ commentId: row.id }, { key: `comment-${row.id}` });
        }
      },
    },
  },
  actions: {
    approveComment: action({
      input: { id: integer().notNull() },
      access: "editor",
      async handler({ id }) {
        const [row] = await db.update(comments).set({ approved: true }).where({ id }).returning();
        if (!row) throw new HttpError(404, "not_found", `No comment ${id}`);
        return row;
      },
    }),
    publishedCount: action({
      input: {},
      access: "anyone",
      async handler() {
        const rows = await db.query.posts.findMany({ where: { status: "published" }, columns: { id: true } });
        return { count: rows.length };
      },
    }),
  },
});
