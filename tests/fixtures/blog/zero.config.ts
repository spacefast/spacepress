// The phase-1 blog, frozen: tests/fixtures/blog/schema.php is what `zero build` emits for it, and the
// PHP suites (tests/php/blog_app.php) run against that schema. examples/blog grows; this file does not.
import {
  collection, global, id, text, integer, boolean, timestamp, richText, media, slug, select,
  repeater, group, blocks, email, url, defineRelations, defineConfig, action, db, HttpError,
} from "zero";

export const authors = collection("authors", {
  id: id(),
  name: text().notNull().max(80),
  email: email().notNull().unique().max(191),
  bio: text({ multiline: true }).max(500),
  avatar: media({ accept: "image" }),
  userId: integer(),                       // the User.id that owns this author profile
}, { label: "Authors", title: "name", access: { read: "anyone", create: "admin", update: "admin", delete: "admin" } });

export const posts = collection("posts", {
  id: id(),
  title: text().notNull().min(1).max(120),
  slug: slug({ source: "title" }),
  body: richText(),
  excerpt: text({ multiline: true }).max(300),
  cover: media({ accept: "image" }),
  tags: select({ options: ["news", "guide", "release"], multiple: true }).notNull().default([]),
  authorId: integer().references(() => authors.id, { onDelete: "set null" }),
  seo: group({ fields: {
    metaTitle: text().max(70),
    metaDescription: text().max(160),
    noindex: boolean().notNull().default(false),
  } }),
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
  access: {
    read: (ctx) => ctx.user && ctx.user.role !== "subscriber" ? true : { status: "published" },
    create: "author",
    update: (ctx) => ctx.user?.role === "admin" || ctx.user?.role === "editor" ? true : { author: { userId: ctx.user?.id ?? -1 } },
    delete: "editor",
  },
});

export const comments = collection("comments", {
  id: id(),
  postId: integer().notNull().references(() => posts.id, { onDelete: "cascade" }),
  name: text().notNull().max(60),
  body: text({ multiline: true }).notNull().min(1).max(2000).validate((v) => v.includes("http://") ? "No links in comments" : true),
  approved: boolean().notNull().default(false),
  createdAt: timestamp().notNull().defaultNow(),
}, {
  editor: false,
  access: { read: (ctx) => ctx.user ? true : { approved: true }, create: "anyone", update: "editor", delete: "editor" },
});

export const schema = { authors, posts, comments };

export const relations = defineRelations(schema, (r) => ({
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
  schema,
  relations,
  globals: { settings },
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
      async afterCreate(row, ctx) {
        if (ctx.user && ctx.user.role !== "subscriber") {
          await db.update(comments).set({ approved: true }).where({ id: row.id });
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
