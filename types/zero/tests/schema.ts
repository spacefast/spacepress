// Fixture schema for the type tests (self-contained; mirrors the pantry example).
import { boolean, collection, date, defineRelations, id, integer, json, text, timestamp } from "zero";

export const UNITS = ["pcs", "g", "kg"] as const;

const timestamps = {
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow().$onUpdate(() => new Date()),
};

export const locations = collection("locations", {
  id: id(),
  name: text().notNull(),
  kind: text({ enum: ["fridge", "freezer", "pantry"] }).notNull().default("pantry"),
});

export const items = collection("items", {
  id: id(),
  name: text().notNull(),
  quantity: integer().notNull().default(1),
  unit: text({ enum: UNITS }).notNull().default("pcs"),
  expiresOn: date(),
  opened: boolean().notNull().default(false),
  locationId: integer().references(() => locations.id, { onDelete: "set null" }),
  tags: json().$type<string[]>().notNull().$default(() => []),
  meta: json(),
  ...timestamps,
});

export const shoppingList = collection("shopping_list", {
  id: id(),
  itemId: integer().references(() => items.id, { onDelete: "cascade" }).unique(),
  name: text().notNull(),
  done: boolean().notNull().default(false),
});

export const schema = { locations, items, shoppingList };

export const relations = defineRelations(schema, (r) => ({
  items: { location: r.one.locations({ from: r.items.locationId, to: r.locations.id }) },
  locations: { items: r.many.items() },
  shoppingList: {
    item: r.one.items({ from: r.shoppingList.itemId, to: r.items.id, optional: false }),
  },
}));
