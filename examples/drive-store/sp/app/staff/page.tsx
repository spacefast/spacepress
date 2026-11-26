import { db } from "spacepress/server";
import { useFormState } from "spacepress/server/app";
import { markShipped, processingOrders, restock } from "../../server";

export const metadata = { title: "Staff", robots: { index: false, follow: false } };

export default async function Staff() {
  const settings = await db.globals.settings.get();
  const shipped = useFormState(markShipped);
  const restocked = useFormState(restock);
  const orders = await processingOrders();
  const low = await db.query.drives.findMany({
    where: { stockQuantity: { lte: settings.lowStockAt } },
    orderBy: { stockQuantity: "asc" }, limit: 100,
    columns: { id: true, name: true, stockQuantity: true },
  });
  const moves = await db.query.stockMovements.findMany({ orderBy: { id: "desc" }, limit: 10 });

  return (
    <>
      <h1>Staff</h1>
      <p><a href="/wp-admin/new/screens/shipping">Shipping in SpacePress Admin</a></p>
      <h2>Orders to ship</h2>
      {shipped.result && <p className="ok">Order {shipped.result.id} marked shipped.</p>}
      {shipped.error && <p className="error" role="alert">{shipped.error.message}</p>}
      {orders.length === 0 && <p>Nothing to ship.</p>}
      <ul className="list">
        {orders.map((order) => (
          <li>
            <span>Order {order.id} · {order.lines.map((line) => `${line.quantity} × ${line.name}`).join(", ")} · {order.total} {order.currency}</span>
            <form action={markShipped} className="inline">
              <input type="hidden" name="order" value={order.id} />
              <button>Mark shipped</button>
            </form>
          </li>
        ))}
      </ul>

      <h2>Low stock</h2>
      {restocked.result && <p className="ok">Restocked. {restocked.result.stock} on the shelf.</p>}
      {restocked.error && <p className="error" role="alert">{restocked.error.message}</p>}
      {low.length === 0 && <p>No drives are at or below the low stock threshold.</p>}
      <ul className="list">
        {low.map((drive) => (
          <li>
            <span>{drive.name} · {drive.stockQuantity} left</span>
            <form action={restock} className="inline">
              <input type="hidden" name="drive" value={drive.id} />
              <label>Quantity <input name="quantity" type="number" min="1" max="500" defaultValue="5" /></label>
              <button>Restock</button>
            </form>
          </li>
        ))}
      </ul>

      <h2>Recent stock movements</h2>
      <table className="table">
        <thead><tr><th>When</th><th>Product</th><th>Order</th><th>Change</th><th>Reason</th></tr></thead>
        <tbody>{moves.map((move) => (
          <tr><td>{move.at.slice(0, 16).replace("T", " ")}</td><td>{move.drive}</td><td>{move.order ?? "—"}</td><td>{move.change}</td><td>{move.reason}</td></tr>
        ))}</tbody>
      </table>
    </>
  );
}
