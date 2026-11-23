import { db } from "spacepress";

export const metadata = { title: "Shopping list" };

export default async function Home() {
  const items = await db.query.shoppingList.findMany({ orderBy: { id: "asc" } });
  return (
    <ul>
      {items.map((item) => <li>{item.name}</li>)}
    </ul>
  );
}
