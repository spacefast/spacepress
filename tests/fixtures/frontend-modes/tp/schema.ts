import { boolean, collection, email, text, slug, richText, userProjection } from "typedpress";

export const notes = collection({
  title: text(),
  slug: slug({ source: "title" }).optional(),
  body: richText().optional(),
}, { title: "title", content: "body", url: "/notes/:slug" });

export const journal = collection({
  title: text(),
  slug: slug({ source: "title" }).optional(),
}, { title: "title", url: "/journal/:year/:slug" });

// Readers must sign in for these: a kind with a URL whose items no visitor may read. The sitemap
// lists none of them.
export const drafts = collection({
  title: text(),
  slug: slug({ source: "title" }).optional(),
}, { title: "title", url: "/desk/:slug", access: { read: "editor" } });

// A filter rule: a visitor reads only the rows that are not embargoed, so only those are listed.
export const briefs = collection({
  title: text(),
  slug: slug({ source: "title" }).optional(),
  embargoed: boolean().default(false),
}, {
  title: "title",
  url: "/briefs/:slug",
  access: { read: (ctx) => ctx.user?.role === "editor" || ctx.user?.role === "admin" ? true : { embargoed: false } },
});

// A kind without a `url` has no public address, so it has no sitemap.
export const memos = collection({ title: text() }, { title: "title" });

// The site's users. A visitor reads only the ones who chose to be listed, so the sitemap names
// only their author archives.
export const members = userProjection({
  email: email().unique().max(191),
  name: text().optional(),
  listed: boolean().default(false),
}, { access: { read: (ctx) => ctx.user?.role === "admin" ? true : { listed: true }, update: "self", create: "admin", delete: "admin" } });

// A slug only editors read: its addresses would carry it, so the kind is not listed at all.
export const cases = collection({
  title: text(),
  slug: slug({ source: "title" }).access({ read: "editor" }).optional(),
}, { title: "title", url: "/cases/:slug" });

// Public rows, but the app page that serves their URL is behind a sign-in guard.
export const vault = collection({
  title: text(),
  slug: slug({ source: "title" }).optional(),
}, { title: "title", url: "/members/vault/:slug" });
