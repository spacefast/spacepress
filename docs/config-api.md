# zero.config.ts API (v0)

`zero build` reads `zero.config.ts`, evaluates it at build time with Zero's own
Rust evaluator (no Node, no JS engine), and compiles hooks/actions to PHP.
Everything below is exported from the `"zero"` module. Shapes follow Drizzle
ORM 1.0 (beta.22): column builders, `defineRelations`, relational-query
`findMany`/`findFirst` with object filters.

## Full example (the pantry tracker)

```ts
import {
  collection, id, text, integer, real, boolean, date, timestamp, json,
  defineRelations, defineConfig, action, db, HttpError,
  type InferSelectModel,
} from "zero";

// Composition is plain TypeScript: shared field sets, factories, spreads.
const timestamps = {
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow().$onUpdate(() => new Date()),
};

const named = (extra = {}) => ({ id: id(), name: text().notNull(), ...extra });

export const locations = collection("locations", {
  ...named(),
  kind: text({ enum: ["fridge", "freezer", "pantry"] }).notNull().default("pantry"),
});

export const items = collection("items", {
  ...named(),
  quantity: integer().notNull().default(1),
  unit: text({ enum: UNITS }).notNull().default("pcs"),
  lowStockAt: integer().notNull().default(LOW_STOCK),
  expiresOn: date(),
  opened: boolean().notNull().default(false),
  locationId: integer().references(() => locations.id, { onDelete: "set null" }),
  tags: json().$type<string[]>().notNull().$default(() => []),
  ...timestamps,
});

export const shoppingList = collection("shopping_list", {
  id: id(),
  itemId: integer().references(() => items.id, { onDelete: "cascade" }).unique(),
  name: text().notNull(),
  done: boolean().notNull().default(false),
  ...timestamps,
});

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
  }
}

export default defineConfig({
  schema,
  relations,
  hooks: {
    items: {
      beforeCreate(data) {
        data.name = data.name.trim();
        if (data.name === "") throw new HttpError(422, "invalid_input", "name can't be empty");
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
        return { item: updated, message: `${updated.name}: ${updated.quantity} ${updated.unit} left` };
      },
    }),
  },
});
```

## Columns

| builder | SQL | TS select type |
|---|---|---|
| `id()` | INTEGER PRIMARY KEY AUTOINCREMENT | `number` |
| `integer()` | INTEGER | `number` |
| `real()` | REAL | `number` |
| `text()` / `text({ enum: [...] })` | TEXT | `string` / union of the enum |
| `boolean()` | INTEGER 0/1 | `boolean` |
| `timestamp()` | TEXT (UTC ISO-8601 with ms) | `string` |
| `date()` | TEXT `YYYY-MM-DD` | `string` |
| `json()` / `json().$type<T>()` | TEXT (JSON) | `unknown` / `T` |

Modifiers (each returns a new builder; builders are immutable so shared field
sets are safe): `.notNull()`, `.default(value)`, `.defaultNow()`
(timestamp/date), `.$default(() => value)` / `.$defaultFn(...)` (runs in PHP on
insert), `.$onUpdate(() => value)` / `.$onUpdateFn(...)` (runs in PHP on
update; `() => new Date()` on a timestamp is recognized as "now"),
`.unique()`, `.primaryKey()`, `.references(() => other.col, { onDelete,
onUpdate })` with actions `"cascade" | "restrict" | "set null" | "no action"`,
`.$type<T>()` (type only).

Column keys are the SQL column names.

## Collections

`collection(name, columns, options?)`. `name` is the table name and the
REST path segment (`/api/<name>`); the key under `schema` is the name used in
`db.query.<key>` and in `hooks`/`relations`. A collection with no primary key
is a build error. Options: `{ api?: { list?, get?, create?, update?, delete? } }`
(booleans, default all `true`).

## Relations

`defineRelations(schema, (r) => ({ ... }))`, Drizzle 1.0 style:
`r.one.<key>({ from: r.<this>.<col>, to: r.<target>.<col>, optional? })`,
`r.many.<key>({ from, to })`. `r.many.<key>()` with no config is inferred from
the single `one` relation pointing back.

## Hooks

`hooks.<collectionKey>` in `defineConfig`:

| hook | arguments | notes |
|---|---|---|
| `beforeCreate` | `(data: Insert)` | mutate `data` or return a replacement |
| `afterCreate` | `(row: Row)` | |
| `beforeUpdate` | `(patch: Partial<Insert>, existing: Row)` | mutate `patch` or return a replacement |
| `afterUpdate` | `(row: Row, previous: Row)` | |
| `beforeDelete` / `afterDelete` | `(row: Row)` | throw to abort |

Throwing anything aborts the request and rolls back every write in it.
`throw new HttpError(status, code, message)` picks the HTTP response.

## Actions

`action({ input: { ...columns }, handler(input) { ... } })` → `POST /api/actions/<name>`.
`input` uses column builders for validation; the return value is the response `data`.

## Database API (hooks and actions only)

```ts
await db.query.items.findMany({ where, orderBy, limit, offset, columns, with });
await db.query.items.findFirst({ where, ... });
await db.insert(items).values(row | rows).returning?();
await db.update(items).set(patch).where(filter).returning?();
await db.delete(items).where(filter).returning?();
```

`where` is the Drizzle 1.0 object filter: `{ col: value }`, `{ col: { eq, ne,
gt, gte, lt, lte, in, notIn, like, ilike, notLike, notIlike, isNull,
isNotNull, OR, AND, NOT } }`, top-level `OR`/`AND`/`NOT`, relation keys
(`{ location: { kind: "fridge" } }` or `{ location: true }`). `orderBy` is
`{ col: "asc" | "desc" }`. Column, relation, and operator names in literal
filters are checked at build time.

`await` on these calls compiles to plain blocking PHP calls.

## The subset (enforced at build time)

Supported: `const`/`let`, functions, arrows, closures, destructuring,
spread, template literals, `if`/`for`/`for...of`/`while`/`switch`/`try`,
`?.`, `??`, objects, arrays, type annotations, type aliases, interfaces,
generics (erased).

Rejected with a located error and a fix: classes, `this`, `var`, `enum`,
`==` (except `== null`), `in`, `instanceof`, `delete`, generators,
`for...in`, labels, getters/setters, BigInt, dynamic `import()`, `any`,
`eval`/`Function`, assigning to module-level state from a hook, mutating an
object after storing it in another (PHP copies on store), `await` on
anything that isn't a Zero API call or your own `async` function, an
`async` call without `await`.

Build-time evaluation forbids I/O, `Date.now()`, `new Date()`, `Math.random()`,
and `db`, and stops runaway loops with a step budget.

Imports: type-only imports (erased), relative `.ts` files (compiled with the
config), and `"zero"`. npm packages are rejected unless they ship TypeScript
source that fits the subset (not implemented yet: today they're rejected).
