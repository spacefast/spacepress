// The file name is free: `like` registers under its export name.
import { mutation } from "spacepress";
export const like = mutation({ access: "anyone" }, async ({ db }, { id }: { id: number }) => {
  const row = await db.system.notes.get(id);
  const likes = (row?.likes ?? 0) + 1;
  await db.system.notes.update(id, { likes });
  return likes;
});
