// The phase-1 blog, frozen: tests/fixtures/blog/schema.php is what `first build` emits for it, and the
// PHP suites (tests/php/blog_app.php) run against that schema. examples/blog grows; this file does not.
import {
  collection, global, text, integer, boolean, timestamp, richText, media, slug, select,
  repeater, group, blocks, email, url, defineConfig, action, db, HttpError,
  table, ref,
} from "first";

export const authors = collection({
  name: text().max(80),
  email: email().unique().max(191),
  bio: text({ multiline: true }).max(500).optional(),
  avatar: media({ accept: "image" }).optional(),
  userId: integer().optional(),                       // the User.id that owns this author profile
}, { label: "Authors", title: "name", access: { read: "anyone", create: "admin", update: "admin", delete: "admin" } });

export const posts = collection({
  title: text().min(1).max(120),
  slug: slug({ source: "title" }).optional(),
  body: richText().optional(),
  excerpt: text({ multiline: true }).max(300).optional(),
  cover: media({ accept: "image" }).optional(),
  tags: select(["news", "guide", "release"]).many().default([]),
  authorId: ref(authors).optional(),
  seo: group({
    metaTitle: text().max(70).optional(),
    metaDescription: text().max(160).optional(),
    noindex: boolean().default(false),
  }).optional(),
  gallery: repeater({ image: media({ accept: "image" }), caption: text().max(120).optional() }).max(12).optional(),
  sections: blocks({
    hero: { heading: text().max(80), image: media({ accept: "image" }).optional() },
    quote: { text: text({ multiline: true }), cite: text().max(80).optional() },
  }).optional(),
  createdAt: timestamp().defaultNow(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()),
}, {
  label: "Posts",
  title: "title",
  content: "body",
  access: {
    read: (ctx) => ctx.user && ctx.user.role !== "subscriber" ? true : { status: "published" },
    create: "author",
    update: (ctx) => ctx.user?.role === "admin" || ctx.user?.role === "editor" ? true : { authorId: { userId: ctx.user?.id ?? -1 } },
    delete: "editor",
  },
});

export const comments = table({
  postId: ref(posts).onDelete("cascade"),
  name: text().max(60),
  body: text({ multiline: true }).min(1).max(2000).validate((v) => v.includes("http://") ? "No links in comments" : true),
  approved: boolean().default(false),
  createdAt: timestamp().defaultNow(),
}, {
  access: { read: (ctx) => ctx.user ? true : { approved: true }, create: "anyone", update: "editor", delete: "editor" },
});

export const collections = { authors, posts };
export const tables = { comments };
export const users = {  };
export const entities = { ...collections, ...tables, ...users };

export const settings = global("settings", {
  siteTitle: text().default("My blog").max(80),
  tagline: text().max(160).optional(),
  postsPerPage: integer().default(10).min(1).max(50),
  social: repeater({ label: text().max(40), href: url() }).optional(),
}, { label: "Site settings" });

export default defineConfig({
  name: "blog",
  collections, tables, users,
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
      input: { id: integer() },
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
