import { db } from "typedpress";
import { Content, Link } from "typedpress/app";

export const metadata = { title: "Kitchen supplies" };

export default async function Supplies() {
  const supplies = await db.query.supplies.findMany({ limit: 20 });
  return (
    <>
      <h1>Kitchen supplies</h1>
      {supplies.map((supply) => (
        <article>
          <h2>{supply.name}</h2>
          <Content value={supply.description} />
          {supply.purchasable && <a href={`/cart/?add-to-cart=${supply.id}`}>Add to cart · USD {supply.price}</a>}
        </article>
      ))}
      <Link href="/cart">View cart</Link>
    </>
  );
}
