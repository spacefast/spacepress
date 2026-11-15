import { collection, table, text, integer, richText, slug, ref } from "typedpress";

const STAFF = ["author", "editor", "admin"];

export const notes = collection({
  title: text().min(1).max(120),
  slug: slug({ source: "title" }).optional(),
  dek: text({ multiline: true }).max(240).optional(),
  body: richText().optional(),
  // Staff-only desk notes: a visitor's rows never carry the value.
  deskNotes: text({ multiline: true }).max(500)
    .access({ read: "author", create: "editor", update: "editor" }).optional(),
}, {
  label: "Notes",
  title: "title",
  content: "body",
  // tp/app/notes/[slug]/page.tsx serves each note at this address.
  url: "/notes/:slug",
  access: {
    read: (ctx) => STAFF.includes(ctx.user?.role ?? "") ? true : { status: "published" },
    create: "author",
    update: "editor",
    delete: "editor",
  },
});

// Reader applause per note. Anyone may read the counts; only the cheer mutation writes them.
export const cheers = table({
  noteId: ref(notes).unique().onDelete("cascade"),
  count: integer().default(0),
}, { access: { read: "anyone", create: "admin", update: "admin", delete: "admin" } });
