export const metadata = { title: "Cart", robots: { index: false, follow: false } };

export default function Cart() {
  return <section><h1>Your cart</h1><drive-cart><p role="status">Loading cart…</p></drive-cart></section>;
}
