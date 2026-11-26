import { db } from "spacepress/server";
import type { PageProps } from "spacepress/server/app";

export default async function Drive({ item }: PageProps<"drives/[slug]">) {
  const shop = await db.globals.shop.get();
  return <p className="drive">{item.name}: {item.price} {shop.currency}, {item.stock} in stock</p>;
}
