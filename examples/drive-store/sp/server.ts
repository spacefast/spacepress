import { adminScreen, db, HttpError, item, mutation, query } from "spacepress";
import { abilities } from "php/wordpress";
import { stockMovements } from "./schema";

export const restock = mutation({
  access: "admin",
  idempotent: true,
}, async ({ drive, quantity }: { drive: number; quantity: number }) => {
  if (!Number.isInteger(drive) || drive < 1) throw new HttpError(422, "invalid_input", "drive must be a positive integer", "/drive");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) throw new HttpError(422, "invalid_input", "quantity must be an integer between 1 and 500", "/quantity");
  const stock = await abilities.call("drive-store/increase-product-stock", { id: drive, quantity });
  await db.insert(stockMovements).values({ drive, change: quantity, reason: "restock" });
  return { stock };
});

export const markShipped = mutation({
  access: "admin",
  idempotent: true,
}, async ({ order }: { order: number }) => {
  if (!Number.isInteger(order) || order < 1) throw new HttpError(422, "invalid_input", "order must be a positive integer", "/order");
  const id = await abilities.call("drive-store/complete-order", { id: order });
  return { id };
});

export async function processingOrders() {
  return await db.query.orders.findMany({
    where: { status: "processing" },
    orderBy: { id: "asc" },
    columns: { id: true, currency: true, total: true, lines: true },
    limit: 100,
  });
}

export const pendingOrders = query({
  access: "admin",
}, async () => {
  const orders = await processingOrders();
  return { rows: orders.map((order) => ({ id: order.id, total: `${order.total} ${order.currency}`, drives: order.lines.map((line) => `${line.quantity} × ${line.name}`).join(", ") })) };
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
