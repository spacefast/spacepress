import { collection, text, slug } from "spacepress";

const STAFF = ["author", "editor", "admin"];

export const notes = collection({
  title: text(),
  slug: slug({ source: "title" }).optional(),
}, {
  title: "title",
  access: {
    read: (ctx) => STAFF.includes(ctx.user?.role ?? "") ? true : { status: "published" },
    create: "author",
    update: "editor",
    delete: "editor",
  },
});
