import { action, job, integer, text, db } from "typedpress";
import { shoppingList } from "typedpress:db";

export const rename = action({
  input: { id: integer(), name: text() },
  access: "editor",
  async handler({ id, name }) {
    await db.update(shoppingList).set({ name }).where({ id });
    return { id, name };
  },
});

export const clearDone = job({
  input: { keep: integer().default(0) },
  retries: 2,
  handler: async () => {
    await db.delete(shoppingList).where({ done: true });
  },
});
