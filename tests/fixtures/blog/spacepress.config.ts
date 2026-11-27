// The phase-1 blog, frozen: tests/fixtures/blog/schema.php is what `spacepress build` emits for it, and the
// PHP suites (tests/php/blog_app.php) run against that schema. examples/blog grows; this file does not.
import { collection, global, defineConfig, table, query, mutation, f } from "spacepress";
import { HttpError } from "spacepress/server";

export const authors = collection({
  name: f.text().max(80),
  email: f.email().unique().max(191),
  bio: f.text({ multiline: true }).max(500).optional(),
  avatar: f.media({ accept: "image" }).optional(),
  userId: f.integer().optional(),                       // the User.id that owns this author profile
}, { label: "Authors", title: "name", access: { read: "anyone", create: "admin", update: "admin", delete: "admin" } });

export const posts = collection({
  title: f.text().min(1).max(120),
  slug: f.slug({ source: "title" }).optional(),
  body: f.richText().optional(),
  excerpt: f.text({ multiline: true }).max(300).optional(),
  cover: f.media({ accept: "image" }).optional(),
  tags: f.select(["news", "guide", "release"]).many().default([]),
  authorId: f.ref(authors).optional(),
  seo: f.group({
    metaTitle: f.text().max(70).optional(),
    metaDescription: f.text().max(160).optional(),
    noindex: f.boolean().default(false),
  }).optional(),
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
  access: {
    read: (ctx) => ctx.user && ctx.user.role !== "subscriber" ? true : { status: "published" },
    create: "author",
    update: (ctx) => ctx.user?.role === "admin" || ctx.user?.role === "editor" ? true : { authorId: { userId: ctx.user?.id ?? -1 } },
    delete: "editor",
  },
}).on({
  async beforeCreate({ data, user, db }) {
    if (data.authorId == null && user) {
      const author = await db.authors.get({ userId: user.id });
      if (author) data.authorId = author.id;
    }
  },
});

export const comments = table({
  postId: f.ref(posts).onDelete("cascade"),
  name: f.text().max(60),
  body: f.text({ multiline: true }).min(1).max(2000).validate((v) => v.includes("http://") ? "No links in comments" : true),
  approved: f.boolean().default(false),
  createdAt: f.timestamp().defaultNow(),
}, {
  access: { read: (ctx) => ctx.user ? true : { approved: true }, create: "anyone", update: "editor", delete: "editor" },
}).on({
  async afterCreate({ row, user, db }) {
    if (user && user.role !== "subscriber") {
      await db.comments.update(row.id, { approved: true });
    }
  },
});

export const collections = { authors, posts };
export const tables = { comments };
export const users = {  };
export const entities = { ...collections, ...tables, ...users };

export const settings = global({
  siteTitle: f.text().default("My blog").max(80),
  tagline: f.text().max(160).optional(),
  postsPerPage: f.integer().default(10).min(1).max(50),
  social: f.repeater({ label: f.text().max(40), href: f.url() }).optional(),
}, { label: "Site settings" });

export const approveComment = mutation({ access: "editor" }, async ({ db }, { id }: { id: number }) => {
  const row = await db.comments.update(id, { approved: true });
  if (!row) throw new HttpError(404, "not_found", `No comment ${id}`);
  return row;
});

export const publishedCount = query({ access: "anyone" }, async ({ db }) => {
  const rows = await db.posts.list({ where: { status: "published" }, columns: { id: true } });
  return { count: rows.length };
});

export default defineConfig({
  name: "blog",
});
