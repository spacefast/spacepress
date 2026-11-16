import { db } from "typedpress";
import { products } from "../../../shop";
export const metadata = { title: "Shop", description: "Simple, useful things for everyday living." };
export default async function Shop() {
  const items = await db.query.products.findMany({ limit: 24, orderBy: { id: "asc" } });
  return <main className="shop-main"><p className="shop-eyebrow">The collection</p><h1>Made for everyday.</h1><p className="shop-intro">Simple, useful objects. A little more care in the things you choose.</p><div className="product-grid">{items.map((item) => <article key={item.id} className="product-card"><a href={item.url || "/shop"}><span className="product-placeholder" aria-hidden="true">{item.virtual ? "↗" : "◯"}</span><h2>{item.name}</h2></a><p>{item.price || "Unavailable"} EUR</p><p>{item.availability === "outofstock" ? "Out of stock" : item.virtual ? "Digital download" : "Ready to ship"}</p></article>)}</div></main>;
}
