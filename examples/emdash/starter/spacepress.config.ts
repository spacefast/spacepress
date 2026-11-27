import { collection, defineConfig, f } from "spacepress";

// Native WordPress titles and blocks; the remaining fields are editable in SCF.
export const posts = collection({
  title: f.text(),
  body: f.richText().optional(),
  excerpt: f.text({ multiline: true }).optional(),
  cover: f.media({ accept: "image" }).optional(),
  seoTitle: f.text().optional(),
  seoDescription: f.text({ multiline: true }).optional(),
}, {
  label: "Publication posts", title: "title", content: "body", revisions: true, comments: true,
  access: {
    read: (ctx) => ["admin", "editor", "author"].includes(ctx.user?.role ?? "") ? true : { status: "published" },
    create: "editor", update: "editor", delete: "editor",
  },
});

export const pages = collection({
  title: f.text(),
  body: f.richText().optional(),
  seoTitle: f.text().optional(),
  seoDescription: f.text({ multiline: true }).optional(),
}, {
  label: "Publication pages", title: "title", content: "body", revisions: true,
  access: {
    read: (ctx) => ["admin", "editor", "author"].includes(ctx.user?.role ?? "") ? true : { status: "published" },
    create: "editor", update: "editor", delete: "editor",
  },
});

export default defineConfig({
  name: "emdash-starter",
  // Keep WordPress's complete native admin, plugin and settings screens.
  admin: false,
});
