import { db } from "spacepress/server";
import { notFound, type PageProps } from "spacepress/app";

export default async function Drive({ params }: PageProps<"drives/[slug]">) {
  const item = await db.drives.get({ slug: params.slug });
  if (!item) notFound();
  const shop = await db.shop.get();
  return <p className="drive">{item.name}: {item.price} {shop.currency}, {item.stock} in stock</p>;
}
