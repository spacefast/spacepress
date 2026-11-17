import {
  boolean,
  date,
  db,
  HttpError,
  integer,
  table,
  text,
  type InferSelectModel, select, ref, mutation,
} from "typedpress";
import { stories } from "./stories";

export const locations = table(
  {
    name: text().min(1).max(80),
    kind: select(["fridge", "freezer", "pantry"]).default("pantry"),
  },
  {
    label: "Locations",
    access: {
      read: "anyone",
      create: "editor",
      update: "editor",
      delete: "editor",
    },
  },
);

export const items = table(
  {
    name: text().min(1).max(120),
    brand: text().max(80).optional(),
    notes: text({ multiline: true }).max(2000).optional(),
    opened: boolean().default(false),
    storyId: ref(() => stories).optional(),
    quantity: integer().min(0).default(1),
    unit: select(["pcs", "g", "ml"]).default("pcs"),
    lowStockAt: integer().min(0).default(1),
    expiresOn: date().optional(),
    locationId: ref(locations).optional(),
  },
  {
    label: "Pantry items",
    access: {
      read: "anyone",
      create: "editor",
      update: "editor",
      delete: "editor",
    },
  },
);

export const shoppingList = table(
  {
    itemId: ref(items).unique().onDelete("cascade"),
    name: text().min(1).max(120),
    done: boolean().default(false),
  },
  {
    label: "Shopping list",
    access: {
      read: "anyone",
      create: "editor",
      update: "editor",
      delete: "editor",
    },
  },
);

type Item = InferSelectModel<typeof items>;

async function syncShopping(item: Item, previous?: Item) {
  const entry = await db.query.shoppingList.findFirst({
    where: { itemId: item.id },
  });
  const low = item.quantity <= item.lowStockAt;
  const crossedLow = !previous || previous.quantity > previous.lowStockAt;
  if (!entry) {
    if (low)
      await db
        .insert(shoppingList)
        .values({ itemId: item.id, name: item.name });
    return;
  }
  await db
    .update(shoppingList)
    .set({
      name: item.name,
      done: low ? (crossedLow ? false : entry.done) : true,
    })
    .where({ id: entry.id });
}

// Declared after `Item` so the handlers' types don't depend on the call that types `items`;
// `.on()` stays in this file, beside the declaration.
items.on({
  beforeCreate(data) {
    data.name = data.name.trim();
    if (!data.name)
      throw new HttpError(422, "invalid_input", "Give this item a name.");
  },
  beforeUpdate(patch) {
    if (patch.name !== undefined) {
      const name = patch.name?.trim();
      if (!name)
        throw new HttpError(422, "invalid_input", "Give this item a name.");
      patch.name = name;
    }
  },
  afterCreate: async (item) => {
    await syncShopping(item);
  },
  afterUpdate: syncShopping,
});

async function changeStock(itemId: number, amount: number, consuming: boolean) {
  const item = await db.query.items.findFirst({ where: { id: itemId } });
  if (!item)
    throw new HttpError(404, "not_found", "That pantry item no longer exists.");
  const quantity = consuming
    ? Math.max(0, item.quantity - amount)
    : item.quantity + amount;
  const [updated] = await db
    .update(items)
    .set({ quantity })
    .where({ id: itemId, quantity: item.quantity })
    .returning();
  if (!updated)
    throw new HttpError(
      409,
      "stock_changed",
      "Stock changed. Refresh and try again.",
    );
  return {
    item: updated,
    message: `${updated.name}: ${updated.quantity} ${updated.unit} ${consuming ? "left" : "in stock"}`,
  };
}

export const consume = mutation({ access: "editor" }, async ({ itemId, amount = 1 }: { itemId: number; amount?: number }) =>
  { if (itemId < 1) throw new HttpError(422, "invalid_input", "itemId must be at least 1", "/itemId"); if (amount < 1) throw new HttpError(422, "invalid_input", "amount must be at least 1", "/amount"); return await changeStock(itemId, amount, true); });

export const restock = mutation({ access: "editor" }, async ({ itemId, amount }: { itemId: number; amount: number }) =>
  { if (itemId < 1) throw new HttpError(422, "invalid_input", "itemId must be at least 1", "/itemId"); if (amount < 1) throw new HttpError(422, "invalid_input", "amount must be at least 1", "/amount"); return await changeStock(itemId, amount, false); });
