// One drive. The kind's `url` is /drives/:slug, so this page receives the drive as `item`, read as the visitor.
// Buying posts the form to the `buy` action; the confirmation comes back on this page.
import { db } from "typedpress";
import { Comments, Content, Link, Live, useFormState, type PageProps } from "typedpress/app";
import { buy } from "../../../server";
import { mediaName, money, size } from "../../_lib/format";

export const metadata = ({ item }: PageProps<"drives/[slug]">) => ({
  title: item.name,
  description: item.summary ?? `${item.brand} ${item.model}`,
});

export default async function Drive({ item }: PageProps<"drives/[slug]">) {
  const shop = await db.globals.shop.get();
  const state = useFormState(buy);
  return (
    <>
      <p className="crumbs"><Link href="/">← Back to the catalog</Link></p>
      <article className="product">
        <div>
          <h1>{item.name}</h1>
          {item.summary ? <p className="lede">{item.summary}</p> : null}
          <dl className="facts">
            <dt>Capacity</dt><dd>{size(item.capacityGb)} {mediaName(item.media)}</dd>
            <dt>Interface</dt><dd>{item.connector.toUpperCase()}</dd>
            <dt>Condition</dt><dd><span className={`pill ${item.condition}`}>{item.condition}</span></dd>
            <dt>Power-on hours</dt><dd>{item.powerOnHours === null ? "—" : String(item.powerOnHours)}</dd>
          </dl>
          <div className="prose"><Content value={item.description} /></div>
        </div>

        <aside className="buybox">
          <p className="price">{money(item.price, shop.currency)}</p>
          {/* Stock changes as people buy; the region updates in place, without a reload. */}
          <Live id="stock">
            <p className="muted">{item.stock > 0 ? `${item.stock} in stock` : "Sold out"}</p>
          </Live>
          {state.result ? (
            <p className="ok">Thanks! Your order code is <strong>{state.result.code}</strong> ({money(state.result.total, shop.currency)}).</p>
          ) : null}
          {state.error ? <p className="error">{state.error.message}</p> : null}
          <form action={buy} className="form">
            <input type="hidden" name="drive" value={String(item.id)} />
            <label>Name<input name="buyerName" required maxLength={80} defaultValue={state.values.buyerName ?? ""} /></label>
            <label>Email<input name="buyerEmail" type="email" required defaultValue={state.values.buyerEmail ?? ""} /></label>
            <label>Quantity<input name="quantity" type="number" min="1" max="5" defaultValue={state.values.quantity ?? "1"} /></label>
            <button className="primary" disabled={item.stock === 0}>Buy</button>
          </form>
          <p className="muted small">This is a demo shop: no payment is taken and nothing ships.</p>
        </aside>
      </article>

      <section className="reviews">
        <h2>Reviews</h2>
        <Comments for={item} />
      </section>
    </>
  );
}
