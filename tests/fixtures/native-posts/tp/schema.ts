import { wp, media, text, integer } from "typedpress";

// WordPress's posts, with a cover image and a reading time, at /blog/<slug>.
// The app's filter excludes one title, and WordPress still controls status and password visibility.
export const posts = wp.posts.extend({
  cover: media({ accept: "image" }).optional(),
  minutes: integer().min(1).optional(),
}, { url: "/blog/:slug", sync: "content/posts/*.md", access: { read: () => ({ title: { ne: "Hidden by app" } }) } });

// A kind like posts with its own rows: comments, drafts and revisions as posts have them.
export const notes = wp.posts.clone({
  mood: text().max(20).optional(),
}, { url: "/notes/:slug", access: { create: "author", update: "author" } });
