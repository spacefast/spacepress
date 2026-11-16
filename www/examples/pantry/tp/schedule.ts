import { job, mail } from "typedpress";
import { shoppingList } from "typedpress:db";

// The weekly list mail. `restock` queues it a week ahead when the list gains an entry, under one
// key, so at most one mail is waiting; it then sends whatever is still open.
export const weeklyList = job({
  input: {},
  async handler() {
    const open = await shoppingList.system.list({ where: { done: false }, orderBy: { name: "asc" } });
    if (open.length === 0) return;
    await mail.send({
      to: "kitchen@example.com",
      subject: `Shopping list: ${open.length} items`,
      text: open.map((entry) => `- ${entry.name}`).join("\n"),
    });
  },
});
