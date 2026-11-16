import { db } from "typedpress";

export const access = "anyone";

export async function GET() {
  const items = await db.query.shoppingList.findMany({});
  return { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(items.map((item) => item.name)) };
}
