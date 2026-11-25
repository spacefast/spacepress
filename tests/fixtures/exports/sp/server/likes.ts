// The file name is free: `like` registers under its export name. The kind comes from "spacepress:db",
// which also works when the kind's module runs after this one.
import { db, mutation } from "spacepress";
import { notes } from "spacepress:db";
export const like = mutation({ access: "anyone" }, async ({ id }: { id: number }) => {
  const row = await db.query.notes.findFirst({ where: { id } });
  const likes = (row?.likes ?? 0) + 1;
  await db.update(notes).set({ likes }).where({ id });
  return likes;
});
