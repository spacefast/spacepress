// The signed-in customer's orders. The orders kind's read rule does the filtering: a customer
// reads the rows with their own `buyerId`, so this page asks for "every order" and gets theirs.
import { db } from "first";
import { Link } from "first/app";
import { orders } from "first:db";
import { money } from "../_lib/format";

export const metadata = { title: "My orders", robots: { index: false, follow: false } };

export default async function MyOrders() {
  const shop = await db.globals.shop.get();
  const mine = await orders.list({ orderBy: { id: "desc" }, limit: 100, with: { drive: true } });
  return (
    <>
      <h1>My orders</h1>
      {mine.length === 0 ? <p className="empty">No orders yet. <Link href="/">Browse the catalog</Link>.</p> : null}
      {mine.length > 0 ? (
        <table className="table">
          <thead><tr><th>Order</th><th>Drive</th><th>Qty</th><th>Total</th><th>Status</th><th>Placed</th></tr></thead>
          <tbody>
            {mine.map((o) => (
              <tr>
                <td><code>{o.code}</code></td>
                <td>{o.drive.name}</td>
                <td>{o.quantity}</td>
                <td>{money(o.total, shop.currency)}</td>
                <td><span className={`pill ${o.status}`}>{o.status}</span></td>
                <td>{o.placedAt.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
