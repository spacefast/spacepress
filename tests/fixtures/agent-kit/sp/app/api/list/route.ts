import { db } from "spacepress/server";

export const access = "anyone";

export async function GET() {
  const items = await db.shoppingList.list();
  return Response.json(items.map((item) => item.name));
}
