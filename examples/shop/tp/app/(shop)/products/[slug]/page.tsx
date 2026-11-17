import { Html } from "typedpress/app";
import { get_option } from "php/wordpress";
export default function ProductPage({ item }) {
  const currency = String(get_option("woocommerce_currency"));
  return <main className="shop-main product-detail"><a href="/shop">← All products</a><div className="product-columns"><div className="product-placeholder product-hero" aria-hidden="true">{item.virtual ? "↗" : "◯"}</div><section><p className="shop-eyebrow">The collection</p><h1>{item.name}</h1><p className="product-price">{item.price || "Unavailable"} {currency}</p><Html value={item.description} /><p>{item.virtual ? "Digital download, delivered after payment." : "Shipping calculated in your cart."}</p>{item.purchasable && item.availability !== "outofstock" ? <shop-add-to-cart data-product={item.id}><button type="button">Add to cart</button></shop-add-to-cart> : <p>Currently unavailable</p>}<p><a href="/cart">View cart →</a></p></section></div></main>;
}
