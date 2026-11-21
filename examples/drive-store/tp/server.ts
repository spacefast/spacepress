// The actions the storefront's forms post to. Each is also a WordPress Ability and an MCP tool.
// The shop's rules (price, stock, who sees which order) live on the kinds in tp/schema.ts, so an
// order placed here, over the API or in TypedPress Admin is checked the same way.
import { action, adminScreen, db, email, HttpError, integer, item, text } from "typedpress";
import { orders } from "typedpress:db";
import { drives, stockMovements } from "./schema";

// A fake checkout: no payment is taken. Anyone may buy; a signed-in buyer finds the order again
// under "My orders".
export const buy = action({
  input: {
    drive: integer(),
    quantity: integer().min(1).max(5).default(1),
    buyerName: text().min(1).max(80),
    buyerEmail: email().max(191),
  },
  access: "anyone",
  async handler(input, ctx) {
    const code = crypto.randomUUID().slice(0, 8).toUpperCase();
    // Trusted insert: guests can't create orders over the API, but they can buy here. The orders
    // kind's beforeCreate hook still prices the order and checks the stock.
    const [order] = await db.insert(orders).values({ ...input, code, buyerId: ctx.user?.id ?? 0 }).returning();
    if (!order) throw new HttpError(500, "internal", "The order wasn't saved.");
    return { code: order.code, quantity: order.quantity, total: order.total, buyerEmail: order.buyerEmail };
  },
});

// Staff only: put drives back on the shelf.
export const restock = action({
  input: { drive: integer(), quantity: integer().min(1).max(500), note: text().max(200).optional() },
  access: "editor",
  async handler({ drive, quantity, note }) {
    const row = await db.query.drives.findFirst({ where: { id: drive }, columns: { id: true, stock: true } });
    if (!row) throw new HttpError(404, "not_found", "No drive has that id.");
    await db.update(drives).set({ stock: row.stock + quantity }).where({ id: row.id });
    // The movement log is written by the app only (its API create rule is admin).
    await db.insert(stockMovements).values({ drive: row.id, change: quantity, reason: "restock", note: note ?? null });
    return { drive: row.id, stock: row.stock + quantity };
  },
});

// Staff only: an order leaves the warehouse.
export const markShipped = action({
  input: { order: integer() },
  access: "editor",
  async handler({ order }) {
    const row = await orders.get(order, { columns: { code: true, status: true } });
    if (!row) throw new HttpError(404, "not_found", "No order has that id.");
    if (row.status !== "placed") throw new HttpError(409, "conflict", `Order ${row.code} is already ${row.status}.`);
    const shipped = await orders.update(order, { status: "shipped", shippedAt: new Date().toISOString() });
    return { code: shipped.code, status: shipped.status };
  },
});

// Staff only: the orders still waiting to leave the warehouse, for the admin screen below.
export const pendingOrders = action({
  input: {},
  access: "editor",
  readonly: true,
  async handler() {
    const rows = await db.query.orders.findMany({
      where: { status: "placed" },
      columns: { id: true, code: true, buyerName: true, quantity: true, total: true },
    });
    return { rows: rows.map((o) => ({ id: o.id, code: o.code, buyer: o.buyerName, quantity: o.quantity, total: o.total })) };
  },
});

// A TypedPress Admin screen declared in TypeScript: a list over pendingOrders with a "Mark shipped"
// action per row. It shows in TypedPress Admin's sidebar and under Tools in classic wp-admin.
export const shipping = adminScreen({
  title: "Shipping",
  description: "Orders placed and not yet shipped.",
  access: "editor",
  view: {
    action: pendingOrders,
    items: "rows",
    id: "id",
    fields: {
      code: { label: "Order code" },
      buyer: { label: "Buyer" },
      quantity: { label: "Quantity", type: "integer" },
      total: { label: "Total", type: "number" },
    },
    layout: { type: "table", titleField: "code", fields: ["buyer", "quantity", "total"] },
  },
  actions: [{ id: "ship", label: "Mark shipped", action: markShipped, input: { order: item("id") } }],
  menu: { icon: "dashicons-airplane" },
  classic: { parent: "tools.php" },
});
