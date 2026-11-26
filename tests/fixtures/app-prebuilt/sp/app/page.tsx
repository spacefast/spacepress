import { db } from "spacepress/server";

export const metadata = { title: "Home" };

export default async function Home() {
  const notes = await db.query.notes.findMany({ orderBy: { id: "asc" } });
  return <ul className="home">{notes.map((n) => <li>{n.title}</li>)}</ul>;
}
