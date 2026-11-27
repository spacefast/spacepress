import { collection, extend, f } from "spacepress";

export const notes = collection({
  title: f.text(),
  slug: f.slug({ source: "title" }).optional(),
  body: f.richText().optional(),
}, { title: "title", content: "body" });

export const journal = collection({
  title: f.text(),
  slug: f.slug({ source: "title" }).optional(),
}, { title: "title" });

// Readers must sign in for these: a kind with a URL whose items no visitor may read. The sitemap
// lists none of them.
export const drafts = collection({
  title: f.text(),
  slug: f.slug({ source: "title" }).optional(),
}, { title: "title", access: { read: "editor" } });

// A filter rule: a visitor reads only the rows that are not embargoed, so only those are listed.
export const briefs = collection({
  title: f.text(),
  slug: f.slug({ source: "title" }).optional(),
  embargoed: f.boolean().default(false),
}, {
  title: "title",
  access: { read: (ctx) => ctx.user?.role === "editor" || ctx.user?.role === "admin" ? true : { embargoed: false } },
});

// A kind without a `url` has no public address, so it has no sitemap.
export const memos = collection({ title: f.text() }, { title: "title" });

// The site's users. A visitor reads only the ones who chose to be listed, so the sitemap names
// only their author archives.
export const members = extend("users", {
  fields: {
    name: f.text().optional(),
    listed: f.boolean().default(false),
  },
  access: { read: (ctx) => ctx.user?.role === "admin" ? true : { listed: true }, update: "self", create: "admin", delete: "admin" },
});

// A slug only editors read: its addresses would carry it, so the kind is not listed at all.
export const cases = collection({
  title: f.text(),
  slug: f.slug({ source: "title" }).access({ read: "editor" }).optional(),
}, { title: "title" });

// Public rows, but the app page that serves their URL is behind a sign-in guard.
export const vault = collection({
  title: f.text(),
  slug: f.slug({ source: "title" }).optional(),
}, { title: "title" });
