import { db } from "typedpress";
import type { PageProps } from "typedpress/app";

export default async function Drive({ item }: PageProps<"drives/[slug]">) {
  const shop = await db.globals.shop.get();
  return <p className="drive">{item.name}: {item.price} {shop.currency}, {item.stock} in stock</p>;
}
