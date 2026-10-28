// Positive checks: inferred types are exactly what the spec says.
import { action, db, defineConfig, integer, text, type InferInsertModel, type InferSelectModel } from "zero";
import { items, locations, relations, schema, shoppingList } from "./schema";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
declare function expectType<T extends true>(): void;

type Item = InferSelectModel<typeof items>;
type Location = InferSelectModel<typeof locations>;
type ItemInsert = InferInsertModel<typeof items>;
type RequiredKeys<T> = { [K in keyof T]-?: {} extends Pick<T, K> ? never : K }[keyof T];

// Select types
expectType<Equal<Item["id"], number>>();
expectType<Equal<Item["unit"], "pcs" | "g" | "kg">>();
expectType<Equal<Location["kind"], "fridge" | "freezer" | "pantry">>();
expectType<Equal<Item["expiresOn"], string | null>>();
expectType<Equal<Item["createdAt"], string>>();
expectType<Equal<Item["opened"], boolean>>();
expectType<Equal<Item["tags"], string[]>>();
expectType<Equal<Item["meta"], unknown>>();
expectType<Equal<Item["locationId"], number | null>>();
expectType<Equal<Item, (typeof items)["$inferSelect"]>>();

// Insert types: only NOT NULL columns without a default are required
expectType<Equal<RequiredKeys<ItemInsert>, "name">>();
expectType<Equal<keyof ItemInsert, keyof Item>>();

async function queries() {
  const withLocation = await db.query.items.findMany({ with: { location: true } });
  expectType<Equal<(typeof withLocation)[number]["location"], Location | null>>();

  // optional: false -> not nullable
  const entry = await db.query.shoppingList.findFirst({ with: { item: true } });
  expectType<Equal<NonNullable<typeof entry>["item"], Item>>();

  // columns pick + nested with
  const loc = await db.query.locations.findFirst({
    columns: { name: true },
    with: { items: { columns: { id: true }, with: { location: true }, limit: 5 } },
  });
  expectType<Equal<typeof loc, { name: string; items: { id: number; location: Location | null }[] } | undefined>>();

  // columns omit
  const lists = await db.query.shoppingList.findMany({
    columns: { done: false },
    where: { item: { location: { kind: "fridge" } }, OR: [{ done: true }, { name: { like: "%milk%" } }] },
    orderBy: { name: "asc" },
  });
  expectType<Equal<keyof (typeof lists)[number], "id" | "itemId" | "name">>();

  const inserted = await db.insert(items).values([{ name: "a" }, { name: "b", unit: "kg" }]).returning();
  expectType<Equal<typeof inserted, Item[]>>();
  const updated = await db.update(items).set({ quantity: 2 }).where({ id: { in: [1, 2] } }).returning();
  expectType<Equal<typeof updated, Item[]>>();
  await db.delete(shoppingList).where({ done: true, itemId: { isNull: true } });
}

export default defineConfig({
  schema,
  relations,
  hooks: {
    items: {
      beforeCreate(data) {
        expectType<Equal<typeof data, ItemInsert>>();
        data.name = data.name.trim();
      },
      async beforeUpdate(patch, existing) {
        expectType<Equal<typeof patch, Partial<ItemInsert>>>();
        return { ...patch, name: existing.name };
      },
      afterUpdate(row, previous) {
        expectType<Equal<typeof row | typeof previous, Item>>();
      },
    },
  },
  actions: {
    consume: action({
      input: { itemId: integer().notNull(), amount: integer().default(1), note: text() },
      handler(input) {
        expectType<Equal<typeof input, { itemId: number; amount: number | null; note?: string | null }>>();
        return input.itemId;
      },
    }),
  },
});
void queries;
