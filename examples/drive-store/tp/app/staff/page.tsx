// The back room, on the storefront: orders to ship and drives running low. Everything else (editing
// drives, moderating reviews, the shop settings) is in TypedPress Admin.
import { db } from "typedpress";
import { useFormState } from "typedpress/app";
import { drives, orders, stockMovements } from "typedpress:db";
import { markShipped, restock } from "../../server";
import { money } from "../_lib/format";

export const metadata = { title: "Staff", robots: { index: false, follow: false } };

export default async function Staff() {
  const shop = await db.globals.shop.get();
  const shipped = useFormState(markShipped);
  const restocked = useFormState(restock);
  const open = await orders.list({
    where: { status: "placed" },
    orderBy: { id: "asc" },
    limit: 100,
    columns: { id: true, code: true, drive: true, quantity: true, total: true, buyerName: true, buyerEmail: true },
  });
  const low = await drives.list({
    where: { stock: { lte: shop.lowStockAt } },
    orderBy: { stock: "asc" },
    limit: 100,
    columns: { id: true, name: true, stock: true },
  });
  const moves = await stockMovements.list({
    orderBy: { id: "desc" },
    limit: 10,
    columns: { drive: true, at: true, change: true, reason: true },
  });
  const names = new Map<number, string>();
  for (const drive of low) names.set(drive.id, drive.name);
  const missing = new Set<number>();
  for (const order of open) {
    if (!names.has(order.drive)) missing.add(order.drive);
  }
  for (const movement of moves) {
    if (!names.has(movement.drive)) missing.add(movement.drive);
  }
  if (missing.size > 0) {
    const titles = await drives.list({
      where: { id: { in: Array.from(missing) } },
      limit: missing.size,
      columns: { id: true, name: true },
    });
    for (const drive of titles) names.set(drive.id, drive.name);
  }
  return (
    <>
      <h1>Staff</h1>
      <p className="muted">Edit drives, reviews and <a href="/wp-admin/new/">shop settings</a> in TypedPress Admin.</p>

      <h2>Orders to ship</h2>
      {shipped.result ? <p className="ok">Order {shipped.result.code} is {shipped.result.status}.</p> : null}
      {shipped.error ? <p className="error">{shipped.error.message}</p> : null}
      {open.length === 0 ? <p className="empty">Nothing to ship.</p> : null}
      {open.length > 0 ? (
        <table className="table">
          <thead><tr><th>Order</th><th>Drive</th><th>Qty</th><th>Total</th><th>Buyer</th><th></th></tr></thead>
          <tbody>
            {open.map((o) => (
              <tr>
                <td><code>{o.code}</code></td>
                <td>{names.get(o.drive)}</td>
                <td>{o.quantity}</td>
                <td>{money(o.total, shop.currency)}</td>
                <td>{o.buyerName} <span className="muted">{o.buyerEmail}</span></td>
                <td>
                  <form action={markShipped} className="inline">
                    <input type="hidden" name="order" value={String(o.id)} />
                    <button>Mark shipped</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <h2>Low stock</h2>
      {restocked.result ? <p className="ok">Restocked: {restocked.result.stock} on the shelf now.</p> : null}
      {restocked.error ? <p className="error">{restocked.error.message}</p> : null}
      {low.length === 0 ? <p className="empty">Every drive has more than {shop.lowStockAt} in stock.</p> : null}
      <ul className="list">
        {low.map((d) => (
          <li>
            <span>{d.name} <span className="muted">({d.stock} left)</span></span>
            <form action={restock} className="inline">
              <input type="hidden" name="drive" value={String(d.id)} />
              <input name="quantity" type="number" min="1" max="500" defaultValue="5" aria-label="Quantity" />
              <button>Restock</button>
            </form>
          </li>
        ))}
      </ul>

      <h2>Recent stock movements</h2>
      <table className="table">
        <thead><tr><th>When</th><th>Drive</th><th>Change</th><th>Reason</th></tr></thead>
        <tbody>
          {moves.map((m) => (
            <tr><td>{m.at.slice(0, 16).replace("T", " ")}</td><td>{names.get(m.drive)}</td><td>{m.change > 0 ? `+${m.change}` : String(m.change)}</td><td>{m.reason}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
