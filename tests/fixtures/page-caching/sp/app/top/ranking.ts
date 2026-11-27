import { db } from "spacepress/server";

export async function firstDrive() {
  return (await db.drives.list({ where: { status: "published" }, orderBy: { price: "desc" }, limit: 1 }))[0] ?? null;
}
