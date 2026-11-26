import { db } from "spacepress/server";

export async function firstDrive() {
  return await db.query.drives.findFirst({ where: { status: "published" }, orderBy: { price: "desc" } });
}
