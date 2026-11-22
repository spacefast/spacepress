import { job, db, mutation } from "typedpress";
import { shoppingList } from "typedpress:db";

export const rename = mutation({ access: "editor" }, async ({ id, name }: { id: number; name: string }) => {
  await db.update(shoppingList).set({ name }).where({ id });
  return { id, name };
});

export const clearDone = job({ retries: 2 }, async (_input: { keep?: number }) => {
  await db.delete(shoppingList).where({ done: true });
});
