import { action, adminScreen, db, integer, item } from "typedpress";
import { abilities } from "php/wordpress";
import { stockMovements } from "./schema";

export const restock = action({
  input: { drive: integer().min(1), quantity: integer().min(1).max(500) },
  access: "admin",
  idempotent: true,
  async handler({ drive, quantity }) {
    const stock = await abilities.call("drive-store/increase-product-stock", { id: drive, quantity });
    await db.insert(stockMovements).values({ drive, change: quantity, reason: "restock" });
    return { stock };
  },
});

export const markShipped = action({
  input: { order: integer().min(1) },
  access: "admin",
  idempotent: true,
  async handler({ order }) {
    const id = await abilities.call("drive-store/complete-order", { id: order });
    return { id };
  },
});

export async function processingOrders() {
  return await db.query.orders.findMany({
    where: { status: "processing" },
    orderBy: { id: "asc" },
    columns: { id: true, currency: true, total: true, lines: true },
    limit: 100,
  });
}

export const pendingOrders = action({
  input: {},
  access: "admin",
  readonly: true,
  async handler() {
    const orders = await processingOrders();
    return { rows: orders.map((order) => ({ id: order.id, total: `${order.total} ${order.currency}`, drives: order.lines.map((line) => `${line.quantity} × ${line.name}`).join(", ") })) };
  },
});

export const shipping = adminScreen({
  title: "Shipping",
  description: "WooCommerce orders ready to ship.",
  access: "admin",
  view: {
    action: pendingOrders,
    items: "rows",
    id: "id",
    fields: {
      id: { label: "Order", type: "integer" },
      drives: { label: "Drives" },
      total: { label: "Total" },
    },
    layout: { type: "table", titleField: "id", fields: ["drives", "total"] },
  },
  actions: [{ id: "ship", label: "Mark shipped", action: markShipped, input: { order: item("id") } }],
  menu: { icon: "dashicons-airplane" },
  classic: { parent: "tools.php" },
});
