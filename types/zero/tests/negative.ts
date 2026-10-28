// Negative checks: each @ts-expect-error must be consumed by a real mistake.
import { action, db, defineConfig, HttpError, integer, text } from "zero";
import { items, locations, schema, relations, shoppingList, UNITS } from "./schema";

async function filters() {
  // Unknown column in a where filter
  // @ts-expect-error `quantiy` is not a column of items
  await db.query.items.findMany({ where: { quantiy: { gt: 0 } } });

  // Unknown operator
  // @ts-expect-error `greaterThan` is not a filter operator
  await db.query.items.findMany({ where: { quantity: { greaterThan: 0 } } });

  // Wrong value type in a filter
  // @ts-expect-error quantity is a number
  await db.query.items.findFirst({ where: { quantity: "3" } });

  // Unknown column in update/delete where
  // @ts-expect-error `nme` is not a column of shopping_list
  await db.delete(shoppingList).where({ nme: "milk" });

  // Unknown relation in `with`
  // @ts-expect-error items has no `shelf` relation
  await db.query.items.findMany({ with: { shelf: true } });

  // Unknown collection key
  // @ts-expect-error there is no `pantry` collection
  await db.query.pantry.findMany();

  // orderBy direction
  // @ts-expect-error orderBy is "asc" | "desc"
  await db.query.items.findMany({ orderBy: { name: "up" } });
}

async function writes() {
  // Wrong value type for a column in values()
  // @ts-expect-error quantity is a number
  await db.insert(items).values({ name: "milk", quantity: "two" });

  // Missing required insert field
  // @ts-expect-error `name` is NOT NULL without a default
  await db.insert(items).values({ quantity: 2 });

  // Enum value outside the union
  // @ts-expect-error "tons" is not one of UNITS
  await db.insert(items).values({ name: "flour", unit: "tons" });

  // Unknown column in set()
  // @ts-expect-error `qty` is not a column of items
  await db.update(items).set({ qty: 1 });
}

async function relationsNotLoaded() {
  const item = await db.query.items.findFirst({ where: { id: 1 } });
  // @ts-expect-error `location` wasn't loaded via `with`
  item?.location;

  const loc = await db.query.locations.findFirst({ columns: { name: true } });
  // @ts-expect-error `kind` was excluded by `columns`
  loc?.kind;
}

// Enum default outside the union
// @ts-expect-error "attic" is not a location kind
text({ enum: ["fridge", "pantry"] }).default("attic");

// Enum value on a select row
declare const unit: (typeof items)["$inferSelect"]["unit"];
// @ts-expect-error "tons" is not comparable with UNITS
if (unit === "tons") void UNITS;

// references() must point at a column of the same type
// @ts-expect-error locations.name is text, not integer
integer().references(() => locations.name);

// defaultNow() only exists on timestamp/date
// @ts-expect-error integer columns have no `now`
integer().defaultNow();

// Hook mistakes: one defineConfig per mistake, since tsc reports only the
// first assignability failure inside a single argument.
defineConfig({
  schema,
  relations,
  hooks: {
    items: {
      // @ts-expect-error misspelled hook name
      beforeCreated(data: unknown) {
        void data;
      },
    },
  },
});

defineConfig({
  schema,
  // @ts-expect-error hooks are keyed by schema key, not table name
  hooks: { shopping_list: {} },
});

defineConfig({
  schema,
  hooks: {
    items: {
      beforeUpdate(patch) {
        // @ts-expect-error quantity is a number
        patch.quantity = "lots";
      },
      // @ts-expect-error afterCreate receives a row, not a string
      afterCreate(row: string) {
        void row;
      },
    },
  },
});

defineConfig({
  schema,
  actions: {
    consume: action({
      input: { itemId: integer().notNull() },
      handler({ itemId }) {
        // @ts-expect-error itemId is a number
        const s: string = itemId;
        // @ts-expect-error HttpError takes (status, code, message)
        if (!s) throw new HttpError(404, "not found");
        return s;
      },
    }),
  },
});
