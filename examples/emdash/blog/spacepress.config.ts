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
  label: "Publication posts", title: "title", content: "body", revisions: true,
  // Like the EmDash blog and WordPress's default Discussion settings: readers comment with a name and
  // email, held for moderation the first time. Without `guests`, commenting needs a sign-in.
  comments: { guests: true, moderation: "first-time" },
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
  name: "emdash-blog",
  // Keep WordPress's complete native admin, plugin and settings screens.
  admin: false,
});
