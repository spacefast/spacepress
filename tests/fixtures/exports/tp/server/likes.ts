// The file name is free: `like` registers under its export name. The kind comes from "typedpress:db",
// which also works when the kind's module runs after this one.
import { action, integer, db } from "typedpress";
import { notes } from "typedpress:db";
export const like = action({ input: { id: integer() }, access: "anyone", async handler({ id }) {
  const row = await db.query.notes.findFirst({ where: { id } });
  const likes = (row?.likes ?? 0) + 1;
  await db.update(notes).set({ likes }).where({ id });
  return likes;
} });
