import { Content, Link, notFound } from "spacepress/app";
import type { PageProps } from "./$types";

export const metadata = async ({ params, db }: PageProps) => {
  const item = await db.supplies.get({ slug: params.slug });
  return { title: item?.name ?? "Kitchen supplies" };
};

// The product's own page: WooCommerce links here from the cart, the checkout and order mail.
export default async function Supply({ params, db }: PageProps) {
  const item = await db.supplies.get({ slug: params.slug });
  if (!item) notFound();
  return (
    <article>
      <h1>{item.name}</h1>
      <p>USD {item.price}{item.sku && ` · SKU ${item.sku}`}</p>
      <Content value={item.description} />
      {item.purchasable && <a href={`/cart/?add-to-cart=${item.id}`}>Add to cart</a>}
      <Link href="/shop">All supplies</Link>
    </article>
  );
}
