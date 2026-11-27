// Unified `db.<kind>.*` API and capability enforcement (`ReadOnlyDb` vs `Db` vs `SystemDb`).
import { f, query, mutation, table } from "spacepress";
import { db } from "spacepress/server";

export async function bump(id: number) {
  await db.items.update(id, { quantity: 2 });
  // @ts-expect-error: not a column of items
  await db.items.update(id, { nope: 1 });
}

// Each kind lists, pages, gets, counts and writes as the visitor; `db.system.<kind>` bypasses access.
export async function queries(id: number) {
  const rows = await db.items.list({ where: { quantity: { gt: 1 } }, orderBy: { quantity: "desc" }, limit: 10, columns: { quantity: true } });
  const q: number = rows[0]!.quantity;
  const page = await db.items.paginate({ limit: 20, cursor: null });
  const next: string | null = page.cursor;
  const one = await db.items.get(id);
  const maybe: number | undefined = one?.quantity;
  const n: number = await db.items.count({ where: { quantity: 2 } });
  const created = await db.items.create({ name: "Nails", quantity: 3 });
  const changed = await db.items.update(created.id, { quantity: 4 });
  const removed = await db.items.delete(changed.id);
  const trusted = await db.system.items.list();
  void q; void next; void maybe; void n; void removed; void trusted;
  // @ts-expect-error: not a column of items
  await db.items.list({ where: { nope: 1 } });
  // @ts-expect-error: paginate takes a cursor, not an offset
  await db.items.paginate({ offset: 5 });
  // @ts-expect-error: findMany is gone
  await db.items.findMany();
  // @ts-expect-error: not a registered kind
  await db.missing.list();
}

// Capability enforcement: `query()` gets ReadOnlyDb (no writes); `mutation()` gets full Db.
export const readOnlyCheck = query({ access: "anyone" }, async ({ db: qdb }) => {
  const rows = await qdb.items.list();
  // @ts-expect-error: query() db is read-only
  await qdb.items.create({ name: "nope" });
  return rows;
});

export const writeCheck = mutation({ access: "editor" }, async ({ db: mdb }) => {
  return await mdb.items.create({ name: "ok" });
});

// `.index(fields, { unique? })` declares a compound index on the kind's own fields.
export const pairs = table({ a: f.integer(), b: f.integer() }).index(["a", "b"], { unique: true });
// @ts-expect-error: not a field of this kind
export const wrongPair = table({ a: f.integer() }).index(["nope"]);
// @ts-expect-error: at least one field
export const emptyPair = table({ a: f.integer() }).index([]);
