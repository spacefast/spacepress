import { collection, text, slug, richText, boolean } from "spacepress";

export const docs = collection({
  title: text(),
  slug: slug({ source: "title" }),
  content: richText().optional(),
  // A page only signed-in readers see: the read rule hides it from visitors. A rule written as a
  // function says which drafts it shows too, as the blog example's does.
  members: boolean().default(false),
}, {
  hierarchical: true,
  url: "/:path",
  sync: "content/docs/**/*.md",
  access: { read: (ctx) => (ctx.user ? true : { members: false, status: "published" }), create: "editor", update: "editor", delete: "editor" },
});
