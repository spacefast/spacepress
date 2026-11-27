import { f } from "spacepress";
import { db } from "spacepress/server";
import type { PageProps } from "spacepress/app";

export const search = { media: f.text().optional() };

export default async function Catalog({ search }: PageProps<"catalog", { media: string | null }>) {
  const shop = await db.shop.get();
  const rows = search.media
    ? await db.drives.list({ where: { status: "published", media: search.media }, orderBy: { price: "asc" } })
    : await db.drives.list({ where: { status: "published" }, orderBy: { price: "asc" } });
  return (
    <ul className="catalog" data-currency={shop.currency}>
      {rows.map((d) => <li>{d.name}</li>)}
    </ul>
  );
}
