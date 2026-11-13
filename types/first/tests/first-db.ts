// `import { … } from "first:db"` gives each registered kind by name (docs/spec/spec.md §2.1), typed
// from the registration in register.ts, and refuses a name the app doesn't register.
import { posts, items } from "first:db";
import { db } from "first";
import { posts as declared } from "./schema";

// The same kind the module declared: usable wherever the declaration is.
const same: typeof declared = posts;
// @ts-expect-error: a kind is not a number
const wrong: number = posts;
void wrong;
void same;
export async function bump(id: number) {
  await db.update(items).set({ quantity: 2 }).where({ id });
  // @ts-expect-error: not a column of items
  await db.update(items).set({ nope: 1 }).where({ id });
}

// @ts-expect-error: not a registered kind
import { missing } from "first:db";
void missing;

// The query API (spec §3): each kind lists, pages, gets, counts and writes as the visitor.
export async function queries(id: number) {
  const rows = await items.list({ where: { quantity: { gt: 1 } }, orderBy: { quantity: "desc" }, limit: 10, columns: { quantity: true } });
  const q: number = rows[0]!.quantity;
  const page = await items.paginate({ limit: 20, cursor: null });
  const next: string | null = page.cursor;
  const one = await items.get(id);
  const maybe: number | undefined = one?.quantity;
  const n: number = await items.count({ where: { quantity: 2 } });
  const created = await items.create({ name: "Nails", quantity: 3 });
  const changed = await items.update(created.id, { quantity: 4 });
  const removed = await items.delete(changed.id);
  const trusted = await items.system.list();
  void q; void next; void maybe; void n; void removed; void trusted;
  // @ts-expect-error: not a column of items
  await items.list({ where: { nope: 1 } });
  // @ts-expect-error: paginate takes a cursor, not an offset
  await items.paginate({ offset: 5 });
  // @ts-expect-error: a kind has no findMany; that is db.query's
  await items.findMany();
}
