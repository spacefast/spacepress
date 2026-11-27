import { mutation } from "spacepress";

export const cheer = mutation({ access: "anyone" }, async ({ db }, { noteId }: { noteId: number }) => {
  const row = await db.system.cheers.get({ noteId });
  if (row) {
    await db.system.cheers.update(row.id, { count: row.count + 1 });
    return { count: row.count + 1 };
  }
  await db.system.cheers.create({ noteId, count: 1 });
  return { count: 1 };
});
