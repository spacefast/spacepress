import { f, mutation, table, type InferSelectModel } from "spacepress";
import { db, HttpError } from "spacepress/server";
import { stories } from "./stories";

export const locations = table(
  {
    name: f.text().min(1).max(80),
    kind: f.select(["fridge", "freezer", "pantry"]).default("pantry"),
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
    name: f.text().min(1).max(120),
    brand: f.text().max(80).optional(),
    notes: f.text({ multiline: true }).max(2000).optional(),
    opened: f.boolean().default(false),
    storyId: f.ref(() => stories).optional(),
    quantity: f.integer().min(0).default(1),
    unit: f.select(["pcs", "g", "ml"]).default("pcs"),
    lowStockAt: f.integer().min(0).default(1),
    expiresOn: f.date().optional(),
    locationId: f.ref(locations).optional(),
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
    itemId: f.ref(items).unique().onDelete("cascade"),
    name: f.text().min(1).max(120),
    done: f.boolean().default(false),
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
  const entry = await db.system.shoppingList.get({ itemId: item.id });
  const low = item.quantity <= item.lowStockAt;
  const crossedLow = !previous || previous.quantity > previous.lowStockAt;
  if (!entry) {
    if (low) await db.system.shoppingList.create({ itemId: item.id, name: item.name });
    return;
  }
  await db.system.shoppingList.update(entry.id, {
    name: item.name,
    done: low ? (crossedLow ? false : entry.done) : true,
  });
}

// Declared after `Item` so the handlers' types don't depend on the call that types `items`;
// `.on()` stays in this file, beside the declaration.
items.on({
  beforeCreate({ data }) {
    data.name = data.name.trim();
    if (!data.name)
      throw new HttpError(422, "invalid_input", "Give this item a name.");
  },
  beforeUpdate({ patch }) {
    if (patch.name !== undefined) {
      const name = patch.name?.trim();
      if (!name)
        throw new HttpError(422, "invalid_input", "Give this item a name.");
      patch.name = name;
    }
  },
  async afterCreate({ row }) {
    await syncShopping(row);
  },
  async afterUpdate({ row, previous }) {
    await syncShopping(row, previous);
  },
});

async function changeStock(itemId: number, amount: number, consuming: boolean) {
  const item = await db.system.items.get(itemId);
  if (!item)
    throw new HttpError(404, "not_found", "That pantry item no longer exists.");
  const quantity = consuming
    ? Math.max(0, item.quantity - amount)
    : item.quantity + amount;
  const updated = await db.system.items.update(itemId, { quantity });
  return {
    item: updated,
    message: `${updated.name}: ${updated.quantity} ${updated.unit} ${consuming ? "left" : "in stock"}`,
  };
}

export const consume = mutation({ access: "editor" }, async (_ctx, { itemId, amount = 1 }: { itemId: number; amount?: number }) => {
  if (!Number.isInteger(itemId)) throw new HttpError(422, "invalid_input", "itemId must be an integer", "/itemId");
  if (!Number.isInteger(amount)) throw new HttpError(422, "invalid_input", "amount must be an integer", "/amount");
  if (itemId < 1) throw new HttpError(422, "invalid_input", "itemId must be at least 1", "/itemId");
  if (amount < 1) throw new HttpError(422, "invalid_input", "amount must be at least 1", "/amount");
  return await changeStock(itemId, amount, true);
});

export const restock = mutation({ access: "editor" }, async (_ctx, { itemId, amount }: { itemId: number; amount: number }) => {
  if (!Number.isInteger(itemId)) throw new HttpError(422, "invalid_input", "itemId must be an integer", "/itemId");
  if (!Number.isInteger(amount)) throw new HttpError(422, "invalid_input", "amount must be an integer", "/amount");
  if (itemId < 1) throw new HttpError(422, "invalid_input", "itemId must be at least 1", "/itemId");
  if (amount < 1) throw new HttpError(422, "invalid_input", "amount must be at least 1", "/amount");
  return await changeStock(itemId, amount, false);
});
