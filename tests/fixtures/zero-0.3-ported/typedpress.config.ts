import { collection, table, text, integer, boolean, timestamp, defineConfig, action, db, HttpError } from "typedpress";
import { MAX_TITLE, slugify } from "./tp/lib/fields";

export const notes = table({
  title: text().max(MAX_TITLE),
  slug: text().unique().max(191),
  done: boolean().default(false),
  createdAt: timestamp().defaultNow(),
}, { access: { read: "anyone", create: "anyone", update: "anyone", delete: "admin" } });

export const pages = collection({
  title: text().max(MAX_TITLE),
  order: integer().default(0),
}, { label: "Pages", title: "title", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export const add = action({
  input: { title: text().max(MAX_TITLE) },
  access: "anyone",
  async handler({ title }) {
    const [row] = await db.insert(notes).values({ title, slug: slugify(title) }).returning();
    return row;
  },
});

export const count = action({
  input: {},
  access: "anyone",
  async handler() {
    const rows = await db.query.notes.findMany({ columns: { id: true } });
    if (rows.length > 1000) throw new HttpError(409, "too_many", "too many notes");
    return { count: rows.length };
  },
});

export default defineConfig({
  name: "notes",
});
