import { db } from "typedpress";

// The most expensive drive: one row, chosen by rank, so a new row can take its place.
export default async function Top() {
  const top = await db.query.drives.findFirst({ where: { status: "published" }, orderBy: { price: "desc" } });
  return <p className="top">{top ? top.name : "none"}</p>;
}
