// A small editorial site with optional TSX pages (pages/). The config holds the collections and
// access rules; the public `cheer` action is in first/actions.ts. The pages add-on reads it through
// viewer-bound queries and never through the trusted `db`.
import { collection, table, text, integer, richText, slug, timestamp, defineConfig, defineRelations } from "first";

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
  noteId: integer().unique().references(() => notes.id, { onDelete: "cascade" }),
  count: integer().default(0),
}, { access: { read: "anyone", create: "admin", update: "admin", delete: "admin" } });

export const relations = defineRelations({ notes, cheers }, (r) => ({
  notes: { cheers: r.many.cheers() },
  cheers: { note: r.one.notes({ from: r.cheers.noteId, to: r.notes.id, optional: false }) },
}));

export default defineConfig({
  name: "fullsite",
  collections: { notes },
  tables: { cheers },
  relations,
  admin: false,
});
