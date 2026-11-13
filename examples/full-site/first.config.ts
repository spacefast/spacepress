// A small editorial site with optional TSX pages (pages/). The config holds the collections and
// access rules; the public `cheer` action is in first/actions.ts. The pages add-on reads it through
// viewer-bound queries and never through the trusted `db`.
import { collection, table, text, integer, richText, slug, timestamp, defineConfig, ref } from "first";

const STAFF = ["author", "editor", "admin"];

export const notes = collection({
  title: text().min(1).max(120),
  slug: slug({ source: "title" }).optional(),
  dek: text({ multiline: true }).max(240).optional(),
  body: richText().optional(),
  // Staff-only desk notes: anonymous rows never carry the value.
  deskNotes: text({ multiline: true }).max(500).access({ read: "author", create: "editor", update: "editor" }).optional(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()),
}, {
  label: "Notes",
  title: "title",
  content: "body",
  access: {
    read: (ctx) => STAFF.includes(ctx.user?.role ?? "") ? true : { status: "published" },
    create: "author",
    update: "editor",
    delete: "editor",
  },
});

// Reader applause per note. Anyone may read counts; only the cheer action writes them.
export const cheers = table({
  noteId: ref(notes).unique().onDelete("cascade"),
  count: integer().default(0),
}, { access: { read: "anyone", create: "admin", update: "admin", delete: "admin" } });

export default defineConfig({
  name: "fullsite",
  collections: { notes },
  tables: { cheers },
  admin: false,
});
