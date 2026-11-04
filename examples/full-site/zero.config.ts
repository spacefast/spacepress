// A small editorial site with optional TSX pages (pages/). The config stays the whole backend:
// collections, access rules and one public action. The pages add-on reads it through
// viewer-bound queries and never through the trusted `db`.
import { collection, table, text, integer, richText, slug, timestamp, defineConfig, defineRelations, action, db, HttpError } from "zero";

const STAFF = ["author", "editor", "admin"];

export const notes = collection({
  title: text().notNull().min(1).max(120),
  slug: slug({ source: "title" }),
  dek: text({ multiline: true }).max(240),
  body: richText(),
  // Staff-only desk notes: anonymous rows never carry the value.
  deskNotes: text({ multiline: true }).max(500).access({ read: "author", create: "editor", update: "editor" }),
  updatedAt: timestamp().notNull().defaultNow().$onUpdate(() => new Date()),
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
  noteId: integer().notNull().unique().references(() => notes.id, { onDelete: "cascade" }),
  count: integer().notNull().default(0),
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
  actions: {
    // The page's one interactive action: a published note gets one more cheer.
    cheer: action({
      input: { noteId: integer().notNull() },
      access: "anyone",
      async handler({ noteId }) {
        const note = await db.query.notes.findFirst({ where: { id: noteId, status: "published" } });
        if (!note) throw new HttpError(404, "not_found", "No published note has that id");
        const row = await db.query.cheers.findFirst({ where: { noteId } });
        if (row) {
          await db.update(cheers).set({ count: row.count + 1 }).where({ id: row.id });
          return { count: row.count + 1 };
        }
        await db.insert(cheers).values({ noteId, count: 1 });
        return { count: 1 };
      },
    }),
  },
  admin: false,
});
