import { db } from "typedpress";
import { get_option } from "php/wordpress";
export default async function CategoryPage({ item }) {
  const currency = String(get_option("woocommerce_currency"));
  const items = await db.query.products.findMany({ where: { categories: { has: item.id } }, limit: 24 });
  return <main className="shop-main"><a href="/shop">← All products</a><h1>{item.name}</h1><div className="product-grid">{items.map((product) => <article key={product.id} className="product-card"><a href={product.url || "/shop"}><h2>{product.name}</h2></a><p>{product.price} {currency}</p></article>)}</div></main>;
}
