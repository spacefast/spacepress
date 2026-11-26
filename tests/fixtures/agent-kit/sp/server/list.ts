import { job, mutation } from "spacepress";
import { db } from "spacepress/server";
import { shoppingList } from "spacepress/server/db";

export const rename = mutation({ access: "editor" }, async ({ id, name }: { id: number; name: string }) => {
  await db.update(shoppingList).set({ name }).where({ id });
  return { id, name };
});

export const clearDone = job({ retries: 2 }, async (_input: { keep?: number }) => {
  await db.delete(shoppingList).where({ done: true });
});
