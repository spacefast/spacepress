import {
  text, integer, boolean, date, timestamp, json,
  action, job, jobs, HttpError,
  table, select, ref,
} from "typedpress";
import { UNITS, LOW_STOCK, timestamps, slugify } from "./lib/fields";

// Composition is plain TypeScript: shared field sets, factories, spreads.
const named = <T extends object>(extra: T) => ({ name: text(), ...extra });

export const locations = table(named({
  kind: select(["fridge", "freezer", "pantry"]).default("pantry"),
}));

export const items = table(named({
  slug: text().unique().max(191),
  quantity: integer().default(1),
  unit: select(UNITS).default("pcs"),
  lowStockAt: integer().default(LOW_STOCK),
  expiresOn: date().optional(),
  opened: boolean().default(false),
  locationId: ref(locations).optional(),
  tags: json<string[]>().$default(() => []),
  ...timestamps,
})).on({
  // Handlers compile to PHP and run inside the write; a throw rolls it back.
  beforeCreate(data) {
    data.name = data.name.trim();
    if (data.name === "") throw new HttpError(422, "invalid_input", "name can't be empty");
    data.slug = slugify(data.name);
    data.tags = (data.tags ?? []).map((t) => t.toLowerCase());
  },
  async afterCreate(row) { await restock(row.id, row.name, row.quantity, row.lowStockAt); },
  async afterUpdate(row) { await restock(row.id, row.name, row.quantity, row.lowStockAt); },
});

export const shoppingList = table({
  itemId: ref(items).unique().optional().onDelete("cascade"),
  name: text(),
  done: boolean().default(false),
  notifiedAt: timestamp().optional(),                // set by the notifyLowStock job
  ...timestamps,
});

// An item at or below its low-stock mark gets one shopping-list entry.
async function restock(itemId: number, name: string, quantity: number, lowStockAt: number) {
  if (quantity > lowStockAt) return;
  const existing = await shoppingList.system.get({ itemId });
  if (!existing) {
    await shoppingList.system.create({ itemId, name });
    // Off the request: runs after this write commits (Action Scheduler delivers it).
    await jobs.notifyLowStock.enqueue({ itemId }, { key: `low-${itemId}` });
    // The weekly list mail (tp/schedule.ts): one waiting at a time, a week from now.
    await jobs.weeklyList.enqueue({}, { delay: 7 * 86_400, key: "weekly-list" });
  }
}

// A real pantry would push a notification here; this one stamps the list entry.
export const notifyLowStock = job({
  input: { itemId: integer() },
  retries: 2,
  async handler({ itemId }) {
    const entry = await shoppingList.system.get({ itemId });
    if (entry) await shoppingList.system.update(entry.id, { notifiedAt: new Date().toISOString() });
  },
});

export const consume = action({
  input: { itemId: integer(), amount: integer().default(1) },
  access: "editor",
  async handler({ itemId, amount }) {
    const item = await items.get(itemId);
    if (!item) throw new HttpError(404, "not_found", `No item ${itemId}`);
    const updated = await items.update(itemId, { quantity: Math.max(0, item.quantity - amount) });
    return { item: updated, message: `${updated.name}: ${updated.quantity} ${updated.unit} left` };
  },
});

export const expiringSoon = action({
  input: { days: integer().default(3) },
  access: "editor",
  readonly: true,
  async handler({ days }) {
    const cutoff = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    const soon = await items.list({
      where: { expiresOn: { lte: cutoff }, quantity: { gt: 0 } },
      orderBy: { expiresOn: "asc" },
      with: { locationId: true },
    });
    return soon.map((i) => ({
      name: i.name,
      expiresOn: i.expiresOn,
      where: i.locationId?.name ?? "somewhere",
    }));
  },
});
