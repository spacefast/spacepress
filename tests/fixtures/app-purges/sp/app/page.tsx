import { db } from "spacepress/server";

export default async function Home() {
  const notes = await db.notes.list({ orderBy: { id: "asc" } });
  return <ul className="home">{notes.map((n) => <li>{n.title}</li>)}</ul>;
}
