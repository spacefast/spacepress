import { collection, f } from "spacepress";

const STAFF = ["author", "editor", "admin"];

export const notes = collection({
  title: f.text(),
  slug: f.slug({ source: "title" }).optional(),
}, {
  title: "title",
  access: {
    read: (ctx) => STAFF.includes(ctx.user?.role ?? "") ? true : { status: "published" },
    create: "author",
    update: "editor",
    delete: "editor",
  },
});
