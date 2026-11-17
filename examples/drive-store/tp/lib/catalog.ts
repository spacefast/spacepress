// Storefront reads, shared by the pages. Reads run as the visitor, so a drive an editor hasn't
// published never shows.
import { drives } from "typedpress:db";

export async function catalog(q: string, media: string, condition: string) {
  const rows = q
    ? await drives.list({ where: { status: "published" }, search: q, orderBy: { price: "asc" }, limit: 100 })
    : await drives.list({ where: { status: "published" }, orderBy: { price: "asc" }, limit: 100 });
  // `where` takes one value per field, so the optional filters apply here.
  return rows
    .filter((d) => (media === "" || d.media === media) && (condition === "" || d.condition === condition))
    .map((d) => ({ ...d, href: `/drives/${d.slug ?? ""}` }));
}
