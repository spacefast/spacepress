import { action, db, integer } from "first";
import { cheers } from "first:db";

export const cheer = action({
  input: { noteId: integer() },
  access: "anyone",
  async handler({ noteId }) {
    const row = await db.query.cheers.findFirst({ where: { noteId } });
    if (row) {
      await db.update(cheers).set({ count: row.count + 1 }).where({ id: row.id });
      return { count: row.count + 1 };
    }
    await db.insert(cheers).values({ noteId, count: 1 });
    return { count: 1 };
  },
});
