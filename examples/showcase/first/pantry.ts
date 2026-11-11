import {
  action,
  boolean,
  date,
  db,
  HttpError,
  integer,
  table,
  text,
  type CollectionHooks,
  type InferSelectModel,
} from "first";
import { stories } from "./stories";

export const locations = table(
  {
    name: text().notNull().min(1).max(80),
    kind: text({ enum: ["fridge", "freezer", "pantry"] })
      .notNull()
      .default("pantry"),
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
    name: text().notNull().min(1).max(120),
    brand: text().max(80),
    notes: text({ multiline: true }).max(2000),
    opened: boolean().notNull().default(false),
    storyId: integer().references(() => stories.id, { onDelete: "set null" }),
    quantity: integer().notNull().min(0).default(1),
    unit: text({ enum: ["pcs", "g", "ml"] })
      .notNull()
      .default("pcs"),
    lowStockAt: integer().notNull().min(0).default(1),
    expiresOn: date(),
    locationId: integer().references(() => locations.id, {
      onDelete: "set null",
    }),
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
    itemId: integer()
      .notNull()
      .unique()
      .references(() => items.id, { onDelete: "cascade" }),
    name: text().notNull().min(1).max(120),
    done: boolean().notNull().default(false),
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

export const itemHooks: CollectionHooks<typeof items> = {
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
};

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

export const consume = action({
  access: "editor",
  input: {
    itemId: integer().notNull().min(1),
    amount: integer().notNull().min(1).default(1),
  },
  handler: async ({ itemId, amount }) =>
    await changeStock(itemId, amount, true),
});

export const restock = action({
  access: "editor",
  input: {
    itemId: integer().notNull().min(1),
    amount: integer().notNull().min(1),
  },
  handler: async ({ itemId, amount }) =>
    await changeStock(itemId, amount, false),
});
