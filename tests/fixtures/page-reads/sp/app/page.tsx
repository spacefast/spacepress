import { db } from "spacepress/server";

export default async function Home() {
  const notes = await db.notes.list({ orderBy: { id: "desc" }, limit: 50 });
  return <ul className="page-list">{notes.map((n) => <li>{n.title}</li>)}</ul>;
}
