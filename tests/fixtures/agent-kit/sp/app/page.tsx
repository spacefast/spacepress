import { db } from "spacepress/server";

export const metadata = { title: "Shopping list" };

export default async function Home() {
  const items = await db.shoppingList.list({ orderBy: { id: "asc" } });
  return (
    <ul>
      {items.map((item) => <li>{item.name}</li>)}
    </ul>
  );
}
