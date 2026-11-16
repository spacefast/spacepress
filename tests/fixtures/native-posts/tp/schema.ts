import { wp, media, text, integer } from "typedpress";

// WordPress's posts, with a cover image and a reading time, at /blog/<slug>. A function read rule that
// allows everything: it must not open anyone's drafts or private posts (core's read_post decides those).
export const posts = wp.posts.extend({
  cover: media({ accept: "image" }).optional(),
  minutes: integer().min(1).optional(),
}, { url: "/blog/:slug", sync: "content/posts/*.md", access: { read: () => true } });

// A kind like posts with its own rows: comments, drafts and revisions as posts have them.
export const notes = wp.posts.clone({
  mood: text().max(20).optional(),
}, { url: "/notes/:slug", access: { create: "author", update: "author" } });
