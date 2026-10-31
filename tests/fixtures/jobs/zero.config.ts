// Feature 3 end to end on standalone (§6.1): a hook enqueues a job, the worker runs it.
import { collection, id, integer, text, defineConfig, db, job, jobs } from "zero";

const items = collection("items", { id: id(), name: text().notNull(), quantity: integer().notNull() }, { editor: false });
const alerts = collection("alerts", { id: id(), itemId: integer().notNull(), note: text().notNull() }, { editor: false });

export default defineConfig({
  schema: { items, alerts },
  jobs: {
    notifyLowStock: job({
      input: { itemId: integer().notNull() },
      retries: 2,
      handler: async (input, ctx) => {
        const item = await db.query.items.findFirst({ where: { id: input.itemId } });
        if (!item) throw new Error(`item ${input.itemId} is gone`);
        await db.insert(alerts).values({ itemId: item.id, note: `${item.name} is low (attempt ${ctx.attempt})` });
      },
    }),
  },
  hooks: {
    items: {
      async afterCreate(row) {
        if (row.quantity < 2) await jobs.notifyLowStock.enqueue({ itemId: row.id }, { key: `low-${row.id}` });
      },
    },
  },
});
