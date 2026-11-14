import { action, collection, defineConfig, media, richText, text } from "first";

import { getReadingTime } from "./first/backend/reading-time";

// Native WordPress titles and blocks; the remaining fields are editable in SCF.
export const posts = collection({
  title: text(),
  body: richText().optional(),
  excerpt: text({ multiline: true }).optional(),
  cover: media({ accept: "image" }).optional(),
  seoTitle: text().optional(),
  seoDescription: text({ multiline: true }).optional(),
}, {
  label: "Publication posts", title: "title", content: "body", revisions: true, comments: true,
  access: {
    read: (ctx) => ["admin", "editor", "author"].includes(ctx.user?.role ?? "") ? true : { status: "published" },
    create: "editor", update: "editor", delete: "editor",
  },
});

export const pages = collection({
  title: text(),
  body: richText().optional(),
  seoTitle: text().optional(),
  seoDescription: text({ multiline: true }).optional(),
}, {
  label: "Publication pages", title: "title", content: "body", revisions: true,
  access: {
    read: (ctx) => ["admin", "editor", "author"].includes(ctx.user?.role ?? "") ? true : { status: "published" },
    create: "editor", update: "editor", delete: "editor",
  },
});

export const readingTime = action({
  input: { content: text() },
  access: "anyone",
  handler: ({ content }) => ({ minutes: getReadingTime([{ _type: "block", children: [{ _type: "span", text: content }] }]) }),
});

export default defineConfig({
  name: "emdash-starter",
  // Keep WordPress's complete native admin, plugin and settings screens.
  admin: false,
});
