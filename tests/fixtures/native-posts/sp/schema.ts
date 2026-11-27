import { collection, extend, f } from "spacepress";

// WordPress's posts, with a cover image and a reading time, at /blog/<slug>.
// The app's filter excludes one title, and WordPress still controls status and password visibility.
export const posts = extend("posts", {
  fields: {
    cover: f.media({ accept: "image" }).optional(),
    minutes: f.integer().min(1).optional(),
  },
  sync: "content/posts/*.md",
  access: { read: () => ({ title: { ne: "Hidden by app" } }) },
});

// A kind like posts with its own rows: comments, drafts and revisions as posts have them.
export const notes = collection({
  title: f.text(),
  slug: f.slug({ source: "title" }).optional(),
  body: f.richText().optional(),
  excerpt: f.text({ multiline: true }).optional(),
  mood: f.text().max(20).optional(),
}, { title: "title", content: "body", drafts: true, revisions: true, comments: true, access: { create: "author", update: "author" } });
