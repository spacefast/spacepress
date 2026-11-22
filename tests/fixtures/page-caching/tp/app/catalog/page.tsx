import { db, text } from "typedpress";
import type { PageProps } from "typedpress/app";

export const search = { media: text().optional() };

export default async function Catalog({ search }: PageProps<"catalog", { media: string | null }>) {
  const shop = await db.globals.shop.get();
  const rows = search.media
    ? await db.query.drives.findMany({ where: { status: "published", media: search.media }, orderBy: { price: "asc" } })
    : await db.query.drives.findMany({ where: { status: "published" }, orderBy: { price: "asc" } });
  return (
    <ul className="catalog" data-currency={shop.currency}>
      {rows.map((d) => <li>{d.name}</li>)}
    </ul>
  );
}
