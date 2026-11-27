// A small editorial site: the config holds the collections and access rules, sp/app/ the TSX
// pages and HTTP routes, and sp/actions.ts the public `cheer` action. Pages read as the visitor.
import { collection, table, defineConfig, f } from "spacepress";

const STAFF = ["author", "editor", "admin"];

export const notes = collection({
  title: f.text().min(1).max(120),
  slug: f.slug({ source: "title" }).optional(),
  dek: f.text({ multiline: true }).max(240).optional(),
  body: f.richText().optional(),
  // Staff-only desk notes: anonymous rows never carry the value.
  deskNotes: f.text({ multiline: true }).max(500).access({ read: "author", create: "editor", update: "editor" }).optional(),
  updatedAt: f.timestamp().defaultNow().onUpdate(() => new Date()),
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
  noteId: f.ref(notes).unique().onDelete("cascade"),
  count: f.integer().default(0),
}, { access: { read: "anyone", create: "admin", update: "admin", delete: "admin" } });

export default defineConfig({
  name: "fullsite",
  admin: false,
});
