import { collection, defineConfig, media, richText, text } from "first";

// Native WordPress titles and blocks; the remaining fields are editable in SCF.
const posts = collection({
  title: text().notNull(),
  body: richText(),
  excerpt: text({ multiline: true }),
  cover: media({ accept: "image" }),
  seoTitle: text(),
  seoDescription: text({ multiline: true }),
}, {
  label: "Publication posts", title: "title", content: "body", revisions: true,
  access: {
    read: (ctx) => ["admin", "editor", "author"].includes(ctx.user?.role ?? "") ? true : { status: "published" },
    create: "editor", update: "editor", delete: "editor",
  },
});

const pages = collection({
  title: text().notNull(),
  body: richText(),
  seoTitle: text(),
  seoDescription: text({ multiline: true }),
}, {
  label: "Publication pages", title: "title", content: "body", revisions: true,
  access: {
    read: (ctx) => ["admin", "editor", "author"].includes(ctx.user?.role ?? "") ? true : { status: "published" },
    create: "editor", update: "editor", delete: "editor",
  },
});

export default defineConfig({
  name: "emdash-blog",
  // Keep WordPress's complete native admin, plugin and settings screens.
  admin: false,
  collections: { posts, pages },
});
