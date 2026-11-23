import { db, mutation } from "spacepress";
import { cheers } from "spacepress:db";

export const cheer = mutation({ access: "anyone" }, async ({ noteId }: { noteId: number }) => {
  const row = await db.query.cheers.findFirst({ where: { noteId } });
  if (row) {
    await db.update(cheers).set({ count: row.count + 1 }).where({ id: row.id });
    return { count: row.count + 1 };
  }
  await db.insert(cheers).values({ noteId, count: 1 });
  return { count: 1 };
});
