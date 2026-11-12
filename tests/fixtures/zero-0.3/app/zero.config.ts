import { collection, table, text, integer, boolean, timestamp, defineConfig, action, db, HttpError } from "zero";
import { MAX_TITLE, slugify } from "./lib/fields";

export const notes = table({
  title: text().notNull().max(MAX_TITLE),
  slug: text().notNull().unique().max(191),
  done: boolean().notNull().default(false),
  createdAt: timestamp().notNull().defaultNow(),
}, { access: { read: "anyone", create: "anyone", update: "anyone", delete: "admin" } });

export const pages = collection({
  title: text().notNull().max(MAX_TITLE),
  order: integer().notNull().default(0),
}, { label: "Pages", title: "title", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export default defineConfig({
  name: "notes",
  tables: { notes },
  collections: { pages },
  actions: {
    add: action({
      input: { title: text().notNull().max(MAX_TITLE) },
      access: "anyone",
      async handler({ title }) {
        const [row] = await db.insert(notes).values({ title, slug: slugify(title) }).returning();
        return row;
      },
    }),
    count: action({
      input: {},
      access: "anyone",
      async handler() {
        const rows = await db.query.notes.findMany({ columns: { id: true } });
        if (rows.length > 1000) throw new HttpError(409, "too_many", "too many notes");
        return { count: rows.length };
      },
    }),
  },
});
