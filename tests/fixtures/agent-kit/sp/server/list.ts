import { job, mutation } from "spacepress";

export const rename = mutation({ access: "editor" }, async ({ db }, { id, name }: { id: number; name: string }) => {
  await db.shoppingList.update(id, { name });
  return { id, name };
});

export const clearDone = job({ retries: 2 }, async ({ db }, _input: { keep?: number }) => {
  const done = await db.shoppingList.list({ where: { done: true } });
  for (const row of done) {
    await db.shoppingList.delete(row.id);
  }
});
