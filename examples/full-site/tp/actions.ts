// The site's one public action: a published note gets one more cheer. The pages island and the
// `CheerButton` client component both call it.
import { action, db, HttpError, integer } from "typedpress";
import { cheers } from "typedpress:db";

export const cheer = action({
  input: { noteId: integer() },
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
});
