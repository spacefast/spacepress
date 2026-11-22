import { collection, table, text, integer, boolean, timestamp, defineConfig, db, HttpError, mutation } from "typedpress";
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

// `rateLimit: false` and `count` as a mutation keep what the 0.3.0 capture compiles to.
export const add = mutation({ access: "anyone", rateLimit: false }, async ({ title }: { title: string }) => {
  if (title.length > MAX_TITLE) throw new HttpError(422, "invalid_input", `title must be at most ${MAX_TITLE} characters`, "/title");
  const [row] = await db.insert(notes).values({ title, slug: slugify(title) }).returning();
  return row;
});

export const count = mutation({ access: "anyone", rateLimit: false }, async () => {
  const rows = await db.query.notes.findMany({ columns: { id: true } });
  if (rows.length > 1000) throw new HttpError(409, "too_many", "too many notes");
  return { count: rows.length };
});

export default defineConfig({
  name: "notes",
});
