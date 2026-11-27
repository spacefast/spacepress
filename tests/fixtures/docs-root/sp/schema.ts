import { collection, f } from "spacepress";

export const docs = collection({
  title: f.text(),
  slug: f.slug({ source: "title" }),
  content: f.richText().optional(),
  // A page only signed-in readers see: the read rule hides it from visitors. A rule written as a
  // function says which drafts it shows too, as the blog example's does.
  members: f.boolean().default(false),
}, {
  hierarchical: true,
  sync: "content/docs/**/*.md",
  access: { read: (ctx) => (ctx.user ? true : { members: false, status: "published" }), create: "editor", update: "editor", delete: "editor" },
});
