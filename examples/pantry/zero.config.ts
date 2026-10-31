import {
  collection, id, text, integer, boolean, date, timestamp, json,
  defineRelations, defineConfig, action, job, jobs, db, HttpError,
  type InferSelectModel,
} from "zero";
import { UNITS, LOW_STOCK, timestamps, slugify } from "./lib/fields";

// Composition is plain TypeScript: shared field sets, factories, spreads.
const named = <T extends object>(extra: T) => ({ id: id(), name: text().notNull(), ...extra });

export const locations = collection("locations", named({
  kind: text({ enum: ["fridge", "freezer", "pantry"] }).notNull().default("pantry"),
}), { editor: false });

export const items = collection("items", named({
  slug: text().unique().notNull().max(191),
  quantity: integer().notNull().default(1),
  unit: text({ enum: UNITS }).notNull().default("pcs"),
  lowStockAt: integer().notNull().default(LOW_STOCK),
  expiresOn: date(),
  opened: boolean().notNull().default(false),
  locationId: integer().references(() => locations.id, { onDelete: "set null" }),
  tags: json().$type<string[]>().notNull().$default(() => []),
  ...timestamps,
}), { editor: false });

export const shoppingList = collection("shopping_list", {
  id: id(),
  itemId: integer().references(() => items.id, { onDelete: "cascade" }).unique(),
  name: text().notNull(),
  done: boolean().notNull().default(false),
  notifiedAt: timestamp(),                // set by the notifyLowStock job
  ...timestamps,
}, { editor: false });

export const schema = { locations, items, shoppingList };

export const relations = defineRelations(schema, (r) => ({
  items: {
    location: r.one.locations({ from: r.items.locationId, to: r.locations.id }),
  },
  locations: { items: r.many.items() },
  shoppingList: {
    item: r.one.items({ from: r.shoppingList.itemId, to: r.items.id }),
  },
}));

type Item = InferSelectModel<typeof items>;

async function restock(item: Item) {
  if (item.quantity > item.lowStockAt) return;
  const existing = await db.query.shoppingList.findFirst({ where: { itemId: item.id } });
  if (!existing) {
    await db.insert(shoppingList).values({ itemId: item.id, name: item.name });
    // Off the request: runs after this write commits (`zero jobs work`, or the dev worker).
    await jobs.notifyLowStock.enqueue({ itemId: item.id }, { key: `low-${item.id}` });
  }
}

export default defineConfig({
  schema,
  relations,
  jobs: {
    // A real pantry would push a notification here; this one stamps the list entry.
    notifyLowStock: job({
      input: { itemId: integer().notNull() },
      retries: 2,
      handler: async ({ itemId }) => {
        await db.update(shoppingList).set({ notifiedAt: new Date().toISOString() }).where({ itemId });
      },
    }),
  },
  hooks: {
    items: {
      beforeCreate(data) {
        data.name = data.name.trim();
        if (data.name === "") throw new HttpError(422, "invalid_input", "name can't be empty");
        data.slug = slugify(data.name);
        data.tags = (data.tags ?? []).map((t) => t.toLowerCase());
      },
      afterCreate: restock,
      afterUpdate: restock,
    },
  },
  actions: {
    consume: action({
      input: { itemId: integer().notNull(), amount: integer().notNull().default(1) },
      async handler({ itemId, amount }) {
        const item = await db.query.items.findFirst({ where: { id: itemId } });
        if (!item) throw new HttpError(404, "not_found", `No item ${itemId}`);
        const [updated] = await db
          .update(items)
          .set({ quantity: Math.max(0, item.quantity - amount) })
          .where({ id: itemId })
          .returning();
        if (!updated) throw new HttpError(404, "not_found", `No item ${itemId}`);
        return { item: updated, message: `${updated.name}: ${updated.quantity} ${updated.unit} left` };
      },
    }),
    expiringSoon: action({
      input: { days: integer().notNull().default(3) },
      async handler({ days }) {
        const cutoff = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
        const soon = await db.query.items.findMany({
          where: { expiresOn: { lte: cutoff }, quantity: { gt: 0 } },
          orderBy: { expiresOn: "asc" },
          with: { location: true },
        });
        return soon.map((i) => ({
          name: i.name,
          expiresOn: i.expiresOn,
          where: i.location?.name ?? "somewhere",
        }));
      },
    }),
  },
});
