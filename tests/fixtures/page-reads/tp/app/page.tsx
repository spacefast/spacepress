import { db } from "typedpress";

export default async function Home() {
  const notes = await db.query.notes.findMany({ orderBy: { id: "desc" }, limit: 50 });
  return <ul className="page-list">{notes.map((n) => <li>{n.title}</li>)}</ul>;
}
